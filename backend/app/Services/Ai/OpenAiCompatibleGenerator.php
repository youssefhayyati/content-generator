<?php

namespace App\Services\Ai;

use Generator;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Text from any OpenAI-compatible chat API: a team gateway, OpenRouter, vLLM, LM Studio, or
 * Ollama's /v1 endpoint. Same contract as Claude's generator, so callers don't care which.
 */
class OpenAiCompatibleGenerator implements TextGenerator
{
    public function __construct(
        private readonly string $provider,
        private readonly string $baseUrl,
        private readonly ?string $key,
        private readonly ?UsageMeter $usage = null,
    ) {}

    public function enabled(): bool
    {
        return filled($this->baseUrl);
    }

    public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
    {
        $response = $this->send([
            'model' => $model,
            'stream' => true,
            'stream_options' => ['include_usage' => true],
            'messages' => [['role' => 'system', 'content' => $system], ['role' => 'user', 'content' => $prompt]],
            ...$this->reasoning($effort),
        ], stream: true);

        $body = $response->toPsrResponse()->getBody();
        $buffer = '';
        while (! $body->eof()) {
            $buffer .= $body->read(2048);
            while (($end = strpos($buffer, "\n")) !== false) {
                $line = trim(substr($buffer, 0, $end));
                $buffer = substr($buffer, $end + 1);
                if (! str_starts_with($line, 'data:')) {
                    continue;
                }
                $data = trim(substr($line, 5));
                if ($data === '[DONE]') {
                    return;
                }
                $event = json_decode($data, true);
                if (isset($event['error'])) {
                    throw new GenerationFailed('The model stopped: '.($event['error']['message'] ?? 'unknown error').'.');
                }
                if (isset($event['usage']['prompt_tokens'])) {
                    $this->usage?->record($this->provider, $model, (int) $event['usage']['prompt_tokens'], (int) ($event['usage']['completion_tokens'] ?? 0));
                }
                $text = $event['choices'][0]['delta']['content'] ?? null;
                if (is_string($text) && $text !== '') {
                    yield $text;
                }
            }
        }
    }

    /**
     * The schema goes in two places on purpose. `response_format` is the real constraint on
     * gateways that implement it, but plenty don't — Ollama Cloud accepts the parameter and
     * ignores it outright, answering with keys of the model's own invention and none of the ones
     * asked for, which silently empties every caller that reads named fields. Spelling the shape
     * out in the prompt costs a few tokens and makes those gateways conform, so the contract
     * holds either way rather than depending on which endpoint is configured.
     */
    public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
    {
        $messages = [
            ['role' => 'system', 'content' => $system."\n\nReply with one JSON object only."],
            // Some providers ignore response_format entirely; the shape goes in the prompt too.
            ['role' => 'user', 'content' => (is_string($content) ? $content : $this->blocks($content))."\n\nReply with one JSON object of exactly this shape: ".$this->shapeHint($schema)],
        ];

        // Structured output is a promise some providers keep loosely: check the required keys
        // are actually there, and give the model one chance to correct itself before failing.
        for ($attempt = 1; $attempt <= 2; $attempt++) {
            $response = $this->send([
                'model' => $model,
                'messages' => $messages,
                'response_format' => ['type' => 'json_schema', 'json_schema' => ['name' => 'reply', 'schema' => $schema, 'strict' => true]],
                ...$this->reasoning($effort),
            ]);
            $this->usage?->record($this->provider, $model, (int) $response->json('usage.prompt_tokens', 0), (int) $response->json('usage.completion_tokens', 0));

            $text = (string) $response->json('choices.0.message.content', '');
            // Some local models wrap JSON in a code fence despite being asked not to.
            $data = json_decode(preg_replace('/^```(?:json)?\s*|\s*```$/', '', trim($text)), true);
            $problem = is_array($data) ? $this->shapeProblem($data, $schema) : 'That was not a JSON object';
            if (is_array($data) && ! $problem) {
                return $data;
            }

            $messages[] = ['role' => 'assistant', 'content' => $text];
            $messages[] = ['role' => 'user', 'content' => $problem.'. Reply again with one JSON object exactly in the asked shape, nothing else.'];
        }

        throw new GenerationFailed('The model’s answer didn’t match what was asked for. Try again, or switch model.');
    }

    /**
     * A one-line, human-readable description of the schema, for prompts: `{"big_idea": string,
     * "pillars": [{"name": string, "why": string}], …}`. Enough for a model to aim at.
     */
    private function shapeHint(array $schema): string
    {
        $describe = function (array $schema) use (&$describe): string {
            if (($schema['type'] ?? 'object') === 'array') {
                return '['.$describe($schema['items'] ?? ['type' => 'string']).']';
            }
            if (($schema['type'] ?? 'object') !== 'object') {
                $type = $schema['type'] ?? 'string';
                $enum = isset($schema['enum']) ? ' ('.implode(' | ', $schema['enum']).')' : '';

                return $type.$enum;
            }

            return '{'.implode(', ', array_map(fn ($k, $v) => "\"{$k}\": ".$describe($v), array_keys($schema['properties'] ?? []), array_values($schema['properties'] ?? []))).'}';
        };

        return $describe($schema);
    }

    /**
     * What's wrong with the answer's shape, in one sentence, or null when it fits: the
     * required top-level keys, and the required keys of objects inside arrays of objects.
     */
    private function shapeProblem(mixed $data, array $schema): ?string
    {
        if (! is_array($data) || array_is_list($data) && ($schema['type'] ?? 'object') === 'object') {
            return 'That was not a JSON object';
        }
        $missing = array_diff($schema['required'] ?? [], array_keys($data));
        if ($missing) {
            return 'It missed the required keys: '.implode(', ', $missing);
        }
        foreach (($schema['properties'] ?? []) as $key => $prop) {
            if (($prop['type'] ?? null) !== 'array' || ! isset($data[$key]) || ! is_array($data[$key])) {
                continue;
            }
            $itemRequired = $prop['items']['required'] ?? [];
            foreach ($data[$key] as $n => $entry) {
                if (! is_array($entry) || ($missing = array_diff($itemRequired, array_keys($entry)))) {
                    return "In \"{$key}\", entry ".($n + 1).' should be an object with: '.implode(', ', $itemRequired ?: ['the asked fields']);
                }
            }
        }

        return null;
    }

    /**
     * How hard a reasoning model should think, as `reasoning_effort`. Omitted entirely when the
     * caller has no preference, which leaves the model on its default.
     *
     * "low" is the useful setting for a conversational agent: measurably faster, and on GLM it
     * returns no reasoning at all while the answer stays clean in `content`. Note that "none" is
     * deliberately never sent — it does not stop a reasoning model thinking, it stops the thinking
     * being separated out, so the monologue lands inside `content` (complete with a stray
     * `</think>`) and ends up in a caption. Capped at "high" because xhigh/max aren't accepted here.
     *
     * @return array<string, string>
     */
    private function reasoning(?string $effort): array
    {
        return match ($effort) {
            'low' => ['reasoning_effort' => 'low'],
            'medium' => ['reasoning_effort' => 'medium'],
            'high', 'xhigh', 'max' => ['reasoning_effort' => 'high'],
            default => [],
        };
    }

    /**
     * Anthropic-style content blocks (text, base64 images) in OpenAI's shape.
     *
     * @param  list<array<string, mixed>>  $blocks
     * @return list<array<string, mixed>>
     */
    private function blocks(array $blocks): array
    {
        return array_map(fn (array $b) => $b['type'] === 'image'
            ? ['type' => 'image_url', 'image_url' => ['url' => "data:{$b['source']['mediaType']};base64,{$b['source']['data']}"]]
            : ['type' => 'text', 'text' => $b['text']], $blocks);
    }

    private function send(array $body, bool $stream = false): Response
    {
        try {
            $response = $this->client($stream)->post($this->baseUrl.'/chat/completions', $body);
        } catch (ConnectionException) {
            throw new GenerationFailed('Couldn’t reach the model. Is the '.($this->provider === 'ollama' ? 'Ollama server' : 'gateway').' running?');
        }

        if ($response->status() === 401 || $response->status() === 403) {
            throw new GenerationFailed('The '.$this->provider.' rejected the key.');
        }
        if ($response->status() === 429) {
            throw new GenerationFailed('The model is busy, or the spend cap is reached. Give it a minute.');
        }
        if (! $response->successful()) {
            throw new GenerationFailed('The model couldn’t answer ('.$response->status().'). Try again, or switch model.');
        }

        return $response;
    }

    private function client(bool $stream): PendingRequest
    {
        return Http::timeout(600)->acceptJson()
            ->when($this->key, fn (PendingRequest $r) => $r->withToken($this->key))
            ->when($stream, fn (PendingRequest $r) => $r->withOptions(['stream' => true]));
    }
}

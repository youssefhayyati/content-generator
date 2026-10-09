<?php

namespace App\Services\Ai\Models;

use App\Models\ModelEval;
use App\Services\Ai\GenerationFailed;
use Illuminate\Support\Collection;
use Throwable;

/**
 * A small eval suite for text models on the studio's real work: captions within limits, posts
 * that keep a brand voice, other languages, structured output. Each task is scored by rule
 * checks, and, when Claude is available, by Claude as a judge of the writing.
 */
class ModelEvals
{
    private const SYSTEM = 'You write social media posts. Reply with the post only: no preamble, no quotation marks, no notes.';

    public function __construct(private readonly ModelRegistry $models) {}

    /**
     * @return array<string, array{label: string, prompt: string, system?: string, json?: array<string, mixed>}>
     */
    public function tasks(): array
    {
        return [
            'caption' => ['label' => 'Instagram caption within limits',
                'prompt' => 'Write an Instagram caption for a hand-poured lavender and fig soy candle from a small studio in Lyon. At most 300 characters and at most 5 hashtags.'],
            'x_post' => ['label' => 'X post with the facts right',
                'prompt' => 'Write an X post announcing a candle pop-up this Saturday at 10:00 in Lyon’s Croix-Rousse. Under 280 characters.'],
            'french' => ['label' => 'Writes in French',
                'prompt' => 'Écris une légende Instagram en français, de moins de 200 caractères, pour une bougie parfumée à la figue.'],
            'voice' => ['label' => 'Keeps the brand voice',
                'system' => self::SYSTEM.' Editorial profile: tone warm and unhurried; never use exclamation marks; avoid the word "luxury".',
                'prompt' => 'Write a LinkedIn post, under 600 characters, about why the studio pours its candles in small batches.'],
            'json' => ['label' => 'Structured output',
                'prompt' => 'Give a headline under 60 characters and exactly 3 hashtags for an autumn candle launch.',
                'json' => ['type' => 'object', 'properties' => ['headline' => ['type' => 'string'], 'hashtags' => ['type' => 'array', 'items' => ['type' => 'string']]], 'required' => ['headline', 'hashtags'], 'additionalProperties' => false]],
        ];
    }

    /**
     * @return Collection<int, ModelEval>
     */
    public function run(string $modelId): Collection
    {
        [$generator, $name] = $this->models->text($modelId);

        return collect($this->tasks())->map(function (array $task, string $key) use ($generator, $name, $modelId) {
            try {
                if (isset($task['json'])) {
                    $data = $generator->json($name, self::SYSTEM, $task['prompt'], $task['json'], 'low');
                    $output = json_encode($data, JSON_UNESCAPED_UNICODE);
                } else {
                    $output = trim(implode('', iterator_to_array($generator->stream($name, $task['system'] ?? self::SYSTEM, $task['prompt'], 'low'), false)));
                    $data = null;
                }
            } catch (GenerationFailed $e) {
                return ModelEval::create(['model' => $modelId, 'task' => $key, 'score' => 0, 'detail' => 'Failed: '.$e->getMessage()]);
            }

            [$rules, $notes] = $this->rules($key, $output, $data);
            $judge = isset($task['json']) ? null : $this->judge($task['prompt'], $output);
            $score = $judge === null ? $rules : (int) round($rules * 0.6 + $judge * 0.4);

            return ModelEval::create([
                'model' => $modelId,
                'task' => $key,
                'score' => $score,
                'detail' => implode(' ', $notes).($judge !== null ? " Judge: {$judge}/100." : ''),
                'output' => mb_substr($output, 0, 2000),
            ]);
        })->values();
    }

    /**
     * @return array{0: int, 1: list<string>}
     */
    private function rules(string $task, string $text, ?array $data): array
    {
        $len = mb_strlen($text);
        $tags = preg_match_all('/(?<![\w#])#[\p{L}\p{N}_]+/u', $text);
        $has = fn (string $needle) => mb_stripos($text, $needle) !== false;
        $checks = match ($task) {
            'caption' => ['≤ 300 characters' => $len <= 300, '1–5 hashtags' => $tags >= 1 && $tags <= 5, 'mentions lavender' => $has('lavender'), 'no preamble' => ! preg_match('/^(here|sure|caption)\b/i', $text)],
            'x_post' => ['≤ 280 characters' => $len <= 280, 'says Saturday' => $has('saturday') || $has('sat'), 'says 10:00' => $has('10'), 'says Croix-Rousse' => $has('croix')],
            'french' => ['≤ 200 characters' => $len <= 200, 'in French' => preg_match_all('/\b(le|la|les|de|des|une|un|et|pour|avec|votre|vos|à|du)\b/iu', $text) >= 3, 'mentions figue' => $has('figue')],
            'voice' => ['≤ 600 characters' => $len <= 600, 'no exclamation marks' => ! str_contains($text, '!'), 'avoids “luxury”' => ! $has('luxury')],
            'json' => ['valid JSON' => is_array($data), 'headline ≤ 60' => mb_strlen((string) ($data['headline'] ?? '')) <= 60 && filled($data['headline'] ?? null), 'exactly 3 hashtags' => count($data['hashtags'] ?? []) === 3],
        };
        $passed = count(array_filter($checks));

        return [(int) round($passed / count($checks) * 100), array_map(fn ($ok, $label) => ($ok ? '✓ ' : '✗ ').$label.'.', $checks, array_keys($checks))];
    }

    /**
     * A judge model's 0–100 on how publishable the writing is, or null when none is available.
     */
    private function judge(string $prompt, string $output): ?int
    {
        try {
            [$judge, $name] = $this->models->text($this->models->textModelOr((string) config('ai.intake.model')));
            $verdict = $judge->json($name,
                'You judge social media copy for a brand studio. Score how ready it is to publish as written: specific, natural, on brief, no filler. 0 is unusable, 100 is ready to post.',
                "Brief: {$prompt}\n\nCopy:\n{$output}",
                ['type' => 'object', 'properties' => ['score' => ['type' => 'integer'], 'reason' => ['type' => 'string']], 'required' => ['score', 'reason'], 'additionalProperties' => false],
                'low');

            return max(0, min(100, (int) ($verdict['score'] ?? 0)));
        } catch (Throwable) {
            return null;
        }
    }
}

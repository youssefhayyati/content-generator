<?php

namespace Tests\Feature;

use App\Services\Ai\GenerationFailed;
use App\Services\Ai\OpenAiCompatibleGenerator;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class OpenAiCompatibleGeneratorTest extends TestCase
{
    public function test_a_model_that_cannot_think_is_asked_again_without_reasoning_effort(): void
    {
        Http::fake([
            'ollama.test/v1/chat/completions' => Http::sequence()
                ->push(['error' => ['message' => '"llama3.2:1b" does not support thinking', 'type' => 'invalid_request_error']], 400)
                ->push(['choices' => [['message' => ['content' => '{"ok": true}']]], 'usage' => ['prompt_tokens' => 5, 'completion_tokens' => 3]]),
        ]);

        $answer = (new OpenAiCompatibleGenerator('ollama', 'https://ollama.test/v1', null))
            ->json('llama3.2:1b', 'Answer.', 'Say ok.', ['type' => 'object', 'properties' => ['ok' => ['type' => 'boolean']], 'required' => ['ok']], 'medium');

        $this->assertSame(['ok' => true], $answer);
        $sent = Http::recorded()->map(fn ($pair) => $pair[0]);
        $this->assertCount(2, $sent);
        $this->assertSame('medium', $sent[0]['reasoning_effort']);
        $this->assertArrayNotHasKey('reasoning_effort', $sent[1]->data());
    }

    public function test_other_bad_requests_still_fail(): void
    {
        Http::fake(['ollama.test/v1/chat/completions' => Http::response(['error' => ['message' => 'model not found']], 400)]);

        $this->expectException(GenerationFailed::class);
        (new OpenAiCompatibleGenerator('ollama', 'https://ollama.test/v1', null))
            ->json('missing', 'Answer.', 'Say ok.', ['type' => 'object', 'properties' => ['ok' => ['type' => 'boolean']], 'required' => ['ok']], 'medium');
    }
}

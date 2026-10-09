<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\TextGenerator;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class WritingTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Stands in for Claude: replies with fixed chunks (or fails), and keeps what it was asked.
     */
    private function fakeGenerator(array $chunks = ['Spring ', 'is here.'], ?string $failWith = null, bool $enabled = true): TextGenerator
    {
        $fake = new class($chunks, $failWith, $enabled) implements TextGenerator
        {
            /** @var list<array{model: string, system: string, prompt: string}> */
            public array $calls = [];

            public function __construct(private array $chunks, private ?string $failWith, private bool $on) {}

            public function enabled(): bool
            {
                return $this->on;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                $this->calls[] = compact('model', 'system', 'prompt');
                yield from $this->chunks;

                if ($this->failWith) {
                    throw new GenerationFailed($this->failWith);
                }
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                throw new GenerationFailed('The composer never asks for JSON.');
            }
        };

        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    private function brief(array $overrides = []): array
    {
        return array_merge([
            'brief' => 'Announce our spring collection',
            'format' => 'image',
            'platforms' => ['linkedin', 'x'],
            'tone' => 'playful',
        ], $overrides);
    }

    /**
     * @return list<array{event: string, data: mixed}>
     */
    private function events(TestResponse $response): array
    {
        preg_match_all('/^event: (\w+)\ndata: (.*)$/m', $response->streamedContent(), $matches, PREG_SET_ORDER);

        return array_map(fn (array $m) => ['event' => $m[1], 'data' => json_decode($m[2], true)], $matches);
    }

    public function test_guests_cannot_write(): void
    {
        $this->fakeGenerator();

        $this->spa()->getJson('/api/ai')->assertUnauthorized();
        $this->spa()->postJson('/api/ai/write', $this->brief())->assertUnauthorized();
    }

    public function test_the_composer_learns_whether_ai_writing_is_on(): void
    {
        $this->actingAs(User::factory()->create());

        $this->fakeGenerator(enabled: false);
        $this->spa()->getJson('/api/ai')
            ->assertOk()
            ->assertJsonPath('enabled', false)
            ->assertJsonPath('models.0.id', 'anthropic/claude-opus-5')
            ->assertJsonPath('models.0.label', 'Claude Opus 5')
            ->assertJsonPath('models.0.reach', 'Claude API')
            ->assertJsonPath('models.0.available', false)
            // The picker's filter needs the kind: drop it and the select is silently empty.
            ->assertJsonPath('models.0.kind', 'text')
            ->assertJsonPath('models.0.reason', 'No Anthropic API key is set.');

        $this->fakeGenerator();
        $this->spa()->getJson('/api/ai')->assertJsonPath('enabled', true)->assertJsonPath('default', 'anthropic/claude-opus-5');
    }

    public function test_a_post_streams_in_as_it_is_written(): void
    {
        $fake = $this->fakeGenerator();

        $response = $this->actingAs(User::factory()->create())->spa()->postJson('/api/ai/write', $this->brief());

        $response->assertOk();
        $this->assertStringStartsWith('text/event-stream', $response->headers->get('Content-Type'));
        $this->assertSame([
            ['event' => 'delta', 'data' => ['text' => 'Spring ']],
            ['event' => 'delta', 'data' => ['text' => 'is here.']],
            ['event' => 'done', 'data' => ['model' => 'claude-opus-5']],
        ], $this->events($response));

        // The model hears the brief, every network, and the strictest limit (X's 280).
        $prompt = $fake->calls[0]['prompt'];
        $this->assertSame('claude-opus-5', $fake->calls[0]['model']);
        $this->assertStringContainsString('Brief: Announce our spring collection', $prompt);
        $this->assertStringContainsString('Networks: LinkedIn, X', $prompt);
        $this->assertStringContainsString('Character limit: 280', $prompt);
        $this->assertStringContainsString('Tone: playful', $prompt);
        $this->assertStringContainsString('caption for an image', $prompt);
        $this->assertStringNotContainsString('<draft>', $prompt);
    }

    public function test_a_draft_is_sent_along_to_be_rewritten(): void
    {
        $fake = $this->fakeGenerator();

        $this->actingAs(User::factory()->create())->spa()
            ->postJson('/api/ai/write', $this->brief(['brief' => 'Make it shorter', 'draft' => 'Our spring collection is finally here.', 'tone' => null]))
            ->assertOk()
            ->streamedContent();

        $prompt = $fake->calls[0]['prompt'];
        $this->assertStringContainsString("<draft>\nOur spring collection is finally here.\n</draft>", $prompt);
        $this->assertStringContainsString('Brief: Make it shorter', $prompt);
        $this->assertStringNotContainsString('Tone:', $prompt);
    }

    public function test_a_failure_mid_stream_arrives_as_an_error_event(): void
    {
        $this->fakeGenerator(['Spring '], failWith: 'Claude is busy right now.');

        $response = $this->actingAs(User::factory()->create())->spa()->postJson('/api/ai/write', $this->brief());

        $this->assertSame([
            ['event' => 'delta', 'data' => ['text' => 'Spring ']],
            ['event' => 'error', 'data' => ['message' => 'Claude is busy right now.']],
        ], $this->events($response));
    }

    public function test_the_request_is_checked_before_anything_is_spent(): void
    {
        $fake = $this->fakeGenerator();
        $this->actingAs(User::factory()->create());

        $this->spa()->postJson('/api/ai/write', $this->brief(['brief' => '']))
            ->assertJsonValidationErrors(['brief' => 'Say what the post should be about.']);
        $this->spa()->postJson('/api/ai/write', $this->brief(['platforms' => []]))
            ->assertJsonValidationErrors('platforms');
        $this->spa()->postJson('/api/ai/write', $this->brief(['model' => 'gpt-5']))
            ->assertJsonValidationErrors('model');
        $this->spa()->postJson('/api/ai/write', $this->brief(['tone' => 'sarcastic']))
            ->assertJsonValidationErrors('tone');

        $this->assertSame([], $fake->calls);
    }

    public function test_writing_needs_ai_switched_on_and_a_confirmed_email(): void
    {
        $this->fakeGenerator(enabled: false);
        $this->actingAs(User::factory()->create())->spa()->postJson('/api/ai/write', $this->brief())
            ->assertStatus(503);

        $fake = $this->fakeGenerator();
        $this->actingAs(User::factory()->unverified()->create())->spa()->postJson('/api/ai/write', $this->brief())
            ->assertForbidden();
        $this->assertSame([], $fake->calls);
    }
}

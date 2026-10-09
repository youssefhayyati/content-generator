<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\ConnectorTest;
use App\Models\Generation;
use App\Models\ModelEval;
use App\Models\User;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\TextGenerator;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class StudioGenerationTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config([
            'ai.providers.higgsfield.key_id' => 'kid',
            'ai.providers.higgsfield.key_secret' => 'ksecret',
            'ai.providers.higgsfield.plan' => ['ideogram-4', 'wan-2-7-i2v'],
        ]);
    }

    private function fakeClaude(array $chunks = ['Autumn ', 'pour.'], ?string $fail = null, array|\Closure $json = []): object
    {
        $fake = new class($chunks, $fail, $json) implements TextGenerator
        {
            public array $calls = [];

            public function __construct(private array $chunks, private ?string $fail, private array|\Closure $json) {}

            public function enabled(): bool
            {
                return true;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                $this->calls[] = compact('model', 'prompt');
                yield from $this->chunks;
                if ($this->fail) {
                    throw new GenerationFailed($this->fail);
                }
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                $this->calls[] = ['model' => $model, 'prompt' => $content];

                return $this->json instanceof \Closure ? ($this->json)($schema) : (array_shift($this->json) ?? ['score' => 80, 'reason' => 'Fine.']);
            }
        };
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    private function higgsfieldTested(): void
    {
        ConnectorTest::create(['provider' => 'higgsfield', 'ok' => true, 'message' => 'Connected.']);
    }

    /**
     * @return list<array{event: string, data: mixed}>
     */
    private function events(TestResponse $response): array
    {
        preg_match_all('/^event: (\w+)\ndata: (.*)$/m', $response->streamedContent(), $m, PREG_SET_ORDER);

        return array_map(fn ($x) => ['event' => $x[1], 'data' => json_decode($x[2], true)], $m);
    }

    public function test_the_registry_lists_every_model_and_says_why_some_cannot_run(): void
    {
        $this->fakeClaude();
        $models = fn () => collect($this->actingAs(User::factory()->create())->spa()->getJson('/api/models')->assertOk()->json('models'))->keyBy('id');

        $list = $models();
        $this->assertTrue($list['anthropic/claude-opus-5-5']['available']);
        $this->assertSame('Claude API', $list['anthropic/claude-opus-5-5']['reach']);
        $this->assertSame('Not in your Higgsfield plan.', $list['higgsfield/soul']['reason']);
        $this->assertSame(['16:9', '9:16', '1:1'], $list['higgsfield/kling-3-pro']['capabilities']['aspect_ratios']);
        $this->assertSame('The Higgsfield connector hasn’t been tested.', $list['higgsfield/ideogram-4']['reason']);

        // Testing the connector: bad credentials are refused, good ones get "not found".
        Http::fake(['api.higgsfield.ai/requests/*' => Http::sequence()
            ->push(['detail' => 'Unauthorized'], 401)
            ->push(['detail' => 'Not found'], 404)]);
        $this->spa()->postJson('/api/models/test/higgsfield')->assertJsonPath('ok', false)->assertJsonPath('message', 'Higgsfield rejected the key.');
        $this->assertSame('The Higgsfield connector test failed: Higgsfield rejected the key.', $models()['higgsfield/ideogram-4']['reason']);

        $this->spa()->postJson('/api/models/test/higgsfield')->assertJsonPath('ok', true);
        $this->assertTrue($models()['higgsfield/ideogram-4']['available']);

        config(['ai.providers.higgsfield.plan' => ['wan-2-7-i2v']]);
        $this->assertSame('Not in your Higgsfield plan.', $models()['higgsfield/ideogram-4']['reason']);
    }

    public function test_gateway_and_local_models_are_discovered_and_labelled(): void
    {
        $this->fakeClaude();
        config([
            'ai.providers.gateway.url' => 'https://gw.example/v1', 'ai.providers.gateway.key' => 'team-key',
            'ai.providers.gateway.local_models' => ['llama-3.3-70b'], 'ai.providers.gateway.image_models' => ['flux-1'],
            'ai.providers.ollama.url' => 'http://ollama:11434',
        ]);
        Http::fake([
            'gw.example/v1/models' => Http::response(['data' => [['id' => 'llama-3.3-70b'], ['id' => 'gpt-frontier'], ['id' => 'flux-1']]]),
            'ollama:11434/api/tags' => Http::response(['models' => [['name' => 'qwen2.5:7b']]]),
        ]);

        $list = collect($this->actingAs(User::factory()->create())->spa()->getJson('/api/models')->json('models'))->keyBy('id');

        $this->assertSame(['text', true, 'Gateway'], [$list['gateway/llama-3.3-70b']['kind'], $list['gateway/llama-3.3-70b']['local'], $list['gateway/llama-3.3-70b']['reach']]);
        $this->assertFalse($list['gateway/gpt-frontier']['local']);
        $this->assertSame('image', $list['gateway/flux-1']['kind']);
        $this->assertSame(['Ollama', true], [$list['ollama/qwen2.5:7b']['reach'], $list['ollama/qwen2.5:7b']['local']]);
        Http::assertSent(fn (Request $r) => $r->url() === 'https://gw.example/v1/models' && $r->hasHeader('Authorization', 'Bearer team-key'));
    }

    public function test_groq_and_openrouter_models_are_discovered_and_only_the_free_ones_are_kept(): void
    {
        $this->fakeClaude();
        config([
            'ai.providers.groq.key' => 'gsk-test',
            'ai.providers.openrouter.key' => 'sk-or-test',
        ]);
        Http::fake([
            'api.groq.com/openai/v1/models' => Http::response(['data' => [['id' => 'llama-3.3-70b-versatile'], ['id' => 'gemma2-9b-it']]]),
            'openrouter.ai/api/v1/models' => Http::response(['data' => [['id' => 'deepseek/deepseek-r1:free'], ['id' => 'openai/gpt-5'], ['id' => 'meta-llama/llama-3.3-70b-instruct:free']]]),
        ]);

        $list = collect($this->actingAs(User::factory()->create())->spa()->getJson('/api/models')->assertOk()->json('models'))->keyBy('id');

        // Groq's short list comes through whole; the free models say so.
        $this->assertSame(['Groq', true, true], [$list['groq/llama-3.3-70b-versatile']['reach'], $list['groq/llama-3.3-70b-versatile']['local'], $list['groq/llama-3.3-70b-versatile']['available']]);
        $this->assertFalse($list['groq/gemma2-9b-it']['local']);
        // OpenRouter keeps only the ':free' ids.
        $this->assertTrue($list['openrouter/deepseek/deepseek-r1:free']['available']);
        $this->assertArrayNotHasKey('openrouter/openai/gpt-5', $list);
        // The key goes with the discovery call.
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.groq.com/openai/v1/models' && $r->hasHeader('Authorization', 'Bearer gsk-test'));

        // A free Groq model generates text through its OpenAI-compatible API.
        $sse = "data: {\"choices\":[{\"delta\":{\"content\":\"Fast \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"draft.\"}}]}\n\ndata: [DONE]\n\n";
        Http::fake(['api.groq.com/openai/v1/chat/completions' => Http::response($sse, 200, ['Content-Type' => 'text/event-stream'])]);
        $events = $this->events($this->spa()->postJson('/api/generations/text', ['prompt' => 'A quick line', 'model' => 'groq/llama-3.3-70b-versatile']));
        $this->assertSame('done', end($events)['event']);
        $this->assertSame('Fast draft.', Generation::latest('id')->first()->output_text);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/chat/completions') && $r['model'] === 'llama-3.3-70b-versatile');
    }

    public function test_text_streams_in_and_is_kept_whether_it_works_or_not(): void
    {
        $fake = $this->fakeClaude();
        $user = User::factory()->create();

        $response = $this->actingAs($user)->spa()->postJson('/api/generations/text', ['prompt' => 'A caption for the autumn pour', 'model' => 'anthropic/claude-opus-5-5']);
        $events = $this->events($response);
        $this->assertSame(['start', 'delta', 'delta', 'done'], array_column($events, 'event'));
        $generation = Generation::find($events[0]['data']['id']);
        $this->assertSame(['succeeded', 'Autumn pour.', 'claude-opus-5-5'], [$generation->status, $generation->output_text, $fake->calls[0]['model']]);

        $this->fakeClaude(['Autumn '], fail: 'Claude is busy right now.');
        $events = $this->events($this->spa()->postJson('/api/generations/text', ['prompt' => 'Again']));
        $this->assertSame('error', end($events)['event']);
        $failed = Generation::latest('id')->first();
        $this->assertSame(['failed', 'Claude is busy right now.', 'Autumn'], [$failed->status, $failed->error, $failed->output_text]);

        $this->spa()->postJson('/api/generations/text', ['prompt' => 'x', 'model' => 'higgsfield/ideogram-4'])->assertJsonValidationErrors('model');
    }

    public function test_a_photo_is_made_by_higgsfield_polled_and_brought_into_the_library(): void
    {
        $this->fakeClaude();
        $this->higgsfieldTested();
        Http::fake([
            'api.higgsfield.ai/ideogram/v4.0' => Http::response(['status' => 'queued', 'request_id' => 'req-1', 'status_url' => 'https://api.higgsfield.ai/requests/req-1/status']),
            'api.higgsfield.ai/requests/req-1/status' => Http::sequence()
                ->push(['status' => 'in_progress', 'request_id' => 'req-1'])
                ->push(['status' => 'completed', 'request_id' => 'req-1', 'images' => [['url' => 'https://cdn.example/out.png']]]),
            'cdn.example/out.png' => Http::response(base64_decode(self::PNG), 200, ['Content-Type' => 'image/png']),
        ]);

        $id = $this->actingAs(User::factory()->create())->spa()->postJson('/api/generations', [
            'kind' => 'image', 'model' => 'higgsfield/ideogram-4', 'prompt' => 'Amber candle jar on linen, morning light',
            'params' => ['aspect_ratio' => '4:5', 'resolution' => '1080p'],
        ])->assertCreated()->json('id');

        $generation = Generation::find($id);
        $this->assertSame(['succeeded', 'req-1'], [$generation->status, $generation->external_id]);
        $asset = Asset::find($generation->output_asset_ids[0]);
        $this->assertSame(['image', 'generated', 'image/png'], [$asset->kind, $asset->source, $asset->mime]);
        $this->spa()->getJson("/api/generations/{$id}")->assertJsonPath('outputs.0.id', $asset->id)->assertJsonPath('model_label', 'Ideogram 4.0');

        // Key auth, an idempotency key, and only the params the model takes. The key carries more
        // than the generation id on purpose: ids are reused once a row is deleted and Higgsfield
        // remembers a key for about a day, so an id-only key can be answered with the image that
        // belonged to the deleted generation. Row timestamp and body fingerprint rule that out.
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/ideogram/v4.0'
            && $r->hasHeader('Authorization', 'Key kid:ksecret')
            && preg_match("/^flowai-generation-{$id}-\d+-[0-9a-f]{16}$/", $r->header('Idempotency-Key')[0] ?? '') === 1
            && $r['aspect_ratio'] === '4:5' && ! isset($r['resolution']));
    }

    public function test_video_starts_from_an_uploaded_image_and_failures_can_be_retried_differently(): void
    {
        $this->fakeClaude();
        $this->higgsfieldTested();
        $user = User::factory()->create();
        Storage::disk('local')->put('assets/x/still.png', base64_decode(self::PNG));
        $still = Asset::factory()->for($user)->create(['path' => 'assets/x/still.png', 'mime' => 'image/png']);

        // No image: refused before anything is spent.
        $this->actingAs($user)->spa()->postJson('/api/generations', ['kind' => 'video', 'model' => 'higgsfield/wan-2-7-i2v', 'prompt' => 'Slow push in'])->assertCreated();
        $this->assertSame('Wan 2.7 · image to video starts from an image. Pick one first.', Generation::latest('id')->first()->error);

        Http::fake([
            'api.higgsfield.ai/files/generate-upload-url' => Http::response(['public_url' => 'https://files.example/still.png', 'upload_url' => 'https://upload.example/put', 'upload_headers' => ['x-amz-acl' => 'private']]),
            'upload.example/put' => Http::response('', 200),
            'api.higgsfield.ai/wan/v2.7/image-to-video' => Http::sequence()
                ->push(['detail' => [['msg' => 'duration must be ≤ 15']]], 422)
                ->push(['request_id' => 'v-2', 'status_url' => 'https://api.higgsfield.ai/requests/v-2/status']),
            'api.higgsfield.ai/requests/v-2/status' => Http::response(['status' => 'nsfw']),
        ]);
        $id = $this->spa()->postJson('/api/generations', ['kind' => 'video', 'model' => 'higgsfield/wan-2-7-i2v', 'prompt' => 'Slow push in', 'input_asset_ids' => [$still->id], 'params' => ['duration' => 15]])->json('id');
        $failed = Generation::find($id);
        $this->assertSame(['failed', 'Higgsfield didn’t accept those settings: duration must be ≤ 15.'], [$failed->status, $failed->error]);
        // The input went up through the presigned URL, without the API key.
        Http::assertSent(fn (Request $r) => $r->url() === 'https://upload.example/put' && ! $r->hasHeader('Authorization') && $r->hasHeader('x-amz-acl', 'private'));
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), 'image-to-video') && $r['image_url'] === 'https://files.example/still.png');

        // Retry with an edited prompt: a new generation that remembers what it replaces.
        $retry = $this->spa()->postJson("/api/generations/{$id}/retry", ['prompt' => 'Slow push in, candle flame flickers'])
            ->assertCreated()->assertJsonPath('retry_of', $id)->assertJsonPath('prompt', 'Slow push in, candle flame flickers')->json('id');
        $this->assertStringContainsString('flagged the result as unsafe', Generation::find($retry)->error);
        // Two submissions down one route, two idempotency keys, so the edited prompt is actually
        // rendered instead of being served the cached answer to the prompt it replaces.
        $keys = Http::recorded(fn (Request $r) => str_ends_with($r->url(), 'image-to-video'))
            ->map(fn ($pair) => $pair[0]->header('Idempotency-Key')[0] ?? null);
        $this->assertSame([2, 2], [$keys->count(), $keys->unique()->count()]);

        // Switching to a model that can't run is refused up front.
        $this->spa()->postJson("/api/generations/{$id}/retry", ['model' => 'higgsfield/kling-3-pro'])->assertCreated();
        $this->assertSame('Kling 3 Pro isn’t available: Not in your Higgsfield plan.', Generation::latest('id')->first()->error);
    }

    public function test_the_text_to_video_recipe_runs_its_steps_on_its_own(): void
    {
        $this->fakeClaude();
        $this->higgsfieldTested();
        Http::fake([
            'api.higgsfield.ai/ideogram/v4.0' => Http::response(['request_id' => 'i-1', 'status_url' => 'https://api.higgsfield.ai/requests/i-1/status']),
            'api.higgsfield.ai/requests/i-1/status' => Http::response(['status' => 'completed', 'images' => [['url' => 'https://cdn.example/still.png']]]),
            'cdn.example/still.png' => Http::response(base64_decode(self::PNG)),
            'api.higgsfield.ai/files/generate-upload-url' => Http::response(['public_url' => 'https://files.example/still.png', 'upload_url' => 'https://upload.example/put']),
            'upload.example/put' => Http::response('', 200),
            'api.higgsfield.ai/wan/v2.7/image-to-video' => Http::response(['request_id' => 'v-1', 'status_url' => 'https://api.higgsfield.ai/requests/v-1/status']),
            'api.higgsfield.ai/requests/v-1/status' => Http::response(['status' => 'completed', 'video' => ['url' => 'https://cdn.example/clip.mp4']]),
            'cdn.example/clip.mp4' => Http::response('not really a video', 200),
        ]);

        $this->actingAs(User::factory()->create())->spa()->postJson('/api/recipes/text_to_video', [
            'prompt' => 'Amber jar on a linen table', 'motion' => 'Candle flame flickers, slow dolly in',
            'image_model' => 'higgsfield/ideogram-4', 'video_model' => 'higgsfield/wan-2-7-i2v', 'duration' => 5,
        ])->assertCreated()->assertJsonPath('recipe', 'text_to_video')->assertJsonPath('recipe_step', 0);

        [$image, $video] = Generation::orderBy('id')->get();
        $this->assertSame(['image', 'succeeded'], [$image->kind, $image->status]);
        $this->assertSame(['video', 1, $image->id, $image->output_asset_ids, 'Candle flame flickers, slow dolly in', 'succeeded'],
            [$video->kind, $video->recipe_step, $video->parent_id, $video->input_asset_ids, $video->prompt, $video->status]);

        $this->spa()->postJson('/api/recipes/image_to_video', ['prompt' => 'x', 'video_model' => 'higgsfield/wan-2-7-i2v'])
            ->assertJsonValidationErrors(['asset_id' => 'Pick the image to start from.']);
    }

    public function test_an_openai_compatible_gateway_streams_text_and_answers_in_json(): void
    {
        $this->fakeClaude();
        config(['ai.providers.gateway.url' => 'https://gw.example/v1', 'ai.providers.gateway.key' => 'team-key', 'ai.prices.llama-3.3-70b' => [1, 2]]);
        $sse = "data: {\"choices\":[{\"delta\":{\"content\":\"Slow \"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"mornings.\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":4}}\n\ndata: [DONE]\n\n";
        Http::fake([
            'gw.example/v1/models' => Http::response(['data' => [['id' => 'llama-3.3-70b']]]),
            'gw.example/v1/chat/completions' => Http::response($sse, 200, ['Content-Type' => 'text/event-stream']),
        ]);

        $user = User::factory()->create();
        $events = $this->events($this->actingAs($user)->spa()->postJson('/api/generations/text', ['prompt' => 'A line about mornings', 'model' => 'gateway/llama-3.3-70b']));
        $this->assertSame('done', end($events)['event']);
        $this->assertSame('Slow mornings.', Generation::first()->output_text);
        $this->assertDatabaseHas('ai_usages', ['provider' => 'gateway', 'model' => 'llama-3.3-70b', 'input_tokens' => 12, 'output_tokens' => 4, 'user_id' => $user->id, 'purpose' => 'studio']);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/chat/completions') && $r['model'] === 'llama-3.3-70b' && $r['stream'] === true);
    }

    public function test_evals_score_a_model_by_rules_and_by_a_judge(): void
    {
        $this->fakeClaude(['Hand-poured lavender & fig, from our Lyon studio. #candles #slowliving'], json: fn (array $schema) => isset($schema['properties']['headline'])
            ? ['headline' => 'Autumn is pouring', 'hashtags' => ['#autumn', '#candles', '#lyon']]
            : ['score' => 90, 'reason' => 'Specific.']);
        $user = User::factory()->create();

        $this->actingAs($user)->spa()->postJson('/api/models/evals', ['model' => 'anthropic/claude-sonnet-5-5'])->assertStatus(202);

        $scores = ModelEval::where('model', 'anthropic/claude-sonnet-5-5')->pluck('score', 'task');
        $this->assertCount(5, $scores);
        $this->assertSame(100, $scores['json']);
        // The caption passes every rule; the French task can't, with an English answer.
        $this->assertGreaterThan($scores['french'], $scores['caption']);
        $this->spa()->getJson('/api/models/evals')->assertJsonPath('results.anthropic/claude-sonnet-5-5.json.score', 100);
        $this->assertNotNull(collect($this->spa()->getJson('/api/models')->json('models'))->firstWhere('id', 'anthropic/claude-sonnet-5-5')['score']);
    }

    public function test_projects_keep_a_canvas(): void
    {
        $user = User::factory()->create();
        $id = $this->actingAs($user)->spa()->postJson('/api/projects', ['name' => 'Autumn launch'])->assertCreated()->assertJsonPath('canvas.nodes', [])->json('id');

        $this->spa()->patchJson("/api/projects/{$id}", ['canvas' => [
            'nodes' => [['id' => 'n1', 'type' => 'note', 'x' => 40, 'y' => 60, 'text' => 'Hook ideas'], ['id' => 'n2', 'type' => 'asset', 'x' => 300, 'y' => 60, 'ref' => 7]],
            'edges' => [['from' => 'n1', 'to' => 'n2']],
            'view' => ['x' => 0, 'y' => 0, 'zoom' => 1],
        ]])->assertOk()->assertJsonPath('nodes', 2)->assertJsonPath('canvas.edges.0.to', 'n2');

        $this->spa()->patchJson("/api/projects/{$id}", ['canvas' => ['nodes' => [['id' => 'x', 'type' => 'spaceship', 'x' => 0, 'y' => 0]]]])->assertJsonValidationErrors('canvas.nodes.0.type');
        $this->actingAs(User::factory()->create())->spa()->getJson("/api/projects/{$id}")->assertForbidden();
    }
}

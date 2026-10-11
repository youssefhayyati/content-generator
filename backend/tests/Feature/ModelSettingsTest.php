<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The Models page's view of the one .env: each connector lists its settings (filled in or not, and
 * whether the assistant reads them too, never their values), and the pod and the assistant list what
 * runs behind them as the assistant reports it, saying when the assistant started before an edit.
 */
class ModelSettingsTest extends TestCase
{
    use RefreshDatabase;

    /** The assistant refuses the API's ENGINE_KEY. */
    private bool $keyRejected = false;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        config([
            'ai.providers.ollama_cloud.key' => 'oc-secret',
            'ai.providers.groq.key' => null,
            'ai.engine.url' => 'http://assistant.test',
            'ai.engine.key' => 'engine-secret',
            'ai.engine.settings' => [
                'COMFYUI_URL' => 'https://pod-8001.test', 'COMFYUI_API_KEY' => 'comfy-secret',
                'MUSIC_URL' => 'https://pod-8003.test', 'MUSIC_API_KEY' => null,
                'LIPSYNC_URL' => null, 'LIPSYNC_API_KEY' => null,
                'FACESWAP_URL' => null, 'FACESWAP_API_KEY' => null,
                'LLM_MODEL' => 'glm-5.3-flash',
            ],
        ]);
        Http::fake([
            'assistant.test/engine/catalog' => fn () => $this->keyRejected
                ? Http::response(['detail' => 'a wrong or missing X-Engine-Key'], 401)
                : Http::response(['workflows' => [], 'services' => [
                    // MUSIC_URL is in .env but the assistant has none: it started before the edit.
                    'comfyui' => 'ok', 'music' => 'off', 'lipsync' => 'off', 'faceswap' => 'not answering',
                    'tts' => 'ok, VoiceStudio', 'sound' => 'off', 'llm' => 'ok, glm-5.3-flash',
                ]]),
            '*' => Http::response(['data' => []]),
        ]);
    }

    public function test_connectors_list_their_settings_without_their_values(): void
    {
        $response = $this->spa()->actingAs(User::factory()->create())->getJson('/api/models')->assertOk();
        $providers = collect($response->json('providers'))->keyBy('id');

        $this->assertSame([['name' => 'OLLAMA_CLOUD_API_KEY', 'set' => true, 'shared' => true]], $providers['ollama_cloud']['settings']);
        $this->assertSame([['name' => 'GROQ_API_KEY', 'set' => false, 'shared' => false]], $providers['groq']['settings']);
        $this->assertSame(['ENGINE_URL' => true, 'ENGINE_KEY' => true], collect($providers['engine']['settings'])->pluck('set', 'name')->all());
        $this->assertNull($providers['groq']['services']);

        foreach (['oc-secret', 'engine-secret', 'comfy-secret'] as $secret) {
            $this->assertStringNotContainsString($secret, $response->getContent());
        }
    }

    public function test_the_pod_and_the_assistant_show_their_services_and_what_to_do(): void
    {
        $providers = collect($this->spa()->actingAs(User::factory()->create())->getJson('/api/models')->json('providers'))->keyBy('id');
        $pod = collect($providers['pod']['services'])->keyBy('id');

        $this->assertSame([true, null], [$pod['comfyui']['ok'], $pod['comfyui']['hint']]);
        $this->assertSame(['COMFYUI_URL' => true, 'COMFYUI_API_KEY' => true], collect($pod['comfyui']['settings'])->pluck('set', 'name')->all());
        $this->assertStringContainsString('docker compose up -d assistant', $pod['music']['hint']);
        $this->assertSame('Set LIPSYNC_URL in .env.', $pod['lipsync']['hint']);
        $this->assertSame([false, 'Not answering.'], [$pod['faceswap']['ok'], $pod['faceswap']['hint']]);

        $engine = collect($providers['engine']['services'])->keyBy('id');
        $this->assertSame(['ok, glm-5.3-flash', true], [$engine['llm']['status'], $engine['llm']['ok']]);
        $this->assertTrue(collect($engine['llm']['settings'])->firstWhere('name', 'OLLAMA_CLOUD_API_KEY')['shared']);
    }

    public function test_a_rejected_engine_key_says_the_assistant_needs_recreating(): void
    {
        $this->keyRejected = true;
        $providers = collect($this->spa()->actingAs(User::factory()->create())->getJson('/api/models')->json('providers'))->keyBy('id');

        $this->assertSame([null, null], [$providers['pod']['services'][0]['status'], $providers['pod']['services'][0]['hint']]);
        $test = $this->spa()->actingAs(User::factory()->create())->postJson('/api/models/test/engine')->assertOk()->json();
        $this->assertFalse($test['ok']);
        $this->assertStringContainsString('rejected ENGINE_KEY', $test['message']);
    }
}

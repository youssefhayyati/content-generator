<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\User;
use App\Services\Sound\VoiceRouter;
use App\Services\Sound\VoiceStudioClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * VoiceStudio as the alternative voice provider: its cloned and designed voices join the Sound
 * tab's catalog behind the "vs:" prefix, the VoiceRouter sends their generations to VoiceStudio,
 * and everything local (Kokoro, the composer, the listener) behaves exactly as before. Both
 * HTTP services are faked; ffmpeg is real.
 */
class VoiceStudioTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Account $ig;

    private bool $vsDown = false;

    private bool $profilesRefused = false;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->ig = Account::factory()->for($this->user)->create(['platform' => 'instagram', 'handle' => 'maisoncire']);
        config([
            'ai.providers.sound.url' => 'http://sound.test',
            'ai.providers.voicestudio.url' => 'http://voicestudio.test',
            'ai.providers.voicestudio.key' => 'vs-secret',
        ]);
        Http::fake([
            'sound.test/health' => Http::response(['ok' => true, 'voices' => 1, 'whisper' => 'base', 'moods' => ['golden-hour']]),
            'sound.test/v1/voices' => Http::response([
                ['id' => 'af_heart', 'name' => 'Heart', 'lang' => 'en-us', 'language' => 'English · US', 'gender' => 'female', 'style' => 'Warm.', 'sample' => 'Forty candles.'],
            ]),
            'sound.test/v1/moods' => Http::response([['id' => 'golden-hour', 'label' => 'Golden hour', 'detail' => 'Warm lo-fi.', 'bpm' => [76, 86], 'colors' => ['#f5b04c', '#e0745a']]]),
            'sound.test/v1/speech' => fn (Request $r) => Http::response([
                'duration' => 0.8, 'audio' => base64_encode(self::wav(0.8)), 'voice' => $r['voice'], 'lang' => 'en-us',
                'words' => [['text' => 'Forty', 'start' => 0.0, 'end' => 0.4], ['text' => 'candles.', 'start' => 0.4, 'end' => 0.74]],
            ]),
            'voicestudio.test/health' => fn () => $this->vsDown ? Http::response('nope', 500) : Http::response(['status' => 'ok']),
            'voicestudio.test/profiles' => fn () => $this->profilesRefused ? Http::response(['detail' => 'Not authenticated'], 401) : Http::response([
                ['id' => 'p-mara', 'name' => 'Mara', 'kind' => 'clone', 'language' => 'English', 'gender' => 'female', 'personality' => 'warm'],
                ['id' => 'p-henri', 'name' => 'Henri', 'kind' => 'design', 'language' => 'French', 'gender' => 'male'],
            ]),
            'voicestudio.test/v1/audio/speech' => fn (Request $r) => Http::response(self::wav(1.0), 200, ['Content-Type' => 'audio/wav']),
        ]);
    }

    private static function wav(float $seconds, float $hz = 220, int $rate = 24000): string
    {
        $data = '';
        for ($i = 0, $n = (int) ($seconds * $rate); $i < $n; $i++) {
            $data .= pack('v', ((int) (9000 * sin(2 * M_PI * $hz * $i / $rate))) & 0xFFFF);
        }

        return 'RIFF'.pack('V', 36 + strlen($data)).'WAVEfmt '.pack('VvvVVvv', 16, 1, 1, $rate, $rate * 2, 2, 16).'data'.pack('V', strlen($data)).$data;
    }

    private function make(array $body): array
    {
        return $this->spa()->actingAs($this->user)->postJson('/api/generations', $body)->assertCreated()->json();
    }

    public function test_the_router_sends_prefixed_voices_to_voicestudio(): void
    {
        $this->assertTrue(VoiceRouter::isVoiceStudio('vs:p-mara'));
        $this->assertFalse(VoiceRouter::isVoiceStudio('af_heart'));
        $this->assertSame('voicestudio/voices', VoiceRouter::modelFor('vs:p-mara'));
        $this->assertSame('sound/kokoro', VoiceRouter::modelFor('af_heart'));
        $this->assertSame('p-mara', VoiceRouter::strip('vs:p-mara'));
        $this->assertEqualsWithDelta(1.0, VoiceStudioClient::wavDuration(self::wav(1.0)), 0.01);
        $this->assertNull(VoiceStudioClient::wavDuration('not a wav'));
    }

    public function test_voicestudio_voices_join_the_registry_and_the_catalog(): void
    {
        $models = collect($this->spa()->actingAs($this->user)->getJson('/api/models')->assertOk()->json('models'))->keyBy('id');
        $this->assertSame(['voice', true, false], [$models['voicestudio/voices']['kind'], $models['voicestudio/voices']['available'], $models['voicestudio/voices']['local']]);
        $this->assertSame('VoiceStudio', $models['voicestudio/voices']['reach']);

        $sound = $this->spa()->actingAs($this->user)->getJson('/api/sound')->assertOk()->json();
        $this->assertTrue($sound['available']);
        $voices = collect($sound['voices'])->keyBy('id');
        $this->assertSame(['af_heart', 'vs:p-mara', 'vs:p-henri'], $voices->keys()->all());
        $this->assertSame(['Mara', 'English', 'female', 'Clone · warm'], [$voices['vs:p-mara']['name'], $voices['vs:p-mara']['language'], $voices['vs:p-mara']['gender'], $voices['vs:p-mara']['style']]);
        $this->assertSame('/api/sound/voices/vs:p-mara/sample', $voices['vs:p-mara']['sample_url']);
        $this->assertSame(['golden-hour'], array_column($sound['moods'], 'id'), 'The composer stays local.');
    }

    public function test_a_voicestudio_voiceover_comes_back_as_mp3_and_the_call_is_authenticated(): void
    {
        $g = $this->make(['kind' => 'voice', 'prompt' => 'Quarante bougies.', 'params' => ['voice' => 'vs:p-henri', 'speed' => 1.1]]);
        $g = $this->spa()->actingAs($this->user)->getJson("/api/generations/{$g['id']}")->assertOk()->json();

        $this->assertSame('succeeded', $g['status']);
        $this->assertSame('voicestudio/voices', $g['model']);
        $out = $g['outputs'][0];
        $this->assertSame(['audio', 'audio/mpeg'], [$out['kind'], $out['mime']]);
        $this->assertEqualsWithDelta(1.0, $out['duration'], 0.15);
        $this->assertSame(['voice', 'vs:p-henri', 'Henri', false], [$out['sound']['type'], $out['sound']['voice'], $out['sound']['voice_name'], $out['sound']['timed'] ?? false]);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/v1/audio/speech')
            && $r['voice'] === 'p-henri' && $r['input'] === 'Quarante bougies.' && (float) $r['speed'] === 1.1
            && $r->hasHeader('Authorization', 'Bearer vs-secret'));
        Http::assertNotSent(fn (Request $r) => str_ends_with($r->url(), '/v1/speech'));
    }

    public function test_an_accounts_voicestudio_voice_routes_every_generation_to_voicestudio(): void
    {
        $this->spa()->actingAs($this->user)->putJson("/api/accounts/{$this->ig->id}/sound", ['voice' => 'vs:p-mara'])->assertOk()->assertJsonPath('voice', 'vs:p-mara');
        $this->spa()->actingAs($this->user)->putJson("/api/accounts/{$this->ig->id}/sound", ['voice' => 'vs:nobody'])->assertUnprocessable();

        $g = $this->make(['kind' => 'voice', 'prompt' => 'A warm welcome.', 'account_id' => $this->ig->id]);
        $g = $this->spa()->actingAs($this->user)->getJson("/api/generations/{$g['id']}")->assertOk()->json();
        $this->assertSame('voicestudio/voices', $g['model']);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/v1/audio/speech') && $r['voice'] === 'p-mara');

        // A Kokoro voice on the same account goes back to the local service.
        $this->spa()->actingAs($this->user)->putJson("/api/accounts/{$this->ig->id}/sound", ['voice' => 'af_heart'])->assertOk();
        $g = $this->make(['kind' => 'voice', 'prompt' => 'Forty candles.', 'account_id' => $this->ig->id]);
        $g = $this->spa()->actingAs($this->user)->getJson("/api/generations/{$g['id']}")->assertOk()->json();
        $this->assertSame('sound/kokoro', $g['model']);
    }

    public function test_a_voice_sample_is_synthesized_once_and_kept(): void
    {
        $this->spa()->actingAs($this->user)->get('/api/sound/voices/vs:p-mara/sample')
            ->assertOk()->assertHeader('Content-Type', 'audio/mpeg');
        $this->spa()->actingAs($this->user)->get('/api/sound/voices/vs:p-mara/sample')->assertOk();
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/v1/audio/speech') && $r['voice'] === 'p-mara' && str_contains($r['input'], 'Mara'));
        $this->assertSame(1, Http::recorded(fn (Request $r) => str_ends_with($r->url(), '/v1/audio/speech'))->count(), 'The second play reads the kept file.');

        $this->spa()->actingAs($this->user)->get('/api/sound/voices/vs:nobody/sample')->assertNotFound();
    }

    public function test_the_catalog_works_on_voicestudio_alone_and_degrades_to_local_when_it_is_down(): void
    {
        // Local sound off: VoiceStudio still carries the tab.
        config(['ai.providers.sound.url' => null]);
        $sound = $this->spa()->actingAs($this->user)->getJson('/api/sound')->assertOk()->json();
        $this->assertTrue($sound['available']);
        $this->assertSame(['vs:p-henri', 'vs:p-mara'], collect($sound['voices'])->pluck('id')->sort()->values()->all());
        $this->assertSame([], $sound['moods']);

        // VoiceStudio down, local back on: the local voices stand alone.
        config(['ai.providers.sound.url' => 'http://sound.test']);
        $this->vsDown = true;
        Cache::flush();
        $sound = $this->spa()->actingAs($this->user)->getJson('/api/sound')->assertOk()->json();
        $this->assertTrue($sound['available']);
        $this->assertSame(['af_heart'], array_column($sound['voices'], 'id'));

        $models = collect($this->spa()->actingAs($this->user)->getJson('/api/models')->json('models'))->keyBy('id');
        $this->assertFalse($models['voicestudio/voices']['available']);
        $this->assertNotNull($models['voicestudio/voices']['reason']);
    }

    public function test_a_voicestudio_that_answers_but_refuses_its_profiles_leaves_the_local_voices(): void
    {
        $this->profilesRefused = true;
        $sound = $this->spa()->actingAs($this->user)->getJson('/api/sound')->assertOk()->json();
        $this->assertSame(['af_heart'], array_column($sound['voices'], 'id'));

        $r = $this->spa()->actingAs($this->user)->postJson('/api/models/test/voicestudio')->assertOk()->json();
        $this->assertFalse($r['ok'], 'The connector test still says what is wrong.');
        $this->assertStringContainsString('Not authenticated', $r['message']);
    }

    public function test_the_connector_test_reports_the_profile_count(): void
    {
        $r = $this->spa()->actingAs($this->user)->postJson('/api/models/test/voicestudio')->assertOk()->json();
        $this->assertTrue($r['ok']);
        $this->assertSame('Connected. 2 voice profiles ready.', $r['message']);
    }
}

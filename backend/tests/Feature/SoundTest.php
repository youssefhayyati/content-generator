<?php

namespace Tests\Feature;

use App\Enums\PostFormat;
use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\Asset;
use App\Models\FlowRun;
use App\Models\Post;
use App\Models\User;
use App\Services\Ai\TextGenerator;
use App\Services\Flows\Catalog;
use App\Services\Sound\Captions;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Sound: voiceovers with every word timed, original music, transcripts, dictation, reels
 * rendered with ffmpeg, an account's sound, and flows that narrate and make reels. FlowAI Sound
 * is faked; ffmpeg is real, so the MP3s, waveforms and reels here are real files.
 */
class SoundTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Account $ig;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create(['timezone' => 'Europe/Paris']);
        $this->ig = Account::factory()->for($this->user)->create(['platform' => 'instagram', 'handle' => 'maisoncire', 'profile' => ['topics' => 'candles']]);
        $this->user->queueSlots()->createMany(collect(range(1, 7))->map(fn ($d) => ['weekday' => $d, 'time' => '18:00'])->all());
        config(['ai.providers.sound.url' => 'http://sound.test']);
        Http::fake([
            'sound.test/health' => Http::response(['ok' => true, 'voices' => 2, 'whisper' => 'base', 'moods' => ['golden-hour']]),
            'sound.test/v1/voices' => Http::response([
                ['id' => 'af_heart', 'name' => 'Heart', 'lang' => 'en-us', 'language' => 'English · US', 'gender' => 'female', 'style' => 'Warm.', 'sample' => 'Forty candles.'],
                ['id' => 'ff_siwis', 'name' => 'Siwis', 'lang' => 'fr-fr', 'language' => 'Français', 'gender' => 'female', 'style' => 'Douce.', 'sample' => 'Quarante bougies.'],
            ]),
            'sound.test/v1/moods' => Http::response([['id' => 'golden-hour', 'label' => 'Golden hour', 'detail' => 'Warm lo-fi.', 'bpm' => [76, 86], 'colors' => ['#f5b04c', '#e0745a']]]),
            'sound.test/v1/speech' => fn (Request $r) => Http::response([
                'sample_rate' => 24000, 'duration' => 0.8, 'audio' => base64_encode(self::wav(0.8)), 'voice' => $r['voice'], 'lang' => 'en-us',
                'words' => [['text' => 'Forty', 'start' => 0.0, 'end' => 0.32], ['text' => 'candles.', 'start' => 0.32, 'end' => 0.74]],
            ]),
            'sound.test/v1/music' => fn (Request $r) => Http::response([
                'sample_rate' => 24000, 'duration' => 1.2, 'audio' => base64_encode(self::wav(1.2, 110)),
                'meta' => ['mood' => $r['mood'], 'label' => 'Golden hour', 'bpm' => 82.0, 'key' => 'Eb major', 'progression' => ['ii9', 'V9'], 'seed' => 42, 'energy' => 0.6],
            ]),
            'sound.test/v1/transcribe*' => Http::response([
                'language' => 'en', 'duration' => 0.8, 'text' => 'Forty candles at a time.',
                'segments' => [['start' => 0.0, 'end' => 0.8, 'text' => 'Forty candles at a time.']],
                'words' => [['text' => 'Forty', 'start' => 0.0, 'end' => 0.2], ['text' => 'candles', 'start' => 0.2, 'end' => 0.5], ['text' => 'at', 'start' => 0.5, 'end' => 0.6], ['text' => 'a', 'start' => 0.6, 'end' => 0.65], ['text' => 'time.', 'start' => 0.65, 'end' => 0.8]],
            ]),
        ]);
        $this->app->instance(TextGenerator::class, new class implements TextGenerator
        {
            public function enabled(): bool
            {
                return true;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                yield 'Our wicks are cotton, our wax is slow.';
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                $props = $schema['properties'] ?? [];

                return match (true) {
                    isset($props['script']) => ['script' => 'Most candles burn for twenty hours. Ours burn for fifty.', 'title' => 'Fifty hours'],
                    isset($props['posts']) => ['posts' => [
                        ['title' => 'Forty at a time', 'body' => 'We pour forty candles at a time. No more.', 'quote' => 'Forty candles at a time.'],
                        ['title' => 'Slow wax', 'body' => 'The wax needs two weeks to cure.', 'quote' => 'two weeks'],
                    ]],
                    default => [],
                };
            }
        });
    }

    /** A short sine wave as 16-bit WAV, the way FlowAI Sound sends audio. */
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

    private function voiceover(): Asset
    {
        $g = $this->make(['kind' => 'voice', 'prompt' => 'Forty candles.', 'params' => ['voice' => 'af_heart']]);

        return Asset::findOrFail($this->spa()->actingAs($this->user)->getJson("/api/generations/{$g['id']}")->json('outputs.0.id'));
    }

    public function test_the_sound_models_are_in_the_registry_when_the_service_answers(): void
    {
        $models = collect($this->spa()->actingAs($this->user)->getJson('/api/models')->assertOk()->json('models'))->keyBy('id');
        $this->assertSame(['voice', true, true], [$models['sound/kokoro']['kind'], $models['sound/kokoro']['available'], $models['sound/kokoro']['local']]);
        $this->assertSame('music', $models['sound/composer']['kind']);
        $this->assertSame('listen', $models['sound/whisper']['kind']);

        $sound = $this->spa()->actingAs($this->user)->getJson('/api/sound')->assertOk()->json();
        $this->assertTrue($sound['available']);
        $this->assertSame('/api/sound/voices/af_heart/sample', $sound['voices'][0]['sample_url']);
        $this->assertSame(['bold', 'editorial', 'pulse'], array_column($sound['styles'], 'id'));
    }

    public function test_a_voiceover_comes_back_as_mp3_with_every_word_timed_and_a_waveform(): void
    {
        $g = $this->make(['kind' => 'voice', 'prompt' => 'Forty candles.', 'params' => ['voice' => 'ff_siwis', 'speed' => 1.1]]);
        $g = $this->spa()->actingAs($this->user)->getJson("/api/generations/{$g['id']}")->assertOk()->json();

        $this->assertSame('succeeded', $g['status']);
        $this->assertSame('sound/kokoro', $g['model']);
        $out = $g['outputs'][0];
        $this->assertSame(['audio', 'audio/mpeg'], [$out['kind'], $out['mime']]);
        $this->assertEqualsWithDelta(0.8, $out['duration'], 0.15);
        $this->assertNotNull($out['poster_url'], 'Audio gets its waveform as a thumbnail.');
        $this->assertCount(96, $out['sound']['peaks']);
        $this->assertSame(['voice', 'ff_siwis', 'Siwis', true], [$out['sound']['type'], $out['sound']['voice'], $out['sound']['voice_name'], $out['sound']['timed']]);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/v1/speech') && $r['voice'] === 'ff_siwis' && $r['speed'] === 1.1 && $r['timings'] === true);

        $words = $this->spa()->actingAs($this->user)->getJson("/api/assets/{$out['id']}/words")->assertOk()->json();
        $this->assertSame(['Forty', 'candles.'], array_column($words['words'], 'text'));
        $this->assertSame('Forty candles.', $words['text']);
    }

    public function test_an_accounts_voice_is_used_unless_another_is_picked(): void
    {
        $this->spa()->actingAs($this->user)->putJson("/api/accounts/{$this->ig->id}/sound", ['voice' => 'ff_siwis', 'mood' => 'golden-hour', 'accent' => '#f5b04c', 'speed' => 0.9])
            ->assertOk()->assertJsonPath('voice', 'ff_siwis')->assertJsonPath('accent', '#f5b04c');
        $this->spa()->actingAs($this->user)->putJson("/api/accounts/{$this->ig->id}/sound", ['voice' => 'xx_nobody'])->assertUnprocessable();
        $this->assertSame('ff_siwis', $this->spa()->actingAs($this->user)->getJson("/api/accounts/{$this->ig->id}")->json('sound.voice'));

        $this->make(['kind' => 'voice', 'prompt' => 'Bonjour.', 'account_id' => $this->ig->id]);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/v1/speech') && $r['voice'] === 'ff_siwis' && $r['speed'] === 0.9);
    }

    public function test_music_is_composed_and_kept_with_what_was_written(): void
    {
        $g = $this->make(['kind' => 'music', 'prompt' => 'Golden hour', 'params' => ['mood' => 'golden-hour', 'seconds' => 20, 'energy' => 0.4]]);
        $out = $this->spa()->actingAs($this->user)->getJson("/api/generations/{$g['id']}")->json('outputs.0');

        $this->assertSame(['music', 'Golden hour', 82, 'Eb major'], [$out['sound']['type'], $out['sound']['label'], $out['sound']['bpm'], $out['sound']['key']]);
        Http::assertSent(fn (Request $r) => str_ends_with($r->url(), '/v1/music') && (float) $r['seconds'] === 20.0 && (float) $r['energy'] === 0.4);
        $this->spa()->actingAs($this->user)->postJson('/api/generations', ['kind' => 'music', 'prompt' => 'x', 'params' => ['seconds' => 999]])->assertUnprocessable();
    }

    public function test_a_reel_is_rendered_with_the_voice_music_and_captions(): void
    {
        $voice = $this->voiceover();
        $music = $this->make(['kind' => 'music', 'prompt' => 'Golden hour', 'params' => ['mood' => 'golden-hour']]);
        $musicId = $this->spa()->actingAs($this->user)->getJson("/api/generations/{$music['id']}")->json('outputs.0.id');

        $g = $this->make(['kind' => 'reel', 'prompt' => 'Fifty hours', 'input_asset_ids' => [$voice->id], 'params' => [
            'style' => 'editorial', 'accent' => '#f5b04c', 'music_asset_id' => $musicId, 'title' => 'Fifty hours', 'handle' => 'maisoncire',
        ]]);
        $g = $this->spa()->actingAs($this->user)->getJson("/api/generations/{$g['id']}")->json();

        $this->assertSame('succeeded', $g['status'], (string) $g['error']);
        $this->assertSame('Reel renderer', $g['model_label']);
        $reel = $g['outputs'][0];
        $this->assertSame(['video', 'video/mp4', 1080, 1920], [$reel['kind'], $reel['mime'], $reel['width'], $reel['height']]);
        $this->assertEqualsWithDelta(3.0, $reel['duration'], 0.2, 'A short voice still makes a three-second reel.');
        $this->assertNotNull($reel['poster_url']);
        $this->assertSame('reel', Asset::find($reel['id'])->meta['sound']);

        // A reel needs something to play.
        $this->spa()->actingAs($this->user)->postJson('/api/generations', ['kind' => 'reel', 'prompt' => 'Empty'])->assertStatus(422);
    }

    public function test_captions_follow_every_word_and_never_break_on_braces(): void
    {
        $words = [['text' => 'Forty', 'start' => 0.0, 'end' => 0.3], ['text' => '{candles}', 'start' => 0.3, 'end' => 0.7], ['text' => 'burn.', 'start' => 0.7, 'end' => 1.1]];

        $bold = Captions::ass($words, 'bold', ['accent' => '#f5b04c'], 2.0);
        $this->assertStringContainsString('Style: Bold,Geist ExtraBold', $bold);
        $this->assertSame(3, substr_count($bold, 'Dialogue: 1,'), 'One event per word.');
        $this->assertStringContainsString('(candles)', $bold);
        $this->assertStringNotContainsString('{candles}', $bold);
        $this->assertStringContainsString('burn{\r}', str_replace('\r}burn', '', $bold));

        $page = Captions::ass($words, 'editorial', ['accent' => '#f5b04c', 'title' => 'Notes'], 2.0);
        $this->assertStringContainsString('Instrument Serif', $page);
        $this->assertStringContainsString('NOTES', $page);
        $this->assertStringContainsString('{\1a&HC4&}burn.', $page, 'Words not said yet wait faintly.');
    }

    public function test_uploaded_audio_is_listened_to_and_turned_into_posts(): void
    {
        $file = UploadedFile::fake()->createWithContent('voice-memo.wav', self::wav(0.8));
        $asset = $this->spa()->actingAs($this->user)->post('/api/assets', ['files' => [$file]])->assertCreated()->json('0');
        $this->assertSame('audio', $asset['kind']);
        $this->assertCount(96, $asset['sound']['peaks']);

        $this->spa()->actingAs($this->user)->postJson("/api/assets/{$asset['id']}/posts", ['account_id' => $this->ig->id])->assertStatus(422);
        $this->spa()->actingAs($this->user)->postJson("/api/assets/{$asset['id']}/transcribe")->assertStatus(202);
        $words = $this->spa()->actingAs($this->user)->getJson("/api/assets/{$asset['id']}/words")->json();
        $this->assertSame(['done', 'Forty candles at a time.', 5], [$words['status'], $words['text'], count($words['words'])]);

        $made = $this->spa()->actingAs($this->user)->postJson("/api/assets/{$asset['id']}/posts", ['account_id' => $this->ig->id, 'count' => 2])->assertCreated()->json('posts');
        $this->assertCount(2, $made);
        $post = Post::find($made[0]['id']);
        $this->assertSame([PostStatus::Draft, $this->ig->id, ['instagram']], [$post->status, $post->account_id, $post->platforms]);
        $this->assertNull($post->approved_at, 'Drafts only: a person schedules them.');

        // Not someone else's.
        $this->spa()->actingAs(User::factory()->create())->getJson("/api/assets/{$asset['id']}/words")->assertForbidden();
    }

    public function test_dictation_and_scripts(): void
    {
        $text = $this->spa()->actingAs($this->user)->post('/api/sound/dictate', ['audio' => UploadedFile::fake()->createWithContent('note.wav', self::wav(0.6))])
            ->assertOk()->json('text');
        $this->assertSame('Forty candles at a time.', $text);

        $this->spa()->actingAs($this->user)->postJson('/api/sound/script', ['brief' => 'Why our candles burn longer', 'seconds' => 20, 'account_id' => $this->ig->id])
            ->assertOk()->assertJsonPath('title', 'Fifty hours')->assertJsonPath('script', 'Most candles burn for twenty hours. Ours burn for fifty.');
    }

    public function test_a_voice_sample_is_made_once_and_kept(): void
    {
        $this->spa()->actingAs($this->user)->get('/api/sound/voices/af_heart/sample')->assertOk()->assertHeader('Content-Type', 'audio/mpeg');
        $this->spa()->actingAs($this->user)->get('/api/sound/voices/af_heart/sample')->assertOk();
        Http::assertSentCount(2); // the voice list and one speech; nothing more the second time
        $this->assertTrue(Storage::disk('local')->exists('sound-samples/af_heart.mp3'));
        $this->spa()->actingAs($this->user)->get('/api/sound/voices/zz_nobody/sample')->assertNotFound();
    }

    public function test_a_flow_narrates_composes_renders_a_reel_and_posts_it_once_approved(): void
    {
        $node = fn (string $id, string $type, array $config = []) => ['id' => $id, 'type' => $type, 'x' => 0, 'y' => 0, 'config' => Catalog::configure($type, $config)];
        $flow = $this->user->flows()->create(['name' => 'Talking reel', 'trigger' => 'trigger.manual', 'graph' => [
            'nodes' => [
                $node('t', 'trigger.manual'), $node('w', 'ai.write', ['account_id' => $this->ig->id, 'brief' => 'Our wicks']),
                $node('n', 'ai.narrate'), $node('m', 'ai.compose', ['seconds' => 10]), $node('r', 'action.reel', ['style' => 'pulse', 'title' => 'Slow wax']),
                $node('a', 'human.approve'), $node('p', 'action.post', ['when' => 'next_slot']),
            ],
            'edges' => [['from' => 't', 'to' => 'w', 'port' => 'next'], ['from' => 'w', 'to' => 'n', 'port' => 'next'], ['from' => 'n', 'to' => 'm', 'port' => 'next'],
                ['from' => 'm', 'to' => 'r', 'port' => 'next'], ['from' => 'r', 'to' => 'a', 'port' => 'next'], ['from' => 'a', 'to' => 'p', 'port' => 'approved']],
        ]]);

        $run = FlowRun::find($this->spa()->actingAs($this->user)->postJson("/api/flows/{$flow->id}/run")->assertCreated()->json('id'));
        $this->assertSame('approval', $run->status, $run->error ?? '');
        $this->assertSame('maisoncire', $run->context['account']['handle'], 'The account named by the first step carries through.');
        $this->assertStringContainsString('every word timed', $run->trail[2]['summary']);
        $this->assertStringContainsString('Golden hour', $run->trail[3]['summary']);
        $video = Asset::find($run->context['video']['id']);
        $this->assertSame('video', $video->kind);
        $this->assertSame('pulse', $video->meta['style']);

        // The reel is in the approval, for watching before saying yes.
        $item = collect($this->spa()->actingAs($this->user)->getJson('/api/inbox')->json())->firstWhere('kind', 'flow_approval');
        $this->assertSame($video->url(), $this->spa()->actingAs($this->user)->getJson("/api/flow-runs/{$run->id}")->json('approval.media.url'));
        $this->assertNotNull($item);

        $this->spa()->actingAs($this->user)->postJson("/api/flow-runs/{$run->id}/decide", ['approve' => true])->assertOk()->assertJsonPath('status', 'done');
        $post = Post::sole();
        $this->assertSame([PostStatus::Scheduled, PostFormat::Video, [$video->id]], [$post->status, $post->format, $post->assets->pluck('id')->all()],
            'Instagram gets the reel: no more drafts for want of a picture.');

        // Every made thing is in the Studio's history too.
        $this->assertSame(['reel', 'music', 'voice'], $this->user->generations()->latest('id')->pluck('kind')->all());
    }

    public function test_without_the_service_sound_says_how_to_start_it(): void
    {
        config(['ai.providers.sound.url' => 'http://down.test']);
        Http::fake(['down.test/*' => fn () => throw new ConnectionException('refused')]);

        $sound = $this->spa()->actingAs($this->user)->getJson('/api/sound')->assertOk()->json();
        $this->assertFalse($sound['available']);
        $this->assertStringContainsString('docker compose up -d sound', $sound['reason']);
        $kokoro = collect($this->spa()->actingAs($this->user)->getJson('/api/models')->json('models'))->firstWhere('id', 'sound/kokoro');
        $this->assertFalse($kokoro['available']);
    }
}

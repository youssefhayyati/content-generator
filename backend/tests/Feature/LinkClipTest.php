<?php

namespace Tests\Feature;

use App\Jobs\CreateLinkClip;
use App\Jobs\RestyleLinkClip;
use App\Models\Asset;
use App\Models\LinkClip;
use App\Models\User;
use App\Services\Clips\ClipFonts;
use App\Services\Clips\ClipPlanner;
use App\Services\Clips\ClipRenderer;
use App\Services\Clips\ClipStyle;
use App\Services\Clips\LinkClipper;
use App\Services\Sound\Captions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class LinkClipTest extends TestCase
{
    use RefreshDatabase;

    /** yt-dlp's answer for a video, without going to YouTube. */
    private static function youtube(float $duration = 600, string $live = 'not_live'): void
    {
        Process::fake(['*yt-dlp*' => Process::result(json_encode(['title' => 'A talk', 'duration' => $duration, 'live_status' => $live]))]);
    }

    public function test_a_video_that_cant_be_clipped_is_refused_with_the_reason_before_anything_is_queued(): void
    {
        Queue::fake();
        $user = User::factory()->create();
        $body = ['url' => 'https://www.youtube.com/watch?v=IJwnDrnqjUA', 'platform' => 'instagram', 'placement' => 'story', 'seconds' => 15, 'count' => 3, 'rights_confirmed' => true];

        Process::fake(['*yt-dlp*' => Process::sequence()
            ->push(Process::result(json_encode(['duration' => 3361, 'live_status' => 'not_live'])))
            ->push(Process::result(json_encode(['duration' => 0, 'live_status' => 'is_live'])))
            ->push(Process::result('', 'ERROR: [youtube] IJwnDrnqjUA: This video is unavailable', 1))]);
        $this->spa()->actingAs($user)->postJson('/api/clips', $body)->assertUnprocessable()
            ->assertJsonPath('errors.url.0', 'This video is 57 minutes long. For now, use one up to 30 minutes.');
        $this->spa()->actingAs($user)->postJson('/api/clips', $body)->assertUnprocessable()
            ->assertJsonPath('errors.url.0', 'This is a live stream or a premiere that hasn’t ended. Try again once it is a regular video.');
        $this->spa()->actingAs($user)->postJson('/api/clips', $body)->assertUnprocessable()
            ->assertJsonPath('errors.url.0', 'YouTube says: This video is unavailable');

        Queue::assertNothingPushed();
        $this->assertSame(0, LinkClip::count());
    }

    public function test_a_link_is_queued_with_the_right_source_type_and_settings(): void
    {
        Queue::fake();
        self::youtube();
        $user = User::factory()->create();
        $clip = $this->spa()->actingAs($user)->postJson('/api/clips', [
            'url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'platform' => 'tiktok',
            'seconds' => 30,
            'count' => 3,
            'accent' => '#ff3366',
            'rights_confirmed' => true,
        ])->assertStatus(202)->assertJsonCount(3, 'data')->assertJsonPath('data.0.source_type', 'youtube')->assertJsonPath('data.0.status', 'queued')->assertJsonPath('data.2.batch_index', 3)->json('data');

        $this->assertSame(['tiktok', 30, '#ff3366'], [LinkClip::find($clip[0]['id'])->settings['platform'], LinkClip::find($clip[0]['id'])->settings['seconds'], LinkClip::find($clip[0]['id'])->settings['accent']]);
        $this->assertSame(1, collect($clip)->pluck('batch_id')->unique()->count());
        Queue::assertPushed(CreateLinkClip::class, 1);
        Queue::assertPushed(CreateLinkClip::class, fn ($job) => $job->clipId === $clip[0]['id']);

        $this->spa()->actingAs($user)->postJson('/api/clips', [
            'url' => 'https://example.com/a-good-article', 'platform' => 'instagram', 'seconds' => 45, 'rights_confirmed' => true,
        ])->assertStatus(202)->assertJsonPath('data.0.source_type', 'article');
    }

    public function test_a_highlight_goes_to_a_platform_as_a_reel_a_story_or_a_short_with_a_caption_colour(): void
    {
        Queue::fake();
        self::youtube();
        $user = User::factory()->create();
        $base = ['url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'seconds' => 30, 'count' => 1, 'rights_confirmed' => true];

        $story = $this->spa()->actingAs($user)->postJson('/api/clips', [...$base, 'platform' => 'facebook', 'placement' => 'story', 'caption_color' => '#FDE047'])
            ->assertStatus(202)->assertJsonPath('data.0.platform', 'facebook')->assertJsonPath('data.0.placement', 'story')->json('data.0.id');
        $this->assertSame('#fde047', LinkClip::find($story)->settings['style']['color']);
        $this->spa()->actingAs($user)->postJson('/api/clips', [...$base, 'platform' => 'youtube'])->assertStatus(202)->assertJsonPath('data.0.placement', 'short');
        $this->spa()->actingAs($user)->postJson('/api/clips', [...$base, 'platform' => 'tiktok'])->assertStatus(202)->assertJsonPath('data.0.placement', 'video');

        $this->spa()->actingAs($user)->postJson('/api/clips', [...$base, 'platform' => 'tiktok', 'placement' => 'story'])->assertUnprocessable()->assertJsonValidationErrors('placement');
        $this->spa()->actingAs($user)->postJson('/api/clips', [...$base, 'platform' => 'instagram', 'placement' => 'story', 'seconds' => 90])->assertUnprocessable()->assertJsonValidationErrors('seconds');
        $this->spa()->actingAs($user)->postJson('/api/clips', [...$base, 'platform' => ['x']])->assertUnprocessable()->assertJsonValidationErrors('platform');
    }

    public function test_rights_and_public_urls_are_required(): void
    {
        Queue::fake();
        $user = User::factory()->create();
        $base = ['platform' => 'tiktok', 'seconds' => 30];

        $this->spa()->actingAs($user)->postJson('/api/clips', [...$base, 'url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'])
            ->assertUnprocessable()->assertJsonValidationErrors('rights_confirmed');
        $this->spa()->actingAs($user)->postJson('/api/clips', [...$base, 'url' => 'https://127.0.0.1/private', 'rights_confirmed' => true])
            ->assertUnprocessable()->assertJsonValidationErrors('url');
        Queue::assertNothingPushed();
    }

    public function test_clip_jobs_are_private(): void
    {
        $mine = User::factory()->create();
        $other = User::factory()->create();
        $clip = $mine->linkClips()->create([
            'source_url' => 'https://example.com/article', 'source_type' => 'article', 'status' => 'failed', 'error' => 'No text.', 'settings' => ['platform' => 'tiktok', 'seconds' => 30],
        ]);

        $this->spa()->actingAs($other)->getJson("/api/clips/{$clip->id}")->assertNotFound();
        $this->spa()->actingAs($other)->deleteJson("/api/clips/{$clip->id}")->assertNotFound();
        $this->spa()->actingAs($mine)->getJson("/api/clips/{$clip->id}")->assertOk()->assertJsonPath('error', 'No text.');
    }

    public function test_the_gallery_lists_only_finished_clips_with_a_video(): void
    {
        $user = User::factory()->create();
        $settings = ['platform' => 'tiktok', 'seconds' => 30];
        $done = $user->linkClips()->create([
            'source_url' => 'https://example.com/a', 'source_type' => 'article', 'status' => 'ready', 'title' => 'Done', 'settings' => $settings,
            'asset_id' => Asset::factory()->create(['user_id' => $user->id])->id,
        ]);
        $user->linkClips()->create(['source_url' => 'https://example.com/b', 'source_type' => 'article', 'status' => 'rendering', 'settings' => $settings]);
        $user->linkClips()->create(['source_url' => 'https://example.com/c', 'source_type' => 'article', 'status' => 'failed', 'settings' => $settings]);
        $user->linkClips()->create(['source_url' => 'https://example.com/d', 'source_type' => 'article', 'status' => 'ready', 'settings' => $settings]); // its video is gone

        $this->spa()->actingAs($user)->getJson('/api/clips?ready=1')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $done->id);
        $this->spa()->actingAs($user)->getJson('/api/clips')->assertOk()->assertJsonCount(4, 'data');
        $this->spa()->actingAs(User::factory()->create())->getJson('/api/clips?ready=1')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_an_article_is_read_once_and_becomes_several_vertical_drafts_without_a_cloud_model(): void
    {
        config(['ai.providers.ollama.url' => null, 'ai.providers.sound.url' => 'http://sound.test']);
        $article = '<html><head><title>Why small rituals matter</title><meta name="description" content="A practical look at the value of daily rituals."></head><body><article><h1>Why small rituals matter</h1>'
            .'<p>Small rituals give the day a dependable shape. They reduce the number of decisions people need to make and make useful habits easier to repeat.</p>'
            .'<p>A ritual does not need to be elaborate. Preparing a desk, making tea, and writing down one priority can be enough to create a clear transition into focused work.</p>'
            .'</article></body></html>';
        Http::fake([
            'example.com/rituals' => Http::response($article, 200, ['Content-Type' => 'text/html']),
            'sound.test/health' => Http::response(['ok' => true]),
            'sound.test/v1/voices' => Http::response([['id' => 'voice-1', 'name' => 'Narrator', 'lang' => 'en', 'language' => 'English', 'gender' => 'female', 'style' => 'Warm', 'sample' => 'Hello']]),
            'sound.test/v1/speech' => fn (Request $request) => Http::response([
                'audio' => base64_encode(self::wav(1.2)), 'duration' => 1.2, 'voice' => $request['voice'], 'lang' => 'en',
                'words' => [['text' => 'Small', 'start' => 0.0, 'end' => 0.3], ['text' => 'rituals', 'start' => 0.3, 'end' => 0.7], ['text' => 'matter.', 'start' => 0.7, 'end' => 1.1]],
            ]),
        ]);
        $user = User::factory()->create();
        $batch = (string) Str::uuid();
        $clips = collect(range(1, 3))->map(fn (int $index) => $user->linkClips()->create([
            'batch_id' => $batch, 'batch_index' => $index, 'batch_total' => 3,
            'source_url' => 'https://example.com/rituals', 'source_type' => 'article', 'status' => 'queued',
            'settings' => ['platform' => 'instagram', 'seconds' => 15, 'accent' => '#a5b4fc'],
        ]));

        app(LinkClipper::class)->run($clips->first());
        $clips->each->refresh();

        foreach ($clips as $clip) {
            $this->assertSame('ready', $clip->status, $clip->error ?? '');
            $this->assertSame(['video', 1080, 1920], [$clip->asset->kind, $clip->asset->width, $clip->asset->height]);
            $this->assertSame(['instagram', 'reel'], [$clip->post->platforms[0], $clip->post->placement]);
        }
        $articleRequests = collect(Http::recorded())->filter(fn ($pair) => $pair[0]->url() === 'https://example.com/rituals');
        $speechRequests = collect(Http::recorded())->filter(fn ($pair) => str_ends_with($pair[0]->url(), '/v1/speech'));
        $this->assertCount(1, $articleRequests);
        $this->assertCount(3, $speechRequests);
    }

    public function test_a_landscape_source_is_rendered_as_a_captioned_vertical_clip(): void
    {
        $base = tempnam(sys_get_temp_dir(), 'clip-source');
        $source = $base.'.mp4';
        @unlink($base);
        $made = Process::timeout(30)->run([
            'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=#24324a:s=640x360:r=30',
            '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '2',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', $source,
        ]);
        $this->assertTrue($made->successful(), $made->errorOutput());

        $rendered = null;
        try {
            $rendered = app(ClipRenderer::class)->render($source, 0, 1.5, [
                ['text' => 'A', 'start' => 0.0, 'end' => 0.3],
                ['text' => 'useful', 'start' => 0.3, 'end' => 0.8],
                ['text' => 'moment', 'start' => 0.8, 'end' => 1.3],
            ], 'A useful moment');
            $probe = Process::timeout(15)->run([
                'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', $rendered,
            ]);
            $stream = json_decode($probe->output(), true)['streams'][0] ?? [];

            $this->assertTrue($probe->successful(), $probe->errorOutput());
            $this->assertSame([1080, 1920], [$stream['width'] ?? null, $stream['height'] ?? null]);
            $this->assertGreaterThan(10_000, filesize($rendered));
        } finally {
            @unlink($source);
            @unlink((string) $rendered);
        }
    }

    public function test_a_batch_selects_distinct_moments_from_one_transcript(): void
    {
        config(['ai.providers.ollama.url' => null]);
        $user = User::factory()->create();
        $clip = $user->linkClips()->create([
            'source_url' => 'https://youtube.com/watch?v=batch', 'source_type' => 'youtube', 'status' => 'queued',
            'settings' => ['platform' => 'tiktok', 'seconds' => 30],
        ]);
        $segments = collect(range(0, 59))->map(fn (int $index) => [
            'start' => $index * 10.0,
            'end' => $index * 10.0 + 9.0,
            'text' => str_repeat("useful moment {$index} ", ($index % 7) + 2),
        ])->all();

        $plans = app(ClipPlanner::class)->videos($clip, ['text' => 'transcript', 'segments' => $segments], 600, 30, 'Long source', 5);

        $this->assertCount(5, $plans);
        $this->assertCount(5, collect($plans)->pluck('start')->unique());
        foreach ($plans as $left => $plan) {
            foreach ($plans as $right => $other) {
                if ($left >= $right) {
                    continue;
                }
                $intersection = max(0, min($plan['end'], $other['end']) - max($plan['start'], $other['start']));
                $this->assertLessThanOrEqual(6.0, $intersection);
            }
        }
    }

    public function test_the_editor_saves_words_style_and_music_and_renders_again(): void
    {
        Queue::fake();
        $user = User::factory()->create();
        $batch = (string) Str::uuid();
        $make = fn (int $index) => $user->linkClips()->create([
            'batch_id' => $batch, 'batch_index' => $index, 'batch_total' => 2,
            'source_url' => 'https://youtube.com/watch?v=edit', 'source_type' => 'youtube', 'status' => 'ready', 'title' => "Moment {$index}",
            'settings' => ['platform' => 'tiktok', 'seconds' => 30, 'accent' => '#ff3366'],
            'analysis' => ['start' => 10, 'end' => 20, 'title' => "Moment {$index}", 'words' => [['text' => 'hello', 'start' => 0.1, 'end' => 0.5]]],
            'asset_id' => Asset::factory()->create(['user_id' => $user->id])->id,
        ]);
        $clip = $make(1);
        $sibling = $make(2);
        $song = Asset::factory()->create(['user_id' => $user->id, 'kind' => 'audio', 'mime' => 'audio/mpeg']);
        $foreign = Asset::factory()->create(['user_id' => User::factory()->create()->id, 'kind' => 'audio', 'mime' => 'audio/mpeg']);

        $this->spa()->actingAs($user)->getJson("/api/clips/{$clip->id}/edit")->assertOk()
            ->assertJsonPath('words.0.text', 'hello')
            ->assertJsonPath('style.font', 'bold')
            ->assertJsonPath('style.highlight', '#ff7094')
            ->assertJsonPath('master_url', null)
            ->assertJsonPath('batch_ready', 2)
            ->assertJsonPath('fonts.0.url', '/api/clips/fonts/bold');

        $this->spa()->actingAs($user)->patchJson("/api/clips/{$clip->id}", ['music' => ['asset_id' => $foreign->id]])
            ->assertUnprocessable()->assertJsonValidationErrors('music.asset_id');
        $this->spa()->actingAs($user)->patchJson("/api/clips/{$clip->id}", ['style' => ['font' => 'comic-sans', 'y' => 2]])
            ->assertUnprocessable()->assertJsonValidationErrors(['style.font', 'style.y']);

        $this->spa()->actingAs($user)->patchJson("/api/clips/{$clip->id}", [
            'words' => [['text' => '  Hello ', 'start' => 0.1, 'end' => 0.5], ['text' => 'world', 'start' => 0.5, 'end' => 0.5], ['text' => ' ', 'start' => 1, 'end' => 2]],
            'style' => ['font' => 'anton', 'color' => '#ffee00', 'backdrop' => 'box', 'y' => 0.5, 'uppercase' => true],
            'music' => ['asset_id' => $song->id, 'volume' => 0.4],
            'apply_to_batch' => true,
        ])->assertStatus(202)->assertJsonCount(2, 'data')->assertJsonPath('data.0.status', 'rendering');

        $clip->refresh();
        $sibling->refresh();
        $this->assertSame([['text' => 'Hello', 'start' => 0.1, 'end' => 0.5], ['text' => 'world', 'start' => 0.5, 'end' => 0.55]], $clip->analysis['words']);
        $this->assertSame('anton', $sibling->settings['style']['font']);
        $this->assertSame($song->id, $sibling->settings['music']['asset_id']);
        $this->assertSame('hello', $sibling->analysis['words'][0]['text'], 'the words stay each clip\'s own');
        Queue::assertPushed(RestyleLinkClip::class, 2);

        $this->spa()->actingAs($user)->patchJson("/api/clips/{$clip->id}", ['style' => ['size' => 120]])->assertStatus(409);
        $this->spa()->actingAs(User::factory()->create())->getJson("/api/clips/{$clip->id}/edit")->assertNotFound();
        $this->spa()->actingAs($user)->get('/api/clips/fonts/anton')->assertOk()->assertHeader('Content-Type', 'font/ttf');
        $this->spa()->actingAs($user)->get('/api/clips/fonts/..%2F..%2F.env')->assertNotFound();
    }

    public function test_an_edited_highlight_is_rendered_from_its_master_with_music_and_replaces_the_old_video(): void
    {
        Storage::fake('local');
        $user = User::factory()->create();
        $tmp = tempnam(sys_get_temp_dir(), 'master');
        $made = Process::timeout(30)->run([
            'ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=#24324a:s=1080x1920:r=30',
            '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '2',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mp4', $tmp,
        ]);
        $this->assertTrue($made->successful(), $made->errorOutput());
        Storage::disk('local')->put('clips/master.mp4', file_get_contents($tmp));
        @unlink($tmp);
        Storage::disk('local')->put('assets/song.wav', self::wav(3));
        $song = Asset::factory()->create(['user_id' => $user->id, 'kind' => 'audio', 'mime' => 'audio/wav', 'path' => 'assets/song.wav']);
        $old = Asset::factory()->create(['user_id' => $user->id]);
        $post = $user->posts()->create(['title' => 'Draft', 'body' => 'Body', 'format' => 'video', 'platforms' => ['tiktok'], 'status' => 'draft']);
        $post->syncAssets([$old->id]);
        $clip = $user->linkClips()->create([
            'source_url' => 'https://youtube.com/watch?v=edit', 'source_type' => 'youtube', 'status' => 'rendering', 'title' => 'A moment',
            'settings' => ['platform' => 'tiktok', 'seconds' => 30, 'style' => ['font' => 'caveat', 'backdrop' => 'box', 'highlight' => null, 'words' => 1], 'music' => ['asset_id' => $song->id, 'volume' => 0.3]],
            'analysis' => ['start' => 0, 'end' => 2, 'title' => 'A moment', 'words' => [['text' => 'Edited', 'start' => 0.1, 'end' => 0.6], ['text' => 'words', 'start' => 0.6, 'end' => 1.2]]],
            'asset_id' => $old->id, 'post_id' => $post->id, 'master_path' => 'clips/master.mp4',
        ]);

        (new RestyleLinkClip($clip->id))->handle(app(LinkClipper::class));
        $clip->refresh();

        $this->assertSame('ready', $clip->status, (string) $clip->error);
        $this->assertNotSame($old->id, $clip->asset_id);
        $this->assertSame([1080, 1920], [$clip->asset->width, $clip->asset->height]);
        $this->assertSame([$clip->asset_id], $post->assets()->pluck('assets.id')->all());
        $this->assertNull(Asset::find($old->id), 'the old render is removed');
        $this->assertSame('Edited', $clip->asset->meta['words'][0]['text']);

        $clip->delete();
        Storage::disk('local')->assertMissing('clips/master.mp4');
    }

    public function test_arabic_subtitles_get_an_arabic_font_and_one_run_per_word(): void
    {
        foreach (array_keys(ClipFonts::FONTS) as $key) {
            $this->assertFileExists((string) ClipFonts::path($key));
        }
        $arabic = [['text' => 'الكم', 'start' => 0.0, 'end' => 0.4], ['text' => 'فرنزد', 'start' => 0.4, 'end' => 0.8], ['text' => 'برس', 'start' => 0.8, 'end' => 1.2]];
        $this->assertTrue(ClipStyle::arabic($arabic));
        $this->assertFalse(ClipStyle::arabic([['text' => 'hello', 'start' => 0, 'end' => 1]]));
        $this->assertSame(ClipFonts::ARABIC_DEFAULT, ClipStyle::resolve(null, '#a5b4fc', 'youtube', true)['font']);
        $this->assertSame('bold', ClipStyle::resolve(['font' => 'bold'], '#a5b4fc', 'youtube', true)['font'], 'a chosen font stays');

        // libass draws words left to right in the order they come, so Arabic lines are written back
        // to front, each word its own run, and broken by hand (\q2).
        $ass = Captions::ass($arabic, 'bold', ClipStyle::look(ClipStyle::defaults(arabic: true), 'عنوان قصير', 3), 3);
        $this->assertStringContainsString('فرنزد{\r} {\1a&H00&}الكم', $ass);
        $this->assertStringContainsString('\q2\pos(540,250)}{\1a&H01&}قصير {\1a&H00&}عنوان', $ass);
        $this->assertStringContainsString('Style: Bold,Noto Sans Arabic ExtraBold,', $ass);

        $english = Captions::ass([['text' => 'one', 'start' => 0, 'end' => 0.4], ['text' => 'two', 'start' => 0.4, 'end' => 0.8]], 'bold', ClipStyle::look(ClipStyle::defaults(), 'A title', 1), 1);
        $this->assertStringContainsString('one{\r} {\1a&H01&}two', $english);
        $this->assertStringNotContainsString('\q2', $english);
    }

    private static function wav(float $seconds, int $rate = 24000): string
    {
        $data = '';
        for ($i = 0, $n = (int) ($seconds * $rate); $i < $n; $i++) {
            $data .= pack('v', ((int) (6000 * sin(2 * M_PI * 220 * $i / $rate))) & 0xFFFF);
        }

        return 'RIFF'.pack('V', 36 + strlen($data)).'WAVEfmt '.pack('VvvVVvv', 16, 1, 1, $rate, $rate * 2, 2, 16).'data'.pack('V', strlen($data)).$data;
    }
}

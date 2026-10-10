<?php

namespace Tests\Feature;

use App\Jobs\CreateLinkClip;
use App\Models\LinkClip;
use App\Models\User;
use App\Services\Clips\ClipRenderer;
use App\Services\Clips\LinkClipper;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class LinkClipTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_link_is_queued_with_the_right_source_type_and_settings(): void
    {
        Queue::fake();
        $user = User::factory()->create();
        $clip = $this->spa()->actingAs($user)->postJson('/api/clips', [
            'url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'platform' => 'tiktok',
            'seconds' => 30,
            'accent' => '#ff3366',
            'rights_confirmed' => true,
        ])->assertStatus(202)->assertJsonPath('source_type', 'youtube')->assertJsonPath('status', 'queued')->json();

        $this->assertSame(['tiktok', 30, '#ff3366'], [LinkClip::find($clip['id'])->settings['platform'], LinkClip::find($clip['id'])->settings['seconds'], LinkClip::find($clip['id'])->settings['accent']]);
        Queue::assertPushed(CreateLinkClip::class, fn ($job) => $job->clipId === $clip['id']);

        $this->spa()->actingAs($user)->postJson('/api/clips', [
            'url' => 'https://example.com/a-good-article', 'platform' => 'instagram', 'seconds' => 45, 'rights_confirmed' => true,
        ])->assertStatus(202)->assertJsonPath('source_type', 'article');
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

    public function test_an_article_becomes_a_vertical_video_draft_without_a_cloud_model(): void
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
        $clip = $user->linkClips()->create([
            'source_url' => 'https://example.com/rituals', 'source_type' => 'article', 'status' => 'queued',
            'settings' => ['platform' => 'instagram', 'seconds' => 15, 'accent' => '#a5b4fc'],
        ]);

        app(LinkClipper::class)->run($clip);
        $clip->refresh();

        $this->assertSame('ready', $clip->status, $clip->error ?? '');
        $this->assertSame(['video', 1080, 1920], [$clip->asset->kind, $clip->asset->width, $clip->asset->height]);
        $this->assertSame(['instagram', 'reel'], [$clip->post->platforms[0], $clip->post->placement]);
        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/v1/speech'));
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

    private static function wav(float $seconds, int $rate = 24000): string
    {
        $data = '';
        for ($i = 0, $n = (int) ($seconds * $rate); $i < $n; $i++) {
            $data .= pack('v', ((int) (6000 * sin(2 * M_PI * 220 * $i / $rate))) & 0xFFFF);
        }

        return 'RIFF'.pack('V', 36 + strlen($data)).'WAVEfmt '.pack('VvvVVvv', 16, 1, 1, $rate, $rate * 2, 2, 16).'data'.pack('V', strlen($data)).$data;
    }
}

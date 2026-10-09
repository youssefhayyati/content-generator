<?php

namespace Tests\Feature;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\ActionLog;
use App\Models\AiUsage;
use App\Models\Asset;
use App\Models\Device;
use App\Models\Post;
use App\Models\User;
use App\Services\Ai\UsageMeter;
use App\Services\Media\MediaInspector;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class StudioFoundationsTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public function test_images_are_uploaded_measured_and_served_only_to_their_owner(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->spa()->post('/api/assets', [
            'files' => [UploadedFile::fake()->createWithContent('dot.png', base64_decode(self::PNG))],
        ])->assertCreated()
            ->assertJsonPath('0.kind', 'image')
            ->assertJsonPath('0.width', 1)
            ->assertJsonPath('0.height', 1)
            ->assertJsonPath('0.name', 'dot.png');

        $url = $response->json('0.url');
        $file = $this->spa()->get($url)->assertOk()->assertHeader('Content-Type', 'image/png')->baseResponse->getFile();
        $this->assertSame(base64_decode(self::PNG), file_get_contents($file->getPathname()));
        $this->spa()->getJson('/api/assets')->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.url', $url);

        $this->actingAs(User::factory()->create())->spa()->get($url)->assertForbidden();

        $this->spa()->post('/api/assets', ['files' => [UploadedFile::fake()->create('brief.pdf', 10, 'application/pdf')]])
            ->assertJsonValidationErrors(['files.0' => 'Use JPG, PNG, WebP or GIF images; MP4, MOV or WebM videos; or MP3, M4A, WAV, OGG or FLAC audio.']);
    }

    public function test_videos_are_measured_with_ffprobe_and_get_a_poster(): void
    {
        if (! app(MediaInspector::class)->canReadVideo()) {
            $this->markTestSkipped('ffmpeg is not installed here.');
        }

        // A real two-second vertical video, made by ffmpeg.
        $path = tempnam(sys_get_temp_dir(), 'clip').'.mp4';
        Process::run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=540x960:rate=10', '-t', '2', '-pix_fmt', 'yuv420p', $path])->throw();

        $this->actingAs(User::factory()->create())->spa()->post('/api/assets', [
            'files' => [new UploadedFile($path, 'clip.mp4', 'video/mp4', null, true)],
        ])->assertCreated()
            ->assertJsonPath('0.kind', 'video')
            ->assertJsonPath('0.width', 540)
            ->assertJsonPath('0.height', 960)
            ->assertJsonPath('0.duration', 2);

        $asset = Asset::first();
        Storage::disk('local')->assertExists($asset->poster_path);
    }

    public function test_accounts_belong_to_their_owner_and_are_unique_per_platform(): void
    {
        $user = User::factory()->create();
        $device = Device::factory()->for($user)->create();

        $this->actingAs($user)->spa()->postJson('/api/accounts', [
            'platform' => 'instagram', 'handle' => '@maisoncire', 'device_id' => $device->id,
            'profile' => ['tone' => 'Warm and unhurried', 'mood' => 'ignored'],
        ])->assertCreated()
            ->assertJsonPath('handle', 'maisoncire')
            ->assertJsonPath('label', '@maisoncire on Instagram')
            ->assertJsonPath('device.name', $device->name)
            ->assertJsonPath('automation', false)
            ->assertJsonPath('autonomy', 'approve_all')
            ->assertJsonPath('profile', ['tone' => 'Warm and unhurried']);

        $this->spa()->postJson('/api/accounts', ['platform' => 'instagram', 'handle' => 'maisoncire'])
            ->assertJsonValidationErrors(['handle' => 'That account is already in the studio.']);
        $this->spa()->postJson('/api/accounts', ['platform' => 'tiktok', 'handle' => 'maisoncire'])->assertCreated();

        $theirs = Device::factory()->create();
        $this->spa()->postJson('/api/accounts', ['platform' => 'x', 'handle' => 'cire', 'device_id' => $theirs->id])
            ->assertJsonValidationErrors('device_id');

        $account = Account::first();
        $this->spa()->patchJson("/api/accounts/{$account->id}", ['automation' => true, 'autonomy' => 'rules'])
            ->assertOk()->assertJsonPath('automation', true)->assertJsonPath('autonomy', 'rules');
        $this->assertSame(['account.automation', 'account.autonomy'], ActionLog::where('action', 'like', 'account.a%')->orderBy('id')->pluck('action')->all());

        $this->actingAs(User::factory()->create())->spa()->patchJson("/api/accounts/{$account->id}", ['automation' => false])->assertForbidden();
    }

    public function test_phones_on_the_service_need_a_device_id(): void
    {
        $this->actingAs(User::factory()->create())->spa()->postJson('/api/devices', ['name' => 'Rack 1', 'driver' => 'http'])
            ->assertJsonValidationErrors(['ref' => 'Enter the device ID the phone-control service uses for this phone.']);

        $this->spa()->postJson('/api/devices', ['name' => 'Rack 1', 'driver' => 'http', 'ref' => 'dev-7'])->assertCreated()->assertJsonPath('status', 'idle');
        $this->spa()->postJson('/api/devices', ['name' => 'Sim', 'driver' => 'simulator', 'profile' => 'flaky'])->assertCreated()->assertJsonPath('profile', 'flaky');
        $this->spa()->getJson('/api/devices')->assertJsonCount(2);
    }

    public function test_the_pre_export_check_holds_media_and_captions_to_the_placement(): void
    {
        $user = User::factory()->create();
        $square = Asset::factory()->for($user)->sized(1080, 1080)->create();
        $wide = Asset::factory()->for($user)->video(1920, 1080, 30)->create();
        $long = Asset::factory()->for($user)->video(1080, 1920, 120)->create();
        $tall = Asset::factory()->for($user)->video(1080, 1920, 20)->create();
        $check = fn (array $body) => $this->actingAs($user)->spa()->postJson('/api/checks', $body)->assertOk();

        // Instagram feed needs media; text alone fails.
        $check(['platforms' => ['instagram'], 'caption' => 'Hello'])
            ->assertJsonPath('0.ok', false)->assertJsonPath('0.placement', 'feed')
            ->assertJsonPath('0.checks.0.detail', 'Instagram feed post takes 1 to 10 files, this has 0.');

        // A square image is fine in the feed; X and LinkedIn take text alone.
        $check(['platforms' => ['instagram', 'x', 'linkedin'], 'caption' => 'Hello', 'asset_ids' => [$square->id]])
            ->assertJsonPath('0.ok', true)->assertJsonPath('1.ok', true)->assertJsonPath('2.ok', true);

        // A video defaults to a Reel: landscape fails the shape, two minutes fails the length.
        $check(['platforms' => ['instagram'], 'asset_ids' => [$wide->id]])
            ->assertJsonPath('0.placement', 'reel')->assertJsonPath('0.ok', false);
        $result = $check(['platforms' => ['instagram'], 'asset_ids' => [$long->id]])->json('0');
        $this->assertContains('Instagram reel takes 3–90 s.', array_map(fn ($c) => preg_replace('/^.*?; /', '', $c['detail']), $result['checks']));
        $check(['platforms' => ['instagram', 'tiktok'], 'asset_ids' => [$tall->id]])->assertJsonPath('0.ok', true)->assertJsonPath('1.ok', true);

        // X caps the caption at 280; Instagram at 30 hashtags.
        $check(['platforms' => ['x'], 'caption' => str_repeat('a', 281)])->assertJsonPath('0.ok', false);
        $check(['platforms' => ['instagram'], 'asset_ids' => [$square->id], 'caption' => implode(' ', array_map(fn ($i) => "#tag{$i}", range(1, 31)))])
            ->assertJsonPath('0.ok', false);

        // Someone else's media isn't checked (or leaked).
        $this->actingAs(User::factory()->create())->spa()->postJson('/api/checks', ['platforms' => ['instagram'], 'asset_ids' => [$square->id]])
            ->assertJsonPath('0.checks.0.detail', 'Instagram feed post takes 1 to 10 files, this has 0.');
    }

    public function test_posts_carry_an_account_media_and_the_approval_of_whoever_scheduled_them(): void
    {
        $user = User::factory()->create();
        $account = Account::factory()->for($user)->create(['platform' => 'instagram']);
        $photo = Asset::factory()->for($user)->create();
        $cover = Asset::factory()->for($user)->create();

        $id = $this->actingAs($user)->spa()->postJson('/api/posts', [
            'body' => 'Autumn pour', 'format' => 'image', 'platforms' => ['linkedin', 'x'], 'status' => 'scheduled',
            'scheduled_at' => now()->addDay()->toIso8601String(), 'account_id' => $account->id, 'asset_ids' => [$cover->id, $photo->id],
        ])->assertCreated()
            ->assertJsonPath('platforms', ['instagram'])
            ->assertJsonPath('account.handle', $account->handle)
            ->assertJsonPath('assets.0.id', $cover->id)
            ->assertJsonPath('assets.1.id', $photo->id)
            ->json('id');

        $post = Post::find($id);
        $this->assertNotNull($post->approved_at);
        $this->assertSame($user->id, $post->approved_by);
        $this->assertDatabaseHas('action_logs', ['action' => 'post.scheduled', 'subject_id' => $id, 'decision' => 'approved']);

        // Back to draft: the approval goes with it.
        $this->spa()->putJson("/api/posts/{$id}", ['body' => 'Autumn pour', 'format' => 'image', 'platforms' => ['instagram'], 'status' => 'draft'])->assertOk();
        $this->assertNull($post->fresh()->approved_at);

        // Run outcomes aren't something the composer can set.
        $this->spa()->putJson("/api/posts/{$id}", ['body' => 'x', 'format' => 'text', 'platforms' => ['x'], 'status' => 'failed'])->assertJsonValidationErrors('status');

        $theirs = Asset::factory()->create();
        $this->spa()->postJson('/api/posts', ['body' => 'x', 'format' => 'text', 'platforms' => ['x'], 'status' => 'draft', 'asset_ids' => [$theirs->id]])
            ->assertJsonValidationErrors('asset_ids.0');
    }

    public function test_posts_a_phone_will_publish_must_pass_the_platform_check_first(): void
    {
        $user = User::factory()->create();
        $account = Account::factory()->for($user)->automated()->create(['platform' => 'instagram']);
        $wide = Asset::factory()->for($user)->video(1920, 1080, 20)->create();
        $tall = Asset::factory()->for($user)->video(1080, 1920, 20)->create();
        $post = fn (array $extra) => $this->actingAs($user)->spa()->postJson('/api/posts', [
            'body' => 'New pour', 'format' => 'video', 'platforms' => ['instagram'], 'status' => 'scheduled',
            'scheduled_at' => now()->addDay()->toIso8601String(), 'account_id' => $account->id, ...$extra,
        ]);

        $post(['asset_ids' => [$wide->id]])->assertJsonValidationErrors('checks');
        $post(['asset_ids' => [$tall->id]])->assertCreated();
        // A draft can be anything.
        $post(['asset_ids' => [$wide->id], 'status' => 'draft', 'scheduled_at' => null])->assertCreated();
    }

    public function test_the_inbox_collects_posts_that_need_a_person(): void
    {
        $user = User::factory()->create();
        Post::factory()->for($user)->create(['status' => PostStatus::Failed, 'error' => 'The app kept crashing.', 'scheduled_at' => now()->subHour()]);
        Post::factory()->for($user)->create(['status' => PostStatus::Submitted, 'scheduled_at' => now()->subMinutes(10)]);
        Post::factory()->for($user)->scheduled()->create();

        $this->actingAs($user)->spa()->getJson('/api/inbox')
            ->assertJsonCount(2)
            ->assertJsonPath('0.kind', 'publish_failed')
            ->assertJsonPath('0.tone', 'fail')
            ->assertJsonPath('1.kind', 'publish_unconfirmed');
        $this->spa()->getJson('/api/overview')->assertJsonPath('inbox', 2)->assertJsonPath('counts.failed', 1)->assertJsonPath('publishing_paused', false);
    }

    public function test_model_calls_are_metered_against_whoever_they_are_for(): void
    {
        $user = User::factory()->create();
        $post = Post::factory()->for($user)->create();
        $meter = app(UsageMeter::class);

        $meter->within($user, $post, 'writing', fn () => $meter->record('anthropic', 'claude-opus-5-5', 1_000_000, 100_000));
        $meter->record('anthropic', 'unknown-model', 10, 10);

        $usage = AiUsage::orderBy('id')->get();
        $this->assertSame([$user->id, 'writing', 6.0, $post->id], [$usage[0]->user_id, $usage[0]->purpose, $usage[0]->cost, $usage[0]->context_id]);
        // Outside within(), nobody is charged and the price falls back to zero.
        $this->assertSame([null, 0.0], [$usage[1]->user_id, $usage[1]->cost]);
    }
}

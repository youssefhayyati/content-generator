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
use App\Services\Publishing\Adb;
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

    public function test_a_scan_lists_the_plugged_in_phones_and_marks_the_registered_ones(): void
    {
        $user = User::factory()->create();
        $known = $user->devices()->create(['name' => 'Desk phone', 'driver' => 'http', 'ref' => 'SER1']);
        $this->mock(Adb::class)->shouldReceive('devices')->andReturn([
            ['serial' => 'SER1', 'state' => 'device', 'model' => 'Pixel 3', 'manufacturer' => 'Google', 'android' => '9'],
            ['serial' => 'SER2', 'state' => 'unauthorized', 'model' => null, 'manufacturer' => null, 'android' => null],
        ]);

        $this->actingAs($user)->spa()->getJson('/api/devices/scan')->assertOk()
            ->assertJsonPath('available', true)
            ->assertJsonPath('phones.0.name', 'Google Pixel 3')
            ->assertJsonPath('phones.0.device_id', $known->id)
            ->assertJsonPath('phones.1.name', 'SER2')
            ->assertJsonPath('phones.1.device_id', null);
        $this->assertNotNull($known->fresh()->last_seen_at);

        // Another studio's phone with the same serial isn't "yours".
        $this->actingAs(User::factory()->create())->spa()->getJson('/api/devices/scan')->assertJsonPath('phones.0.device_id', null);
    }

    public function test_a_scan_without_an_adb_server_says_so(): void
    {
        $this->mock(Adb::class)->shouldReceive('devices')->andThrow(new \RuntimeException('No adb server at host:5037.'));

        $this->actingAs(User::factory()->create())->spa()->getJson('/api/devices/scan')->assertOk()
            ->assertJsonPath('available', false)->assertJsonPath('error', 'No adb server at host:5037.')->assertJsonCount(0, 'phones');
    }

    public function test_a_real_phone_can_be_watched_and_driven_by_hand(): void
    {
        $user = User::factory()->create();
        $phone = $user->devices()->create(['name' => 'Desk phone', 'driver' => 'http', 'ref' => 'SER1']);
        $adb = $this->mock(Adb::class);
        $adb->shouldReceive('screenshot')->with('SER1')->andReturn(['png' => 'PNGDATA', 'width' => 1080, 'height' => 2160]);
        $adb->shouldReceive('tap')->once()->with('SER1', 540, 1200);
        $adb->shouldReceive('swipe')->once()->with('SER1', 500, 1600, 500, 400, 300);
        $adb->shouldReceive('key')->once()->with('SER1', 'back');
        $adb->shouldReceive('type')->once()->with('SER1', 'hello world');

        $this->actingAs($user)->spa()->get("/api/devices/{$phone->id}/live")->assertOk()
            ->assertHeader('Content-Type', 'image/png')->assertHeader('X-Screen-Width', 1080)->assertHeader('X-Screen-Height', 2160);
        $this->assertNotNull($phone->fresh()->last_seen_at);

        $this->spa()->postJson("/api/devices/{$phone->id}/control", ['action' => 'tap', 'x' => 540, 'y' => 1200])->assertNoContent();
        $this->spa()->postJson("/api/devices/{$phone->id}/control", ['action' => 'swipe', 'x' => 500, 'y' => 1600, 'x2' => 500, 'y2' => 400])->assertNoContent();
        $this->spa()->postJson("/api/devices/{$phone->id}/control", ['action' => 'key', 'key' => 'back'])->assertNoContent();
        $this->spa()->postJson("/api/devices/{$phone->id}/control", ['action' => 'text', 'text' => 'hello world'])->assertNoContent();
        $this->spa()->postJson("/api/devices/{$phone->id}/control", ['action' => 'key', 'key' => 'reboot'])->assertJsonValidationErrors('key');
        $this->spa()->postJson("/api/devices/{$phone->id}/control", ['action' => 'tap'])->assertJsonValidationErrors(['x', 'y']);

        // A run on the phone owns it; hands off until it's done.
        $phone->forceFill(['booked_run_id' => 99])->save();
        $this->spa()->postJson("/api/devices/{$phone->id}/control", ['action' => 'key', 'key' => 'home'])->assertStatus(409);

        $sim = $user->devices()->create(['name' => 'Sim', 'driver' => 'simulator']);
        $this->spa()->getJson("/api/devices/{$sim->id}/live")->assertStatus(422);

        $this->actingAs(User::factory()->create())->spa()->getJson("/api/devices/{$phone->id}/live")->assertForbidden();
    }

    public function test_the_live_stream_ticket_is_signed_and_carries_who_may_touch(): void
    {
        $user = User::factory()->create();
        $phone = $user->devices()->create(['name' => 'Desk phone', 'driver' => 'http', 'ref' => 'SER1']);

        $res = $this->actingAs($user)->spa()->postJson("/api/devices/{$phone->id}/stream")->assertOk()->assertJsonPath('control', true);
        parse_str((string) parse_url($res->json('url'), PHP_URL_QUERY), $query);
        [$body, $sig] = explode('.', $query['ticket']);
        $this->assertSame(hash_hmac('sha256', $body, config('app.key')), $sig);
        $ticket = json_decode(base64_decode(strtr($body, '-_', '+/')), true);
        $this->assertSame(['d' => $phone->id, 's' => 'SER1', 'c' => true], array_intersect_key($ticket, array_flip(['d', 's', 'c'])));
        $this->assertGreaterThan(now()->timestamp, $ticket['e']);

        // While a run drives the phone, the stream is watch-only.
        $phone->forceFill(['booked_run_id' => 99])->save();
        $this->spa()->postJson("/api/devices/{$phone->id}/stream")->assertJsonPath('control', false);

        $sim = $user->devices()->create(['name' => 'Sim', 'driver' => 'simulator']);
        $this->spa()->postJson("/api/devices/{$sim->id}/stream")->assertStatus(422);
        $this->actingAs(User::factory()->create())->spa()->postJson("/api/devices/{$phone->id}/stream")->assertForbidden();
    }

    public function test_deleting_a_phone_unlinks_its_accounts_but_not_while_it_runs(): void
    {
        $user = User::factory()->create();
        $phone = $user->devices()->create(['name' => 'Desk phone', 'driver' => 'http', 'ref' => 'SER1']);
        $account = Account::factory()->for($user)->create(['device_id' => $phone->id]);

        $phone->forceFill(['booked_run_id' => 99])->save();
        $this->actingAs($user)->spa()->deleteJson("/api/devices/{$phone->id}")->assertStatus(409);
        $phone->forceFill(['booked_run_id' => null])->save();

        $this->actingAs(User::factory()->create())->spa()->deleteJson("/api/devices/{$phone->id}")->assertForbidden();

        $this->actingAs($user)->spa()->deleteJson("/api/devices/{$phone->id}")->assertNoContent();
        $this->assertModelMissing($phone);
        $this->assertNull($account->fresh()->device_id);
        $this->assertSame(1, ActionLog::where('action', 'device.deleted')->count());
    }

    public function test_a_phone_that_cannot_be_reached_says_why(): void
    {
        $user = User::factory()->create();
        $phone = $user->devices()->create(['name' => 'Desk phone', 'driver' => 'http', 'ref' => 'SER1']);
        $this->mock(Adb::class)->shouldReceive('screenshot')->andThrow(new \RuntimeException("adb: device 'SER1' not found"));

        $this->actingAs($user)->spa()->getJson("/api/devices/{$phone->id}/live")->assertStatus(503)->assertJsonPath('message', "adb: device 'SER1' not found");

        // adb's own words, turned into what to do about it.
        $this->assertSame(Adb::NOT_CONNECTED, Adb::explain("device 'SER1' not found"));
        $this->assertStringContainsString('Tap Allow', Adb::explain('device unauthorized.'));
        $this->assertSame('adb: something else', Adb::explain('something else'));
    }

    public function test_only_plain_text_is_typed_into_a_phone(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        (new Adb('nowhere', 1))->type('SER1', 'café');
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

<?php

namespace Tests\Feature;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\Device;
use App\Models\Post;
use App\Models\PublishingRun;
use App\Models\User;
use App\Services\Publishing\Publisher;
use App\Services\Publishing\SimulatorPhone;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PublishingTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Device $phone;

    private Account $account;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->user = User::factory()->create();
        $this->phone = Device::factory()->for($this->user)->create(['name' => 'Studio phone']);
        $this->account = Account::factory()->for($this->user)->automated()->create([
            'platform' => 'instagram', 'handle' => 'maisoncire', 'device_id' => $this->phone->id,
        ]);
    }

    protected function tearDown(): void
    {
        SimulatorPhone::rig(null);
        parent::tearDown();
    }

    /** An approved post whose time has come, ready for the phone. */
    private function duePost(array $overrides = []): Post
    {
        return Post::factory()->for($this->user)->for($this->account)->scheduled(now()->subMinute())
            ->create(['approved_at' => now(), 'body' => 'A warm caption for the evening ritual.', ...$overrides]);
    }

    public function test_a_due_approved_post_publishes_on_the_simulator_with_proof(): void
    {
        $post = $this->duePost();

        $this->assertSame(1, app(Publisher::class)->dispatchDue());

        $post->refresh();
        $this->assertSame(PostStatus::Published, $post->status);
        $this->assertNotNull($post->published_at);

        $run = $post->runs()->sole();
        $this->assertSame('confirmed', $run->status);
        $this->assertSame('screenshot', $run->evidence['kind']);
        $this->assertNotNull($run->screenshot_id);
        $this->assertNotNull($run->ended_at);
        $actions = collect($run->steps)->pluck('action');
        $this->assertContains('app-start', $actions);
        $this->assertContains('tap:post-button', $actions);
        $this->assertContains('screenshot', $actions);
        $this->assertTrue(collect($run->steps)->every(fn ($s) => $s['ok']));

        // The phone is free again, with the screenshot as its latest.
        $this->phone->refresh();
        $this->assertNull($this->phone->booked_run_id);
        $this->assertSame('idle', $this->phone->status);
        $this->assertNotNull($this->phone->last_screenshot);
    }

    public function test_only_approved_automated_due_posts_dispatch(): void
    {
        $unapproved = $this->duePost(['approved_at' => null]);
        $notAutomated = Post::factory()->for($this->user)->for(
            Account::factory()->for($this->user)->create(['device_id' => $this->phone->id])
        )->scheduled(now()->subMinute())->create(['approved_at' => now()]);
        $future = $this->duePost(['scheduled_at' => now()->addHour()]);

        $this->assertSame(0, app(Publisher::class)->dispatchDue());
        $this->assertSame(0, PublishingRun::count());
        $this->assertSame(PostStatus::Scheduled, $unapproved->refresh()->status);
    }

    public function test_the_stop_button_and_a_paused_phone_hold_everything(): void
    {
        $this->duePost();

        $this->spa()->actingAs($this->user)->postJson('/api/publishing/pause')->assertOk();
        $this->assertSame(0, app(Publisher::class)->dispatchDue());

        $this->spa()->actingAs($this->user)->postJson('/api/publishing/resume')->assertOk();
        $this->assertSame(1, app(Publisher::class)->dispatchDue());

        $this->duePost();
        $this->spa()->actingAs($this->user)->postJson("/api/devices/{$this->phone->id}/pause")->assertOk()->assertJsonPath('paused', true);
        $this->assertSame(0, app(Publisher::class)->dispatchDue());
        $this->spa()->actingAs($this->user)->postJson("/api/devices/{$this->phone->id}/resume")->assertOk()->assertJsonPath('paused', false);
        $this->assertSame(1, app(Publisher::class)->dispatchDue());
    }

    public function test_one_phone_runs_one_job_at_a_time(): void
    {
        $http = Device::factory()->for($this->user)->create(['driver' => 'http', 'ref' => 'phone-1']);
        $second = Account::factory()->for($this->user)->automated()->create([
            'platform' => 'tiktok', 'handle' => 'maisoncire.tt', 'device_id' => $http->id,
        ]);
        $this->account->update(['device_id' => $http->id]);
        $first = $this->duePost();
        $other = Post::factory()->for($this->user)->for($second)->scheduled(now()->subMinute())->create(['approved_at' => now()]);

        // The first run books the phone and waits for the agent; the second can't start.
        $this->assertNotNull(app(Publisher::class)->open($first));
        $this->assertNull(app(Publisher::class)->open($other));
        $this->assertSame(PostStatus::Scheduled, $other->refresh()->status);
        $this->assertSame(1, PublishingRun::count());

        // …and the dispatch loop leaves the waiting post for a later minute.
        $this->assertSame(0, app(Publisher::class)->dispatchDue());
    }

    public function test_a_broken_phone_fails_waits_tries_again_then_hands_it_to_a_person(): void
    {
        $this->phone->update(['profile' => 'broken']);
        $post = $this->duePost();
        $publisher = app(Publisher::class);

        $publisher->dispatchDue();
        $post->refresh();
        $this->assertSame(PostStatus::Scheduled, $post->status);
        $this->assertNotNull($post->error);
        $this->assertTrue($post->scheduled_at->greaterThan(now()->addMinutes(4))); // R3: waits first
        $this->assertSame('failed', $post->runs()->sole()->status);

        $this->travel(6)->minutes();
        $publisher->dispatchDue();
        $this->assertSame(2, $post->runs()->count());

        $this->travel(16)->minutes();
        $publisher->dispatchDue();
        $post->refresh();
        $this->assertSame(3, $post->runs()->count());
        $this->assertSame(PostStatus::Failed, $post->status); // every attempt failed: a person takes over
    }

    public function test_an_unproven_publish_is_honestly_uncertain(): void
    {
        SimulatorPhone::rig('uncertain'); // told to post; the screen proves nothing
        $post = $this->duePost();

        app(Publisher::class)->dispatchDue();

        $post->refresh();
        $this->assertSame(PostStatus::Submitted, $post->status);
        $run = $post->runs()->sole();
        $this->assertSame('uncertain', $run->status);
        $this->assertNotNull($run->error);
    }

    public function test_the_operator_tries_a_failed_post_again(): void
    {
        $post = $this->duePost(['status' => PostStatus::Failed, 'error' => 'Every attempt failed.']);

        $this->spa()->actingAs($this->user)->postJson("/api/posts/{$post->id}/retry")
            ->assertCreated()->assertJsonPath('outcome', 'confirmed');

        $this->assertSame(PostStatus::Published, $post->refresh()->status);

        // A published post cannot be tried again.
        $this->spa()->actingAs($this->user)->postJson("/api/posts/{$post->id}/retry")->assertUnprocessable();
    }

    public function test_the_operator_confirms_live_by_hand(): void
    {
        $post = $this->duePost(['status' => PostStatus::Submitted, 'error' => 'No proof.']);

        $this->spa()->actingAs($this->user)->postJson("/api/posts/{$post->id}/confirm-live", [
            'post_url' => 'https://instagram.com/p/abc123',
        ])->assertOk()->assertJsonPath('status', 'published');

        $post->refresh();
        $this->assertSame(PostStatus::Published, $post->status);
        $this->assertSame('https://instagram.com/p/abc123', $post->post_url);
        $this->assertNull($post->error);
    }

    public function test_a_silent_agent_run_is_swept_and_the_phone_released(): void
    {
        config(['publishing.stale_minutes' => 10]);
        $http = Device::factory()->for($this->user)->create(['driver' => 'http', 'ref' => 'phone-1']);
        $account = Account::factory()->for($this->user)->automated()->create(['device_id' => $http->id]);
        $post = Post::factory()->for($this->user)->for($account)->scheduled(now()->subMinute())->create(['approved_at' => now()]);

        $run = app(Publisher::class)->open($post);
        $this->assertNotNull($run);
        $this->assertSame($run->id, $http->refresh()->booked_run_id);

        // Quiet for too long, before any Publish tap: failed, and the phone is free.
        $run->forceFill(['updated_at' => now()->subMinutes(11)])->save();
        $this->assertSame(1, app(Publisher::class)->sweepStale());
        $this->assertSame('failed', $run->refresh()->status);
        $this->assertNull($http->refresh()->booked_run_id);
        $this->assertSame(PostStatus::Scheduled, $post->refresh()->status);

        // Quiet after tapping Publish: honestly uncertain.
        $second = app(Publisher::class)->open($post->refresh());
        $second->step('tap:post-button', true, 800);
        $second->forceFill(['updated_at' => now()->subMinutes(11)])->save();
        app(Publisher::class)->sweepStale();
        $this->assertSame('uncertain', $second->refresh()->status);
        $this->assertSame(PostStatus::Submitted, $post->refresh()->status);
    }

    public function test_the_records_list_detail_and_usage_feed_the_dashboard(): void
    {
        $this->duePost();
        app(Publisher::class)->dispatchDue(); // a clean confirmed run

        SimulatorPhone::rig('uncertain');
        $second = $this->duePost(['title' => 'The quiet launch']);
        app(Publisher::class)->dispatchDue(); // told to post, nothing proves it
        SimulatorPhone::rig(null);

        app(Publisher::class)->retry($second->refresh()); // the operator's try-again confirms

        $runs = $this->spa()->actingAs($this->user)->getJson('/api/publishing/runs')->assertOk()->json();
        $this->assertCount(3, $runs);

        $detail = $this->spa()->actingAs($this->user)->getJson('/api/publishing/runs/'.$runs[0]['id'])
            ->assertOk()->json();
        foreach (['run_id', 'goal', 'account', 'started_at', 'ended_at', 'outcome', 'evidence', 'steps', 'totals'] as $key) {
            $this->assertArrayHasKey($key, $detail);
        }
        foreach (['steps', 'wall_clock_ms', 'spend'] as $key) {
            $this->assertArrayHasKey($key, $detail['totals']);
        }
        $this->assertSame('maisoncire', $detail['account']);

        $usage = $this->spa()->actingAs($this->user)->getJson('/api/publishing/usage')->assertOk()->json();
        $this->assertSame(3, $usage['runs']);
        $this->assertGreaterThan(0, $usage['typical']['steps']);
        $this->assertSame(2, $usage['outcomes']['confirmed']);
        $this->assertSame(1, $usage['outcomes']['uncertain']);

        // Another studio's runs are not here, and the detail is not theirs to see.
        $other = User::factory()->create();
        $this->spa()->actingAs($other)->getJson('/api/publishing/runs')->assertOk()->assertJsonCount(0);
        $this->spa()->actingAs($other)->getJson('/api/publishing/runs/'.$runs[0]['id'])->assertNotFound();
    }

    public function test_the_agent_token_is_shown_and_rotated(): void
    {
        $first = $this->spa()->actingAs($this->user)->getJson('/api/publishing/agent-token')->assertOk()->json('token');
        $this->assertNotEmpty($first);
        $this->assertSame($first, $this->user->refresh()->agent_token);

        // The same one comes back until it's rotated.
        $this->spa()->actingAs($this->user)->getJson('/api/publishing/agent-token')->assertJsonPath('token', $first);

        $second = $this->spa()->actingAs($this->user)->postJson('/api/publishing/agent-token/rotate')->assertOk()->json('token');
        $this->assertNotSame($first, $second);

        $this->withHeaders(['Authorization' => "Bearer {$first}"])->getJson('/api/agent/next-job')->assertUnauthorized();
        $this->withHeaders(['Authorization' => "Bearer {$second}"])->getJson('/api/agent/next-job')->assertNotFound(); // no such device_ref
    }

    public function test_the_phones_latest_screenshot_is_served(): void
    {
        $this->spa()->actingAs($this->user)->getJson("/api/devices/{$this->phone->id}/screenshot")->assertNotFound();

        $this->duePost();
        app(Publisher::class)->dispatchDue();

        $this->spa()->actingAs($this->user)->get("/api/devices/{$this->phone->id}/screenshot")
            ->assertOk()->assertHeader('Content-Type', 'image/png');

        // Not another studio's phone.
        $this->spa()->actingAs(User::factory()->create())->get("/api/devices/{$this->phone->id}/screenshot")->assertForbidden();
    }

    public function test_a_run_ends_once_when_the_agent_and_the_sweep_race(): void
    {
        $http = Device::factory()->for($this->user)->create(['driver' => 'http', 'ref' => 'phone-1']);
        $account = Account::factory()->for($this->user)->automated()->create(['device_id' => $http->id]);
        $post = Post::factory()->for($this->user)->for($account)->scheduled(now()->subMinute())->create(['approved_at' => now()]);
        $run = app(Publisher::class)->open($post);

        // The sweep loaded the run while it was still running; the agent confirms it meanwhile.
        $seenBySweep = PublishingRun::find($run->id);
        app(Publisher::class)->finish($run, 'confirmed', 'https://instagram.com/p/abc', null);
        app(Publisher::class)->finish($seenBySweep, 'failed', null, 'The agent went quiet before finishing.');

        $this->assertSame('confirmed', $run->refresh()->status);
        $this->assertSame(PostStatus::Published, $post->refresh()->status); // not rescheduled, so not posted twice
    }

    public function test_an_http_phones_run_waits_for_the_agent(): void
    {
        $http = Device::factory()->for($this->user)->create(['driver' => 'http', 'ref' => 'phone-1']);
        $account = Account::factory()->for($this->user)->automated()->create(['device_id' => $http->id]);
        $post = Post::factory()->for($this->user)->for($account)->scheduled(now()->subMinute())->create(['approved_at' => now()]);

        $this->assertSame(1, app(Publisher::class)->dispatchDue());
        $run = $post->runs()->sole();
        $this->assertTrue($run->isRunning()); // booked, waiting for the automation service
        $this->assertSame(PostStatus::Publishing, $post->refresh()->status);
        $this->assertSame('busy', $http->refresh()->status);
    }
}

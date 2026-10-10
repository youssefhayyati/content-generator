<?php

namespace Tests\Feature;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\Asset;
use App\Models\Device;
use App\Models\Post;
use App\Models\PublishingRun;
use App\Models\User;
use App\Services\Publishing\Publisher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The contract the automation service (the Python dev) builds against: next job → steps and
 * screenshots → finish. Signed with the studio's agent token, never a session.
 */
class AgentApiTest extends TestCase
{
    use RefreshDatabase;

    private const TOKEN = 'agent-token-under-test';

    private User $user;

    private Device $phone;

    private Account $account;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->user = User::factory()->create(['agent_token' => self::TOKEN]);
        $this->phone = Device::factory()->for($this->user)->create(['driver' => 'http', 'ref' => 'phone-1']);
        $this->account = Account::factory()->for($this->user)->automated()->create([
            'platform' => 'instagram', 'handle' => 'maisoncire', 'device_id' => $this->phone->id,
        ]);
    }

    private function agent(): static
    {
        return $this->withHeaders(['Authorization' => 'Bearer '.self::TOKEN, 'Accept' => 'application/json']);
    }

    /** A booked run waiting on the phone: what the agent's loop starts from. */
    private function book(?Asset $media = null): PublishingRun
    {
        $post = Post::factory()->for($this->user)->for($this->account)->scheduled(now()->subMinute())
            ->create(['approved_at' => now(), 'body' => 'A warm caption for the evening ritual.']);
        if ($media) {
            $post->syncAssets([$media->id]);
        }

        return tap(app(Publisher::class)->open($post), fn ($run) => $this->assertNotNull($run));
    }

    public function test_calls_without_a_token_are_refused(): void
    {
        $this->getJson('/api/agent/next-job?device_ref=phone-1')->assertUnauthorized();
        $this->withHeaders(['Authorization' => 'Bearer wrong'])->getJson('/api/agent/next-job?device_ref=phone-1')->assertUnauthorized();
    }

    public function test_no_booked_run_means_no_job(): void
    {
        $this->agent()->getJson('/api/agent/next-job?device_ref=phone-1')->assertNoContent();
        $this->agent()->getJson('/api/agent/next-job?device_ref=not-mine')->assertNotFound();
    }

    public function test_the_agent_drives_a_run_to_confirmed(): void
    {
        $media = Asset::factory()->for($this->user)->create();
        Storage::disk('local')->put($media->path, 'jpeg-bytes');
        $run = $this->book($media);

        $job = $this->agent()->getJson('/api/agent/next-job?device_ref=phone-1')->assertOk()->json();
        $this->assertSame($run->uuid, $job['run_id']);
        $this->assertSame('instagram', $job['account']['platform']);
        $this->assertSame('com.instagram.android', $job['account']['app']['package']);
        $this->assertContains('post-button', $job['account']['app']['targets']);
        $this->assertSame('A warm caption for the evening ritual.', $job['post']['caption']);
        $this->assertSame($run->post_id, $job['post']['id']);
        $this->assertSame("/api/agent/assets/{$media->id}/file", $job['media'][0]['url']);
        $this->assertSame((int) config('publishing.step_budget'), $job['limits']['step_budget']);
        $this->assertSame((int) config('publishing.hard_timeout_seconds'), $job['limits']['hard_timeout_seconds']);

        // The media comes down with the same token.
        $this->agent()->get($job['media'][0]['url'])->assertOk();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/steps", ['steps' => [
            ['action' => 'app-start', 'ok' => true, 'ms' => 1200],
            ['action' => 'tap:compose-button', 'ok' => true, 'ms' => 400],
        ]])->assertOk()->assertJsonPath('steps', 2);

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/screenshot", [
            'file' => UploadedFile::fake()->image('shot.png'),
        ])->assertCreated()->assertJsonStructure(['asset_id', 'url']);

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", [
            'outcome' => 'confirmed', 'post_url' => 'https://instagram.com/p/abc123',
        ])->assertOk()->assertJsonPath('outcome', 'confirmed');

        $run->refresh();
        $this->assertSame('post_url', $run->evidence['kind']);
        $this->assertSame('https://instagram.com/p/abc123', $run->evidence['ref']);
        $this->assertSame(PostStatus::Published, $run->post->status);
        $this->assertNull($this->phone->refresh()->booked_run_id); // the phone is free
        $this->assertNotNull($this->phone->last_screenshot);
    }

    public function test_confirmed_needs_proof(): void
    {
        $run = $this->book();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", ['outcome' => 'confirmed'])
            ->assertUnprocessable();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/screenshot", [
            'file' => UploadedFile::fake()->image('shot.png'),
        ])->assertCreated();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", ['outcome' => 'confirmed'])
            ->assertOk()->assertJsonPath('outcome', 'confirmed');
        $this->assertSame('screenshot', $run->refresh()->evidence['kind']);
    }

    public function test_a_failed_report_waits_and_tries_again(): void
    {
        $run = $this->book();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", [
            'outcome' => 'failed', 'note' => 'The app crashed on open.',
        ])->assertOk()->assertJsonPath('outcome', 'failed');

        $post = $run->post->refresh();
        $this->assertSame(PostStatus::Scheduled, $post->status); // R3: back in line, not lost
        $this->assertSame('The app crashed on open.', $post->error);
        $this->assertTrue($post->scheduled_at->greaterThan(now()->addMinutes(4)));
    }

    public function test_an_honest_uncertain_asks_a_person_to_look(): void
    {
        $run = $this->book();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", [
            'outcome' => 'uncertain', 'note' => 'Tapped Publish; the screen went blank.',
        ])->assertOk()->assertJsonPath('outcome', 'uncertain');

        $this->assertSame(PostStatus::Submitted, $run->post->refresh()->status);
    }

    public function test_an_ended_run_refuses_more_work(): void
    {
        $run = $this->book();
        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", ['outcome' => 'failed'])->assertOk();

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/steps", ['steps' => [['action' => 'tap', 'ok' => true, 'ms' => 1]]])->assertConflict();
        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/screenshot", ['file' => UploadedFile::fake()->image('shot.png')])->assertConflict();
        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/finish", ['outcome' => 'failed'])->assertConflict();
    }

    public function test_the_step_budget_is_enforced(): void
    {
        config(['publishing.step_budget' => 3]);
        $run = $this->book();
        $step = ['action' => 'tap:compose-button', 'ok' => true, 'ms' => 10];

        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/steps", ['steps' => [$step, $step, $step]])->assertOk();
        $this->agent()->postJson("/api/agent/runs/{$run->uuid}/steps", ['steps' => [$step]])->assertUnprocessable();
    }

    public function test_another_studios_token_sees_nothing(): void
    {
        $run = $this->book();
        $other = User::factory()->create(['agent_token' => 'other-token']);
        $asOther = $this->withHeaders(['Authorization' => 'Bearer other-token', 'Accept' => 'application/json']);

        $asOther->getJson('/api/agent/next-job?device_ref=phone-1')->assertNotFound();
        $asOther->postJson("/api/agent/runs/{$run->uuid}/steps", ['steps' => [['action' => 'tap', 'ok' => true, 'ms' => 1]]])->assertNotFound();
        $asOther->postJson("/api/agent/runs/{$run->uuid}/finish", ['outcome' => 'failed'])->assertNotFound();
        $this->assertTrue($run->refresh()->isRunning()); // untouched
    }
}

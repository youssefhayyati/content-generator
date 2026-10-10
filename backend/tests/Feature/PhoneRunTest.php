<?php

namespace Tests\Feature;

use App\Enums\PostStatus;
use App\Models\Device;
use App\Models\Post;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The voice assistant posts a draft from the team's phone when the person says so, then puts the run on
 * FlowAI's record with the screenshot the phone ended on (POST /api/posts/{post}/phone-run).
 */
class PhoneRunTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Device $phone;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->user = User::factory()->create();
        $this->phone = Device::factory()->for($this->user)->create(['name' => 'Team phone', 'driver' => 'http', 'ref' => 'heracles-phone']);
    }

    /** What the Assistant page hands the assistant: a token to act as the person (drafts only). */
    private function assistant(): static
    {
        $token = $this->actingAs($this->user)->spa()->postJson('/api/assistant/session')->assertOk()->json('token');
        $this->app['auth']->forgetGuards();

        return $this->withHeaders(['Authorization' => "Bearer {$token}", 'Accept' => 'application/json']);
    }

    private function draft(): Post
    {
        return Post::factory()->for($this->user)->create([
            'title' => 'Little things', 'body' => 'Little things that make your day softer.',
            'platforms' => ['instagram'], 'placement' => 'feed', 'status' => PostStatus::Draft,
        ]);
    }

    private function steps(): string
    {
        return json_encode([
            ['action' => 'transfer', 'ok' => true, 'ms' => 5300, 'note' => 'put 1 picture on the phone'],
            ['action' => 'tap', 'ok' => true, 'ms' => 4022, 'note' => 'Tap the + (Create) button'],
            ['action' => 'approval', 'ok' => true, 'ms' => 0, 'note' => 'the phone asked: press Enter'],
            ['action' => 'tap:post-button', 'ok' => true, 'ms' => 10018, 'note' => 'Tap the blue Share button'],
            ['action' => 'done', 'ok' => true, 'ms' => 3000, 'note' => ''],
        ]);
    }

    public function test_a_post_the_assistant_put_up_is_published_at_that_moment_with_its_proof(): void
    {
        $post = $this->draft();
        $ended = Carbon::parse('2026-10-10T19:06:33Z');

        $this->assistant()->post("/api/posts/{$post->id}/phone-run", [
            'outcome' => 'confirmed',
            'note' => 'The feed shows the new post at the top.',
            'steps' => $this->steps(),
            'started_at' => '2026-10-10T18:58:39Z',
            'ended_at' => $ended->toIso8601ZuluString(),
            'device_ref' => 'heracles-phone',
            'screenshot' => UploadedFile::fake()->image('phone.png', 540, 1200),
        ])->assertCreated()
            ->assertJsonPath('run.outcome', 'confirmed')
            ->assertJsonPath('run.device.name', 'Team phone')
            ->assertJsonPath('post.status', 'published')
            ->assertJsonPath('post.run.outcome', 'confirmed');

        $post->refresh();
        $this->assertSame(PostStatus::Published, $post->status);
        $this->assertTrue($post->published_at->equalTo($ended));
        $this->assertTrue($post->scheduled_at->equalTo($ended), 'the calendar shows it when it went up');
        $this->assertNotNull($post->approved_at);

        $run = $post->runs()->sole();
        $this->assertSame('confirmed', $run->status);
        $this->assertSame('screenshot', $run->evidence['kind']);
        $this->assertNotNull($run->screenshot_id);
        $this->assertSame($this->phone->id, $run->device_id);
        $this->assertTrue($run->ended_at->equalTo($ended));
        $this->assertSame(['transfer', 'tap', 'approval', 'tap:post-button', 'done'], collect($run->steps)->pluck('action')->all());
        $this->assertSame(1, $run->steps[0]['n']);
        $this->assertArrayNotHasKey('note', $run->steps[4]);

        // The calendar's week has it, with the screenshot to show
        $this->spa()->actingAs($this->user)->getJson('/api/posts?'.http_build_query([
            'from' => '2026-10-05T00:00:00Z', 'to' => '2026-10-12T00:00:00Z', 'sort' => 'scheduled',
        ]))->assertOk()
            ->assertJsonPath('data.0.id', $post->id)
            ->assertJsonPath('data.0.run.outcome', 'confirmed')
            ->assertJsonPath('data.0.run.screenshot_url', "/api/assets/{$run->screenshot_id}/file")
            ->assertJsonPath('data.0.run.note', 'The feed shows the new post at the top.');
        $this->spa()->actingAs($this->user)->get("/api/assets/{$run->screenshot_id}/file")->assertOk();
    }

    public function test_an_unsure_post_waits_for_a_person_to_check(): void
    {
        $post = $this->draft();

        $this->assistant()->post("/api/posts/{$post->id}/phone-run", [
            'outcome' => 'uncertain',
            'note' => 'It tapped Share, then the phone dropped out.',
            'screenshot' => UploadedFile::fake()->image('phone.png', 540, 1200),
        ])->assertCreated()->assertJsonPath('post.status', 'submitted');

        $post->refresh();
        $this->assertSame(PostStatus::Submitted, $post->status);
        $this->assertSame('It tapped Share, then the phone dropped out.', $post->error);
        $this->assertNotNull($post->scheduled_at);
        $this->assertSame('uncertain', $post->runs()->sole()->status);
    }

    public function test_a_failed_post_stays_as_it_was_and_is_not_rescheduled(): void
    {
        $post = $this->draft();

        $this->assistant()->post("/api/posts/{$post->id}/phone-run", [
            'outcome' => 'failed',
            'note' => 'Instagram showed a login screen.',
        ])->assertCreated()->assertJsonPath('post.status', 'draft');

        $post->refresh();
        $this->assertSame(PostStatus::Draft, $post->status);
        $this->assertNull($post->scheduled_at);
        $this->assertSame('Instagram showed a login screen.', $post->error);
        $run = $post->runs()->sole();
        $this->assertSame('failed', $run->status);
        $this->assertNotNull($run->ended_at);
    }

    public function test_confirmed_needs_proof_and_one_run_at_a_time(): void
    {
        $post = $this->draft();

        $this->assistant()->postJson("/api/posts/{$post->id}/phone-run", ['outcome' => 'confirmed'])
            ->assertStatus(422);
        $this->assertSame(0, $post->runs()->count());

        $post->runs()->create(['user_id' => $this->user->id, 'device_id' => $this->phone->id, 'goal' => 'x', 'started_at' => now()]);
        $this->assistant()->post("/api/posts/{$post->id}/phone-run", [
            'outcome' => 'confirmed', 'screenshot' => UploadedFile::fake()->image('phone.png'),
        ])->assertStatus(409);
    }

    public function test_nobody_records_runs_on_someone_elses_post(): void
    {
        $theirs = Post::factory()->for(User::factory())->create();

        $this->assistant()->post("/api/posts/{$theirs->id}/phone-run", [
            'outcome' => 'failed', 'note' => 'nope',
        ])->assertForbidden();
        $this->assertSame(0, $theirs->runs()->count());
    }
}

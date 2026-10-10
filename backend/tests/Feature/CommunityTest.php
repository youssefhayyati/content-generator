<?php

namespace Tests\Feature;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\Asset;
use App\Models\Comment;
use App\Models\Post;
use App\Models\Repost;
use App\Models\User;
use App\Services\Ai\TextGenerator;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Areas 02 and 11: reposting from X to Instagram with recorded permission and attribution,
 * and the comment inbox with AI triage and human-approved replies.
 */
class CommunityTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Account $ig;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->ig = Account::factory()->for($this->user)->create(['platform' => 'instagram', 'handle' => 'maisoncire']);
        $this->app->instance(TextGenerator::class, new class implements TextGenerator
        {
            public function enabled(): bool
            {
                return true;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                yield 'x';
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                $props = $schema['properties'] ?? [];
                if (isset($props['caption'])) {
                    return ['caption' => 'Forty at a time, poured slow in the Lyon atelier.', 'hashtags' => ['#candles', 'slowmade']];
                }
                if (isset($props['decision'])) {
                    return match (true) {
                        str_contains($content, 'spammy-bot') => ['decision' => 'ignore', 'reason' => 'Spam.', 'draft' => ''],
                        str_contains($content, 'angry') => ['decision' => 'human', 'reason' => 'A complaint to handle with care.', 'draft' => ''],
                        default => ['decision' => 'reply', 'reason' => 'A friendly question.', 'draft' => 'Thank you! They burn for fifty hours.'],
                    };
                }

                return [];
            }
        });
    }

    private function capture(array $overrides = []): array
    {
        return $this->spa()->actingAs($this->user)->postJson('/api/reposts', [
            'account_id' => $this->ig->id,
            'source_url' => 'https://x.com/slowmade/status/123',
            'author' => 'slowmade',
            'source_text' => 'We pour forty candles at a time. No more: the wax needs the room to cure.',
            'asset_ids' => [Asset::factory()->for($this->user)->create()->id], // Instagram needs a photo
            ...$overrides,
        ])->assertCreated()->json();
    }

    public function test_a_repost_needs_recorded_permission_before_anything_else(): void
    {
        $repost = $this->capture();

        $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$repost['id']}/adapt")
            ->assertUnprocessable();

        // The check records the why, and a denied one goes nowhere.
        $denied = $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$repost['id']}/permission", [
            'decision' => 'denied', 'note' => 'Not ours to reuse: it is their campaign line.',
        ])->assertOk()->json();
        $this->assertSame('denied', $denied['permission']);
        $this->assertSame('dropped', $denied['status']);
        $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$repost['id']}/adapt")->assertConflict();

        // An X post goes to Instagram, not back to X.
        $x = Account::factory()->for($this->user)->create(['platform' => 'x']);
        $this->spa()->actingAs($this->user)->postJson('/api/reposts', [
            'account_id' => $x->id, 'source_url' => 'https://x.com/a/status/1', 'author' => 'a', 'source_text' => 'text',
        ])->assertUnprocessable();
        $this->assertSame(1, Repost::count()); // the 422 above leaves nothing behind
    }

    public function test_an_allowed_repost_is_adapted_credited_and_scheduled(): void
    {
        $repost = $this->capture();
        $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$repost['id']}/permission", [
            'decision' => 'allowed', 'note' => 'Our own founder’s account; she asked us to reuse it.',
        ])->assertOk();

        $adapted = $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$repost['id']}/adapt")->assertOk()->json();
        $this->assertSame('adapted', $adapted['status']);
        $this->assertStringContainsString('Forty at a time', $adapted['caption']);
        // Attribution is on the caption that would go out, crediting the original author.
        $this->assertStringContainsString('Credit: @slowmade', $adapted['caption_with_credit']);

        $done = $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$repost['id']}/schedule")->assertCreated()->json();
        $this->assertSame('scheduled', $done['status']);
        $post = Post::findOrFail($done['post_id']);
        $this->assertSame(PostStatus::Scheduled, $post->status);
        $this->assertTrue($post->isApproved()); // 6B: the operator reviewed and scheduled it
        $this->assertStringContainsString('Credit: @slowmade', $post->body);
        $this->assertStringContainsString('#candles', $post->body);
        $this->assertSame($this->ig->id, $post->account_id);
    }

    public function test_mode_b_schedules_the_adapted_repost_on_its_own(): void
    {
        $this->ig->update(['autonomy' => 'rules']);
        $this->ig->rules()->create(['action' => 'repost.schedule', 'allow' => true, 'created_by' => $this->user->id]);

        $repost = $this->capture();
        $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$repost['id']}/permission", ['decision' => 'allowed', 'note' => 'Ours.']);
        $done = $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$repost['id']}/adapt")->assertOk()->json();

        $this->assertSame('scheduled', $done['status']); // no schedule call: the rule did it
        $this->assertNotNull($done['post_id']);
    }

    public function test_reposts_are_private_to_their_studio(): void
    {
        $repost = $this->capture();
        $other = User::factory()->create();
        $this->spa()->actingAs($other)->getJson('/api/reposts')->assertOk()->assertJsonCount(0);
        $this->spa()->actingAs($other)->postJson("/api/reposts/{$repost['id']}/permission", ['decision' => 'allowed', 'note' => 'x'])->assertNotFound();
    }

    public function test_a_comment_is_triaged_drafted_and_sent_only_by_a_human(): void
    {
        $comment = $this->spa()->actingAs($this->user)->postJson('/api/comments', [
            'account_id' => $this->ig->id, 'author' => 'cire_fan', 'body' => 'How long do they burn?', 'post_ref' => 'Evening ritual',
        ])->assertCreated()->json();
        $this->assertSame('new', $comment['status']);

        $triaged = $this->spa()->actingAs($this->user)->postJson("/api/comments/{$comment['id']}/triage")->assertOk()->json();
        $this->assertSame('drafted', $triaged['status']);
        $this->assertSame('A friendly question.', $triaged['triage']['reason']);
        $this->assertNotEmpty($triaged['draft']);

        // Triage runs once.
        $this->spa()->actingAs($this->user)->postJson("/api/comments/{$comment['id']}/triage")->assertConflict();

        // The human approves, with an edit; only then is it sent.
        $sent = $this->spa()->actingAs($this->user)->postJson("/api/comments/{$comment['id']}/send", [
            'reply' => 'Thank you! About fifty hours each.',
        ])->assertOk()->json();
        $this->assertSame('sent', $sent['status']);
        $this->assertSame('Thank you! About fifty hours each.', $sent['reply']);
        $this->assertNotNull($sent['sent_at']);
    }

    public function test_triage_ignores_spam_and_sends_the_hard_ones_to_a_human(): void
    {
        $spam = $this->spa()->actingAs($this->user)->postJson('/api/comments', [
            'account_id' => $this->ig->id, 'author' => 'spammy-bot', 'body' => 'spammy-bot: followers cheap!',
        ])->assertCreated()->json();
        $out = $this->spa()->actingAs($this->user)->postJson("/api/comments/{$spam['id']}/triage")->assertOk()->json();
        $this->assertSame('ignored', $out['status']);

        $hard = $this->spa()->actingAs($this->user)->postJson('/api/comments', [
            'account_id' => $this->ig->id, 'author' => 'unhappy', 'body' => 'I am angry: my order never came.',
        ])->assertCreated()->json();
        $out = $this->spa()->actingAs($this->user)->postJson("/api/comments/{$hard['id']}/triage")->assertOk()->json();
        $this->assertSame('human', $out['status']);

        // …and the human is told, in the Inbox.
        $inbox = $this->spa()->actingAs($this->user)->getJson('/api/inbox')->assertOk()->json();
        $item = collect($inbox)->firstWhere('key', "comment-{$out['id']}");
        $this->assertSame('comment_human', $item['kind']);
    }

    public function test_mode_b_sends_replies_within_the_rules_limit(): void
    {
        $this->ig->update(['autonomy' => 'rules']);
        $this->ig->rules()->create(['action' => 'comment.send_reply', 'allow' => true, 'conditions' => ['max_per_day' => 1], 'created_by' => $this->user->id]);

        $first = $this->spa()->actingAs($this->user)->postJson('/api/comments', [
            'account_id' => $this->ig->id, 'author' => 'fan_one', 'body' => 'Do you ship abroad?',
        ])->assertCreated()->json();
        $out = $this->spa()->actingAs($this->user)->postJson("/api/comments/{$first['id']}/triage")->assertOk()->json();
        $this->assertSame('sent', $out['status']); // the rule sent it, no human touched it

        // Past the day's allowance the next one waits for a person.
        $second = $this->spa()->actingAs($this->user)->postJson('/api/comments', [
            'account_id' => $this->ig->id, 'author' => 'fan_two', 'body' => 'And to Canada?',
        ])->assertCreated()->json();
        $out = $this->spa()->actingAs($this->user)->postJson("/api/comments/{$second['id']}/triage")->assertOk()->json();
        $this->assertSame('drafted', $out['status']);
        $this->assertSame(1, $this->ig->repliesSentToday());
    }

    public function test_comments_are_private_to_their_studio(): void
    {
        $comment = Comment::create(['user_id' => $this->user->id, 'account_id' => $this->ig->id, 'author' => 'x', 'body' => 'hi']);
        $other = User::factory()->create();
        $this->spa()->actingAs($other)->getJson('/api/comments')->assertJsonCount(0);
        $this->spa()->actingAs($other)->postJson("/api/comments/{$comment->id}/triage")->assertNotFound();
    }
}

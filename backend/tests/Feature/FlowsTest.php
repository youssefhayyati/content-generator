<?php

namespace Tests\Feature;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\ActionLog;
use App\Models\Device;
use App\Models\Flow;
use App\Models\FlowRun;
use App\Models\Post;
use App\Models\User;
use App\Services\Ai\TextGenerator;
use App\Services\Flows\Catalog;
use App\Services\Flows\Flows;
use App\Services\Flows\SafeUrl;
use App\Services\Publishing\Publisher;
use App\Services\Studio\StormGuard;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Flows: automations drawn on a canvas, from templates, or described in words — and the rule
 * that holds them to the studio's promise: a flow schedules only what a person approved.
 */
class FlowsTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Account $x;

    /** What the fake model last saw, for asserting on prompts. */
    public static array $prompts = [];

    protected function setUp(): void
    {
        parent::setUp();
        self::$prompts = [];
        $this->user = User::factory()->create(['timezone' => 'Europe/Paris']);
        $this->x = Account::factory()->for($this->user)->create(['platform' => 'x', 'handle' => 'maisoncire', 'profile' => ['topics' => 'candles, slow craft']]);
        $this->user->queueSlots()->createMany(collect(range(1, 7))->map(fn ($d) => ['weekday' => $d, 'time' => '18:00'])->all());
        $this->app->instance(TextGenerator::class, new class implements TextGenerator
        {
            public function enabled(): bool
            {
                return true;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                FlowsTest::$prompts[] = $prompt;
                yield 'Forty candles at a time, ';
                yield 'poured slow in the Lyon atelier.';
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                FlowsTest::$prompts[] = $content;
                $props = $schema['properties'] ?? [];

                return match (true) {
                    isset($props['score']) => str_contains($content, 'football') ? ['score' => 12, 'reason' => 'Off topic.'] : ['score' => 86, 'reason' => 'Right in the account’s lane.'],
                    isset($props['reply']) => ['reply' => 'Thank you! They burn for fifty hours.'],
                    isset($props['steps']) => [
                        'name' => 'Morning candle post',
                        'description' => 'Every weekday morning, a post about candles.',
                        'steps' => [
                            ['id' => 'when', 'type' => 'trigger.schedule', 'after' => '', 'port' => '', 'settings' => [['key' => 'every', 'value' => 'weekdays'], ['key' => 'at', 'value' => '07:45']]],
                            ['id' => 'write', 'type' => 'ai.write', 'after' => 'when', 'port' => 'next', 'settings' => [['key' => 'account', 'value' => '@maisoncire'], ['key' => 'brief', 'value' => 'A morning candle ritual.']]],
                            // No approval: the compiler must put one in.
                            ['id' => 'post', 'type' => 'action.post', 'after' => 'write', 'port' => 'next', 'settings' => [['key' => 'when', 'value' => 'next_slot']]],
                            ['id' => 'bogus', 'type' => 'action.teleport', 'after' => 'post', 'port' => 'next', 'settings' => []],
                        ],
                    ],
                    default => [],
                };
            }
        });
    }

    private function flow(array $nodes, array $edges, array $attrs = []): Flow
    {
        return $this->user->flows()->create([
            'name' => 'Test flow',
            'trigger' => collect($nodes)->first(fn ($n) => str_starts_with($n[1], 'trigger.'))[1],
            'graph' => [
                'nodes' => array_map(fn ($n) => ['id' => $n[0], 'type' => $n[1], 'x' => 0, 'y' => 0, 'config' => Catalog::configure($n[1], $n[2] ?? [])], $nodes),
                'edges' => array_map(fn ($e) => ['from' => $e[0], 'to' => $e[1], 'port' => $e[2] ?? 'next'], $edges),
            ],
            ...$attrs,
        ]);
    }

    private function writeApprovePost(): Flow
    {
        return $this->flow([
            ['t', 'trigger.manual'],
            ['w', 'ai.write', ['account_id' => $this->x->id, 'brief' => 'Our slow craft.']],
            ['a', 'human.approve', ['ask' => 'Post this?']],
            ['p', 'action.post', ['account_id' => $this->x->id]],
        ], [['t', 'w'], ['w', 'a'], ['a', 'p', 'approved']]);
    }

    public function test_the_catalog_and_every_template_build_valid_flows_for_the_user(): void
    {
        $out = $this->spa()->actingAs($this->user)->getJson('/api/flows/catalog')->assertOk()->json();

        $this->assertArrayHasKey('trigger.storm', $out['nodes']);
        $this->assertCount(7, $out['templates']);
        foreach ($out['templates'] as $t) {
            $flow = $this->spa()->actingAs($this->user)->postJson('/api/flows', ['template' => $t['key']])->assertCreated()->json();
            $this->assertSame($t['name'], $flow['name']);
            $this->assertFalse($flow['enabled'], 'Templates start switched off.');
            // Any template that schedules a post asks first.
            $types = array_column($flow['graph']['nodes'], 'type');
            if (in_array('action.post', $types, true)) {
                $this->assertContains('human.approve', $types);
            }
        }
        // The signal template already watches news about the account's topics.
        $signal = collect($out['templates'])->firstWhere('key', 'signal');
        $this->assertStringContainsString('news.google.com', $signal['graph']['nodes'][0]['config']['url']);
    }

    public function test_a_graph_needs_one_trigger_and_no_loops(): void
    {
        $flow = $this->spa()->actingAs($this->user)->postJson('/api/flows', [])->assertCreated()->json();
        $node = fn ($id, $type) => ['id' => $id, 'type' => $type, 'x' => 0, 'y' => 0, 'config' => []];

        $this->spa()->actingAs($this->user)->patchJson("/api/flows/{$flow['id']}", ['graph' => ['nodes' => [$node('a', 'ai.write')], 'edges' => []]])
            ->assertUnprocessable()->assertJsonValidationErrors('graph');
        $this->spa()->actingAs($this->user)->patchJson("/api/flows/{$flow['id']}", ['graph' => ['nodes' => [$node('a', 'trigger.manual'), $node('b', 'trigger.comment')], 'edges' => []]])
            ->assertUnprocessable();
        $this->spa()->actingAs($this->user)->patchJson("/api/flows/{$flow['id']}", ['graph' => [
            'nodes' => [$node('t', 'trigger.manual'), $node('a', 'logic.wait'), $node('b', 'action.notify')],
            'edges' => [['from' => 't', 'to' => 'a'], ['from' => 'a', 'to' => 'b'], ['from' => 'b', 'to' => 'a']],
        ]])->assertUnprocessable()->assertJsonPath('errors.graph.0', 'A flow can’t loop back on itself. Remove the line that closes the loop.');

        // Unknown types and edges to nowhere are dropped; another studio's account is cleared.
        $theirs = Account::factory()->create();
        $saved = $this->spa()->actingAs($this->user)->patchJson("/api/flows/{$flow['id']}", ['graph' => [
            'nodes' => [$node('t', 'trigger.manual'), $node('x', 'action.teleport'), ['id' => 'w', 'type' => 'ai.write', 'x' => 0, 'y' => 0, 'config' => ['account_id' => $theirs->id]]],
            'edges' => [['from' => 't', 'to' => 'w'], ['from' => 'w', 'to' => 'ghost'], ['from' => 'w', 'to' => 't']],
        ]])->assertOk()->json();
        $this->assertCount(2, $saved['graph']['nodes']);
        $this->assertSame([['from' => 't', 'to' => 'w', 'port' => 'next']], $saved['graph']['edges']);
        $this->assertNull($saved['graph']['nodes'][1]['config']['account_id']);

        // Not another studio's flow.
        $this->spa()->actingAs(User::factory()->create())->getJson("/api/flows/{$flow['id']}")->assertNotFound();
    }

    public function test_a_run_waits_for_approval_then_schedules_the_edited_draft(): void
    {
        $flow = $this->writeApprovePost();

        $run = $this->spa()->actingAs($this->user)->postJson("/api/flows/{$flow->id}/run")->assertCreated()->json();
        $run = $this->spa()->actingAs($this->user)->getJson("/api/flow-runs/{$run['id']}")->assertOk()->json();

        $this->assertSame('approval', $run['status']);
        $this->assertSame('a', $run['waiting_on']);
        $this->assertSame('Forty candles at a time, poured slow in the Lyon atelier.', $run['approval']['draft']);
        $this->assertSame(['t', 'w', 'a'], array_column($run['trail'], 'node'));
        $this->assertSame(0, Post::count(), 'Nothing is made before a person says yes.');

        // It waits in the Inbox, draft and all.
        $item = collect($this->spa()->actingAs($this->user)->getJson('/api/inbox')->json())->firstWhere('kind', 'flow_approval');
        $this->assertSame($run['id'], $item['run_id']);
        $this->assertSame('Test flow: Post this?', $item['title']);

        $done = $this->spa()->actingAs($this->user)->postJson("/api/flow-runs/{$run['id']}/decide", ['approve' => true, 'draft' => 'Forty candles. Poured slow.'])
            ->assertOk()->json();
        $this->assertSame('done', $done['status']);
        $this->assertSame('approved', $done['trail'][3]['port']);

        $post = Post::sole();
        $this->assertSame('Forty candles. Poured slow.', $post->body);
        $this->assertSame(PostStatus::Scheduled, $post->status);
        $this->assertSame($this->x->id, $post->account_id);
        $this->assertSame($this->user->id, $post->approved_by);
        $this->assertNotNull($post->approved_at);
        $this->assertSame('18:00', $post->scheduled_at->setTimezone('Europe/Paris')->format('H:i'), 'The next free queue slot.');
        $this->assertTrue(ActionLog::where('actor', 'flow:Test flow')->where('action', 'post.scheduled')->exists());

        // Decided once only.
        $this->spa()->actingAs($this->user)->postJson("/api/flow-runs/{$run['id']}/decide", ['approve' => true])->assertConflict();
    }

    public function test_without_an_approval_in_the_run_a_flow_only_drafts(): void
    {
        $flow = $this->flow([
            ['t', 'trigger.manual'],
            ['w', 'ai.write', ['account_id' => $this->x->id, 'brief' => 'Our slow craft.']],
            ['p', 'action.post', ['account_id' => $this->x->id, 'when' => 'next_slot']],
        ], [['t', 'w'], ['w', 'p']]);

        $run = $this->spa()->actingAs($this->user)->postJson("/api/flows/{$flow->id}/run")->assertCreated()->json();

        $this->assertSame('done', FlowRun::find($run['id'])->status);
        $post = Post::sole();
        $this->assertSame(PostStatus::Draft, $post->status);
        $this->assertNull($post->approved_at);
        $this->assertStringContainsString('nobody approved it', FlowRun::find($run['id'])->trail[2]['summary']);
    }

    public function test_a_rejection_goes_down_the_rejected_branch(): void
    {
        $flow = $this->flow([
            ['t', 'trigger.manual'],
            ['w', 'ai.write', ['account_id' => $this->x->id, 'brief' => 'Our slow craft.']],
            ['a', 'human.approve'],
            ['p', 'action.post', ['account_id' => $this->x->id]],
            ['n', 'action.notify', ['message' => 'You passed on: {{draft}}']],
        ], [['t', 'w'], ['w', 'a'], ['a', 'p', 'approved'], ['a', 'n', 'rejected']]);

        $run = $this->spa()->actingAs($this->user)->postJson("/api/flows/{$flow->id}/run")->json();
        $this->spa()->actingAs($this->user)->postJson("/api/flow-runs/{$run['id']}/decide", ['approve' => false])->assertOk()->assertJsonPath('status', 'done');

        $this->assertSame(0, Post::count());
        $note = $this->user->inboxNotes()->sole();
        $this->assertSame('You passed on: Forty candles at a time, poured slow in the Lyon atelier.', $note->title);
        $this->spa()->actingAs($this->user)->postJson("/api/inbox/notes/{$note->id}/dismiss")->assertOk();
        $this->assertNotNull($note->fresh()->dismissed_at);
    }

    public function test_scores_branch_and_waits_resume_on_the_clock(): void
    {
        $flow = $this->flow([
            ['t', 'trigger.manual'],
            ['s', 'ai.score', ['account_id' => $this->x->id, 'input' => 'Beeswax prices fall']],
            ['i', 'logic.if', ['value' => '{{score}}', 'op' => 'gte', 'compare' => '70']],
            ['z', 'logic.wait', ['amount' => 2, 'unit' => 'hours']],
            ['y', 'action.notify', ['message' => 'Scored {{score}}: {{reason}}']],
            ['n', 'action.notify', ['message' => 'Too low']],
        ], [['t', 's'], ['s', 'i'], ['i', 'z', 'yes'], ['z', 'y'], ['i', 'n', 'no']]);

        $run = FlowRun::find($this->spa()->actingAs($this->user)->postJson("/api/flows/{$flow->id}/run")->json('id'));
        $this->assertSame('waiting', $run->status);
        $this->assertSame('yes', $run->trail[2]['port']);
        $this->assertSame(86, $run->context['score']);
        $this->assertSame(0, $this->user->inboxNotes()->count());

        // Not yet.
        app(Flows::class)->tick();
        $this->assertSame('waiting', $run->fresh()->status);

        $this->travel(121)->minutes();
        $this->assertSame(1, app(Flows::class)->tick()['resumed']);
        $this->assertSame('done', $run->fresh()->status);
        $this->assertSame('Scored 86: Right in the account’s lane.', $this->user->inboxNotes()->sole()->title);
    }

    public function test_a_scheduled_flow_starts_on_its_own_when_switched_on(): void
    {
        $this->travelTo(now()->setTimezone('Europe/Paris')->next('Wednesday')->setTime(8, 0)->utc());
        $flow = $this->flow([['t', 'trigger.schedule', ['every' => 'weekdays', 'at' => '09:15']], ['n', 'action.notify', ['message' => 'Morning!']]], [['t', 'n']]);

        $this->spa()->actingAs($this->user)->patchJson("/api/flows/{$flow->id}", ['enabled' => true])->assertOk()
            ->assertJsonPath('trigger_label', 'every weekday at 09:15');
        $flow->refresh();
        $this->assertSame('09:15', $flow->next_run_at->setTimezone('Europe/Paris')->format('H:i'));

        $this->assertSame(0, app(Flows::class)->tick()['scheduled']);
        $this->travel(80)->minutes();
        $this->assertSame(1, app(Flows::class)->tick()['scheduled']);
        $this->assertSame('done', $flow->runs()->sole()->status);
        $this->assertSame('Thursday 09:15', $flow->fresh()->next_run_at->setTimezone('Europe/Paris')->format('l H:i'));

        // Off means off.
        $this->spa()->actingAs($this->user)->patchJson("/api/flows/{$flow->id}", ['enabled' => false])->assertOk();
        $this->assertNull($flow->fresh()->next_run_at);
    }

    public function test_events_start_the_flows_listening_for_them(): void
    {
        $ig = Account::factory()->for($this->user)->create(['platform' => 'instagram', 'handle' => 'cire.studio']);
        $live = $this->flow([['t', 'trigger.post_published', ['account_id' => $this->x->id]], ['n', 'action.notify', ['message' => 'Live: {{post.title}} on @{{account.handle}}']]], [['t', 'n']], ['enabled' => true]);
        $this->flow([['t', 'trigger.post_published'], ['n', 'action.notify']], [['t', 'n']], ['enabled' => false]);

        // Marked published by hand, on another account: not this flow's business.
        $other = Post::factory()->for($this->user)->for($ig)->create(['title' => 'On Instagram']);
        $this->spa()->actingAs($this->user)->putJson("/api/posts/{$other->id}", ['body' => $other->body, 'format' => 'text', 'platforms' => ['instagram'], 'status' => 'published'])->assertOk();
        $this->assertSame(0, $live->runs()->count());

        $mine = Post::factory()->for($this->user)->for($this->x)->create(['title' => 'Forty at a time']);
        $this->spa()->actingAs($this->user)->putJson("/api/posts/{$mine->id}", ['title' => 'Forty at a time', 'body' => $mine->body, 'format' => 'text', 'platforms' => ['x'], 'status' => 'published'])->assertOk();
        $this->assertSame('done', $live->runs()->sole()->status);
        $this->assertSame('Live: Forty at a time on @maisoncire', $this->user->inboxNotes()->sole()->title);
    }

    public function test_a_phone_that_proves_a_post_live_fires_the_flow_and_a_failure_is_rescued(): void
    {
        $phone = Device::factory()->for($this->user)->create();
        $this->x->update(['device_id' => $phone->id, 'automation' => true]);
        $rescue = $this->spa()->actingAs($this->user)->postJson('/api/flows', ['template' => 'rescue'])->json();
        $this->spa()->actingAs($this->user)->patchJson("/api/flows/{$rescue['id']}", ['enabled' => true])->assertOk();

        $post = Post::factory()->for($this->user)->for($this->x)->scheduled(now()->subMinute())->create(['approved_at' => now()->subHour(), 'platforms' => ['x']]);
        config(['publishing.max_attempts' => 0]); // straight to failed-for-good
        app(Publisher::class)->dispatchDue();
        $this->assertSame(PostStatus::Failed, $post->fresh()->status);

        $run = Flow::find($rescue['id'])->runs()->sole();
        $this->assertSame('waiting', $run->status, 'Noted, webhook skipped, now giving the phone an hour.');
        $this->assertSame('No webhook URL yet: skipped.', $run->trail[2]['summary']);
        $this->assertStringStartsWith('Couldn’t publish', $this->user->inboxNotes()->sole()->title);

        $this->travel(61)->minutes();
        app(Flows::class)->tick();
        $this->assertSame('done', $run->fresh()->status);
        $this->assertSame(PostStatus::Scheduled, $post->fresh()->status);
        $this->assertNotNull($post->fresh()->approved_at, 'The approved content keeps its approval.');
    }

    public function test_kind_words_drafts_a_reply_and_mode_b_sends_it(): void
    {
        $flow = $this->spa()->actingAs($this->user)->postJson('/api/flows', ['template' => 'kind-words'])->json();
        $this->spa()->actingAs($this->user)->patchJson("/api/flows/{$flow['id']}", ['enabled' => true])->assertOk();

        $happy = $this->spa()->actingAs($this->user)->postJson('/api/comments', ['account_id' => $this->x->id, 'author' => 'lea', 'body' => 'I love these, they are gorgeous! How long do they burn?'])->assertCreated()->json();
        $this->assertGreaterThan(25, $happy['sentiment']);
        $comment = $this->user->comments()->find($happy['id']);
        $this->assertSame('drafted', $comment->status, 'Mode A: the reply waits for a person.');
        $this->assertSame('Thank you! They burn for fifty hours.', $comment->draft);

        $angry = $this->spa()->actingAs($this->user)->postJson('/api/comments', ['account_id' => $this->x->id, 'author' => 'max', 'body' => 'Worst candles ever. Total scam, I want a refund.'])->json();
        $this->assertLessThan(-25, $angry['sentiment']);
        $this->assertSame('new', $this->user->comments()->find($angry['id'])->status, 'Anger goes nowhere near the AI.');

        // Mode B with a rule: it goes out on its own.
        $this->x->update(['autonomy' => 'rules']);
        $this->x->rules()->create(['action' => 'comment.send_reply', 'allow' => true, 'created_by' => $this->user->id]);
        $again = $this->spa()->actingAs($this->user)->postJson('/api/comments', ['account_id' => $this->x->id, 'author' => 'sam', 'body' => 'Beautiful, thank you!'])->json();
        $this->assertSame('sent', $this->user->comments()->find($again['id'])->status);
    }

    public function test_storm_guard_freezes_an_account_holds_its_posts_and_starts_the_response(): void
    {
        $phone = Device::factory()->for($this->user)->create();
        $this->x->update(['device_id' => $phone->id, 'automation' => true]);
        $response = $this->spa()->actingAs($this->user)->postJson('/api/flows', ['template' => 'storm-response'])->json();
        $this->spa()->actingAs($this->user)->patchJson("/api/flows/{$response['id']}", ['enabled' => true])->assertOk();
        $held = Post::factory()->for($this->user)->for($this->x)->scheduled(now()->addMinutes(30))->create(['approved_at' => now()->subDay(), 'platforms' => ['x']]);

        $say = fn (string $who, string $body) => $this->spa()->actingAs($this->user)->postJson('/api/comments', ['account_id' => $this->x->id, 'author' => $who, 'body' => $body])->assertCreated();
        $say('a', 'Love this!');
        $say('b', 'This is a scam. Shame on you.');
        $say('c', 'Disgusting. Unfollowed.');
        $say('d', 'Worst brand, never buying again');
        $this->assertNull($this->x->fresh()->storm_at, 'Not enough comments yet.');
        $say('e', 'BOYCOTT!!! Liars.');

        $this->x->refresh();
        $this->assertNotNull($this->x->storm_at);
        $this->assertSame('4 of the last 5 comments in 60 minutes are negative (80%).', $this->x->storm_reason);
        $this->assertTrue(ActionLog::where('action', 'storm.tripped')->where('actor', 'agent:storm-guard')->exists());

        $storm = collect($this->spa()->actingAs($this->user)->getJson('/api/inbox')->json())->first();
        $this->assertSame('storm', $storm['kind'], 'A frozen account is the first thing in the Inbox.');
        $this->assertStringContainsString('1 scheduled post held', $storm['detail']);

        // The response flow drafted a holding statement and waits for a yes.
        $run = Flow::find($response['id'])->runs()->sole();
        $this->assertSame('approval', $run->status);
        $this->assertStringContainsString('Storm Guard froze @maisoncire', $this->user->inboxNotes()->sole()->title);

        // Held: approved before the storm, its time comes, nothing starts.
        $this->travel(31)->minutes();
        $this->assertSame(0, app(Publisher::class)->dispatchDue());
        $this->assertSame(PostStatus::Scheduled, $held->fresh()->status);

        // The holding statement, approved during the storm, may go.
        $this->spa()->actingAs($this->user)->postJson("/api/flow-runs/{$run->id}/decide", ['approve' => true])->assertOk();
        $statement = Post::where('body', 'like', 'Forty candles%')->sole();
        $this->assertSame(PostStatus::Scheduled, $statement->status);
        $this->travel(16)->minutes();
        $this->assertSame(1, app(Publisher::class)->dispatchDue());
        $this->assertSame(PostStatus::Published, $statement->fresh()->status);
        $this->assertSame(PostStatus::Scheduled, $held->fresh()->status);

        // All clear: the held post goes out.
        $pressure = $this->spa()->actingAs($this->user)->getJson('/api/storm-guard')->assertOk()->json('0');
        $this->assertTrue($pressure['tripped']);
        $this->spa()->actingAs($this->user)->postJson("/api/accounts/{$this->x->id}/storm-guard/clear")->assertOk()->assertJsonPath('tripped', false);
        $this->assertSame(1, app(Publisher::class)->dispatchDue());
        $this->assertSame(PostStatus::Published, $held->fresh()->status);
    }

    public function test_storm_guard_settings_and_reads(): void
    {
        $this->spa()->actingAs($this->user)->putJson("/api/accounts/{$this->x->id}/storm-guard", ['enabled' => false, 'threshold' => 50])->assertOk()
            ->assertJsonPath('enabled', false)->assertJsonPath('threshold', 50)->assertJsonPath('window_minutes', 60);
        $this->spa()->actingAs($this->user)->putJson("/api/accounts/{$this->x->id}/storm-guard", ['threshold' => 5])->assertUnprocessable();
        $this->spa()->actingAs(User::factory()->create())->putJson("/api/accounts/{$this->x->id}/storm-guard", ['enabled' => true])->assertForbidden();

        foreach (range(1, 6) as $i) {
            $this->spa()->actingAs($this->user)->postJson('/api/comments', ['account_id' => $this->x->id, 'author' => "u{$i}", 'body' => 'Terrible. Scam.']);
        }
        $this->assertNull($this->x->fresh()->storm_at, 'Switched off, it watches but never trips.');
        $this->assertSame(100, $this->spa()->actingAs($this->user)->getJson('/api/storm-guard')->json('0.share'));

        $guard = app(StormGuard::class);
        $this->assertGreaterThan(0, $guard->read('Not bad at all, love it ❤️'));
        $this->assertLessThan(-25, $guard->read('not great. disappointed.'));
        $this->assertLessThan(-25, $guard->read('Quelle arnaque, plus jamais.'));
        $this->assertSame(0, $guard->read('What time do you open on Sunday?'));
    }

    public function test_a_feed_trigger_reads_new_items_once(): void
    {
        $rss = fn (array $titles) => '<?xml version="1.0"?><rss><channel>'.implode('', array_map(fn ($t) => "<item><title>{$t}</title><link>https://news.test/{$t}</link><guid>{$t}</guid><description><![CDATA[<p>About {$t}</p>]]></description></item>", $titles)).'</channel></rss>';
        Http::fakeSequence('feeds.test/*')
            ->push($rss(['beeswax', 'soy']))
            ->push($rss(['football', 'beeswax', 'soy']));

        $flow = $this->flow([
            ['t', 'trigger.rss', ['url' => 'https://feeds.test/candles.xml']],
            ['s', 'ai.score', ['account_id' => $this->x->id]],
            ['i', 'logic.if', ['value' => '{{score}}', 'op' => 'gte', 'compare' => '70']],
            ['n', 'action.notify', ['message' => '{{item.title}}: {{item.summary}}']],
        ], [['t', 's'], ['s', 'i'], ['i', 'n', 'yes']], ['enabled' => true]);

        $this->assertSame(1, app(Flows::class)->tick()['feeds'], 'The first read takes only the newest item.');
        $this->assertSame('beeswax: About beeswax', $this->user->inboxNotes()->sole()->title);

        $this->assertSame(0, app(Flows::class)->tick()['feeds'], 'Not again within 15 minutes.');
        $this->travel(16)->minutes();
        $this->assertSame(1, app(Flows::class)->tick()['feeds']);
        $last = $flow->runs()->latest('id')->first();
        $this->assertSame('no', $last->trail[2]['port'], 'Football scored 12: ignored.');
        $this->assertSame(1, $this->user->inboxNotes()->count());

        // Switching on a feed flow needs a URL.
        $empty = $this->flow([['t', 'trigger.rss', ['url' => '']]], []);
        $this->spa()->actingAs($this->user)->patchJson("/api/flows/{$empty->id}", ['enabled' => true])->assertUnprocessable()->assertJsonValidationErrors('enabled');
    }

    public function test_webhooks_post_out_but_never_into_the_studio(): void
    {
        Http::fake(['hooks.test/*' => Http::response(['ok' => true])]);
        $this->assertNotNull(SafeUrl::problem('http://localhost:8000/api'));
        $this->assertNotNull(SafeUrl::problem('http://10.0.0.4/hook'));
        $this->assertNotNull(SafeUrl::problem('http://ollama:11434'));
        $this->assertNotNull(SafeUrl::problem('ftp://example.com'));

        $flow = $this->flow([
            ['t', 'trigger.manual'],
            ['h', 'action.webhook', ['url' => 'https://hooks.test/T0/B0', 'message' => 'Hello{{nothing}}, team']],
        ], [['t', 'h']]);
        $this->spa()->actingAs($this->user)->postJson("/api/flows/{$flow->id}/run")->assertCreated();
        Http::assertSent(fn ($r) => $r->url() === 'https://hooks.test/T0/B0' && $r['text'] === 'Hello, team' && $r['content'] === 'Hello, team' && $r['flow'] === 'Test flow');

        $bad = $this->flow([['t', 'trigger.manual'], ['h', 'action.webhook', ['url' => 'http://127.0.0.1/x']]], [['t', 'h']]);
        $run = FlowRun::find($this->spa()->actingAs($this->user)->postJson("/api/flows/{$bad->id}/run")->json('id'));
        $this->assertSame('failed', $run->status);
        $this->assertStringContainsString('inside the studio', $run->error);
    }

    public function test_say_it_compiles_words_into_a_flow_with_an_approval_in_front_of_the_post(): void
    {
        $out = $this->spa()->actingAs($this->user)->postJson('/api/flows/compose', ['prompt' => 'Every weekday morning write a candle post for maisoncire and schedule it'])
            ->assertOk()->json();

        $this->assertSame('Morning candle post', $out['name']);
        $types = array_column($out['graph']['nodes'], 'type');
        $this->assertSame(['trigger.schedule', 'ai.write', 'action.post', 'human.approve'], $types, 'The made-up node is gone, an approval is added.');
        $byId = collect($out['graph']['nodes'])->keyBy('id');
        $this->assertSame($this->x->id, $byId['write']['config']['account_id'], 'The handle became the account.');
        $this->assertSame('07:45', $byId['when']['config']['at']);
        $this->assertContains(['from' => 'ask_post', 'to' => 'post', 'port' => 'approved'], $out['graph']['edges']);
        $this->assertContains(['from' => 'write', 'to' => 'ask_post', 'port' => 'next'], $out['graph']['edges']);
        // Laid out top to bottom.
        $this->assertLessThan($byId['post']['y'], $byId['ask_post']['y']);
        $this->assertLessThan($byId['ask_post']['y'], $byId['write']['y']);

        $this->spa()->actingAs($this->user)->postJson('/api/flows/compose', ['prompt' => 'post'])->assertUnprocessable();
    }

    public function test_second_life_brings_back_old_posts_once_each(): void
    {
        $old = Post::factory()->for($this->user)->for($this->x)->published()->create(['published_at' => now()->subDays(45), 'body' => 'The original candle story.']);
        $flow = $this->flow([
            ['t', 'trigger.manual'],
            ['e', 'logic.evergreen', ['older_than_days' => 30]],
            ['r', 'ai.rewrite', ['source' => '{{post.body}}']],
        ], [['t', 'e'], ['e', 'r']]);

        $first = FlowRun::find($this->spa()->actingAs($this->user)->postJson("/api/flows/{$flow->id}/run")->json('id'));
        $this->assertSame('done', $first->status);
        $this->assertSame($old->id, $first->context['post']['id']);
        $this->assertSame('maisoncire', $first->context['account']['handle']);
        $this->assertStringContainsString('The original candle story.', collect(self::$prompts)->last());

        $second = FlowRun::find($this->spa()->actingAs($this->user)->postJson("/api/flows/{$flow->id}/run")->json('id'));
        $this->assertSame('ended', $second->trail[1]['status']);
        $this->assertStringContainsString('left to bring back', $second->trail[1]['summary']);
    }

    public function test_a_live_run_can_be_stopped_and_the_overview_counts_the_automation(): void
    {
        $flow = $this->writeApprovePost();
        $flow->update(['enabled' => true]);
        $run = $this->spa()->actingAs($this->user)->postJson("/api/flows/{$flow->id}/run")->json();

        $overview = $this->spa()->actingAs($this->user)->getJson('/api/overview')->assertOk()->json('automation');
        $this->assertSame(1, $overview['flows_on']);
        $this->assertSame(1, $overview['waiting_on_you']);

        $this->spa()->actingAs($this->user)->postJson("/api/flow-runs/{$run['id']}/stop")->assertOk()->assertJsonPath('status', 'stopped');
        $this->spa()->actingAs($this->user)->postJson("/api/flow-runs/{$run['id']}/stop")->assertConflict();
        $this->spa()->actingAs(User::factory()->create())->getJson("/api/flow-runs/{$run['id']}")->assertNotFound();

        $list = $this->spa()->actingAs($this->user)->getJson('/api/flows')->assertOk()->json();
        $this->assertSame('stopped', $list['flows'][0]['last_run']['status']);
        $this->assertSame(1, $list['stats']['on']);
    }
}

<?php

namespace Tests\Feature;

use App\Http\Controllers\AssistantController;
use App\Models\Account;
use App\Models\Asset;
use App\Models\NodeRun;
use App\Models\Post;
use App\Models\Project;
use App\Models\User;
use App\Services\Ai\TextGenerator;
use App\Services\Lab\Graph;
use App\Services\Lab\Nodes\Captions;
use App\Services\Lab\YtDlp;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class LabTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Project $project;

    public static int $calls = 0;

    public static array $prompts = [];

    protected function setUp(): void
    {
        parent::setUp();
        self::$calls = 0;
        self::$prompts = [];
        $this->user = User::factory()->create(['timezone' => 'Europe/Paris']);
        $this->project = $this->user->projects()->create(['name' => 'Autumn', 'canvas' => Graph::normalize(['version' => 2])]);
        $this->app->instance(TextGenerator::class, new class implements TextGenerator
        {
            public function enabled(): bool
            {
                return true;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                LabTest::$calls++;
                LabTest::$prompts[] = $system."\n---\n".$prompt;
                yield 'Pumpkin latte is back. ';
                yield 'Come in before ten.';
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                LabTest::$calls++;

                return ['moments' => [
                    ['title' => 'The ten second rule', 'hook' => 'Nobody tells you this about coffee', 'why' => 'A surprising tip', 'score' => 88,
                        'start_quote' => 'here is the thing nobody tells you', 'end_quote' => 'and that is the whole secret', 'start' => 10, 'end' => 30],
                ]];
            }
        });
    }

    private function ops(array $ops, ?User $as = null)
    {
        return $this->spa()->actingAs($as ?? $this->user)->postJson("/api/projects/{$this->project->id}/lab/ops", ['ops' => $ops]);
    }

    public function test_nodes_connect_only_where_their_types_fit_and_never_in_a_loop(): void
    {
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'words', 'type' => 'source.text', 'x' => 0, 'y' => 0, 'params' => ['text' => 'Autumn menu']]],
            ['op' => 'add', 'node' => ['id' => 'write', 'type' => 'text.write', 'x' => 340, 'y' => 0]],
            ['op' => 'add', 'node' => ['id' => 'edit', 'type' => 'image.edit', 'x' => 340, 'y' => 240]],
            ['op' => 'connect', 'from' => 'words', 'to' => 'write'],
        ])->assertOk()->assertJsonPath('canvas.edges.0', ['from' => 'words', 'out' => 'text', 'to' => 'write', 'in' => 'context']);

        // Text into a picture input: refused, with why.
        $this->ops([['op' => 'connect', 'from' => 'words', 'out' => 'text', 'to' => 'edit', 'in' => 'image']])
            ->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'doesn’t take text'));

        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'translate', 'type' => 'text.translate']],
            ['op' => 'connect', 'from' => 'write', 'to' => 'translate'],
        ])->assertOk();
        $this->ops([['op' => 'connect', 'from' => 'translate', 'to' => 'write']])->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'loop'));
    }

    public function test_nothing_runs_without_a_run_and_keep_up_to_date_reruns_what_was_run(): void
    {
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'words', 'type' => 'source.text', 'params' => ['text' => 'Autumn menu']]],
            ['op' => 'add', 'node' => ['id' => 'write', 'type' => 'text.write', 'params' => ['task' => 'caption']]],
            ['op' => 'connect', 'from' => 'words', 'to' => 'write'],
        ])->assertOk();

        // Placing and connecting a node never starts it: it waits for Run.
        $state = $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab")->assertOk()->json('nodes');
        $this->assertSame(['ready', 'auto', 0], [$state['write']['status'], $state['write']['policy'], NodeRun::count()]);
        // The queue is synchronous in tests: running it ran it.
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/write/run")->assertCreated();
        $state = $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab")->json('nodes');
        $this->assertSame('done', $state['write']['status']);
        $this->assertSame('Pumpkin latte is back. Come in before ten.', $state['write']['outputs']['text']['text']);
        $this->assertSame(1, $state['write']['versions']);

        // A change upstream, with Keep up to date off (the default): it's out of date, and waits.
        $this->ops([['op' => 'set', 'id' => 'words', 'params' => ['text' => 'Spring menu']]])->assertOk()->assertJsonPath('nodes.write.status', 'stale');
        $this->assertSame(1, NodeRun::where('node_id', 'write')->count());

        // With it on, a node already run runs again by itself; both versions stay.
        $this->ops([['op' => 'auto', 'on' => true]])->assertOk()->assertJsonPath('canvas.auto', true);
        $this->ops([['op' => 'set', 'id' => 'words', 'params' => ['text' => 'Winter menu']]])->assertOk();
        $this->assertSame(2, NodeRun::where('node_id', 'write')->where('status', 'succeeded')->count());
        $this->assertStringContainsString('Winter menu', end(self::$prompts));

        // Pin the first version: it's what flows on, and the node is out of date against it.
        $first = NodeRun::where('node_id', 'write')->orderBy('id')->first();
        $state = $this->ops([['op' => 'pin', 'id' => 'write', 'run' => $first->id]])->assertOk()->json('nodes');
        $this->assertSame($first->id, $state['write']['current']['id']);
        $this->assertSame('stale', $state['write']['status']);

        $history = $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab/nodes/write/history")->assertOk()->json('runs');
        $this->assertCount(2, $history);
    }

    public function test_the_same_inputs_never_run_twice_and_a_failed_auto_run_isnt_retried_by_itself(): void
    {
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'words', 'type' => 'source.text', 'params' => ['text' => 'Autumn']]],
            ['op' => 'add', 'node' => ['id' => 'write', 'type' => 'text.write']],
            ['op' => 'connect', 'from' => 'words', 'to' => 'write'],
        ]);
        $calls = self::$calls;
        // Moving a node changes nothing it runs with.
        $this->ops([['op' => 'move', 'id' => 'write', 'x' => 500, 'y' => 40], ['op' => 'label', 'id' => 'write', 'label' => 'Caption']])->assertOk();
        $this->assertSame($calls, self::$calls);
    }

    public function test_a_manual_node_waits_and_running_it_runs_what_it_needs_first(): void
    {
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'brief', 'type' => 'source.brief', 'params' => ['product' => 'pumpkin latte', 'offer' => 'two for one before ten', 'style' => 'warm morning light']]],
            ['op' => 'add', 'node' => ['id' => 'write', 'type' => 'text.write', 'params' => ['task' => 'hook', 'instructions' => 'About {product}: {offer}']]],
            ['op' => 'add', 'node' => ['id' => 'video', 'type' => 'video.generate']],
            ['op' => 'connect', 'from' => 'brief', 'to' => 'write'],
            ['op' => 'connect', 'from' => 'write', 'to' => 'video', 'in' => 'prompt'],
        ])->assertOk();
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/write/run")->assertCreated();
        // The brief filled the writer's {variables} and gave it the brief.
        $this->assertStringContainsString('About pumpkin latte: two for one before ten', end(self::$prompts));
        $this->assertStringContainsString('warm morning light', end(self::$prompts));

        $state = $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab")->json('nodes');
        $this->assertSame('manual', $state['video']['policy']);
        $this->assertSame('ready', $state['video']['status']);
        // No video model can run in tests: it says so, and nothing is left running.
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/video/run")->assertCreated();
        $run = NodeRun::where('node_id', 'video')->latest('id')->first();
        $this->assertSame('failed', $run->status);
        $this->assertNotEmpty($run->error);
    }

    public function test_a_branch_copies_a_node_and_everything_after_it_with_their_results(): void
    {
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'words', 'type' => 'source.text', 'params' => ['text' => 'Autumn'], 'x' => 0, 'y' => 0]],
            ['op' => 'add', 'node' => ['id' => 'write', 'type' => 'text.write', 'x' => 340, 'y' => 0]],
            ['op' => 'add', 'node' => ['id' => 'translate', 'type' => 'text.translate', 'x' => 680, 'y' => 0]],
            ['op' => 'connect', 'from' => 'words', 'to' => 'write'],
            ['op' => 'connect', 'from' => 'write', 'to' => 'translate'],
        ]);
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/translate/run")->assertCreated();
        $res = $this->ops([['op' => 'branch', 'id' => 'write']])->assertOk();
        $canvas = $res->json('canvas');
        $this->assertCount(5, $canvas['nodes']);
        $copy = collect($canvas['nodes'])->firstWhere('id', $res->json('results.0.root'));
        $this->assertSame('B', $copy['branch']);
        $this->assertNotNull($copy['pin']);
        // The copy is fed by the same text, and shows the original's result until it's changed.
        $this->assertContains(['from' => 'words', 'out' => 'text', 'to' => $copy['id'], 'in' => 'context'], $canvas['edges']);
        $this->assertSame('done', $res->json("nodes.{$copy['id']}.status"));
    }

    public function test_a_post_node_saves_a_draft_linked_to_its_node_and_only_a_person_schedules(): void
    {
        $account = Account::factory()->for($this->user)->create(['platform' => 'instagram', 'handle' => 'maisoncire']);
        $image = Asset::factory()->for($this->user)->create(['kind' => 'image', 'mime' => 'image/png', 'width' => 1080, 'height' => 1350]);
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'media', 'type' => 'source.media', 'params' => ['assets' => [$image->id]]]],
            ['op' => 'add', 'node' => ['id' => 'caption', 'type' => 'source.text', 'params' => ['text' => 'Autumn is here.']]],
            ['op' => 'add', 'node' => ['id' => 'post', 'type' => 'finish.post', 'params' => ['account_id' => $account->id, 'when' => 'at', 'at' => now()->addDay()->format('Y-m-d\TH:i')]]],
            ['op' => 'connect', 'from' => 'media', 'out' => 'image', 'to' => 'post', 'in' => 'media'],
            ['op' => 'connect', 'from' => 'caption', 'to' => 'post', 'in' => 'caption'],
        ])->assertOk();
        // The post node never runs by itself.
        $this->assertSame(0, Post::count());

        // The assistant can't schedule.
        $this->app['auth']->forgetGuards();
        $token = $this->user->createToken(AssistantController::ABILITY, [AssistantController::ABILITY])->plainTextToken;
        $this->withToken($token)->postJson("/api/projects/{$this->project->id}/lab/nodes/post/run")->assertCreated();
        $this->assertSame(0, Post::count());
        $this->assertStringContainsString('Only you can schedule', NodeRun::where('node_id', 'post')->latest('id')->value('error'));
        $this->app['auth']->forgetGuards();

        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/post/run")->assertCreated();
        $post = Post::firstOrFail();
        $this->assertSame('scheduled', $post->status->value);
        $this->assertSame($this->project->id, $post->project_id);
        $this->assertSame('post', $post->node_id);
        $this->assertNotNull($post->approved_at);
        $this->assertSame([$image->id], $post->assets->pluck('id')->all());
        $state = $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab")->json('nodes.post');
        $this->assertSame($post->id, $state['post']['id']);
        $this->assertSame('maisoncire', $state['post']['account']['handle']);

        // Running it again changes the same post rather than making another.
        $this->ops([['op' => 'set', 'id' => 'post', 'params' => ['when' => 'draft']]]);
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/post/run")->assertCreated();
        $this->assertSame(1, Post::count());
        $this->assertSame('draft', $post->fresh()->status->value);
    }

    public function test_a_template_starts_a_project_and_a_project_saves_as_a_template(): void
    {
        $out = $this->spa()->actingAs($this->user)->postJson('/api/lab/projects', ['name' => 'Latte', 'template' => 'product-picture'])->assertCreated()->json();
        $this->assertCount(7, $out['canvas']['nodes']);
        // Templates are kinds of content; where it goes is a node of its own before the post.
        $this->assertSame(['finish.channel', 'finish.post'], array_slice(array_column($out['canvas']['nodes'], 'type'), -2));

        $catalog = $this->spa()->actingAs($this->user)->getJson('/api/lab/catalog')->assertOk()->json();
        foreach ($catalog['templates'] as $t) {
            // Every built-in template is a valid graph.
            $p = $this->spa()->actingAs($this->user)->postJson('/api/lab/projects', ['name' => $t['name'], 'template' => $t['key']])->assertCreated()->json();
            $this->assertCount(count($t['graph']['edges']), $p['canvas']['edges'], $t['key']);
        }

        $saved = $this->spa()->actingAs($this->user)->postJson("/api/projects/{$out['project']['id']}/lab/template", ['name' => 'My latte post'])->assertCreated()->json();
        $mine = collect($this->spa()->actingAs($this->user)->getJson('/api/lab/catalog')->json('templates'))->firstWhere('key', $saved['key']);
        $this->assertSame('My latte post', $mine['name']);
        $this->assertCount(7, $mine['graph']['nodes']);
    }

    public function test_the_first_creative_lab_canvases_open_as_nodes(): void
    {
        $asset = Asset::factory()->for($this->user)->create(['kind' => 'image', 'mime' => 'image/png']);
        $old = $this->user->projects()->create(['name' => 'Old board', 'canvas' => ['nodes' => [
            ['id' => 'a', 'type' => 'note', 'x' => 0, 'y' => 0, 'text' => 'Ideas'],
            ['id' => 'b', 'type' => 'asset', 'x' => 300, 'y' => 0, 'ref' => $asset->id],
        ], 'edges' => [['from' => 'a', 'to' => 'b']], 'view' => ['x' => 0, 'y' => 0, 'zoom' => 1]]]);
        $out = $this->spa()->actingAs($this->user)->getJson("/api/projects/{$old->id}/lab")->assertOk()->json();
        $this->assertSame(['util.note', 'source.media'], array_column($out['canvas']['nodes'], 'type'));
        $this->assertSame('done', $out['nodes']['b']['status']);
        $this->assertSame([$asset->id], $out['nodes']['b']['outputs']['image']['assets']);
    }

    public function test_someone_elses_project_is_out_of_reach(): void
    {
        $other = User::factory()->create();
        $this->ops([['op' => 'add', 'node' => ['type' => 'util.note']]], $other)->assertForbidden();
        $this->spa()->actingAs($other)->getJson("/api/projects/{$this->project->id}/lab")->assertForbidden();
    }

    public function test_captions_are_timed_to_the_words_and_youtube_captions_become_words(): void
    {
        $words = [['text' => 'Here', 'start' => 0.0, 'end' => 0.3], ['text' => 'it', 'start' => 0.3, 'end' => 0.5], ['text' => 'is.', 'start' => 0.5, 'end' => 0.9], ['text' => 'Next', 'start' => 2.0, 'end' => 2.4]];
        $ass = Captions::ass($words, 1080, 1920, ['style' => 'bold', 'words' => 3, 'highlight' => '#facc15']);
        $this->assertStringContainsString('PlayResX: 1080', $ass);
        $this->assertSame(4, substr_count($ass, 'Dialogue:'));
        $this->assertStringContainsString('{\\c&H0015CCFA', $ass);
        $this->assertStringContainsString('HERE', $ass);

        $parsed = YtDlp::json3Words(['events' => [
            ['tStartMs' => 1000, 'dDurationMs' => 2000, 'segs' => [['utf8' => 'hello'], ['utf8' => ' world', 'tOffsetMs' => 600]]],
            ['tStartMs' => 3000, 'dDurationMs' => 1000, 'segs' => [['utf8' => '[Music]']]],
        ]]);
        $this->assertSame(['hello', 'world'], array_column($parsed, 'text'));
        $this->assertEqualsWithDelta(1.6, $parsed[1]['start'], 0.01);
    }

    public function test_moments_are_placed_on_the_words_the_model_quotes(): void
    {
        $text = 'so we started small and then here is the thing nobody tells you about coffee you have ten seconds to get the milk right and that is the whole secret thanks for listening everyone';
        $words = [];
        foreach (explode(' ', $text) as $i => $w) {
            $words[] = ['text' => $w, 'start' => $i * 0.8, 'end' => $i * 0.8 + 0.6];
        }
        $audio = Asset::factory()->for($this->user)->create(['kind' => 'audio', 'mime' => 'audio/mpeg', 'meta' => ['transcript' => ['words' => $words, 'text' => $text]]]);
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'audio', 'type' => 'source.media', 'params' => ['assets' => [$audio->id]]]],
            ['op' => 'add', 'node' => ['id' => 'transcript', 'type' => 'audio.transcribe']],
            ['op' => 'add', 'node' => ['id' => 'moments', 'type' => 'clip.moments', 'params' => ['min' => 5, 'max' => 30]]],
            ['op' => 'connect', 'from' => 'audio', 'out' => 'audio', 'to' => 'transcript'],
            ['op' => 'connect', 'from' => 'transcript', 'out' => 'transcript', 'to' => 'moments'],
        ])->assertOk();
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/moments/run")->assertCreated();
        $out = $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab")->json('nodes.moments');
        $this->assertSame('done', $out['status'], json_encode($out));
        $m = $out['outputs']['moments']['moments'][0];
        $this->assertStringStartsWith('here is the thing nobody tells you', $m['quote']);
        $this->assertStringEndsWith('whole secret', $m['quote']);
        $this->assertEqualsWithDelta(6 * 0.8 - 0.12, $m['start'], 0.01);
    }

    public function test_a_project_can_start_with_a_campaign_brief_that_guides_it(): void
    {
        $account = Account::factory()->for($this->user)->create(['platform' => 'instagram', 'handle' => 'maisoncire']);
        $out = $this->spa()->actingAs($this->user)->postJson('/api/lab/projects', [
            'name' => 'Autumn launch',
            'campaign' => ['goal' => 'Fill the café before ten', 'audience' => 'Commuters nearby', 'message' => 'Pumpkin latte is back', 'key_facts' => 'Two for one before ten', 'account_ids' => [$account->id]],
            'brief' => ['tone' => 'warm', 'style' => 'soft morning light', 'palette' => ['#d97706']],
        ])->assertCreated()->json();

        $campaign = $this->user->campaigns()->firstOrFail();
        $this->assertSame($campaign->id, $out['campaign_id']);
        $this->assertSame('Pumpkin latte is back', $campaign->brief['message']);
        $this->assertSame([$account->id], $campaign->account_ids);
        // An empty project gets a Brief node of its own, linked to the campaign, with the look.
        $brief = collect($out['canvas']['nodes'])->firstWhere('type', 'source.brief');
        $this->assertSame($campaign->id, $brief['params']['campaign_id']);
        $this->assertSame('warm', $brief['params']['tone']);
        $this->assertSame($account->id, $brief['params']['account_id']);
        $context = $out['nodes'][$brief['id']]['outputs']['brief']['brief']['context'];
        $this->assertStringContainsString('Fill the café before ten', $context);
        $this->assertStringContainsString('soft morning light', $context);

        // With a template, its own Brief node takes the campaign.
        $out = $this->spa()->actingAs($this->user)->postJson('/api/lab/projects', ['name' => 'Pack', 'template' => 'campaign-pack', 'campaign_id' => $campaign->id])->assertCreated()->json();
        $this->assertCount(1, collect($out['canvas']['nodes'])->where('type', 'source.brief'));
        $this->assertSame($campaign->id, collect($out['canvas']['nodes'])->firstWhere('type', 'source.brief')['params']['campaign_id']);
    }

    public function test_a_project_starts_from_an_interview_with_its_photos_under_the_brief(): void
    {
        Storage::fake('local');
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=');
        // The assistant asked the questions in its chat; the logo and a portrait were shared there.
        $logo = Asset::factory()->for($this->user)->create(['name' => 'logo.png', 'mime' => 'image/png']);
        $face = Asset::factory()->for($this->user)->create();
        Storage::disk('local')->put($logo->path, $png);
        Storage::disk('local')->put($face->path, $png);

        $out = $this->spa()->actingAs($this->user)->postJson('/api/lab/projects', [
            'interview' => ['depth' => 'quick', 'fields' => ['focus' => 'A product', 'offer' => 'Hand-poured lavender candles', 'audience' => 'Women in Lyon', 'goal' => 'More sales', 'tone' => 'Warm (suggested)', 'nonsense' => 'x']],
            'photos' => [['asset_id' => $logo->id, 'kind' => 'logo'], ['asset_id' => $face->id, 'kind' => 'person']],
        ])->assertCreated()->json();

        $campaign = $this->user->campaigns()->firstOrFail();
        $this->assertSame(['intake', true], [$campaign->source, $campaign->isComplete()]);
        $this->assertArrayNotHasKey('nonsense', $campaign->fields);
        $this->assertSame('Hand-poured lavender candles', $out['project']['name']);
        // The brief at the start reads the answers (a suggestion without its marker), the photos sit under it by kind.
        $brief = collect($out['canvas']['nodes'])->firstWhere('type', 'source.brief');
        $this->assertSame(['Hand-poured lavender candles', 'Warm'], [$out['nodes'][$brief['id']]['outputs']['brief']['brief']['product'], $out['nodes'][$brief['id']]['outputs']['brief']['brief']['tone']]);
        $refs = collect($out['canvas']['nodes'])->where('type', 'source.media')->mapWithKeys(fn ($n) => [$n['label'] => $n['params']['assets']]);
        $this->assertSame(['Logo' => [$logo->id], 'People' => [$face->id]], $refs->all());

        // A photo shared during the page's interview goes into the gallery once, whatever the number of projects.
        Storage::disk('local')->put($campaign->directory().'/jar.png', $png);
        $campaign->photos()->create(['path' => $campaign->directory().'/jar.png', 'mime' => 'image/png', 'kind' => 'product']);
        $assets = Asset::count();
        foreach ([1, 2] as $i) {
            $out = $this->spa()->actingAs($this->user)->postJson("/api/campaigns/{$campaign->id}/lab")->assertCreated()->json();
            $this->assertSame(['Logo', 'The product', 'People'], collect($out['canvas']['nodes'])->where('type', 'source.media')->pluck('label')->values()->all());
        }
        $this->assertSame($assets + 1, Asset::count());
    }

    public function test_a_voiceover_reads_in_a_voice_cloned_from_a_recording_with_consent(): void
    {
        config(['ai.providers.voicestudio.url' => 'https://vs.example', 'ai.providers.voicestudio.key' => 'k']);
        Http::fake([
            'vs.example/profiles' => fn ($r) => Http::response($r->method() === 'POST' ? ['id' => 'abc', 'name' => 'Cloned · me', 'kind' => 'clone'] : [['id' => 'abc', 'name' => 'Cloned · me', 'kind' => 'clone']]),
            'vs.example/*' => Http::response(['detail' => 'no'], 500),
        ]);
        Storage::fake('local');
        $recording = Asset::factory()->for($this->user)->create(['kind' => 'audio', 'mime' => 'audio/wav', 'name' => 'me.wav', 'path' => 'assets/test/me.wav', 'duration' => 1]);
        Storage::disk('local')->makeDirectory('assets/test');
        Process::run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', Storage::disk('local')->path('assets/test/me.wav')])->throw();

        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'me', 'type' => 'source.media', 'params' => ['assets' => [$recording->id]]]],
            ['op' => 'add', 'node' => ['id' => 'voice', 'type' => 'audio.voice', 'params' => ['script' => 'Pumpkin latte is back.']]],
            ['op' => 'connect', 'from' => 'me', 'out' => 'audio', 'to' => 'voice', 'in' => 'clone'],
        ])->assertOk();

        // Without consent it won't clone.
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/voice/run")->assertCreated();
        $this->assertStringContainsString('agreed', NodeRun::where('node_id', 'voice')->latest('id')->first()->error);

        $this->ops([['op' => 'set', 'id' => 'voice', 'params' => ['consent' => true]]])->assertOk();
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/voice/run")->assertCreated();
        Http::assertSent(fn ($r) => $r->url() === 'https://vs.example/profiles' && $r->method() === 'POST');
        // The clone is kept on the recording: the next run reads in the same voice without cloning again.
        $this->assertSame('vs:abc', $recording->fresh()->meta['voice_clone']);
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/voice/run")->assertCreated();
        $this->assertCount(1, Http::recorded(fn ($r) => $r->url() === 'https://vs.example/profiles' && $r->method() === 'POST'));
    }

    public function test_where_it_goes_fits_the_caption_and_the_post_takes_its_account_and_placement(): void
    {
        $account = Account::factory()->for($this->user)->create(['platform' => 'x', 'handle' => 'maisoncire']);
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'caption', 'type' => 'source.text', 'params' => ['text' => str_repeat('Pumpkin latte is back. ', 30).'#latte #autumn #cafe #coffee']]],
            ['op' => 'add', 'node' => ['id' => 'where', 'type' => 'finish.channel', 'params' => ['account_id' => $account->id, 'rewrite' => false]]],
            ['op' => 'add', 'node' => ['id' => 'post', 'type' => 'finish.post']],
            ['op' => 'connect', 'from' => 'caption', 'to' => 'where', 'in' => 'caption'],
            ['op' => 'connect', 'from' => 'where', 'out' => 'channel', 'to' => 'post', 'in' => 'channel'],
            ['op' => 'connect', 'from' => 'where', 'out' => 'caption', 'to' => 'post', 'in' => 'caption'],
        ])->assertOk();
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/where/run")->assertCreated();
        $state = $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab")->json('nodes.where');
        $this->assertSame('done', $state['status'], json_encode($state));
        $this->assertSame('post', $state['outputs']['channel']['placement']);
        $this->assertLessThanOrEqual(280, mb_strlen($state['outputs']['caption']['text']));

        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/post/run")->assertCreated();
        $post = Post::firstOrFail();
        $this->assertSame($account->id, $post->account_id);
        $this->assertSame(['x'], $post->platforms);
        $this->assertSame('draft', $post->status->value);
    }
}

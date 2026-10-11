<?php

namespace Tests\Feature;

use App\Jobs\RunLabNode;
use App\Models\NodeRun;
use App\Models\Project;
use App\Models\User;
use App\Services\Ai\TextGenerator;
use App\Services\Lab\Graph;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * A Write node asked for several versions, and the lines out of it each taking one; tidying a canvas.
 */
class LabVersionsTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Project $project;

    public static array $prompts = [];

    protected function setUp(): void
    {
        parent::setUp();
        self::$prompts = [];
        $this->user = User::factory()->create();
        $this->project = $this->user->projects()->create(['name' => 'Supercars', 'canvas' => Graph::normalize(['version' => 2])]);
        $this->app->instance(TextGenerator::class, new class implements TextGenerator
        {
            public function enabled(): bool
            {
                return true;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                LabVersionsTest::$prompts[] = $prompt;
                if (str_starts_with($prompt, 'Translate')) {
                    yield 'FR: '.trim((string) strrchr($prompt, "\n"));
                } elseif (str_contains($prompt, '3 different versions')) {
                    // The way models answer anyway: a label before each, and the separator asked for.
                    yield "Caption 1\n\nMidnight. Empty streets.\n---\nCaption 2:\nThe city didn't light this car up.\n---\n**Version 3**\nDreams this loud don't whisper.";
                } elseif (str_contains($prompt, 'lines for a video')) {
                    yield "1. The engine wakes.\n2. The city listens.\n3. Your turn.";
                } else {
                    yield "Caption 1\n\nOne car, one night.";
                }
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                return [];
            }
        });
    }

    private function ops(array $ops)
    {
        return $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/ops", ['ops' => $ops]);
    }

    private function runNode(string $node)
    {
        return $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/{$node}/run");
    }

    private function nodes(): array
    {
        return $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab")->assertOk()->json('nodes');
    }

    public function test_several_versions_each_go_down_their_own_line(): void
    {
        $canvas = $this->ops([
            ['op' => 'add', 'node' => ['id' => 'captions', 'type' => 'text.write', 'params' => ['task' => 'caption', 'variants' => 3]]],
            ['op' => 'add', 'node' => ['id' => 'fr-1', 'type' => 'text.translate']],
            ['op' => 'add', 'node' => ['id' => 'fr-2', 'type' => 'text.translate']],
            ['op' => 'add', 'node' => ['id' => 'fr-3', 'type' => 'text.translate']],
            ['op' => 'connect', 'from' => 'captions', 'to' => 'fr-1'],
            ['op' => 'connect', 'from' => 'captions', 'to' => 'fr-2'],
            ['op' => 'connect', 'from' => 'captions', 'to' => 'fr-3'],
        ])->assertOk()->json('canvas');
        // Each line took its own version, in the order they were drawn.
        $this->assertSame([1, 2, 3], array_column($canvas['edges'], 'pick'));

        $this->runNode('fr-3')->assertCreated();
        $nodes = $this->nodes();
        // One request for the three, separated, the labels the model added anyway taken off.
        $this->assertStringContainsString('Write 3 different versions', self::$prompts[0]);
        $this->assertSame(['Midnight. Empty streets.', 'The city didn\'t light this car up.', 'Dreams this loud don\'t whisper.'], $nodes['captions']['outputs']['text']['items']);
        $this->assertSame('FR: Dreams this loud don\'t whisper.', $nodes['fr-3']['outputs']['text']['text']);

        // All of it (0), or one that isn't there.
        $this->ops([['op' => 'pick', 'from' => 'captions', 'to' => 'fr-1', 'pick' => 0]])->assertOk();
        $this->ops([['op' => 'pick', 'from' => 'captions', 'to' => 'fr-2', 'pick' => 5]])->assertOk()
            ->assertJsonPath('nodes.fr-2.missing.0', fn ($m) => str_contains($m, 'has 3 to pick from, not 5'));
        $this->runNode('fr-1')->assertCreated();
        $this->assertStringContainsString("Midnight. Empty streets.\n\nThe city didn't light this car up.", end(self::$prompts));

        // Back to one version: the lines take it whole again.
        $canvas = $this->ops([['op' => 'set', 'id' => 'captions', 'params' => ['variants' => 1]]])->assertOk()->json('canvas');
        $this->assertSame([], array_filter(array_column($canvas['edges'], 'pick')));
    }

    public function test_one_version_comes_without_the_label_and_a_line_of_a_list_can_be_picked(): void
    {
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'caption', 'type' => 'text.write', 'params' => ['task' => 'caption']]],
            ['op' => 'add', 'node' => ['id' => 'lines', 'type' => 'text.write', 'params' => ['task' => 'lines', 'count' => 3]]],
            ['op' => 'add', 'node' => ['id' => 'fr', 'type' => 'text.translate']],
            ['op' => 'connect', 'from' => 'lines', 'to' => 'fr', 'pick' => 2],
        ])->assertOk()->assertJsonPath('canvas.edges.0.pick', 2);

        $this->runNode('caption')->assertCreated();
        $this->runNode('fr')->assertCreated();
        $nodes = $this->nodes();
        $this->assertStringContainsString('Write one version only', self::$prompts[0]);
        $this->assertSame('One car, one night.', $nodes['caption']['outputs']['text']['text']);
        // A list flows on whole (its numbers as the model wrote them), and a line of it can be picked.
        $this->assertSame(['The engine wakes.', 'The city listens.', 'Your turn.'], $nodes['lines']['outputs']['text']['items']);
        $this->assertSame('FR: The city listens.', $nodes['fr']['outputs']['text']['text']);
    }

    public function test_a_translation_keeps_the_names_it_is_told_to(): void
    {
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'words', 'type' => 'source.text', 'params' => ['text' => 'Cold brew season is open at low tide.']]],
            ['op' => 'add', 'node' => ['id' => 'fr', 'type' => 'text.translate', 'params' => ['language' => 'French', 'keep' => 'Low Tide']]],
            ['op' => 'connect', 'from' => 'words', 'to' => 'fr'],
        ])->assertOk();
        $this->runNode('fr')->assertCreated();
        $this->assertStringContainsString('These are names: never translate them, and write them exactly as given here, capitals included, even where the text has them in lower case: Low Tide.', end(self::$prompts));
    }

    public function test_running_a_node_runs_what_changed_further_up_and_what_is_between(): void
    {
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'words', 'type' => 'source.text', 'params' => ['text' => 'Open at low tide.']]],
            ['op' => 'add', 'node' => ['id' => 'fr', 'type' => 'text.translate']],
            ['op' => 'add', 'node' => ['id' => 'en', 'type' => 'text.translate', 'params' => ['language' => 'English']]],
            ['op' => 'connect', 'from' => 'words', 'to' => 'fr'],
            ['op' => 'connect', 'from' => 'fr', 'to' => 'en'],
        ])->assertOk();
        $this->runNode('en')->assertCreated();
        // A setting changed two nodes up: the one between is still done (its input hasn't changed yet).
        $this->ops([['op' => 'set', 'id' => 'fr', 'params' => ['keep' => 'Low Tide']]])->assertOk();
        $this->assertSame(['stale', 'done'], [$this->nodes()['fr']['status'], $this->nodes()['en']['status']]);

        $plan = $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab/nodes/en/plan")->assertOk()->json('nodes');
        $this->assertSame(['fr', 'en'], array_column($plan, 'id'));
        $this->runNode('en')->assertCreated();
        $this->assertStringContainsString('Low Tide', collect(self::$prompts)->filter(fn ($p) => str_contains($p, 'into French'))->last());
        $this->assertSame('done', $this->nodes()['fr']['status']);
    }

    public function test_a_node_between_waits_for_a_run_already_on_its_way_before_it(): void
    {
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'words', 'type' => 'source.text', 'params' => ['text' => 'Open at low tide.']]],
            ['op' => 'add', 'node' => ['id' => 'fr', 'type' => 'text.translate']],
            ['op' => 'add', 'node' => ['id' => 'en', 'type' => 'text.translate', 'params' => ['language' => 'English']]],
            ['op' => 'add', 'node' => ['id' => 'de', 'type' => 'text.translate', 'params' => ['language' => 'German']]],
            ['op' => 'connect', 'from' => 'words', 'to' => 'fr'],
            ['op' => 'connect', 'from' => 'fr', 'to' => 'en'],
            ['op' => 'connect', 'from' => 'en', 'to' => 'de'],
        ])->assertOk();
        $this->runNode('de')->assertCreated();
        // Nothing runs from here on: the first one is run again and stays on its way.
        Queue::fake([RunLabNode::class]);
        $this->runNode('fr')->assertCreated();
        $this->runNode('de')->assertCreated();
        // The one between was done, but its input is about to change: it runs again, after it.
        $between = NodeRun::where('node_id', 'en')->latest('id')->first();
        $this->assertSame(['queued', ['fr']], [$between->status, $between->state['after'] ?? null]);
        $this->assertContains('en', NodeRun::where('node_id', 'de')->latest('id')->first()->state['after'] ?? []);
    }

    public function test_run_all_takes_what_comes_after_what_it_reruns(): void
    {
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'caption', 'type' => 'text.write', 'params' => ['task' => 'caption']]],
            ['op' => 'add', 'node' => ['id' => 'fr', 'type' => 'text.translate']],
            ['op' => 'connect', 'from' => 'caption', 'to' => 'fr'],
        ])->assertOk();
        $this->runNode('fr')->assertCreated();
        // The caption asked for something else: it's out of date, the translation still done (for now).
        $this->ops([['op' => 'set', 'id' => 'caption', 'params' => ['instructions' => 'Shorter']]])->assertOk();
        $this->assertSame(['stale', 'done'], [$this->nodes()['caption']['status'], $this->nodes()['fr']['status']]);

        $plan = $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/run-all")->assertOk()->json('nodes');
        $this->assertSame(['caption', 'fr'], array_column($plan, 'id'));
    }

    public function test_a_node_never_lands_on_another_and_tidy_lays_the_graph_out_in_columns(): void
    {
        // What the assistant did: a picture's chain put where the writers already were.
        $canvas = $this->ops([
            ['op' => 'add', 'node' => ['id' => 'brief', 'type' => 'source.brief', 'x' => 80, 'y' => 80]],
            ['op' => 'add', 'node' => ['id' => 'hooks', 'type' => 'text.write', 'x' => 1080, 'y' => 80, 'params' => ['task' => 'hook', 'variants' => 2]]],
            ['op' => 'add', 'node' => ['id' => 'anim', 'type' => 'video.animate', 'x' => 1080, 'y' => 80]],
        ])->assertOk()->json('canvas');
        $this->assertSame(460.0, (float) collect($canvas['nodes'])->firstWhere('id', 'anim')['y']);

        $ops = [['op' => 'connect', 'from' => 'brief', 'to' => 'hooks']];
        foreach ([1, 2] as $i) {
            $ops[] = ['op' => 'add', 'node' => ['id' => "pic-{$i}", 'type' => 'image.generate', 'x' => 700, 'y' => 80]];
            $ops[] = ['op' => 'add', 'node' => ['id' => "design-{$i}", 'type' => 'finish.design', 'x' => 1440, 'y' => 80]];
            $ops[] = ['op' => 'connect', 'from' => 'brief', 'to' => "pic-{$i}"];
            $ops[] = ['op' => 'connect', 'from' => "pic-{$i}", 'to' => "design-{$i}", 'in' => 'media'];
            $ops[] = ['op' => 'connect', 'from' => 'hooks', 'to' => "design-{$i}", 'in' => 'headline'];
        }
        $this->ops($ops)->assertOk();
        $canvas = $this->ops([['op' => 'tidy']])->assertOk()->json('canvas');
        $at = collect($canvas['nodes'])->keyBy('id')->map(fn ($n) => [(int) $n['x'], (int) $n['y']]);

        // Columns by how far along: the brief, then what it feeds; a picture right before its design.
        $this->assertSame([80, 420, 760], [$at['brief'][0], $at['pic-1'][0], $at['design-1'][0]]);
        $this->assertSame($at['pic-2'][0], $at['pic-1'][0]);
        // A writer for both designs stays left, beside the pictures; a picture and its design share a row.
        $this->assertSame(420, $at['hooks'][0]);
        $this->assertSame($at['pic-1'][1], $at['design-1'][1]);
        // No two cards on one another.
        foreach ($at as $a => [$x, $y]) {
            foreach ($at as $b => [$x2, $y2]) {
                $this->assertFalse($a !== $b && $x === $x2 && abs($y - $y2) < 140, "{$a} sits on {$b}");
            }
        }
    }
}

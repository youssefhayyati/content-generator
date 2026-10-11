<?php

namespace App\Services\Lab;

use App\Jobs\RunLabNode;
use App\Models\Asset;
use App\Models\Generation;
use App\Models\NodeRun;
use App\Models\Project;
use App\Models\User;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Media\HiggsfieldClient;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\Pricing;
use App\Services\Ai\UsageMeter;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Throwable;

/**
 * Runs a Creative Lab graph.
 *
 * What a node passes on is its current run's outputs: the run a person pinned, else its newest good
 * one. Nodes with nothing to run (media, text, a brief) pass on what they hold. A node is out of date
 * when what it would run with now (its settings and its inputs, hashed) isn't what its current run
 * ran with. Nothing runs without a person's Run (or the assistant's, when it was handed control): a
 * node placed or changed waits, saying how long it takes and what it costs. With the project's Keep
 * up to date on (canvas.auto), fast, free nodes that were run once run again by themselves (cascade).
 *
 * A run either finishes in its job (writing, cutting, mixing) or waits on generations (a model on the
 * pod or in the cloud); GenerationRunner tells generationSettled when those finish.
 */
class Engine
{
    /** Auto runs wait this long after an edit, so typing doesn't start a run per key. */
    public const SETTLE_SECONDS = 2;

    /** @var array<string, list<array<string, mixed>>> */
    private array $modelLists = [];

    public function __construct(private readonly ModelRegistry $models) {}

    /* ------------------------------------------------------------------ */
    /* The canvas */
    /* ------------------------------------------------------------------ */

    /**
     * @return array<string, mixed>
     */
    public function canvas(Project $project): array
    {
        return Graph::normalize($project->canvas);
    }

    /**
     * Apply operations to the newest canvas, then start what the changes put out of date (auto nodes
     * only, after a moment). Returns the new canvas and what each operation did.
     *
     * @param  list<array<string, mixed>>  $ops
     * @return array{0: array<string, mixed>, 1: list<array<string, mixed>>}
     *
     * @throws InvalidArgumentException
     */
    public function apply(Project $project, array $ops, string $by = 'you'): array
    {
        [$canvas, $results, $touched] = DB::transaction(function () use ($project, $ops) {
            $fresh = Project::query()->lockForUpdate()->findOrFail($project->id);
            $canvas = Graph::normalize($fresh->canvas);
            // A branch copies each node's current result along with it.
            if (collect($ops)->contains(fn ($op) => ($op['op'] ?? null) === 'branch')) {
                $current = $this->currentRuns($fresh, $canvas);
                $canvas['nodes'] = array_map(fn ($n) => isset($current[$n['id']]) ? [...$n, '_current' => $current[$n['id']]->id] : $n, $canvas['nodes']);
            }
            [$canvas, $results] = Graph::apply($canvas, $ops);
            $this->checkPins($fresh, $canvas);
            $fresh->update(['canvas' => $canvas]);
            $project->setRawAttributes($fresh->getAttributes(), true);

            $touched = [];
            foreach ($ops as $i => $op) {
                $touched = [...$touched, ...match ($op['op'] ?? '') {
                    'add', 'set', 'pin' => array_filter([$op['id'] ?? $results[$i]['id'] ?? $op['node']['id'] ?? null]),
                    'connect', 'disconnect' => array_filter([$op['to'] ?? null]),
                    'insert' => array_values($results[$i]['ids'] ?? []),
                    default => [],
                }];
            }

            return [$canvas, $results, array_values(array_unique($touched))];
        });

        if ($touched) {
            rescue(fn () => $this->settle($project->fresh(), $touched, $by), report: true);
        }

        return [$canvas, $results];
    }

    /**
     * Pins only to runs of this project, of the same kind of node, that succeeded.
     *
     * @param  array<string, mixed>  $canvas
     */
    private function checkPins(Project $project, array &$canvas): void
    {
        $pins = array_filter(array_map(fn ($n) => $n['pin'] ?? null, $canvas['nodes']));
        if (! $pins) {
            return;
        }
        $good = $project->nodeRuns()->whereIn('id', $pins)->where('status', 'succeeded')->pluck('type', 'id');
        foreach ($canvas['nodes'] as $i => $n) {
            if (isset($n['pin']) && ($good[$n['pin']] ?? null) !== $n['type']) {
                unset($canvas['nodes'][$i]['pin']);
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* State: what each node holds and how it stands */
    /* ------------------------------------------------------------------ */

    /**
     * Every node's status, outputs and run, for the page (and the assistant), with the assets they
     * mention.
     *
     * @return array{nodes: array<string, array<string, mixed>>, assets: array<int, array<string, mixed>>}
     */
    public function state(Project $project): array
    {
        $canvas = $this->canvas($project);
        $ctx = $this->context($project, $canvas);
        $nodes = [];
        foreach ($canvas['nodes'] as $node) {
            $nodes[$node['id']] = $this->nodeState($ctx, $node);
        }
        $ids = collect($nodes)->flatMap(fn ($n) => [
            ...collect($n['outputs'] ?? [])->flatMap(fn ($o) => $o['assets'] ?? []),
            ...collect($n['params_assets'] ?? []),
        ])->unique()->values();
        $assets = Asset::where('user_id', $project->user_id)->whereIn('id', $ids)->get()->mapWithKeys(fn (Asset $a) => [$a->id => $a->summary()])->all();

        return ['nodes' => $nodes, 'assets' => $assets];
    }

    /**
     * The working context for one look at a project: its canvas, its runs by node, and memoized
     * outputs and hashes.
     *
     * @param  array<string, mixed>  $canvas
     */
    public function context(Project $project, array $canvas): Context
    {
        $runs = $project->nodeRuns()->orderBy('id')->get(['id', 'node_id', 'type', 'version', 'status', 'inputs_hash', 'outputs', 'stage', 'share', 'error', 'cost', 'by', 'started_at', 'finished_at', 'created_at', 'state']);

        return new Context($this, $project, $canvas, $runs);
    }

    /**
     * @param  array<string, mixed>  $node
     * @return array<string, mixed>
     */
    public function nodeState(Context $ctx, array $node): array
    {
        $kind = Catalog::node($node['type']);
        $policy = $this->policy($node);
        $base = ['id' => $node['id'], 'type' => $node['type'], 'policy' => $policy, 'run_label' => $kind['run_label'] ?? 'Run'];
        if ($node['type'] === 'source.media') {
            $base['params_assets'] = array_map('intval', $node['params']['assets'] ?? []);
        }

        if ($policy === 'none') {
            $outputs = $ctx->outputs($node['id']);

            return [...$base, 'status' => collect($outputs)->filter(fn ($o) => $this->filled($o))->isNotEmpty() ? 'done' : 'empty', 'outputs' => $outputs];
        }

        $runs = $ctx->runsOf($node['id']);
        $active = $runs->first(fn (NodeRun $r) => in_array($r->status, ['queued', 'running'], true));
        $current = $ctx->current($node);
        $latest = $runs->last();
        $inputs = $ctx->inputs($node);
        $missing = $inputs->missing();
        $hash = $missing ? null : $ctx->hash($node);

        $status = match (true) {
            (bool) $active => $active->status,
            $latest && $latest->status === 'failed' && (! $current || $latest->id > $current->id) => 'failed',
            ! $current => $missing ? 'missing' : 'ready',
            $missing => 'missing',
            $current->inputs_hash !== $hash => 'stale',
            default => 'done',
        };
        $estimate = $this->estimate($node);

        return [
            ...$base,
            'status' => $status,
            'outputs' => $current?->outputs ?? (object) [],
            'current' => $current ? $this->runSummary($current) : null,
            'active' => $active ? $this->runSummary($active) : null,
            'failed' => $status === 'failed' ? $this->runSummary($latest) : null,
            'versions' => $runs->where('status', 'succeeded')->count(),
            'missing' => $missing,
            'estimate' => $estimate,
            'pinned' => isset($node['pin']),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function runSummary(NodeRun $r): array
    {
        return [
            'id' => $r->id, 'version' => $r->version, 'status' => $r->status, 'stage' => $r->stage, 'share' => $r->share,
            'error' => $r->error, 'cost' => $r->cost, 'by' => $r->by,
            'started_at' => $r->started_at?->toIso8601ZuluString(), 'finished_at' => $r->finished_at?->toIso8601ZuluString(),
            'waiting_for' => $r->state['after'] ?? null,
        ];
    }

    /**
     * @param  array<string, mixed>|null  $value
     */
    public function filled(?array $value): bool
    {
        return match ($value['type'] ?? null) {
            null => false,
            'text' => trim((string) ($value['text'] ?? '')) !== '',
            'brief' => ! empty($value['brief']),
            'moments' => ! empty($value['moments']),
            'transcript' => ! empty($value['asset_id']) || ! empty($value['source_id']) || ! empty($value['text']),
            'source' => ! empty($value['source_id']),
            'post' => ! empty($value['post_id']),
            'channel' => ! empty($value['account_id']),
            'character' => ! empty($value['reference_id']),
            default => ! empty($value['assets']),
        };
    }

    /**
     * auto, manual, none or post: the catalog's, made manual for a model that is slow or paid.
     *
     * @param  array<string, mixed>  $node
     */
    public function policy(array $node): string
    {
        $base = Catalog::node($node['type'])['run'] ?? 'manual';
        if ($base !== 'auto') {
            return $base;
        }
        // With its defaults: a Music node placed as it comes writes a song (slow), not a mood.
        $p = Catalog::withDefaults($node['type'], $node['params'] ?? []);
        if ($node['type'] === 'audio.music' && $p['source'] === 'song') {
            return 'manual';
        }
        if (in_array($node['type'], ['image.generate', 'image.edit'], true)) {
            $model = $this->modelFor($node);

            return $model && $model['provider'] === 'pod' ? 'auto' : 'manual';
        }

        return 'auto';
    }

    /**
     * How long a run takes, roughly, and what it costs when that's known.
     *
     * @param  array<string, mixed>  $node
     * @return array{seconds: int, cost: float|null, pod: float, model: string|null, unavailable: string|null}
     */
    public function estimate(array $node): array
    {
        $kind = Catalog::node($node['type']);
        $model = $this->modelFor($node);
        $seconds = (int) ($model['capabilities']->seconds ?? $kind['seconds'] ?? 10);
        if ($node['type'] === 'audio.music' && Catalog::withDefaults('audio.music', $node['params'] ?? [])['source'] === 'song') {
            $seconds = 45;
        }
        // Nodes without a model run on this server, the assistant or FlowAI Sound: free. `cost` is what a
        // provider bills; `pod` is the run's share of the pod's hourly rate, which is paid either way.
        $price = 0.0;
        $pod = 0.0;
        if ($model) {
            [$provider] = explode('/', $model['id'], 2);
            $n = max(1, (int) ($node['params']['variations'] ?? 1));
            $price = Pricing::perOutput($provider, $model['id'], (float) ($node['params']['duration'] ?? 0));
            $price = $price === null ? null : $price * $n;
            $pod = in_array($provider, Pricing::POD, true) ? Pricing::podTime($seconds * $n) : 0.0;
        }

        // A model that can't run now says why before anyone presses Run (a key missing, a connector untested).
        return ['seconds' => $seconds, 'cost' => $price, 'pod' => round($pod, 4), 'model' => $model['label'] ?? null, 'unavailable' => $model && ! $model['available'] ? $model['reason'] : null];
    }

    /**
     * The model a node would run on: the one picked, else the first that can run for its kind.
     *
     * @param  array<string, mixed>  $node
     * @return array<string, mixed>|null
     */
    public function modelFor(array $node): ?array
    {
        $kind = Catalog::node($node['type']);
        $field = collect($kind['fields'] ?? [])->firstWhere('kind', 'model');
        if (! $field) {
            // A node made for one model (Higgsfield's tools) runs on that one.
            return isset($kind['model_id']) ? $this->models->find($kind['model_id']) : null;
        }
        $choices = $this->modelsFor($field['models']);
        $picked = $node['params']['model'] ?? null;

        return collect($choices)->firstWhere('id', $picked) ?? collect($choices)->firstWhere('available', true) ?? ($choices[0] ?? null);
    }

    /**
     * The models a node's model field offers, best first: on the pod (free) before the cloud.
     *
     * @return list<array<string, mixed>>
     */
    public function modelsFor(string $which): array
    {
        // Per Engine, so a long-running worker sees models come and go.
        if (isset($this->modelLists[$which])) {
            return $this->modelLists[$which];
        }
        $everything = collect($this->models->all());
        // Higgsfield's own tools (Cinema Studio, Ads Studio, Motion Control…) are only offered on their nodes.
        $all = $everything->filter(fn ($m) => empty($m['capabilities']->feature));
        $takesImage = fn ($m) => (int) ($m['capabilities']->max_inputs ?? 0) > 0 || ! empty($m['capabilities']->requires_image);
        $list = match ($which) {
            'cinema', 'ads', 'motion', 'restyle', 'character' => $everything->filter(fn ($m) => ($m['capabilities']->feature ?? null) === $which),
            'text' => $all->where('kind', 'text'),
            'image' => $all->where('kind', 'image')->reject(fn ($m) => ! empty($m['capabilities']->requires_image)),
            'image_edit' => $all->where('kind', 'image')->filter($takesImage),
            'video_t2v' => $all->where('kind', 'video')->reject(fn ($m) => ! empty($m['capabilities']->requires_image)),
            'video_i2v' => $all->where('kind', 'video')->filter($takesImage),
            default => collect(),
        };
        if ($which === 'text') {
            $default = $this->models->defaultText();
            $list = $list->sortBy(fn ($m) => [$m['available'] ? 0 : 1, $m['id'] === $default ? 0 : 1]);
        } else {
            $list = $list->sortBy(fn ($m) => [$m['available'] ? 0 : 1, $m['provider'] === 'pod' ? 0 : 1]);
        }

        return $this->modelLists[$which] = $list->values()->all();
    }

    /* ------------------------------------------------------------------ */
    /* Running */
    /* ------------------------------------------------------------------ */

    /**
     * What running a node takes: itself, and the nodes before it that have to run first (when
     * `upstream`), with how long and what it costs in all.
     *
     * @return array{nodes: list<array<string, mixed>>, seconds: int, cost: float|null, pod: float, blocked: list<string>}
     */
    public function plan(Project $project, string $nodeId): array
    {
        $canvas = $this->canvas($project);
        $ctx = $this->context($project, $canvas);
        $node = Graph::find($canvas, $nodeId) ?? throw new InvalidArgumentException("There is no node “{$nodeId}”.");
        $needed = $this->needed($ctx, $node);
        $nodes = [];
        $seconds = 0;
        $cost = 0.0;
        $pod = 0.0;
        $known = true;
        foreach ([...$needed['run'], $nodeId] as $id) {
            $n = Graph::find($canvas, $id);
            $e = $this->estimate($n);
            $nodes[] = ['id' => $id, 'type' => $n['type'], 'label' => $n['label'] ?? Catalog::node($n['type'])['label'], ...$e];
            $seconds += $e['seconds'];
            $pod += $e['pod'];
            $e['cost'] === null ? $known = false : $cost += $e['cost'];
        }

        return ['nodes' => $nodes, 'seconds' => $seconds, 'cost' => $known ? round($cost, 4) : null, 'pod' => round($pod, 4), 'blocked' => $needed['blocked']];
    }

    /**
     * The nodes before this one that must run first (in order), and what's missing that no run can
     * give (an empty source, an unconnected required input).
     *
     * @param  array<string, mixed>  $node
     * @return array{run: list<string>, blocked: list<string>}
     */
    private function needed(Context $ctx, array $node, array &$seen = []): array
    {
        $run = [];
        $blocked = [];
        foreach (Catalog::node($node['type'])['inputs'] as $port) {
            $edges = Graph::into($ctx->canvas, $node['id'], $port['name']);
            if (! $edges && ! empty($port['required'])) {
                $blocked[] = Catalog::node($node['type'])['label'].' needs '.mb_strtolower($port['label']).' connected.';
            }
            foreach ($edges as $e) {
                if (isset($seen[$e['from']])) {
                    continue;
                }
                $seen[$e['from']] = true;
                $up = Graph::find($ctx->canvas, $e['from']);
                $state = $this->nodeState($ctx, $up);
                if (in_array($state['status'], ['queued', 'running'], true)) {
                    continue;
                }
                if ($state['status'] === 'done') {
                    // Done, but with something before it out of date (a setting changed two nodes up):
                    // once that runs its input changes, so it runs again after it. A version a person
                    // pinned stays as it is.
                    if ($state['policy'] !== 'none' && ! (isset($up['pin']) && empty($up['soft']))) {
                        $deeper = $this->needed($ctx, $up, $seen);
                        // A run already on its way before it counts too: it changes what this one gets.
                        if ($deeper['run'] || $this->busyUpstream($ctx, $up)) {
                            $run = [...$run, ...$deeper['run'], $up['id']];
                            $blocked = [...$blocked, ...$deeper['blocked']];
                        }
                    }

                    continue;
                }
                if ($state['policy'] === 'none') {
                    $blocked[] = ($up['label'] ?? Catalog::node($up['type'])['label']).' is empty.';

                    continue;
                }
                $deeper = $this->needed($ctx, $up, $seen);
                $run = [...$run, ...$deeper['run'], $up['id']];
                $blocked = [...$blocked, ...$deeper['blocked']];
            }
        }

        return ['run' => array_values(array_unique($run)), 'blocked' => array_values(array_unique($blocked))];
    }

    /**
     * Run a node, with the nodes before it that need to run first when `upstream`. Returns the run.
     *
     * @throws InvalidArgumentException when it can't run, saying why
     */
    public function run(Project $project, string $nodeId, string $by = 'you', bool $upstream = true): NodeRun
    {
        $canvas = $this->canvas($project);
        $ctx = $this->context($project, $canvas);
        $node = Graph::find($canvas, $nodeId) ?? throw new InvalidArgumentException("There is no node “{$nodeId}”.");
        $policy = $this->policy($node);
        if ($policy === 'none') {
            throw new InvalidArgumentException((Catalog::node($node['type'])['label']).' has nothing to run: what it holds goes straight on.');
        }

        $needed = $this->needed($ctx, $node);
        if ($needed['blocked']) {
            throw new InvalidArgumentException(implode(' ', $needed['blocked']));
        }
        if ($needed['run'] && ! $upstream) {
            throw new InvalidArgumentException('Run the nodes before it first: '.collect($needed['run'])->map(fn ($id) => Graph::find($canvas, $id)['label'] ?? $id)->join(', ').'.');
        }
        // A run already waiting or working on this node is superseded by this one.
        foreach ($ctx->runsOf($nodeId)->where('status', 'queued') as $old) {
            $old->update(['status' => 'canceled', 'error' => 'Replaced by a newer run.', 'finished_at' => now()]);
        }
        foreach ($needed['run'] as $id) {
            $up = Graph::find($canvas, $id);
            if (! $ctx->runsOf($id)->contains(fn ($r) => in_array($r->status, ['queued', 'running'], true))) {
                $this->queue($project, $up, $by, after: array_values(array_unique([...$this->waitsOn($ctx, $up, $needed['run']), ...$this->busyUpstream($ctx, $up)])));
            }
        }

        $run = $this->queue($project, $node, $by, after: $this->waitsOn($ctx, $node, [...$needed['run'], ...$this->busyUpstream($ctx, $node)]));
        // What it waits for may have finished already (a quick node, a fast worker): start it then.
        $this->pump($project);

        return $run->fresh() ?? $run;
    }

    /**
     * Its direct inputs among these nodes: what it waits for.
     *
     * @param  array<string, mixed>  $node
     * @param  list<string>  $among
     * @return list<string>
     */
    private function waitsOn(Context $ctx, array $node, array $among): array
    {
        return array_values(array_intersect(Graph::upstream($ctx->canvas, $node['id']), $among));
    }

    /**
     * Nodes before this one that are running right now: it waits for them.
     *
     * @param  array<string, mixed>  $node
     * @return list<string>
     */
    private function busyUpstream(Context $ctx, array $node): array
    {
        return array_values(array_filter(Graph::upstream($ctx->canvas, $node['id']), fn ($id) => $ctx->runsOf($id)->contains(fn ($r) => in_array($r->status, ['queued', 'running'], true))));
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  list<string>  $after  nodes it waits for
     */
    public function queue(Project $project, array $node, string $by, array $after = [], int $delay = 0): NodeRun
    {
        $version = (int) $project->nodeRuns()->where('node_id', $node['id'])->max('version') + 1;
        $run = $project->nodeRuns()->create([
            'user_id' => $project->user_id,
            'node_id' => $node['id'],
            'type' => $node['type'],
            'version' => $version,
            'status' => 'queued',
            'inputs_hash' => '',
            'params' => Catalog::withDefaults($node['type'], $node['params'] ?? []),
            'by' => $by,
            'state' => $after ? ['after' => array_values($after)] : null,
            'stage' => $after ? 'Waiting for the nodes before it' : 'Queued',
        ]);
        if (! $after) {
            RunLabNode::dispatch($run->id)->delay($delay ? now()->addSeconds($delay) : null);
        }

        return $run;
    }

    /**
     * The job: run it now with its inputs as they are.
     */
    public function execute(NodeRun $run): void
    {
        $run->refresh();
        if ($run->status !== 'queued') {
            return;
        }
        $project = $run->project;
        $canvas = $this->canvas($project);
        $node = Graph::find($canvas, $run->node_id);
        if (! $node || $node['type'] !== $run->type) {
            $run->update(['status' => 'canceled', 'error' => 'The node was removed.', 'finished_at' => now()]);
            // Runs waiting for it hear it won't come.
            $this->pump($project);

            return;
        }
        // A newer run for the same node takes over.
        if ($project->nodeRuns()->where('node_id', $run->node_id)->where('id', '>', $run->id)->whereIn('status', ['queued', 'running'])->exists()) {
            $run->update(['status' => 'canceled', 'error' => 'Replaced by a newer run.', 'finished_at' => now()]);

            return;
        }
        $ctx = $this->context($project, $canvas);
        $inputs = $ctx->inputs($node);
        if ($missing = $inputs->missing()) {
            $this->fail($run, implode(' ', $missing));

            return;
        }
        $hash = $ctx->hash($node);
        // An auto run whose result already exists (the same inputs and settings) has nothing to do.
        if ($run->by === 'auto' && ($current = $ctx->current($node)) && $current->inputs_hash === $hash) {
            $run->delete();
            // Runs waiting for this one go ahead with the result already there.
            $this->pump($project);

            return;
        }
        // Taken atomically: the sweep may have queued this run a second time, and two workers must not both run it.
        if (! NodeRun::whereKey($run->id)->where('status', 'queued')->update(['status' => 'running', 'started_at' => now()])) {
            return;
        }
        $params = Catalog::withDefaults($node['type'], $node['params'] ?? []);
        $run->update([
            'status' => 'running', 'started_at' => now(), 'inputs_hash' => $hash, 'params' => $params,
            'inputs' => $inputs->snapshot(), 'stage' => 'Starting', 'error' => null,
        ]);

        $job = new NodeJob($run, $node, $params, $inputs, $project, $this);
        try {
            // Every model call it makes, listening included, counts as this run's in Spending.
            $result = app(UsageMeter::class)->within($job->user(), $run, 'lab', fn () => Executors::for($node['type'])->start($job));
        } catch (NodeFailed|GenerationFailed|InvalidArgumentException $e) {
            $job->discard();
            $this->fail($run, $e->getMessage());

            return;
        } catch (Throwable $e) {
            $job->discard();
            report($e);
            $this->fail($run, 'Something went wrong running it: '.class_basename($e).'. Try again.');

            return;
        }
        if (isset($result['outputs'])) {
            $this->succeed($run, $result['outputs'], $result['cost'] ?? 0);
        }
        // Only now, with every model call made: one that finishes at once can't end the run before the rest exist.
        $job->dispatch();
    }

    /**
     * A generation made for a node finished. When all of the run's have, collect them.
     */
    public function generationSettled(Generation $generation): void
    {
        $run = $generation->nodeRun;
        if (! $run || $run->isFinished()) {
            return;
        }
        $generations = $run->generations()->get();
        if ($generations->contains(fn (Generation $g) => ! $g->isFinished())) {
            $done = $generations->filter(fn (Generation $g) => $g->isFinished())->count();
            $run->update(['stage' => "Made {$done} of {$generations->count()}", 'share' => round($done / max(1, $generations->count()), 3)]);

            return;
        }
        $good = $generations->where('status', 'succeeded');
        if ($good->isEmpty()) {
            $this->fail($run, $generations->firstWhere('status', 'failed')?->error ?? 'The model couldn’t make it.');

            return;
        }
        $project = $run->project;
        $canvas = $this->canvas($project);
        $node = Graph::find($canvas, $run->node_id) ?? ['id' => $run->node_id, 'type' => $run->type, 'params' => $run->params];
        try {
            $outputs = Executors::for($run->type)->collect(new NodeJob($run, $node, $run->params ?? [], null, $project, $this), $good->values());
        } catch (NodeFailed|GenerationFailed $e) {
            $this->fail($run, $e->getMessage());

            return;
        } catch (Throwable $e) {
            report($e);
            $this->fail($run, 'The result came back, but couldn’t be used: '.class_basename($e).'.');

            return;
        }
        $this->succeed($run, $outputs, (float) $good->sum('cost'));
    }

    /**
     * @param  array<string, mixed>  $outputs
     */
    public function succeed(NodeRun $run, array $outputs, float $cost = 0): void
    {
        if ($this->stopped($run)) {
            return;
        }
        $run->update(['status' => 'succeeded', 'outputs' => $outputs, 'cost' => $cost, 'stage' => null, 'share' => 1, 'finished_at' => now()]);
        $project = $run->project()->first();
        $this->unpin($project, $run->node_id);
        rescue(fn () => $this->cascade($project, $run->node_id), report: true);
        rescue(fn () => $this->pump($project), report: true);
    }

    /** A new result is the node's own: any pinned version lets go. */
    private function unpin(Project $project, string $nodeId): void
    {
        DB::transaction(function () use ($project, $nodeId) {
            $fresh = Project::query()->lockForUpdate()->find($project->id);
            $canvas = Graph::normalize($fresh?->canvas);
            $changed = false;
            foreach ($canvas['nodes'] as $i => $n) {
                if ($n['id'] === $nodeId && isset($n['pin'])) {
                    unset($canvas['nodes'][$i]['pin'], $canvas['nodes'][$i]['soft']);
                    $changed = true;
                }
            }
            if ($changed) {
                $canvas['rev']++;
                $fresh->update(['canvas' => $canvas]);
            }
        });
    }

    public function fail(NodeRun $run, string $error): void
    {
        if ($this->stopped($run)) {
            return;
        }
        $run->update(['status' => 'failed', 'error' => mb_substr($error, 0, 2000), 'stage' => null, 'finished_at' => now()]);
        rescue(fn () => $this->pump($run->project()->first()), report: true);
    }

    /** Stopped by a person while it was working: what it was doing ends with it, and the run stays stopped. */
    private function stopped(NodeRun $run): bool
    {
        return NodeRun::whereKey($run->id)->where('status', 'canceled')->exists();
    }

    /**
     * Runs that went quiet: a queued one nobody picked up (a worker restarted) starts again; a running
     * one with no model call still working, past an hour, fails and says so.
     */
    public function sweep(): void
    {
        NodeRun::where('status', 'queued')->whereNull('state')->where('updated_at', '<', now()->subMinutes(15))->get()
            ->each(fn (NodeRun $r) => RunLabNode::dispatch($r->id));
        NodeRun::where('status', 'running')->where('updated_at', '<', now()->subMinutes(60))->get()->each(function (NodeRun $r) {
            if ($r->generations()->whereNotIn('status', ['succeeded', 'failed', 'canceled'])->where('updated_at', '>', now()->subMinutes(30))->exists()) {
                return; // a model is still working on it
            }
            $this->fail($r, 'It stopped answering for an hour. Run it again.');
        });
        // Runs waiting on nodes before them that nothing will ever wake (what they waited for ended without saying so).
        NodeRun::where('status', 'queued')->whereNotNull('state')->where('updated_at', '<', now()->subMinutes(15))->distinct()->pluck('project_id')
            ->each(fn ($id) => ($project = Project::find($id)) && $this->pump($project));
    }

    public function stop(Project $project, string $nodeId): void
    {
        $project->nodeRuns()->where('node_id', $nodeId)->whereIn('status', ['queued', 'running'])->get()->each(function (NodeRun $r) {
            $r->update(['status' => 'canceled', 'error' => 'Stopped.', 'finished_at' => now()]);
            foreach ($r->generations()->whereNotIn('status', ['succeeded', 'failed', 'canceled'])->get() as $g) {
                // The engine's job stops too (the pod's own work with it).
                if ($g->external_id && (str_starts_with($g->model, 'pod/') || str_starts_with($g->model, 'engine/'))) {
                    app(EngineClient::class)->cancel((string) $g->external_id);
                }
                // A Higgsfield request still queued is canceled before it's charged for.
                if ($g->external_id && str_starts_with($g->model, 'higgsfield/') && $g->kind !== 'character') {
                    app(HiggsfieldClient::class)->cancel((string) $g->external_id);
                }
                $g->update(['status' => 'canceled', 'finished_at' => now()]);
            }
        });
        $this->pump($project);
    }

    /**
     * After a node finishes: the auto nodes right after it that are now out of date run again
     * (only with Keep up to date on).
     */
    public function cascade(Project $project, string $nodeId): void
    {
        $canvas = $this->canvas($project);
        if (empty($canvas['auto'])) {
            return;
        }
        $ctx = $this->context($project, $canvas);
        foreach (Graph::next($canvas, $nodeId) as $id) {
            $next = Graph::find($canvas, $id);
            $this->maybeAuto($ctx, $next, 'auto');
        }
    }

    /**
     * After an edit, with Keep up to date on: the touched nodes that run auto, or the auto nodes
     * right after a touched node that has nothing to run (a text, a brief), start a moment later
     * if they're out of date. With it off (the default), nothing runs without a Run.
     *
     * @param  list<string>  $ids
     */
    public function settle(Project $project, array $ids, string $by = 'auto'): void
    {
        $canvas = $this->canvas($project);
        if (empty($canvas['auto'])) {
            return;
        }
        $ctx = $this->context($project, $canvas);
        $candidates = [];
        foreach ($ids as $id) {
            $node = Graph::find($canvas, $id);
            if (! $node) {
                continue;
            }
            if ($this->policy($node) === 'none' || (isset($node['pin']) && empty($node['soft']))) {
                $candidates = [...$candidates, ...Graph::next($canvas, $id)];
            } else {
                $candidates[] = $id;
            }
        }
        foreach (array_unique($candidates) as $id) {
            $node = Graph::find($canvas, $id);
            if ($node) {
                $this->maybeAuto($ctx, $node, 'auto', self::SETTLE_SECONDS);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $node
     */
    private function maybeAuto(Context $ctx, array $node, string $by, int $delay = 0): void
    {
        if ($this->policy($node) !== 'auto' || (isset($node['pin']) && empty($node['soft']))) {
            return; // a version a person pinned stays until they let it go
        }
        // A node runs by itself only once someone ran it: placing one never starts it.
        if (! $ctx->runsOf($node['id'])->contains(fn (NodeRun $r) => $r->by !== 'auto')) {
            return;
        }
        $state = $this->nodeState($ctx, $node);
        if (! in_array($state['status'], ['ready', 'stale'], true)) {
            return;
        }
        // Never retry by itself what just failed with these same inputs.
        $last = $ctx->runsOf($node['id'])->last();
        if ($last && $last->status === 'failed' && $last->inputs_hash === $ctx->hash($node)) {
            return;
        }
        $this->queue($ctx->project, $node, $by, delay: $delay);
    }

    /**
     * Runs waiting for nodes before them: start the ones whose inputs are all done; fail the ones
     * whose inputs failed.
     */
    public function pump(Project $project): void
    {
        $waiting = $project->nodeRuns()->where('status', 'queued')->whereNotNull('state')->get()->filter(fn (NodeRun $r) => ! empty($r->state['after']));
        if ($waiting->isEmpty()) {
            return;
        }
        $canvas = $this->canvas($project);
        $ctx = $this->context($project, $canvas);
        foreach ($waiting as $run) {
            $after = $run->state['after'];
            $stillBusy = false;
            foreach ($after as $id) {
                $latest = $ctx->runsOf($id)->last();
                if ($latest && in_array($latest->status, ['queued', 'running'], true)) {
                    $stillBusy = true;
                } elseif ($latest && in_array($latest->status, ['failed', 'canceled'], true) && ! $ctx->current(Graph::find($canvas, $id) ?? ['id' => $id, 'type' => ''])) {
                    $label = Graph::find($canvas, $id)['label'] ?? $id;
                    $run->update(['status' => 'failed', 'error' => "{$label} didn’t finish: ".($latest->error ?? 'it stopped.'), 'finished_at' => now(), 'stage' => null]);

                    continue 2;
                }
            }
            if (! $stillBusy) {
                $run->update(['state' => null, 'stage' => 'Queued']);
                RunLabNode::dispatch($run->id);
            }
        }
    }

    /**
     * The current run of every node that has one.
     *
     * @param  array<string, mixed>  $canvas
     * @return array<string, NodeRun>
     */
    public function currentRuns(Project $project, array $canvas): array
    {
        $ctx = $this->context($project, $canvas);
        $out = [];
        foreach ($canvas['nodes'] as $n) {
            if ($r = $ctx->current($n)) {
                $out[$n['id']] = $r;
            }
        }

        return $out;
    }

    /**
     * What a node with nothing to run holds, as outputs.
     *
     * @param  array<string, mixed>  $node
     * @return array<string, mixed>
     */
    public function instantOutputs(Project $project, array $node): array
    {
        return Instant::outputs($project, $node);
    }

    /**
     * All runs of a node, newest first, for its history.
     *
     * @return Collection<int, NodeRun>
     */
    public function history(Project $project, string $nodeId): Collection
    {
        return $project->nodeRuns()->where('node_id', $nodeId)->latest('id')->limit(50)->get();
    }

    public function user(Project $project): User
    {
        return $project->user;
    }
}

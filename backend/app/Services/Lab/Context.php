<?php

namespace App\Services\Lab;

use App\Models\NodeRun;
use App\Models\Project;
use Illuminate\Support\Collection;

/**
 * One look at a project: its canvas and runs, with each node's outputs, inputs and hash worked out
 * once. Made fresh for every request or job; never kept.
 */
class Context
{
    /** @var array<string, Collection<int, NodeRun>> */
    private array $byNode;

    /** @var array<string, array<string, mixed>> */
    private array $outputs = [];

    /** @var array<string, Inputs> */
    private array $inputs = [];

    /** @var array<string, string> */
    private array $hashes = [];

    /**
     * @param  array<string, mixed>  $canvas
     * @param  Collection<int, NodeRun>  $runs
     */
    public function __construct(public readonly Engine $engine, public readonly Project $project, public readonly array $canvas, Collection $runs)
    {
        $this->byNode = $runs->groupBy('node_id')->map(fn ($g) => $g->values())->all();
        $this->runsById = $runs->keyBy('id');
    }

    /** @var Collection<int, NodeRun> */
    private Collection $runsById;

    /**
     * @return Collection<int, NodeRun>
     */
    public function runsOf(string $nodeId): Collection
    {
        return $this->byNode[$nodeId] ?? collect();
    }

    /**
     * The run whose outputs the node passes on: the pinned one, else its newest good one.
     *
     * @param  array<string, mixed>  $node
     */
    public function current(array $node): ?NodeRun
    {
        if (isset($node['pin']) && ($pinned = $this->runsById->get((int) $node['pin'])) && $pinned->status === 'succeeded') {
            return $pinned;
        }

        return $this->runsOf($node['id'])->last(fn (NodeRun $r) => $r->status === 'succeeded');
    }

    /**
     * @return array<string, mixed> keyed by output port
     */
    public function outputs(string $nodeId): array
    {
        if (array_key_exists($nodeId, $this->outputs)) {
            return $this->outputs[$nodeId];
        }
        $node = Graph::find($this->canvas, $nodeId);
        if (! $node) {
            return $this->outputs[$nodeId] = [];
        }
        $out = $this->engine->policy($node) === 'none'
            ? $this->engine->instantOutputs($this->project, $node)
            : ($this->current($node)?->outputs ?? []);

        return $this->outputs[$nodeId] = $out;
    }

    /**
     * @param  array<string, mixed>  $node
     */
    public function inputs(array $node): Inputs
    {
        return $this->inputs[$node['id']] ??= Inputs::resolve($this, $node);
    }

    /**
     * What it would run with now, hashed: its kind, its settings and its inputs.
     *
     * @param  array<string, mixed>  $node
     */
    public function hash(array $node): string
    {
        return $this->hashes[$node['id']] ??= sha1(json_encode([
            $node['type'],
            Catalog::withDefaults($node['type'], $node['params'] ?? []),
            $this->inputs($node)->identity(),
        ], JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION));
    }
}

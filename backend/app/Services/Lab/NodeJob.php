<?php

namespace App\Services\Lab;

use App\Jobs\RunGeneration;
use App\Models\Generation;
use App\Models\NodeRun;
use App\Models\Project;
use App\Models\User;

/**
 * One run of one node, as its executor sees it: the run, the node, its settings and inputs, and a
 * few helpers (showing where it has got, starting a model call).
 */
class NodeJob
{
    /** @var list<int> generations made by start(), sent off once it returns (dispatch) */
    private array $made = [];

    /**
     * @param  array<string, mixed>  $node
     * @param  array<string, mixed>  $params  with defaults filled in
     */
    public function __construct(
        public readonly NodeRun $run,
        public readonly array $node,
        public readonly array $params,
        public readonly ?Inputs $inputs,
        public readonly Project $project,
        public readonly Engine $engine,
    ) {}

    public function user(): User
    {
        return $this->project->user;
    }

    public function stage(string $stage, ?float $share = null): void
    {
        $this->run->update(['stage' => mb_substr($stage, 0, 160), 'share' => $share === null ? null : max(0, min(1, $share))]);
    }

    /**
     * A model call made for this run, queued once start() returns (dispatch): the run waits for it
     * (Engine::generationSettled).
     *
     * @param  array<string, mixed>  $params
     * @param  list<int>  $inputs  asset ids
     */
    public function generate(string $kind, string $model, string $prompt, array $params = [], array $inputs = []): Generation
    {
        $generation = $this->user()->generations()->create([
            'project_id' => $this->project->id,
            'node_run_id' => $this->run->id,
            'kind' => $kind,
            'model' => $model,
            'prompt' => mb_substr($prompt !== '' ? $prompt : '(no prompt)', 0, 4000),
            'params' => $params,
            'input_asset_ids' => $inputs ?: null,
            'status' => 'queued',
        ]);
        $this->made[] = $generation->id;

        return $generation;
    }

    /** Send off the model calls start() made. */
    public function dispatch(): void
    {
        foreach ($this->made as $id) {
            RunGeneration::dispatch($id);
        }
        $this->made = [];
    }

    /** start() failed after making some: they never go out (nor cost anything). */
    public function discard(): void
    {
        if ($this->made) {
            Generation::whereIn('id', $this->made)->update(['status' => 'canceled', 'finished_at' => now()]);
            $this->made = [];
        }
    }

    public function label(): string
    {
        return $this->node['label'] ?? Catalog::node($this->node['type'])['label'];
    }
}

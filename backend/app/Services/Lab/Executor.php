<?php

namespace App\Services\Lab;

use App\Models\Asset;
use App\Models\Generation;
use App\Services\Ai\Models\ModelRegistry;
use Illuminate\Support\Collection;

/**
 * What a kind of node does when it runs. start() either finishes (['outputs' => [...]]) or starts
 * model calls (NodeJob::generate) and returns ['wait' => true]; then collect() turns the finished
 * generations into outputs. Throw NodeFailed with a message for the person when it can't.
 */
abstract class Executor
{
    /**
     * @return array{outputs?: array<string, mixed>, wait?: bool, cost?: float}
     */
    abstract public function start(NodeJob $job): array;

    /**
     * The generations' files, onto the node's output ports by kind.
     *
     * @param  Collection<int, Generation>  $generations
     * @return array<string, mixed>
     */
    public function collect(NodeJob $job, Collection $generations): array
    {
        $ids = $generations->flatMap(fn (Generation $g) => $g->output_asset_ids ?? [])->map(fn ($id) => (int) $id)->values()->all();
        $kinds = Asset::whereIn('id', $ids)->pluck('kind', 'id');
        $texts = $generations->pluck('output_text')->filter()->join("\n\n");
        $out = [];
        foreach (Catalog::node($job->node['type'])['outputs'] as $port) {
            $out[$port['name']] = $port['type'] === 'text'
                ? ['type' => 'text', 'text' => $texts]
                : ['type' => $port['type'], 'assets' => array_values(array_filter($ids, fn ($id) => ($kinds[$id] ?? null) === $port['type']))];
        }

        return $out;
    }

    /**
     * Outputs for one asset on the port of its kind (the others empty).
     *
     * @return array<string, mixed>
     */
    protected function assetOutputs(NodeJob $job, Asset ...$assets): array
    {
        $out = [];
        foreach (Catalog::node($job->node['type'])['outputs'] as $port) {
            $out[$port['name']] = ['type' => $port['type'], 'assets' => array_values(array_map(fn (Asset $a) => $a->id, array_filter($assets, fn (Asset $a) => $a->kind === $port['type'])))];
        }

        return $out;
    }

    /**
     * The brief connected to the node, as the node uses it (its brief_use setting).
     *
     * @return array<string, mixed>|null
     */
    protected function brief(NodeJob $job): ?array
    {
        return Brief::using($job->inputs?->brief(), (string) ($job->params['brief_use'] ?? 'both'));
    }

    /**
     * A prompt from the node's own field, else from what's connected, with the brief's {variables}
     * filled in and its style added for pictures and video.
     */
    protected function prompt(NodeJob $job, string $field, string $port, bool $style = false): string
    {
        $brief = $this->brief($job);
        $own = trim((string) ($job->params[$field] ?? ''));
        $connected = $job->inputs?->text($port) ?? '';
        $prompt = trim(implode("\n", array_filter([$connected, $own])));
        $prompt = Brief::fill($prompt, $brief);
        if ($style && ($words = Brief::styleWords($brief)) !== '') {
            $prompt = trim($prompt.($prompt !== '' ? '. ' : '').'Style: '.$words);
        }

        return $prompt;
    }

    /**
     * A model by id that must be able to run now.
     *
     * @return array<string, mixed>
     */
    protected function model(string $id): array
    {
        $m = app(ModelRegistry::class)->find($id) ?? throw new NodeFailed("There is no model {$id}.");
        if (! $m['available']) {
            throw new NodeFailed("{$m['label']} isn’t available: {$m['reason']}");
        }

        return $m;
    }

    /**
     * The node's chosen model (or the best that can run), which must be able to run now.
     *
     * @return array<string, mixed>
     */
    protected function nodeModel(NodeJob $job): array
    {
        $m = $job->engine->modelFor($job->node) ?? throw new NodeFailed('No model can do this yet. Set one up under Models.');
        if (! $m['available']) {
            throw new NodeFailed("{$m['label']} isn’t available: {$m['reason']}");
        }

        return $m;
    }

    /**
     * What a video made from another one carries on: where it came from, and the credit its caption owes.
     *
     * @return array<string, mixed>
     */
    protected function inherit(?Asset $from): array
    {
        return array_intersect_key($from?->meta ?? [], array_flip(['credit', 'video_source_id', 'source_url']));
    }

    protected function media(): Media
    {
        return app(Media::class);
    }
}

<?php

namespace App\Services\Lab\Nodes;

use App\Models\Generation;
use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;
use Illuminate\Support\Collection;

/**
 * Character: Higgsfield Soul ID, trained from photos of one person. What it passes
 * on is the character (its id at Higgsfield, for Character pictures) and how it looks.
 */
class Character extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->nodeModel($job);
        $photos = $job->inputs->assetIds('photos', ['image']);
        if (! $photos) {
            throw new NodeFailed('Connect photos of the person.');
        }
        $name = trim((string) ($job->params['name'] ?? '')) ?: 'Character '.$job->node['id'];
        $job->stage('Training '.$name.' on '.count($photos).' photo'.(count($photos) === 1 ? '' : 's').' (a few minutes)');
        $job->generate('character', $model['id'], $name, ['name' => $name, 'version' => $job->params['version'] ?: 'v2'], array_slice($photos, 0, 100));

        return ['wait' => true];
    }

    /**
     * @param  Collection<int, Generation>  $generations
     * @return array<string, mixed>
     */
    public function collect(NodeJob $job, Collection $generations): array
    {
        $g = $generations->first();
        $look = array_map('intval', $g->output_asset_ids ?? []);

        return [
            'character' => ['type' => 'character', 'reference_id' => (string) $g->external_id, 'version' => (string) ($g->params['version'] ?? 'v2'), 'name' => (string) ($g->params['name'] ?? 'Character'), 'assets' => $look],
            'image' => ['type' => 'image', 'assets' => $look],
        ];
    }
}

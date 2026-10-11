<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Character picture: a Soul picture of the trained character, on the Soul model it was trained for
 * (Soul 2, Soul Cinema or Soul), one or four at a time.
 */
class CharacterPicture extends Executor
{
    private const MODELS = ['v2' => 'higgsfield/soul-v2', 'cinema' => 'higgsfield/soul-cinema', 'v1' => 'higgsfield/soul'];

    public function start(NodeJob $job): array
    {
        $character = $job->inputs->character() ?? throw new NodeFailed('Connect a trained Character.');
        $model = $this->model(self::MODELS[$character['version']] ?? self::MODELS['v2']);
        $prompt = $this->prompt($job, 'prompt', 'prompt', style: true);
        if ($prompt === '') {
            throw new NodeFailed('Describe the scene, or connect a prompt.');
        }
        $p = $job->params;
        $n = (int) ($p['variations'] ?? 1) === 4 ? 4 : 1;
        $job->stage('Picturing '.($character['name'] ?: 'the character').' with '.$model['label']);
        $job->generate('image', $model['id'], $prompt, [
            'aspect_ratio' => $p['aspect'] ?: '3:4',
            'batch_size' => $n,
            'custom_reference_id' => $character['reference_id'],
            'custom_reference_strength' => max(0.0, min(1.0, (float) ($p['likeness'] ?? 1))),
        ]);

        return ['wait' => true];
    }
}

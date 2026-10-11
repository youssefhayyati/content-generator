<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/** Picture: a new picture from a prompt (and references, for models that take them). */
class Picture extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->nodeModel($job);
        $prompt = $this->prompt($job, 'prompt', 'prompt', style: true);
        if ($prompt === '') {
            throw new NodeFailed('Write a prompt, or connect one.');
        }
        $p = $job->params;
        $refs = (int) ($model['capabilities']->max_inputs ?? 0) > 0 ? array_slice($job->inputs->assetIds('reference', ['image']), 0, (int) $model['capabilities']->max_inputs) : [];
        $n = max(1, min(4, (int) ($p['variations'] ?? 1)));
        $params = array_filter(['aspect_ratio' => $p['aspect'] ?? null, 'negative_prompt' => $p['avoid'] ?: null]);
        $job->stage('Making '.($n > 1 ? "{$n} pictures" : 'the picture').' with '.$model['label']);
        if ((int) ($model['capabilities']->max_outputs ?? 1) >= $n && $n > 1) {
            $job->generate('image', $model['id'], $prompt, [...$params, 'batch_size' => $n], $refs);
        } else {
            for ($i = 0; $i < $n; $i++) {
                $job->generate('image', $model['id'], $prompt, $params, $refs);
            }
        }

        return ['wait' => true];
    }
}

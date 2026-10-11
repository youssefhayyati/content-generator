<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Brief;
use App\Services\Lab\Executor;
use App\Services\Lab\Graph;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Picture: a new picture from a prompt (and references, for models that take them). A picture whose
 * words are drawn on it afterwards (it goes into Text over it) asks for none in it: a name in the
 * prompt ("Ember & Fig") otherwise comes back lettered on the label, under the headline.
 */
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
        $avoid = array_filter([trim((string) ($p['avoid'] ?? '')), Brief::avoidWords($this->brief($job))]);
        if ($this->wordsGoOver($job)) {
            $prompt .= '. No text, letters, labels or logos anywhere in the picture: the words are added afterwards.';
            $avoid[] = 'text, letters, words, labels, logo, watermark';
        }
        $refs = (int) ($model['capabilities']->max_inputs ?? 0) > 0 ? array_slice($job->inputs->assetIds('reference', ['image']), 0, (int) $model['capabilities']->max_inputs) : [];
        $n = max(1, min(4, (int) ($p['variations'] ?? 1)));
        $params = array_filter(['aspect_ratio' => $p['aspect'] ?? null, 'negative_prompt' => implode(', ', $avoid) ?: null]);
        $job->stage('Making '.($n > 1 ? "{$n} pictures" : 'the picture').' with '.$model['label']);
        // One request for them all when the model makes that many at once (Soul: 1 or 4), else one each.
        $sizes = (array) ($model['capabilities']->batch_sizes ?? []);
        if ($n > 1 && (int) ($model['capabilities']->max_outputs ?? 1) >= $n && (! $sizes || in_array($n, $sizes, true))) {
            $job->generate('image', $model['id'], $prompt, [...$params, 'batch_size' => $n], $refs);
        } else {
            for ($i = 0; $i < $n; $i++) {
                $job->generate('image', $model['id'], $prompt, $params, $refs);
            }
        }

        return ['wait' => true];
    }

    /** Whether the picture goes into Text over it, its words drawn on it there. */
    private function wordsGoOver(NodeJob $job): bool
    {
        $canvas = Graph::normalize($job->project->canvas);

        return collect($canvas['edges'])->contains(fn ($e) => $e['from'] === $job->node['id'] && (Graph::find($canvas, $e['to'])['type'] ?? null) === 'finish.design');
    }
}

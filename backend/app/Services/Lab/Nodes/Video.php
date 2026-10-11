<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/** Video (from a prompt) and Animate picture (from a still and a prompt). */
class Video extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->nodeModel($job);
        $animate = $job->node['type'] === 'video.animate';
        $prompt = $this->prompt($job, 'prompt', 'prompt', style: ! $animate);
        $inputs = [];
        $params = ['duration' => (int) ($job->params['duration'] ?? 5)];
        if ($animate) {
            $image = $job->inputs->asset('image', ['image']) ?? throw new NodeFailed('Connect the picture to animate.');
            $inputs = [$image->id];
            if ($ratio = $image->ratio()) {
                $params['aspect_ratio'] = EditPicture::nearest($ratio);
            }
            if ($prompt === '') {
                $prompt = 'Subtle, natural motion; a slow cinematic camera move.';
            }
        } else {
            if ($prompt === '') {
                throw new NodeFailed('Write a prompt, or connect one.');
            }
            $params['aspect_ratio'] = $job->params['aspect'] ?? '9:16';
        }
        // Durations the model takes: the nearest one.
        if ($durations = (array) ($model['capabilities']->durations ?? [])) {
            $params['duration'] = collect($durations)->sortBy(fn ($d) => abs($d - $params['duration']))->first();
        }
        $job->stage(($animate ? 'Animating' : 'Making the video').' with '.$model['label']);
        $job->generate('video', $model['id'], $prompt, $params, $inputs);

        return ['wait' => true];
    }
}

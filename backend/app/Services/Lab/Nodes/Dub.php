<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Dub: the video says new words in its speaker's own voice (cloned from it) or a chosen one, and
 * LatentSync on the pod redraws the lips to match.
 */
class Dub extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->model('pod/latentsync');
        $video = $job->inputs->asset('video', ['video']) ?? throw new NodeFailed('Connect the video.');
        $script = $this->prompt($job, 'script', 'script');
        if ($script === '') {
            throw new NodeFailed('Write what they say now, or connect it (a Translate node, for one).');
        }
        if (($video->duration ?? 0) > 90) {
            throw new NodeFailed('Dubbing takes videos up to 90 seconds. Cut it shorter first.');
        }
        $job->stage('Dubbing');
        $job->generate('dub', $model['id'], $script, array_filter(['voice' => $job->params['voice'] ?: null]), [$video->id]);

        return ['wait' => true];
    }
}

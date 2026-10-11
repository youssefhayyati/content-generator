<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/** Face swap: the face from one picture on the person in a picture or video (inswapper, on the pod). */
class Swap extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->model('pod/faceswap');
        $face = $job->inputs->asset('face', ['image']) ?? throw new NodeFailed('Connect a picture of the face.');
        $target = $job->inputs->asset('target', ['image', 'video']) ?? throw new NodeFailed('Connect what to put the face on.');
        if ($target->kind === 'video' && ($target->duration ?? 0) > 120) {
            throw new NodeFailed('Face swaps take videos up to 2 minutes. Cut it shorter first.');
        }
        $job->stage('Swapping the face');
        $job->generate('swap', $model['id'], 'Face swap', ['every' => (bool) ($job->params['every'] ?? false)], [$face->id, $target->id]);

        return ['wait' => true];
    }
}

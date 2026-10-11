<?php

namespace App\Services\Lab\Nodes;

use App\Models\Asset;
use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Paint to change: only the painted part of the picture is sent to the editing model and pasted back
 * (assistant/backend/retouch.py), so the rest stays exactly as it was.
 */
class Paint extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->model('engine/retouch');
        $image = $job->inputs->asset('image', ['image']) ?? throw new NodeFailed('Connect the picture.');
        $mask = ! empty($job->params['mask']) ? Asset::where('user_id', $job->project->user_id)->find((int) $job->params['mask']) : null;
        if (! $mask) {
            throw new NodeFailed('Paint over the part to change first (open the node and paint on the picture).');
        }
        $mode = (string) ($job->params['mode'] ?? 'remove');
        $prompt = trim((string) ($job->params['prompt'] ?? ''));
        if (in_array($mode, ['replace', 'change'], true) && $prompt === '') {
            throw new NodeFailed('Say what it becomes.');
        }
        $job->stage('Changing the painted part');
        $job->generate('retouch', $model['id'], $prompt, ['mode' => $mode], [$image->id, $mask->id]);

        return ['wait' => true];
    }
}

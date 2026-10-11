<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\Media;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Restyle video: Higgsfield Genjutsu Restyle. The video in the look picked (one of Higgsfield's presets),
 * its motion, framing and sound kept; pictures of the people (up to 5) guide how they look.
 */
class Restyle extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->nodeModel($job);
        $style = trim((string) ($job->params['style'] ?? ''));
        if ($style === '') {
            throw new NodeFailed('Pick a look.');
        }
        $video = $job->inputs->asset('video', ['video']) ?? throw new NodeFailed('Connect the video to restyle.');
        $seconds = (float) ($video->duration ?: Media::probe(Media::path($video))['duration']);
        if ($seconds > 0 && $seconds < 4) {
            throw new NodeFailed('Restyling takes videos of 4 seconds or more.');
        }
        $people = array_slice($job->inputs->assetIds('people', ['image']), 0, 5);
        $job->stage('Restyling'.($seconds > 30.5 ? ' the first 30 seconds' : '').' with '.$model['label']);
        $job->generate('video', $model['id'], $this->prompt($job, 'prompt', 'prompt'), [
            'preset_id' => $style,
            'resolution' => $job->params['resolution'] ?: '720p',
        ], [$video->id, ...$people]);

        return ['wait' => true];
    }
}

<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\Media;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Copy the moves: Kling Motion Control on Higgsfield. The person in the picture does what's done in
 * the video, for as long as the video lasts (3 to 30 seconds; 10 when the picture's framing is kept).
 */
class Motion extends Executor
{
    public function start(NodeJob $job): array
    {
        if (empty($job->params['consent'])) {
            throw new NodeFailed('Tick that the person in the picture agreed to it.');
        }
        $model = $this->nodeModel($job);
        $image = $job->inputs->asset('image', ['image']) ?? throw new NodeFailed('Connect the picture of who moves.');
        $video = $job->inputs->asset('video', ['video']) ?? throw new NodeFailed('Connect the video with the moves.');
        $follow = ($job->params['follow'] ?? 'video') === 'image' ? 'image' : 'video';
        $seconds = (float) ($video->duration ?: Media::probe(Media::path($video))['duration']);
        $max = $follow === 'image' ? 10 : 30;
        if ($seconds > 0 && $seconds < 3) {
            throw new NodeFailed('The moves video is too short: it takes 3 to '.$max.' seconds.');
        }
        if ($seconds > $max + 0.5) {
            throw new NodeFailed('The moves video is '.round($seconds).' s: it takes up to '.$max.' s'.($follow === 'image' ? ' when the picture’s framing is kept' : '').'. Cut it shorter first (Cut & reframe).');
        }
        $job->stage('Copying the moves with '.$model['label']);
        $job->generate('video', $model['id'], $this->prompt($job, 'prompt', 'prompt'), [
            'character_orientation' => $follow,
            'keep_original_sound' => ($job->params['sound'] ?? true) ? 'yes' : 'no',
        ], [$image->id, $video->id]);

        return ['wait' => true];
    }
}

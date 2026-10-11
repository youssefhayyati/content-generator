<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\Media;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/** Frame from video: one still, for a cover or to edit and animate. */
class Frame extends Executor
{
    public function start(NodeJob $job): array
    {
        $video = $job->inputs->asset('video', ['video']) ?? throw new NodeFailed('Connect the video.');
        $path = Media::path($video);
        $info = Media::probe($path);
        $at = $job->params['at'] ?? null;
        $at = $at === null || $at === '' ? $info['duration'] / 3 : min((float) $at, max(0, $info['duration'] - 0.05));
        $out = Media::tmp('png');
        Media::ffmpeg(['-ss', sprintf('%.3f', $at), '-i', $path, '-frames:v', '1', $out], 'take the frame');
        $asset = $this->media()->keep($job->user(), $out, 'image/png', 'frame-'.round($at, 1).'s.png', ['from_asset' => $video->id, 'at' => round($at, 3)]);

        return ['outputs' => $this->assetOutputs($job, $asset)];
    }
}

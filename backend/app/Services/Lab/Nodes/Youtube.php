<?php

namespace App\Services\Lab\Nodes;

use App\Models\VideoSource;
use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;
use App\Services\Lab\VideoSources;

/**
 * YouTube video: downloads, once a person has recorded the permission, the sound (and the whole video
 * when it's ten minutes or less) and YouTube's own captions. The parts that get cut are downloaded by
 * the Cut node, only those.
 */
class Youtube extends Executor
{
    public function __construct(private readonly VideoSources $sources) {}

    public function start(NodeJob $job): array
    {
        $id = $job->params['source_id'] ?? null;
        $source = $id ? VideoSource::where('user_id', $job->project->user_id)->find($id) : null;
        if (! $source) {
            $url = trim((string) ($job->params['url'] ?? ''));
            if ($url === '') {
                throw new NodeFailed('Paste the video’s link.');
            }
            $job->stage('Reading the video’s details');
            $source = $this->sources->inspect($job->user(), $url);
        }
        if ($source->permission === 'denied') {
            throw new NodeFailed('This video was marked as not ours to use.');
        }
        if (! $source->allowed()) {
            throw new NodeFailed('Record whose video this is (open the node), then fetch it.');
        }
        $source = $this->sources->fetch($source, fn ($stage, $share) => $job->stage($stage, $share));

        return ['outputs' => [
            'source' => ['type' => 'source', 'source_id' => $source->id, 'title' => $source->title, 'duration' => $source->duration],
            'audio' => ['type' => 'audio', 'assets' => array_filter([$source->audio_asset_id])],
            'video' => ['type' => 'video', 'assets' => array_filter([$source->video_asset_id])],
        ]];
    }
}

<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\Media;
use App\Services\Lab\NodeJob;

/** Music: FlowAI Sound's composer (a mood), or ACE-Step on the pod (a song to a description). */
class Music extends Executor
{
    public function start(NodeJob $job): array
    {
        $p = $job->params;
        $seconds = $p['seconds'] ?? null;
        if (($video = $job->inputs->asset('video', ['video'])) && ($seconds === null || $seconds === '' || $job->inputs->has('video'))) {
            $seconds = ceil(Media::probe(Media::path($video))['duration']) + 1;
        }
        $seconds = max(5, min(180, (float) ($seconds ?: 30)));
        $brief = $this->brief($job);

        if (($p['source'] ?? 'composer') === 'song') {
            $model = $this->model('pod/acestep');
            $description = trim((string) ($p['description'] ?? '')) ?: trim(implode(', ', array_filter([$brief['tone'] ?? null, 'instrumental background music for a social video'])));
            $job->stage('Writing the song');
            $job->generate('song', $model['id'], $description, ['seconds' => $seconds, 'seed' => random_int(1, 2_000_000_000)]);
        } else {
            $model = $this->model('sound/composer');
            $job->stage('Composing');
            $job->generate('music', $model['id'], 'Music: '.($p['mood'] ?? 'golden-hour'), ['mood' => $p['mood'] ?? 'golden-hour', 'seconds' => $seconds]);
        }

        return ['wait' => true];
    }
}

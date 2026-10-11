<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/** Reel look: FlowAI Sound's reel renderer (Bold, Editorial, Pulse) over a voice or a track. */
class Reel extends Executor
{
    public function start(NodeJob $job): array
    {
        $p = $job->params;
        $sound = $job->inputs->asset('sound', ['audio']) ?? throw new NodeFailed('Connect a voice or a track.');
        $background = $job->inputs->asset('background', ['image', 'video']);
        $music = $job->inputs->asset('music', ['audio']);
        $job->stage('Rendering the reel');
        $job->generate('reel', 'studio/reel', (string) ($p['title'] ?: 'Reel'), array_filter([
            'style' => $p['style'] ?? 'bold',
            'accent' => $p['accent'] ?? null,
            'title' => $p['title'] ?: null,
            'captions' => (bool) ($p['captions'] ?? true),
            'music_volume' => isset($p['music_volume']) ? (float) $p['music_volume'] : null,
            'music_asset_id' => $music?->id,
        ], fn ($v) => $v !== null), array_values(array_filter([$sound->id, $background?->id])));

        return ['wait' => true];
    }
}

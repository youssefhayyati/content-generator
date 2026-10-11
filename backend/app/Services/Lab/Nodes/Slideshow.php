<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Brief;
use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Pictures to video: the assistant's video maker (assistant/backend/reel.py). Each picture moves while
 * the voice reads its line, with captions, music that steps aside for the voice, and an end card.
 */
class Slideshow extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->model('engine/slideshow');
        $p = $job->params;
        $images = $job->inputs->assetIds('images', ['image']);
        if (! $images) {
            throw new NodeFailed('Connect the pictures.');
        }
        $text = trim((string) ($p['lines'] ?? '')) ?: $job->inputs->text('lines');
        $lines = array_values(array_filter(array_map('trim', preg_split('/\R+/', Brief::fill($text, $job->inputs->brief())) ?: [])));
        // No lines: the pictures move to the music alone.
        $music = $job->inputs->assetIds('music', ['audio']);
        $job->stage('Sending the pictures');
        $job->generate('slideshow', $model['id'], $lines ? implode(' / ', $lines) : 'Pictures in motion', array_filter([
            'lines' => $lines ?: null,
            'voice' => $p['voice'] ?: null,
            'music' => $music ? 'track' : ($p['music'] ?? 'golden-hour'),
            'song' => $p['song'] ?: null,
            'cta' => Brief::fill((string) ($p['cta'] ?? ''), $job->inputs->brief()) ?: null,
            'captions' => (bool) ($p['captions'] ?? true),
            'motion' => $p['motion'] ?? 'auto',
            'platform' => $p['platform'] ?? 'instagram',
        ], fn ($v) => $v !== null), [...$images, ...array_slice($music, 0, 1)]);

        return ['wait' => true];
    }
}

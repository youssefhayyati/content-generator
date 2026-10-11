<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Catalog;
use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Cinematic shot: Higgsfield Cinema Studio. The prompt (with the brief's look) and the director's
 * choices (the camera move, genre, lens, film, grade…); what's left empty it chooses itself. Pictures
 * connected to In the shot make it reference-to-video.
 */
class Cinema extends Executor
{
    /** The node's settings, by the name Cinema Studio gives them. */
    private const CHOICES = ['camera' => 'camera_movement', 'genre' => 'genre', 'grade' => 'color_palette', 'lens' => 'camera_lens', 'film' => 'camera_model', 'focus' => 'camera_aperture', 'light' => 'light', 'pacing' => 'pacing', 'era' => 'era'];

    public function start(NodeJob $job): array
    {
        $model = $this->nodeModel($job);
        $prompt = $this->prompt($job, 'prompt', 'prompt', style: true);
        if ($prompt === '') {
            throw new NodeFailed('Describe the shot, or connect a prompt.');
        }
        $p = $job->params;
        $refs = array_slice($job->inputs->assetIds('reference', ['image']), 0, 30);
        $params = [
            'aspect_ratio' => $p['aspect'] ?: '9:16',
            'duration' => max(4, min(30, (int) ($p['duration'] ?: 6))),
            'resolution' => $p['resolution'] ?: '720p',
            'generate_audio' => (bool) ($p['sound'] ?? true),
        ];
        foreach (self::CHOICES as $key => $name) {
            if (filled($p[$key] ?? null)) {
                $params[$name] = (string) $p[$key];
            }
        }
        $move = Catalog::CAMERA_MOVES[$p['camera'] ?? ''] ?? null;
        $job->stage('Shooting'.($move ? ' a '.mb_strtolower($move) : '').' with '.$model['label']);
        $job->generate('video', $model['id'], $prompt, $params, $refs);

        return ['wait' => true];
    }
}

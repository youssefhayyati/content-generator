<?php

namespace App\Services\Lab\Nodes;

use App\Services\Ai\Models\ModelRegistry;
use App\Services\Lab\Executor;
use App\Services\Lab\Media;
use App\Services\Lab\NodeJob;

/**
 * Music: ACE-Step on the pod (a song to a description), or one of six moods: FlowAI Sound's
 * composer when the local sound service runs, else the mood written as a song on the pod.
 */
class Music extends Executor
{
    /** Each mood as a song description for ACE-Step. */
    private const MOODS = [
        'golden-hour' => 'warm lo-fi hip hop, mellow keys, soft vinyl crackle, golden hour',
        'linen' => 'airy ambient, soft pads, gentle piano, calm and light',
        'atelier' => 'bright acoustic, fingerpicked guitar, light percussion, cheerful',
        'pulse' => 'upbeat house, four-on-the-floor, punchy bass, energetic',
        'night-drive' => 'synthwave, retro analog synths, driving bassline, neon night',
        'bloom' => 'dreamy cinematic, swelling strings, soft piano, hopeful',
    ];

    public function start(NodeJob $job): array
    {
        $p = $job->params;
        $seconds = $p['seconds'] ?? null;
        if (($video = $job->inputs->asset('video', ['video'])) && ($seconds === null || $seconds === '' || $job->inputs->has('video'))) {
            $seconds = ceil(Media::probe(Media::path($video))['duration']) + 1;
        }
        $seconds = max(5, min(180, (float) ($seconds ?: 30)));
        $brief = $this->brief($job);
        $mood = (string) ($p['mood'] ?? 'golden-hour');
        $own = trim((string) ($p['description'] ?? ''));

        $composer = app(ModelRegistry::class)->find('sound/composer');
        if (($p['source'] ?? 'song') === 'composer' && $own === '' && ($composer['available'] ?? false)) {
            $job->stage('Composing');
            $job->generate('music', $composer['id'], 'Music: '.$mood, ['mood' => $mood, 'seconds' => $seconds]);

            return ['wait' => true];
        }

        $model = $this->model('pod/acestep');
        $description = match (true) {
            $own !== '' => $own,
            ($p['source'] ?? 'song') === 'composer' => (self::MOODS[$mood] ?? self::MOODS['golden-hour']).', instrumental background music for a social video',
            default => trim(implode(', ', array_filter([$brief['tone'] ?? null, 'instrumental background music for a social video']))),
        };
        $job->stage('Writing the song');
        $job->generate('song', $model['id'], $description, ['seconds' => $seconds, 'seed' => random_int(1, 2_000_000_000)]);

        return ['wait' => true];
    }
}

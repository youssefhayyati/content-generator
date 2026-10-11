<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\Media;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Add sound: music or a voice laid on a video. Under its own sound, what's added steps aside
 * whenever someone speaks (a sidechain compressor keyed by the video's sound); instead of it, it
 * replaces it; together, both play as they are. What's added fades out at the end.
 */
class Mix extends Executor
{
    public function start(NodeJob $job): array
    {
        $video = $job->inputs->asset('video', ['video']) ?? throw new NodeFailed('Connect the video.');
        $sounds = $job->inputs->assets('audio', ['audio']);
        if ($sounds->isEmpty()) {
            throw new NodeFailed('Connect the sound to add.');
        }
        $path = Media::path($video);
        $info = Media::probe($path);
        $mode = (string) ($job->params['mode'] ?? 'under');
        $volume = $job->params['volume'] ?? null;
        $volume = $volume === null || $volume === '' ? ['under' => 0.35, 'replace' => 1.0, 'mix' => 0.6][$mode] ?? 0.5 : (float) $volume;
        $D = max(0.5, $info['duration']);
        $fade = max(0, $D - 1.5);

        $inputs = ['-i', $path];
        $added = [];
        foreach ($sounds->values() as $i => $s) {
            $inputs = [...$inputs, '-i', Media::path($s)];
            $added[] = '['.($i + 1).':a]aresample=48000,aformat=channel_layouts=stereo[s'.$i.']';
        }
        $n = $sounds->count();
        $graph = implode(';', $added).';'.implode('', array_map(fn ($i) => "[s{$i}]", range(0, $n - 1)))
            .($n > 1 ? "amix=inputs={$n}:duration=longest:normalize=0," : 'anull,')
            ."volume={$volume},afade=t=out:st=".sprintf('%.2f', $fade).':d=1.5[add]';
        $own = $info['audio'] && $mode !== 'replace';
        if ($own && $mode === 'under') {
            $graph .= ';[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[own][key];[add][key]sidechaincompress=threshold=0.035:ratio=6:attack=20:release=450[duck];[own][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]';
        } elseif ($own) {
            $graph .= ';[0:a]aresample=48000,aformat=channel_layouts=stereo[own];[own][add]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]';
        } else {
            $graph .= ';[add]apad,atrim=0:'.sprintf('%.3f', $D).'[a]';
        }
        $out = Media::tmp('mp4');
        $job->stage('Mixing the sound');
        Media::ffmpeg([...$inputs, '-filter_complex', $graph, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', sprintf('%.3f', $D), '-movflags', '+faststart', $out], 'mix the sound');
        $words = $mode === 'replace' ? null : ($video->meta['words'] ?? null);
        $asset = $this->media()->keep($job->user(), $out, 'video/mp4', 'with-sound-'.($video->name ?: 'video.mp4'), array_filter([...$this->inherit($video), 'words' => $words]));

        return ['outputs' => $this->assetOutputs($job, $asset)];
    }
}

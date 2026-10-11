<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\Media;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/** Join: videos one after the other, in the frame of the first, with their sound (silence where one has none). */
class Join extends Executor
{
    public function start(NodeJob $job): array
    {
        $videos = $job->inputs->assets('videos', ['video'])->values();
        if ($videos->count() < 2) {
            throw new NodeFailed('Connect two videos or more.');
        }
        $infos = $videos->map(fn ($v) => Media::probe(Media::path($v)));
        $W = $infos[0]['width'] - $infos[0]['width'] % 2;
        $H = $infos[0]['height'] - $infos[0]['height'] % 2;
        $inputs = [];
        $chains = [];
        $pairs = '';
        $extra = $videos->count();
        foreach ($videos as $i => $v) {
            $inputs = [...$inputs, '-i', Media::path($v)];
        }
        foreach ($videos as $i => $v) {
            $chains[] = "[{$i}:v]scale={$W}:{$H}:force_original_aspect_ratio=decrease,pad={$W}:{$H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{$i}]";
            if ($infos[$i]['audio']) {
                $chains[] = "[{$i}:a]aresample=48000,aformat=channel_layouts=stereo[a{$i}]";
            } else {
                $inputs = [...$inputs, '-f', 'lavfi', '-t', sprintf('%.3f', $infos[$i]['duration']), '-i', 'anullsrc=r=48000:cl=stereo'];
                $chains[] = "[{$extra}:a]anull[a{$i}]";
                $extra++;
            }
            $pairs .= "[v{$i}][a{$i}]";
        }
        $graph = implode(';', $chains).";{$pairs}concat=n={$videos->count()}:v=1:a=1[v][a]";
        $out = Media::tmp('mp4');
        $job->stage('Joining '.$videos->count().' videos');
        Media::ffmpeg([...$inputs, '-filter_complex', $graph, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', $out], 'join the videos');
        $credits = $videos->map(fn ($v) => $v->meta['credit'] ?? null)->filter()->unique()->values();
        $asset = $this->media()->keep($job->user(), $out, 'video/mp4', 'joined-'.$videos->count().'.mp4', array_filter(['credit' => $credits->join("\n") ?: null]));

        return ['outputs' => $this->assetOutputs($job, $asset)];
    }
}

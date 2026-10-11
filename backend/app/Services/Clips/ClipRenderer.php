<?php

namespace App\Services\Clips;

use App\Services\Sound\Captions;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Turn one moment of a landscape source into a captioned 9:16 Reel/TikTok video, in two passes:
 * a clean vertical master (no text), kept so the highlight can be edited later, and the finished
 * video (subtitles, title and music on top of the master).
 */
class ClipRenderer
{
    /**
     * @param  list<array{text: string, start: float, end: float}>  $words
     */
    public function render(string $source, float $start, float $seconds, array $words, string $title, string $accent = '#a5b4fc'): string
    {
        $master = $this->master($source, $start, $seconds);
        try {
            $style = ClipStyle::defaults($accent);

            return $this->finish($master, $seconds, $words, ClipStyle::look($style, $title, $seconds));
        } finally {
            @unlink($master);
        }
    }

    /** The moment as a clean 1080 × 1920 video: the whole frame over a blurred copy of itself. */
    public function master(string $source, float $start, float $seconds): string
    {
        $out = tempnam(sys_get_temp_dir(), 'clip-master').'.mp4';
        // Keep the whole source frame in the middle. A darkened blurred copy fills the 9:16
        // canvas, so landscape interviews do not lose a speaker to a blind centre crop.
        $graph = '[0:v]split=2[back][front];'
            .'[back]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=32,eq=brightness=-0.34:saturation=0.78[bg];'
            .'[front]scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[fg];'
            .'[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v];'
            .'[0:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=11[a]';

        $this->ffmpeg([
            '-ss', (string) round($start, 3), '-t', (string) round($seconds, 3), '-i', $source,
            '-filter_complex', $graph, '-map', '[v]', '-map', '[a]', '-r', '30',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-threads', '2',
            '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', $out,
        ], $out, 'The vertical clip could not be rendered');

        return $out;
    }

    /**
     * The finished highlight: the master with its subtitles and title burned in, and music under
     * the speech if there is any (it steps aside whenever someone talks).
     *
     * @param  list<array{text: string, start: float, end: float}>  $words  empty for no subtitles
     * @param  array<string, mixed>  $look  as ClipStyle::look() makes it
     */
    public function finish(string $master, float $seconds, array $words, array $look, ?string $music = null, float $musicVolume = 0.25, float $originalVolume = 1.0): string
    {
        $dir = sys_get_temp_dir().'/link-clip-'.Str::random(12);
        File::ensureDirectoryExists($dir);
        $out = tempnam(sys_get_temp_dir(), 'clip').'.mp4';

        try {
            file_put_contents("{$dir}/captions.ass", Captions::ass($words, 'bold', $look, $seconds));
            $fadeOut = max(0, $seconds - 0.35);
            $f = ["[0:v]subtitles=filename={$dir}/captions.ass:fontsdir=".resource_path('fonts').",fade=t=in:st=0:d=0.25,fade=t=out:st={$fadeOut}:d=0.35,setsar=1[v]"];
            $inputs = ['-i', $master];
            $original = round(max(0, $originalVolume), 2);
            if ($music) {
                $inputs = [...$inputs, '-stream_loop', '-1', '-i', $music];
                $volume = round(max(0, $musicVolume), 2);
                $f[] = "[0:a]aresample=48000,aformat=channel_layouts=stereo,volume={$original},asplit=2[speech][side]";
                $f[] = "[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{$seconds},asetpts=N/SR/TB,volume={$volume},afade=t=in:d=0.4,afade=t=out:st=".max(0, $seconds - 1.2).':d=1.2[mx]';
                $f[] = '[mx][side]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=400:makeup=1[duck]';
                $f[] = '[speech][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95,afade=t=in:d=0.12,afade=t=out:st='.max(0, $seconds - 0.3).':d=0.3[a]';
            } else {
                $f[] = "[0:a]volume={$original},afade=t=in:d=0.12,afade=t=out:st=".max(0, $seconds - 0.3).':d=0.3[a]';
            }

            $this->ffmpeg([
                ...$inputs, '-filter_complex', implode(';', $f), '-map', '[v]', '-map', '[a]', '-t', (string) round($seconds, 3), '-r', '30',
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-threads', '2',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', $out,
            ], $out, 'The highlight could not be rendered');

            return $out;
        } finally {
            File::deleteDirectory($dir);
        }
    }

    private function ffmpeg(array $args, string $out, string $problem): void
    {
        $run = Process::timeout(900)->run(['ffmpeg', '-y', '-v', 'error', ...$args]);
        if (! $run->successful() || ! is_file($out) || filesize($out) === 0) {
            @unlink($out);
            throw new RuntimeException($problem.': '.Str::limit(trim($run->errorOutput()), 350));
        }
    }
}

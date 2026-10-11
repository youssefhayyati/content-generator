<?php

namespace App\Services\Clips;

use App\Services\Sound\Captions;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use RuntimeException;

/** Turn one moment of a landscape source into a captioned 9:16 Reel/TikTok video. */
class ClipRenderer
{
    /**
     * @param  list<array{text: string, start: float, end: float}>  $words
     */
    public function render(string $source, float $start, float $seconds, array $words, string $title, string $accent = '#a5b4fc'): string
    {
        $dir = sys_get_temp_dir().'/link-clip-'.Str::random(12);
        File::ensureDirectoryExists($dir);
        $out = tempnam(sys_get_temp_dir(), 'clip').'.mp4';

        try {
            file_put_contents("{$dir}/captions.ass", Captions::ass($words, 'bold', [
                'accent' => $accent,
                'title' => Str::limit($title, 60, ''),
                'title_seconds' => min(3.2, $seconds),
                'text_y' => 1390,
            ], $seconds));

            // Keep the whole source frame in the middle. A darkened blurred copy fills the 9:16
            // canvas, so landscape interviews do not lose a speaker to a blind centre crop.
            $graph = '[0:v]split=2[back][front];'
                .'[back]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=32,eq=brightness=-0.34:saturation=0.78[bg];'
                .'[front]scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[fg];'
                .'[bg][fg]overlay=(W-w)/2:(H-h)/2[framed];'
                ."[framed]subtitles=filename={$dir}/captions.ass:fontsdir=".resource_path('fonts').',fade=t=in:st=0:d=0.25,fade=t=out:st='.max(0, $seconds - 0.35).':d=0.35,setsar=1[v];'
                .'[0:a]aresample=48000,loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=in:d=0.12,afade=t=out:st='.max(0, $seconds - 0.3).':d=0.3[a]';

            $run = Process::timeout(900)->run([
                'ffmpeg', '-y', '-v', 'error', '-ss', (string) round($start, 3), '-t', (string) round($seconds, 3), '-i', $source,
                '-filter_complex', $graph, '-map', '[v]', '-map', '[a]', '-r', '30',
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-threads', '2',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', $out,
            ]);
            if (! $run->successful() || ! is_file($out)) {
                @unlink($out);
                throw new RuntimeException('The vertical clip could not be rendered: '.Str::limit(trim($run->errorOutput()), 350));
            }

            return $out;
        } finally {
            File::deleteDirectory($dir);
        }
    }
}

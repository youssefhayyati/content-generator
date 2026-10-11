<?php

namespace App\Services\Lab;

use App\Models\Asset;
use App\Models\User;
use App\Services\Media\AssetStore;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;

/**
 * ffmpeg and ffprobe for the nodes that work on this server (cut, captions, mix, join, frames),
 * and putting what they make into the library.
 */
class Media
{
    public function __construct(private readonly AssetStore $assets) {}

    public static function path(Asset $asset): string
    {
        return Storage::disk('local')->path($asset->path);
    }

    /** A temporary file of this extension, removed by the caller (or moved into the library). */
    public static function tmp(string $ext): string
    {
        $dir = storage_path('app/lab-tmp');
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        return $dir.'/'.bin2hex(random_bytes(10)).'.'.$ext;
    }

    /**
     * @param  list<string>  $args  after "ffmpeg -y -v error"
     *
     * @throws NodeFailed
     */
    public static function ffmpeg(array $args, string $what, int $timeout = 900): void
    {
        $run = Process::timeout($timeout)->run(['ffmpeg', '-y', '-v', 'error', '-nostdin', ...$args]);
        if (! $run->successful()) {
            $err = trim($run->errorOutput());
            report(new \RuntimeException("ffmpeg ({$what}): {$err}"));
            throw new NodeFailed("Couldn’t {$what}: ".(collect(explode("\n", $err))->filter()->last() ?: 'ffmpeg stopped.'));
        }
    }

    /**
     * Width, height, duration, frame rate, and whether it has sound.
     *
     * @return array{width: int, height: int, duration: float, fps: float, audio: bool}
     */
    public static function probe(string $path): array
    {
        $run = Process::timeout(60)->run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:stream_tags=rotate:format=duration', '-of', 'json', $path]);
        $data = json_decode($run->output(), true) ?: [];
        $video = collect($data['streams'] ?? [])->firstWhere('codec_type', 'video') ?? [];
        [$num, $den] = array_map('floatval', explode('/', (string) ($video['r_frame_rate'] ?? '30/1')) + [1 => 1]);
        $w = (int) ($video['width'] ?? 0);
        $h = (int) ($video['height'] ?? 0);
        if (abs((int) ($video['tags']['rotate'] ?? 0)) % 180 === 90) {
            [$w, $h] = [$h, $w];
        }

        return [
            'width' => $w,
            'height' => $h,
            'duration' => (float) ($data['format']['duration'] ?? 0),
            'fps' => $den > 0 && $num > 0 ? min(60, $num / $den) : 30.0,
            'audio' => collect($data['streams'] ?? [])->contains('codec_type', 'audio'),
        ];
    }

    /**
     * A finished file into the library, as made by this node.
     *
     * @param  array<string, mixed>  $meta
     */
    public function keep(User $user, string $file, string $mime, string $name, array $meta = []): Asset
    {
        return $this->assets->fromFile($user, $file, $mime, $name, 'generated', $meta);
    }

    /**
     * The size of a shape ("9:16") for a source this big: as large as fits, never upscaled past 1080
     * on the short side, with even numbers.
     *
     * @return array{0: int, 1: int}
     */
    public static function frame(string $aspect, int $srcW, int $srcH): array
    {
        if ($aspect === 'original' || ! str_contains($aspect, ':')) {
            return [$srcW - $srcW % 2, $srcH - $srcH % 2];
        }
        [$a, $b] = array_map('floatval', explode(':', $aspect));
        $ratio = $a / $b;
        $short = min(1080, max(480, min($srcW, $srcH)));
        [$w, $h] = $ratio < 1 ? [$short, $short / $ratio] : [$short * $ratio, $short];

        return [(int) round($w / 2) * 2, (int) round($h / 2) * 2];
    }

    /**
     * An ffmpeg filter that puts a w×h frame into W×H: cropped (around a point left to right), fitted over a
     * blurred copy of itself, or fitted with bars.
     */
    public static function reframe(string $fit, int $w, int $h, int $W, int $H, float $focus = 0.5): string
    {
        $r = $W / $H;

        return match ($fit) {
            'blur' => "split[a][b];[a]scale={$W}:{$H}:force_original_aspect_ratio=increase,crop={$W}:{$H},boxblur=24:3[bg];[b]scale={$W}:{$H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2",
            'fit' => "scale={$W}:{$H}:force_original_aspect_ratio=decrease,pad={$W}:{$H}:(ow-iw)/2:(oh-ih)/2:black",
            default => (function () use ($w, $h, $r, $W, $H, $focus) {
                if ($w / max(1, $h) > $r) {
                    $cw = (int) (round($h * $r / 2) * 2);
                    $x = (int) max(0, min($w - $cw, round(($w * $focus) - $cw / 2)));

                    return "crop={$cw}:{$h}:{$x}:0,scale={$W}:{$H}";
                }
                $ch = (int) (round($w / $r / 2) * 2);
                $y = (int) max(0, min($h - $ch, round(($h - $ch) / 2)));

                return "crop={$w}:{$ch}:0:{$y},scale={$W}:{$H}";
            })(),
        };
    }

    /** "1:1" -> 1.0; "original" -> null */
    public static function ratio(string $aspect): ?float
    {
        if (! str_contains($aspect, ':')) {
            return null;
        }
        [$a, $b] = array_map('floatval', explode(':', $aspect));

        return $b > 0 ? $a / $b : null;
    }
}

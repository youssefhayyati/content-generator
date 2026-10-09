<?php

namespace App\Services\Media;

use Illuminate\Support\Facades\Process;

/**
 * Reads what the platform checks need from a media file: size in pixels and, for video,
 * duration. Images need nothing but PHP; video needs ffprobe (shipped in the Docker images).
 */
class MediaInspector
{
    private ?bool $ffmpeg = null;

    public function canReadVideo(): bool
    {
        return $this->ffmpeg ??= Process::run(['ffprobe', '-version'])->successful();
    }

    /**
     * @return array{width: int|null, height: int|null, duration: float|null}
     */
    public function inspect(string $path, string $mime): array
    {
        if (str_starts_with($mime, 'image/')) {
            $size = @getimagesize($path);

            return ['width' => $size[0] ?? null, 'height' => $size[1] ?? null, 'duration' => null];
        }

        $none = ['width' => null, 'height' => null, 'duration' => null];
        if (! $this->canReadVideo()) {
            return $none;
        }
        if (str_starts_with($mime, 'audio/')) {
            $probe = Process::timeout(30)->run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', $path]);
            $seconds = trim($probe->output());

            return [...$none, 'duration' => $probe->successful() && is_numeric($seconds) ? round((float) $seconds, 2) : null];
        }

        $probe = Process::timeout(30)->run([
            'ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=duration',
            '-of', 'json', $path,
        ]);
        $data = json_decode($probe->output(), true);
        if (! $probe->successful() || ! is_array($data)) {
            return $none;
        }

        $stream = $data['streams'][0] ?? [];
        $width = isset($stream['width']) ? (int) $stream['width'] : null;
        $height = isset($stream['height']) ? (int) $stream['height'] : null;
        // Phones record landscape frames with a rotation flag; what people see is turned.
        $rotation = abs((int) ($stream['tags']['rotate'] ?? collect($stream['side_data_list'] ?? [])->pluck('rotation')->filter()->first() ?? 0));
        if ($rotation % 180 === 90) {
            [$width, $height] = [$height, $width];
        }
        $duration = $data['format']['duration'] ?? $stream['duration'] ?? null;

        return ['width' => $width, 'height' => $height, 'duration' => $duration !== null ? round((float) $duration, 2) : null];
    }

    /**
     * A still from early in the video, for thumbnails. Returns false when ffmpeg can't make one.
     */
    public function poster(string $videoPath, string $posterPath): bool
    {
        if (! $this->canReadVideo()) {
            return false;
        }

        return Process::timeout(60)->run([
            'ffmpeg', '-y', '-v', 'error', '-ss', '0.5', '-i', $videoPath, '-frames:v', '1',
            '-vf', 'scale=min(720\,iw):-2', $posterPath,
        ])->successful() && is_file($posterPath);
    }
}

<?php

namespace App\Services\Clips;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use RuntimeException;

/** Metadata and one bounded download from a YouTube URL, delegated to yt-dlp. */
class YouTubeDownloader
{
    public const MAX_SOURCE_SECONDS = 1800;

    public static function supports(string $url): bool
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        $host = preg_replace('/^www\.|^m\./', '', $host) ?? $host;

        return in_array($host, ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], true);
    }

    /** @return array{path: string, title: string, duration: float, author: string|null, cleanup: string} */
    public function download(string $url): array
    {
        if (! self::supports($url)) {
            throw new RuntimeException('Use a youtube.com or youtu.be video link.');
        }
        $metaRun = Process::timeout(90)->run(['yt-dlp', '--no-playlist', '--quiet', '--no-warnings', '--dump-single-json', '--skip-download', $url]);
        if (! $metaRun->successful()) {
            throw new RuntimeException('YouTube could not open that video: '.Str::limit(trim($metaRun->errorOutput()), 240));
        }
        $meta = json_decode($metaRun->output(), true);
        $duration = (float) ($meta['duration'] ?? 0);
        if ($duration < 3) {
            throw new RuntimeException('That video has no usable duration.');
        }
        if ($duration > self::MAX_SOURCE_SECONDS) {
            throw new RuntimeException('For now, use a YouTube video under 30 minutes.');
        }

        $dir = sys_get_temp_dir().'/youtube-'.Str::random(12);
        File::ensureDirectoryExists($dir);
        $run = Process::timeout(1200)->run([
            'yt-dlp', '--no-playlist', '--quiet', '--no-warnings', '--no-progress',
            '--format', 'bv*[height<=1080]+ba/b[height<=1080]', '--merge-output-format', 'mp4',
            '--output', "{$dir}/source.%(ext)s", $url,
        ]);
        if (! $run->successful()) {
            File::deleteDirectory($dir);
            throw new RuntimeException('The video could not be downloaded: '.Str::limit(trim($run->errorOutput()), 280));
        }
        $path = collect(File::files($dir))->first(fn ($file) => in_array(strtolower($file->getExtension()), ['mp4', 'mkv', 'webm', 'mov'], true))?->getPathname();
        if (! $path) {
            File::deleteDirectory($dir);
            throw new RuntimeException('The downloaded video file was missing.');
        }

        return [
            'path' => $path,
            'title' => Str::limit((string) ($meta['title'] ?? 'YouTube clip'), 160, ''),
            'duration' => $duration,
            'author' => filled($meta['uploader'] ?? null) ? Str::limit((string) $meta['uploader'], 100, '') : null,
            'cleanup' => $dir,
        ];
    }
}

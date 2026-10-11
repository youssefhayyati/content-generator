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

    /**
     * What the video is, without downloading it, and whether it can be clipped: one that's live, too long or
     * unavailable gets a message that says so. (A --match-filter on the download skips such a video without an
     * error, which left nothing to clip and no reason why.)
     *
     * @return array{title: string, duration: float}
     */
    public function check(string $url): array
    {
        if (! self::supports($url)) {
            throw new RuntimeException('Use a youtube.com or youtu.be video link.');
        }
        $run = Process::timeout(60)->run(['yt-dlp', '--no-playlist', '--no-warnings', '--skip-download', '--dump-single-json', $url]);
        if (! $run->successful()) {
            $why = trim((string) preg_replace('/^ERROR:\s*(\[\w+\]\s*[\w-]+:\s*)?/m', '', trim($run->errorOutput())));
            throw new RuntimeException('YouTube says: '.Str::limit($why ?: 'the video could not be read.', 200));
        }
        $meta = json_decode($run->output(), true) ?: [];
        if (in_array($meta['live_status'] ?? null, ['is_live', 'is_upcoming'], true)) {
            throw new RuntimeException('This is a live stream or a premiere that hasn’t ended. Try again once it is a regular video.');
        }
        $duration = (float) ($meta['duration'] ?? 0);
        if ($duration < 3) {
            throw new RuntimeException('This video is too short to clip (under 3 seconds).');
        }
        if ($duration > self::MAX_SOURCE_SECONDS) {
            throw new RuntimeException(sprintf('This video is %d minutes long. For now, use one up to %d minutes.', (int) ceil($duration / 60), self::MAX_SOURCE_SECONDS / 60));
        }

        return ['title' => (string) ($meta['title'] ?? ''), 'duration' => $duration];
    }

    /** @return array{path: string, title: string, duration: float, author: string|null, cleanup: string} */
    public function download(string $url): array
    {
        $this->check($url);
        $dir = sys_get_temp_dir().'/youtube-'.Str::random(12);
        File::ensureDirectoryExists($dir);
        $run = Process::timeout(1200)->run([
            'yt-dlp', '--no-playlist', '--quiet', '--no-warnings', '--no-progress', '--write-info-json',
            '--concurrent-fragments', '4', '--format', 'bv*[height<=720]+ba/b[height<=720]', '--merge-output-format', 'mp4',
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
        $info = collect(File::files($dir))->first(fn ($file) => str_ends_with($file->getFilename(), '.info.json'))?->getPathname();
        $meta = $info ? json_decode((string) file_get_contents($info), true) : [];
        $duration = (float) ($meta['duration'] ?? 0);
        if ($duration < 3 || $duration > self::MAX_SOURCE_SECONDS) {
            File::deleteDirectory($dir);
            throw new RuntimeException('For now, use a YouTube video between 3 seconds and 30 minutes.');
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

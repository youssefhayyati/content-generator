<?php

namespace App\Services\Lab;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Process;

/**
 * yt-dlp (with Deno, which current yt-dlp needs for YouTube), installed in the PHP image. Reads a
 * video's details without downloading, then downloads only what's asked: the sound, the whole video
 * when it's short, or just the parts that are cut from it. YTDLP_COOKIES points at a cookies file
 * when YouTube asks the server to sign in.
 */
class YtDlp
{
    public function available(): bool
    {
        static $ok = null;

        return $ok ??= Process::timeout(20)->run([$this->bin(), '--version'])->successful();
    }

    /**
     * The video's details (title, channel, length, license, chapters, captions), downloading nothing.
     *
     * @return array<string, mixed>
     *
     * @throws NodeFailed
     */
    public function info(string $url): array
    {
        $run = $this->run(['-J', '--no-playlist', '--skip-download', $url], 90);
        $data = json_decode($run, true);
        if (! is_array($data)) {
            throw new NodeFailed('That link’s details couldn’t be read.');
        }

        return $data;
    }

    /** The best sound only, as M4A (small: about 1 MB a minute). */
    public function audio(string $url, string $out): void
    {
        $this->run(['-f', 'bestaudio[ext=m4a]/bestaudio', '-x', '--audio-format', 'm4a', '--no-playlist', '-o', $this->template($out), $url], 1800);
        $this->found($out);
    }

    /** The whole video, 1080p at most, as MP4. */
    public function video(string $url, string $out, int $height = 1080): void
    {
        $this->run(['-f', $this->format($height), '--merge-output-format', 'mp4', '--no-playlist', '-o', $this->template($out), $url], 1800);
        $this->found($out);
    }

    /** Only the part between two times, cut exactly, as MP4. */
    public function section(string $url, float $start, float $end, string $out, int $height = 1080): void
    {
        $this->run([
            '-f', $this->format($height), '--merge-output-format', 'mp4', '--no-playlist',
            '--download-sections', sprintf('*%.2f-%.2f', $start, $end), '--force-keyframes-at-cuts',
            '-o', $this->template($out), $url,
        ], 1800);
        $this->found($out);
    }

    /**
     * YouTube's own captions (its automatic ones when there are no others), as timed words. Empty
     * when it has none.
     *
     * @param  array<string, mixed>  $info
     * @return list<array{text: string, start: float, end: float}>
     */
    public function captions(string $url, array $info): array
    {
        $lang = (string) ($info['language'] ?? '') ?: 'en';
        $tracks = [...array_keys($info['subtitles'] ?? []), ...array_keys($info['automatic_captions'] ?? [])];
        $pick = collect([$lang, "{$lang}-orig", 'en', 'en-orig'])->first(fn ($l) => in_array($l, $tracks, true));
        if (! $pick) {
            return [];
        }
        $base = Media::tmp('cap');
        try {
            $this->run(['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', $pick, '--sub-format', 'json3', '--no-playlist', '-o', $base.'.%(ext)s', $url], 120);
        } catch (NodeFailed) {
            return [];
        }
        $file = collect(glob($base.'*.json3') ?: [])->first();
        if (! $file) {
            return [];
        }
        $data = json_decode((string) file_get_contents($file), true) ?: [];
        @unlink($file);

        return self::json3Words($data);
    }

    /**
     * json3 captions to words: each event has a start (ms) and segments with offsets.
     *
     * @param  array<string, mixed>  $data
     * @return list<array{text: string, start: float, end: float}>
     */
    public static function json3Words(array $data): array
    {
        $words = [];
        foreach ($data['events'] ?? [] as $e) {
            $t0 = ((float) ($e['tStartMs'] ?? 0)) / 1000;
            $dur = ((float) ($e['dDurationMs'] ?? 0)) / 1000;
            $segs = array_values(array_filter($e['segs'] ?? [], fn ($s) => trim((string) ($s['utf8'] ?? '')) !== ''));
            foreach ($segs as $i => $s) {
                foreach (preg_split('/\s+/', trim((string) $s['utf8'])) as $k => $w) {
                    if ($w === '') {
                        continue;
                    }
                    $start = $t0 + ((float) ($s['tOffsetMs'] ?? 0)) / 1000 + $k * 0.05;
                    $words[] = ['text' => $w, 'start' => round($start, 3), 'end' => 0.0];
                }
            }
            // An event's words end where the next begins, the last at the event's end.
            $n = count($words);
            if ($n && $dur > 0) {
                $words[$n - 1]['end'] = round($t0 + $dur, 3);
            }
        }
        for ($i = 0; $i < count($words); $i++) {
            $next = $words[$i + 1]['start'] ?? null;
            $end = $words[$i]['end'] ?: ($next ?? $words[$i]['start'] + 0.4);
            $words[$i]['end'] = round(max($words[$i]['start'] + 0.05, $next !== null ? min($end, $next) : $end), 3);
        }

        return array_values(array_filter($words, fn ($w) => ! preg_match('/^\[.*\]$/', $w['text'])));
    }

    private function format(int $height): string
    {
        // H.264 first: ffmpeg re-encodes at the cuts, and AV1 or VP9 may not decode here.
        return "bv*[height<={$height}][vcodec^=avc1]+ba[ext=m4a]/b[height<={$height}][ext=mp4]/bv*[height<={$height}]+ba/b";
    }

    /** yt-dlp names the file itself: give it the stem, and find what it made. */
    private function template(string $out): string
    {
        return preg_replace('/\.\w+$/', '', $out).'.%(ext)s';
    }

    private function found(string $out): void
    {
        $stem = preg_replace('/\.\w+$/', '', $out);
        $made = collect(glob($stem.'.*') ?: [])->reject(fn ($f) => str_ends_with($f, '.part') || str_ends_with($f, '.ytdl'))->first();
        if (! $made) {
            throw new NodeFailed('The download finished without a file.');
        }
        if ($made !== $out) {
            rename($made, $out);
        }
    }

    /**
     * @param  list<string>  $args
     *
     * @throws NodeFailed
     */
    private function run(array $args, int $timeout): string
    {
        if (! $this->available()) {
            throw new NodeFailed('yt-dlp isn’t installed on the server. Rebuild the PHP image (docker compose build api worker).');
        }
        $this->keepCurrent();
        $cookies = config('ai.engine.ytdlp_cookies');
        $base = [$this->bin(), '--no-warnings', '--no-progress', '--retries', '3', '--socket-timeout', '30'];
        if ($cookies && is_file($cookies)) {
            $base = [...$base, '--cookies', $cookies];
        }
        $run = Process::timeout($timeout)->run([...$base, ...$args]);
        if (! $run->successful()) {
            $err = trim($run->errorOutput()) ?: trim($run->output());
            report(new \RuntimeException('yt-dlp: '.mb_substr($err, 0, 2000)));
            throw new NodeFailed(self::explain($err));
        }

        return $run->output();
    }

    /** yt-dlp's error, in words a person can act on. */
    public static function explain(string $err): string
    {
        return match (true) {
            str_contains($err, 'Sign in to confirm') || str_contains($err, 'not a bot') => 'YouTube asked the server to sign in (it does that to servers). Set YTDLP_COOKIES to a cookies file from a signed-in browser, or upload the video instead.',
            str_contains($err, 'Private video') => 'That video is private.',
            str_contains($err, 'Video unavailable') || str_contains($err, 'This video is unavailable') => 'That video isn’t available.',
            str_contains($err, 'members-only') || str_contains($err, 'Join this channel') => 'That video is for channel members only.',
            str_contains($err, 'age') && str_contains($err, 'confirm') => 'YouTube wants a signed-in, age-confirmed account for that video. Set YTDLP_COOKIES, or upload it instead.',
            str_contains($err, 'Unsupported URL') => 'That link isn’t a video yt-dlp can read.',
            default => 'The download didn’t work: '.(collect(explode("\n", $err))->filter(fn ($l) => str_contains($l, 'ERROR'))->last() ?: mb_substr($err, 0, 200)),
        };
    }

    /** YouTube changes often and yt-dlp follows: update it at most once a day, before a download. */
    private function keepCurrent(): void
    {
        if (! Cache::add('lab.ytdlp.updated', true, now()->addDay())) {
            return;
        }
        $run = Process::timeout(120)->run([$this->bin(), '-U']);
        if (! $run->successful()) {
            report(new \RuntimeException('yt-dlp -U: '.mb_substr(trim($run->errorOutput()), 0, 500)));
        }
    }

    private function bin(): string
    {
        return (string) config('ai.engine.ytdlp', 'yt-dlp');
    }
}

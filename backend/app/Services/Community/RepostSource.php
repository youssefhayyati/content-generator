<?php

namespace App\Services\Community;

use App\Models\Asset;
use App\Models\Repost;
use App\Services\Media\AssetStore;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * Reads a public post from X or Instagram — who wrote it, what it says, its photos or video —
 * and saves the media to the library, so the post can be adapted for the other network.
 * Only the networks' own hosts are ever fetched: the source URL is parsed, never followed.
 */
class RepostSource
{
    public function __construct(private readonly AssetStore $store) {}

    /** Which network a post URL belongs to, when it's a post on one we repost from. */
    public static function platformOf(string $url): ?string
    {
        $host = preg_replace('/^(www\.|mobile\.|m\.)/', '', strtolower((string) parse_url($url, PHP_URL_HOST))) ?? '';
        $path = (string) parse_url($url, PHP_URL_PATH);

        return match (true) {
            in_array($host, ['x.com', 'twitter.com'], true) && self::tweetId($path) !== null => 'x',
            $host === 'instagram.com' && self::instagramCode($path) !== null => 'instagram',
            default => null,
        };
    }

    /** Fill in the repost from its source: author, text and media. */
    public function capture(Repost $repost): void
    {
        $post = match ($repost->source_platform) {
            'instagram' => $this->instagram($repost->source_url),
            default => $this->x($repost->source_url),
        };

        $author = Str::limit(ltrim($post['author'] ?: $repost->author, '@'), 120, '');
        $assets = [];
        try {
            foreach (array_slice($post['media'], 0, config('reposts.max_items')) as $i => $item) {
                $assets[] = $this->save($repost, $item, "Repost of @{$author} ".($i + 1))->id;
            }
        } catch (Throwable $e) {
            $repost->user->assets()->whereIn('id', $assets)->get()->each->delete(); // no half-saved media
            throw $e;
        } finally {
            if (isset($post['cleanup'])) {
                File::deleteDirectory($post['cleanup']);
            }
        }

        if (trim($post['text']) === '' && $assets === []) {
            throw new RuntimeException('That post has no text or media we could read.');
        }

        $repost->update([
            'author' => $author,
            'source_text' => Str::limit($post['text'], 5000, ''),
            'asset_ids' => $assets,
            'status' => 'captured',
            'error' => null,
        ]);
    }

    /**
     * @return array{author: string, text: string, media: list<array{kind: string, url?: string, path?: string}>}
     */
    private function x(string $url): array
    {
        $id = self::tweetId((string) parse_url($url, PHP_URL_PATH));
        $response = Http::timeout(config('reposts.timeout'))->acceptJson()->get(rtrim(config('reposts.fxtwitter_url'), '/')."/status/{$id}");
        $tweet = $response->json('tweet');
        if (! $response->successful() || ! is_array($tweet)) {
            throw new RuntimeException('That X post couldn’t be read. It may be private or deleted.');
        }

        $media = collect($tweet['media']['all'] ?? [...($tweet['media']['photos'] ?? []), ...($tweet['media']['videos'] ?? [])])
            ->filter(fn ($m) => is_array($m) && filled($m['url'] ?? null))
            ->map(fn (array $m) => ['kind' => ($m['type'] ?? 'photo') === 'photo' ? 'image' : 'video', 'url' => (string) $m['url']])
            ->values()->all();

        return [
            'author' => (string) ($tweet['author']['screen_name'] ?? ''),
            'text' => trim((string) ($tweet['text'] ?? '')),
            'media' => $media,
        ];
    }

    /**
     * Instagram shares a post's caption and photo with link-preview crawlers; a video is
     * downloaded with yt-dlp, falling back to its cover photo when that fails.
     *
     * @return array{author: string, text: string, media: list<array{kind: string, url?: string, path?: string}>, cleanup?: string}
     */
    private function instagram(string $url): array
    {
        $path = (string) parse_url($url, PHP_URL_PATH);
        [$type, $code] = self::instagramCode($path);
        $canonical = "https://www.instagram.com/{$type}/{$code}/";

        $response = Http::timeout(config('reposts.timeout'))->withUserAgent(config('reposts.preview_agent'))->get($canonical);
        $meta = $response->successful() ? self::metaTags($response->body()) : [];
        $title = $meta['twitter:title'] ?? $meta['og:title'] ?? '';
        $description = trim($meta['description'] ?? $meta['og:description'] ?? '');
        if ($title === '' && $description === '') {
            throw new RuntimeException('Instagram didn’t share that post. It may be private — paste its text instead.');
        }

        preg_match('/\(@([\w.]+)\)/', $title, $handle);
        preg_match('/ - ([\w.]+) on [^:]+:/u', $description, $byline);
        // "792K likes, 7,334 comments - nasa on July 20, 2024: "the caption"."
        $text = preg_match('/^.*? - [\w.]+ on [^:]+: "(.*)"\.?$/su', $description, $caption) ? $caption[1] : '';
        $post = ['author' => $handle[1] ?? $byline[1] ?? '', 'text' => trim($text), 'media' => []];

        $image = $meta['og:image'] ?? $meta['twitter:image'] ?? null;
        $isVideo = $type !== 'p' || isset($meta['og:video']) || str_contains($title, 'Instagram video');
        if ($isVideo && ($video = $this->instagramVideo($canonical))) {
            $post['media'][] = ['kind' => 'video', 'path' => $video['path']];
            $post['cleanup'] = $video['cleanup'];
            $post['text'] = $post['text'] ?: $video['text'];
        } elseif ($image) {
            $post['media'][] = ['kind' => 'image', 'url' => $image];
        }

        return $post;
    }

    /** @return array{path: string, text: string, cleanup: string}|null */
    private function instagramVideo(string $url): ?array
    {
        $dir = sys_get_temp_dir().'/repost-'.Str::random(12);
        File::ensureDirectoryExists($dir);
        $seconds = config('reposts.video_seconds');
        $run = Process::timeout(300)->run([
            'yt-dlp', '--no-playlist', '--quiet', '--no-warnings', '--no-progress', '--write-info-json',
            '--match-filter', "duration <= {$seconds}", '--max-filesize', config('reposts.video_mb').'M',
            '--format', 'b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b', '--merge-output-format', 'mp4',
            '--output', "{$dir}/source.%(ext)s", $url,
        ]);
        $video = collect(File::files($dir))->first(fn ($f) => strtolower($f->getExtension()) === 'mp4')?->getPathname();
        if (! $run->successful() || ! $video) {
            File::deleteDirectory($dir);

            return null;
        }
        $info = collect(File::files($dir))->first(fn ($f) => str_ends_with($f->getFilename(), '.info.json'))?->getPathname();
        $meta = $info ? (json_decode((string) file_get_contents($info), true) ?: []) : [];

        return ['path' => $video, 'text' => trim((string) ($meta['description'] ?? '')), 'cleanup' => $dir];
    }

    /** @param array{kind: string, url?: string, path?: string} $item */
    private function save(Repost $repost, array $item, string $name): Asset
    {
        $meta = ['repost_id' => $repost->id, 'source_url' => $repost->source_url];
        if (isset($item['path'])) {
            return $this->store->fromPath($repost->user, $item['path'], 'video/mp4', $name, 'repost', $meta);
        }

        $url = (string) $item['url'];
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        $ours = collect(config('reposts.media_hosts'))->contains(fn (string $h) => $host === $h || str_ends_with($host, '.'.$h));
        if (parse_url($url, PHP_URL_SCHEME) !== 'https' || ! $ours) {
            throw new RuntimeException('The post’s media isn’t on the network’s own servers, so it wasn’t downloaded.');
        }

        $tmp = tempnam(sys_get_temp_dir(), 'repost');
        try {
            $response = Http::timeout(120)->sink($tmp)->get($url);
            $mime = strtolower(trim(explode(';', (string) $response->header('Content-Type'))[0]));
            $kind = AssetStore::kindOf($mime);
            $limit = config($kind === 'video' ? 'reposts.video_mb' : 'reposts.image_mb') * 1024 * 1024;
            if (! $response->successful() || ! in_array($kind, ['image', 'video'], true)) {
                throw new RuntimeException('The post’s '.($item['kind'] === 'video' ? 'video' : 'photo').' couldn’t be downloaded.');
            }
            if (filesize($tmp) > $limit) {
                throw new RuntimeException('The post’s '.$kind.' is too large to repost.');
            }
            return $this->store->fromPath($repost->user, $tmp, $mime, $name, 'repost', $meta);
        } finally {
            @unlink($tmp);
        }
    }

    /**
     * A story's words on its picture or video, since stories show no caption: the line in dark type on a white
     * box, low in the frame, and the credit as a small tag under it (libass draws Arabic and French alike, with
     * DejaVu when Geist lacks a letter; emoji can't be drawn and are left out). The 9:16 file comes from fit().
     */
    public function sticker(Repost $repost, Asset $asset, ?string $line, ?string $credit): Asset
    {
        $clean = fn (?string $t) => trim(preg_replace('/\s+/u', ' ', str_replace(['{', '}', '\\'], '', (string) preg_replace('/[\p{So}\p{Sk}\p{Cs}\x{FE0F}\x{200D}]/u', '', (string) $t))));
        [$line, $credit] = [$clean($line), $clean($credit)];
        if (($line === '' && $credit === '') || ! in_array($asset->kind, ['image', 'video'], true)) {
            return $asset;
        }

        $dir = sys_get_temp_dir().'/story-'.Str::random(12);
        File::ensureDirectoryExists($dir);
        $video = $asset->kind === 'video';
        $out = "{$dir}/story".($video ? '.mp4' : '.jpg');
        // Name, Font, Size, Primary, Secondary, Outline (the box, BorderStyle 3), Back, Bold, Italic, Underline, Strike,
        // ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment (2: bottom centre), MarginL, MarginR, MarginV
        $ass = "[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
            ."[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            ."Style: Line,Geist ExtraBold,62,&H00141414,&H00141414,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,3,20,0,2,110,110,520,1\n"
            ."Style: Credit,Geist SemiBold,36,&H00FFFFFF,&H00FFFFFF,&H8C000000,&H00000000,0,0,0,0,100,100,0,0,3,12,0,2,110,110,300,1\n\n"
            ."[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
            .($line !== '' ? "Dialogue: 0,0:00:00.00,9:00:00.00,Line,,0,0,0,,{$line}\n" : '')
            .($credit !== '' ? "Dialogue: 0,0:00:00.00,9:00:00.00,Credit,,0,0,0,,{$credit}\n" : '');
        file_put_contents("{$dir}/card.ass", $ass);
        $filter = "subtitles=filename={$dir}/card.ass:fontsdir=".resource_path('fonts');
        $source = Storage::disk('local')->path($asset->path);
        $run = Process::timeout(900)->run($video
            ? ['ffmpeg', '-y', '-v', 'error', '-i', $source, '-vf', $filter, '-map', '0:v', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast',
                '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'copy', '-movflags', '+faststart', $out]
            : ['ffmpeg', '-y', '-v', 'error', '-i', $source, '-vf', $filter, '-frames:v', '1', '-q:v', '2', $out]);
        try {
            if (! $run->successful() || ! is_file($out) || filesize($out) === 0) {
                Log::warning('Repost: the story’s words couldn’t be drawn; it goes without them.', ['asset' => $asset->id, 'error' => Str::limit(trim($run->errorOutput()), 300)]);

                return $asset;
            }

            return $this->store->fromPath($repost->user, $out, $video ? 'video/mp4' : 'image/jpeg', $asset->name, 'repost',
                ['repost_id' => $repost->id, 'source_url' => $repost->source_url, 'story_text' => $line, 'from_asset' => $asset->id]);
        } finally {
            File::deleteDirectory($dir);
        }
    }

    /**
     * A photo or video in the shape its placement takes: as it is when it fits the spec's ratio range,
     * else a new one at the spec's canvas (1080 × 1920 for reels and stories, 1080 × 1350 for the feed),
     * with the whole frame in the middle over a darkened, blurred copy of itself, as ClipRenderer frames
     * clips. When ffmpeg can't, the original is kept (and the platform check says it's off).
     *
     * @param  array{ratio: array{0: float, 1: float}}  $spec
     */
    public function fit(Repost $repost, Asset $asset, array $spec): Asset
    {
        [$lo, $hi] = $spec['ratio'];
        $ratio = $asset->ratio();
        if (! in_array($asset->kind, ['image', 'video'], true) || $ratio === null || ($ratio >= $lo - 0.005 && $ratio <= $hi + 0.005)) {
            return $asset;
        }
        [$w, $h] = $hi <= 0.6 ? [1080, 1920] : [1080, 1350];
        $video = $asset->kind === 'video';
        $out = tempnam(sys_get_temp_dir(), 'fit').($video ? '.mp4' : '.jpg');
        $graph = '[0:v]split=2[back][front];'
            ."[back]scale={$w}:{$h}:force_original_aspect_ratio=increase,crop={$w}:{$h},gblur=sigma=32,eq=brightness=-0.34:saturation=0.78[bg];"
            ."[front]scale={$w}:{$h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[fg];"
            .'[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]';
        $source = Storage::disk('local')->path($asset->path);
        $run = Process::timeout(900)->run($video
            ? ['ffmpeg', '-y', '-v', 'error', '-i', $source, '-filter_complex', $graph, '-map', '[v]', '-map', '0:a?', '-r', '30',
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-threads', '2',
                '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', $out]
            : ['ffmpeg', '-y', '-v', 'error', '-i', $source, '-filter_complex', $graph, '-map', '[v]', '-frames:v', '1', '-q:v', '2', $out]);
        try {
            if (! $run->successful() || ! is_file($out) || filesize($out) === 0) {
                Log::warning('Repost: the media couldn’t be reframed; the original is kept.', ['asset' => $asset->id, 'error' => Str::limit(trim($run->errorOutput()), 300)]);

                return $asset;
            }

            return $this->store->fromPath($repost->user, $out, $video ? 'video/mp4' : 'image/jpeg', $asset->name, 'repost',
                ['repost_id' => $repost->id, 'source_url' => $repost->source_url, 'reframed' => "{$w}x{$h}", 'from_asset' => $asset->id]);
        } finally {
            @unlink($out);
        }
    }

    private static function tweetId(string $path): ?string
    {
        return preg_match('#/status(?:es)?/(\d+)#', $path, $m) ? $m[1] : null;
    }

    /** @return array{0: string, 1: string}|null  ['p'|'reel'|'tv', code] */
    private static function instagramCode(string $path): ?array
    {
        if (! preg_match('#/(p|reels?|tv)/([A-Za-z0-9_-]+)#', $path, $m)) {
            return null;
        }

        return [$m[1] === 'reels' ? 'reel' : $m[1], $m[2]];
    }

    /** @return array<string, string> */
    private static function metaTags(string $html): array
    {
        preg_match_all('/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"/i', $html, $m, PREG_SET_ORDER);

        return collect($m)->mapWithKeys(fn (array $t) => [strtolower($t[1]) => html_entity_decode($t[2], ENT_QUOTES | ENT_HTML5)])
            ->all();
    }
}

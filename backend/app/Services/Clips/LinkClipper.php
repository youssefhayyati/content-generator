<?php

namespace App\Services\Clips;

use App\Enums\PostFormat;
use App\Enums\PostStatus;
use App\Models\ActionLog;
use App\Models\Asset;
use App\Models\LinkClip;
use App\Services\Flows\SafeUrl;
use App\Services\Media\AssetStore;
use App\Services\Sound\AudioTools;
use App\Services\Sound\Listener;
use App\Services\Sound\ReelRenderer;
use App\Services\Sound\SoundClient;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/** The complete source-link → vertical video → draft workflow. */
class LinkClipper
{
    public function __construct(
        private readonly YouTubeDownloader $youtube,
        private readonly ArticleReader $articles,
        private readonly ClipPlanner $planner,
        private readonly ClipRenderer $clips,
        private readonly Listener $listener,
        private readonly SoundClient $sound,
        private readonly ReelRenderer $reels,
        private readonly AudioTools $audio,
        private readonly AssetStore $assets,
    ) {}

    public function run(LinkClip $clip): void
    {
        $clip->source_type === 'youtube' ? $this->youtube($clip) : $this->article($clip);
    }

    private function youtube(LinkClip $clip): void
    {
        $targets = $this->targets($clip);
        $targets->each->update(['status' => 'downloading', 'error' => null]);
        $source = $this->youtube->download($clip->source_url);
        try {
            $targets->each->update(['status' => 'analyzing', 'title' => $source['title']]);
            $heard = $this->listener->file($source['path'], maxSeconds: YouTubeDownloader::MAX_SOURCE_SECONDS);
            $wanted = (int) ($clip->settings['seconds'] ?? 30);
            $plans = $this->planner->videos($clip, $heard, $source['duration'], $wanted, $source['title'], $targets->count());

            foreach ($targets as $index => $target) {
                $rendered = null;
                try {
                    $plan = $plans[$index] ?? $plans[0];
                    $seconds = max(3, $plan['end'] - $plan['start']);
                    $words = $this->inside($heard, $plan['start'], $plan['end']);
                    $target->update(['status' => 'rendering', 'analysis' => [...$plan, 'source_title' => $source['title'], 'author' => $source['author']]]);
                    $rendered = $this->clips->render($source['path'], $plan['start'], $seconds, $words, $plan['title'], (string) ($target->settings['accent'] ?? '#a5b4fc'));
                    $asset = $this->assets->fromPath($target->user, $rendered, 'video/mp4', $plan['title'].'.mp4', 'generated', [
                        'generator' => 'link-clip',
                        'source_url' => $target->source_url,
                        'source_title' => $source['title'],
                        'source_author' => $source['author'],
                        'clip_start' => $plan['start'],
                        'clip_end' => $plan['end'],
                        'words' => $words,
                    ]);
                    $this->finish($target, $asset, $plan);
                } catch (Throwable $e) {
                    $this->fail($target, $e);
                } finally {
                    @unlink((string) $rendered);
                }
            }
        } finally {
            File::deleteDirectory($source['cleanup']);
        }
    }

    private function article(LinkClip $clip): void
    {
        $targets = $this->targets($clip);
        $targets->each->update(['status' => 'reading', 'error' => null]);
        $article = $this->articles->read($clip->source_url);
        $targets->each->update(['status' => 'writing', 'title' => $article['title']]);
        $plans = $this->planner->articles($clip, $article, (int) ($clip->settings['seconds'] ?? 30), $targets->count());

        if (! $this->sound->up()) {
            throw new RuntimeException('FlowAI Sound is needed to narrate an article reel. Start the sound service and try again.');
        }
        $voice = collect($this->sound->voices())->first();
        if (! $voice) {
            throw new RuntimeException('FlowAI Sound has no available narration voice.');
        }
        $image = $this->image($article['image']);
        try {
            foreach ($targets as $index => $target) {
                $wav = tempnam(sys_get_temp_dir(), 'clip-voice').'.wav';
                $rendered = null;
                try {
                    $plan = $plans[$index] ?? $plans[0];
                    $spoken = $this->sound->speak($plan['script'], $voice['id'], 1.0, true);
                    file_put_contents($wav, $spoken['wav']);
                    $target->update(['status' => 'rendering', 'analysis' => [...$plan, 'source_title' => $article['title']]]);
                    $rendered = $this->reels->render([
                        'voice' => $wav,
                        'words' => $spoken['words'],
                        'background' => $image,
                        'background_kind' => $image ? 'image' : null,
                        'style' => 'bold',
                        'accent' => (string) ($target->settings['accent'] ?? '#a5b4fc'),
                        'title' => $plan['title'],
                        'captions' => true,
                    ], $this->audio);
                    $asset = $this->assets->fromPath($target->user, $rendered, 'video/mp4', $plan['title'].'.mp4', 'generated', [
                        'generator' => 'article-reel',
                        'source_url' => $target->source_url,
                        'source_title' => $article['title'],
                        'sound' => 'reel',
                        'voice' => $spoken['voice'],
                        'script' => $plan['script'],
                        'words' => $spoken['words'],
                        'lang' => $spoken['lang'],
                    ]);
                    $this->finish($target, $asset, $plan);
                } catch (Throwable $e) {
                    $this->fail($target, $e);
                } finally {
                    @unlink($wav);
                    @unlink((string) $rendered);
                }
            }
        } finally {
            @unlink((string) $image);
        }
    }

    /** @return Collection<int, LinkClip> */
    private function targets(LinkClip $clip): Collection
    {
        if (! $clip->batch_id) {
            return new Collection([$clip]);
        }

        return LinkClip::with('user')->where('user_id', $clip->user_id)->where('batch_id', $clip->batch_id)->where('status', 'queued')->orderBy('batch_index')->get();
    }

    private function fail(LinkClip $clip, Throwable $error): void
    {
        report($error);
        $clip->update(['status' => 'failed', 'error' => Str::limit($error->getMessage() ?: 'This highlight could not be rendered.', 500)]);
    }

    private function finish(LinkClip $clip, Asset $asset, array $plan): void
    {
        $platform = in_array($clip->settings['platform'] ?? null, ['instagram', 'tiktok'], true) ? $clip->settings['platform'] : 'tiktok';
        $post = $clip->user->posts()->create([
            'title' => Str::limit($plan['title'], 110, ''),
            'body' => Str::limit($plan['caption'], 2100, ''),
            'format' => PostFormat::Video,
            'placement' => $platform === 'instagram' ? 'reel' : 'video',
            'platforms' => [$platform],
            'status' => PostStatus::Draft,
        ]);
        $post->syncAssets([$asset->id]);
        $clip->update(['status' => 'ready', 'title' => $plan['title'], 'asset_id' => $asset->id, 'post_id' => $post->id, 'error' => null]);
        ActionLog::record($clip->user, 'agent:clipper', 'post.draft', $post, 'Turned a source link into a vertical video draft.', null, ['source_url' => $clip->source_url]);
    }

    /** Shift the source transcript so captions begin at zero in the rendered clip. */
    private function inside(array $heard, float $start, float $end): array
    {
        $words = collect($heard['words'] ?? [])->filter(fn ($w) => (float) ($w['end'] ?? 0) > $start && (float) ($w['start'] ?? 0) < $end)->map(fn ($w) => [
            'text' => trim((string) ($w['text'] ?? '')),
            'start' => round(max(0, (float) $w['start'] - $start), 3),
            'end' => round(min($end - $start, (float) $w['end'] - $start), 3),
        ])->filter(fn ($w) => filled($w['text']) && $w['end'] > $w['start'])->values()->all();

        return $words ?: $this->wordsFromSegments($heard['segments'] ?? [], $start, $end);
    }

    private function wordsFromSegments(array $segments, float $start, float $end): array
    {
        $out = [];
        foreach ($segments as $segment) {
            if (($segment['end'] ?? 0) <= $start || ($segment['start'] ?? 0) >= $end) {
                continue;
            }
            $parts = preg_split('/\s+/u', trim((string) ($segment['text'] ?? ''))) ?: [];
            $from = max($start, (float) $segment['start']);
            $to = min($end, (float) $segment['end']);
            $step = ($to - $from) / max(1, count($parts));
            foreach ($parts as $i => $word) {
                $out[] = ['text' => $word, 'start' => round($from - $start + $i * $step, 3), 'end' => round($from - $start + ($i + 1) * $step, 3)];
            }
        }

        return $out;
    }

    private function image(?string $url): ?string
    {
        if (! $url || SafeUrl::problem($url)) {
            return null;
        }
        $response = Http::timeout(20)->withOptions(['allow_redirects' => false])->withHeaders(['User-Agent' => 'FlowAI Clip Studio/1.0'])->get($url);
        $mime = strtolower(strtok((string) $response->header('Content-Type'), ';'));
        if (! $response->successful() || ! in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true) || strlen($response->body()) > 12_000_000) {
            return null;
        }
        $path = tempnam(sys_get_temp_dir(), 'article-image').match ($mime) {
            'image/png' => '.png',
            'image/webp' => '.webp',
            default => '.jpg',
        };
        file_put_contents($path, $response->body());

        return $path;
    }
}

<?php

namespace App\Services\Social;

use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * What is doing well on Instagram and TikTok right now, for one hashtag.
 *
 * Both platforms are read through Apify actors that bill per item returned,
 * so a search is capped by config and cached: the same hashtag costs money
 * once per TTL, not once per page view.
 */
class Trends
{
    public function enabled(): bool
    {
        return filled(config('trends.apify.token'));
    }

    /**
     * @return array{items: list<array<string, mixed>>, platform: string, hashtag: string, checked_at: string, cost: float}
     */
    public function search(string $platform, string $hashtag): array
    {
        $actor = config("trends.platforms.{$platform}.actor");
        abort_unless($actor, 422, 'Inspire reads Instagram and TikTok only.');

        $tag = $this->tag($hashtag);
        abort_unless($tag !== '', 422, 'Give a hashtag to search for, like "candle" or "autumn".');

        return Cache::remember("trends.{$platform}.{$tag}", (int) config('trends.ttl'), function () use ($platform, $actor, $tag) {
            $limit = (int) config('trends.limit');
            $raw = $this->run($actor, $this->input($platform, $tag, $limit));

            $items = collect($raw)
                ->reject(fn ($row) => filled(Arr::get($row, 'error')))
                ->map(fn ($row) => $platform === 'tiktok' ? $this->fromTikTok($row) : $this->fromInstagram($row))
                ->filter(fn ($item) => filled($item['url']))
                ->sortByDesc(fn ($item) => $item['metrics']['views'] ?: $item['metrics']['likes'])
                ->values()
                ->all();

            return [
                'items' => $items,
                'platform' => $platform,
                'hashtag' => $tag,
                'checked_at' => now()->toIso8601String(),
                'cost' => round(count($raw) * (float) config("trends.platforms.{$platform}.cost_per_item"), 4),
            ];
        });
    }

    /** Actors disagree on input keys; this is the only place that difference lives. */
    private function input(string $platform, string $tag, int $limit): array
    {
        return $platform === 'tiktok'
            ? ['hashtags' => [$tag], 'resultsPerPage' => $limit, 'shouldDownloadCovers' => false, 'shouldDownloadVideos' => false, 'shouldDownloadSubtitles' => false, 'shouldDownloadSlideshowImages' => false]
            : ['hashtags' => [$tag], 'resultsLimit' => $limit];
    }

    private function run(string $actor, array $input): array
    {
        $response = Http::withToken(config('trends.apify.token'))
            ->timeout((int) config('trends.apify.timeout'))
            ->post(config('trends.apify.url')."/acts/{$actor}/run-sync-get-dataset-items", $input);

        if ($response->status() === 401 || $response->status() === 403) {
            abort(502, 'Apify rejected the token. Check APIFY_TOKEN in backend/.env.');
        }
        if ($response->status() === 402) {
            abort(502, 'The Apify account is out of monthly credit, so no new trends can be fetched.');
        }
        abort_unless($response->successful(), 502, 'Could not reach the trend source. Try again in a moment.');

        return $response->json() ?? [];
    }

    private function fromTikTok(array $row): array
    {
        return [
            'platform' => 'tiktok',
            'external_id' => (string) Arr::get($row, 'id'),
            'url' => (string) Arr::get($row, 'webVideoUrl'),
            'caption' => (string) Arr::get($row, 'text'),
            'hashtags' => $this->hashtags(Arr::get($row, 'text')),
            'kind' => 'video',
            'thumbnail' => Arr::get($row, 'videoMeta.coverUrl'),
            'duration' => Arr::get($row, 'videoMeta.duration'),
            'author' => [
                'handle' => Arr::get($row, 'authorMeta.name'),
                'name' => Arr::get($row, 'authorMeta.nickName'),
                'avatar' => Arr::get($row, 'authorMeta.avatar'),
                'followers' => (int) Arr::get($row, 'authorMeta.fans', 0),
                'verified' => (bool) Arr::get($row, 'authorMeta.verified', false),
            ],
            'sound' => Arr::get($row, 'musicMeta.musicName') ? [
                'name' => Arr::get($row, 'musicMeta.musicName'),
                'author' => Arr::get($row, 'musicMeta.musicAuthor'),
                'original' => (bool) Arr::get($row, 'musicMeta.musicOriginal', false),
            ] : null,
            'metrics' => [
                'views' => (int) Arr::get($row, 'playCount', 0),
                'likes' => (int) Arr::get($row, 'diggCount', 0),
                'comments' => (int) Arr::get($row, 'commentCount', 0),
                'shares' => (int) Arr::get($row, 'shareCount', 0),
                'saves' => (int) Arr::get($row, 'collectCount', 0),
            ],
            'posted_at' => Arr::get($row, 'createTimeISO'),
        ];
    }

    private function fromInstagram(array $row): array
    {
        $kind = match (Arr::get($row, 'type')) {
            'Video' => 'video',
            'Sidecar' => 'carousel',
            default => 'image',
        };

        return [
            'platform' => 'instagram',
            'external_id' => (string) Arr::get($row, 'id'),
            'url' => (string) Arr::get($row, 'url'),
            'caption' => (string) Arr::get($row, 'caption'),
            'hashtags' => array_values(array_filter(array_map(fn ($t) => ltrim((string) $t, '#'), Arr::get($row, 'hashtags') ?? []))),
            'kind' => $kind,
            'thumbnail' => Arr::get($row, 'displayUrl'),
            'duration' => Arr::get($row, 'videoDuration'),
            'author' => [
                'handle' => Arr::get($row, 'ownerUsername'),
                'name' => Arr::get($row, 'ownerFullName'),
                'avatar' => null,
                'followers' => 0,
                'verified' => false,
            ],
            'sound' => null,
            'metrics' => [
                'views' => (int) Arr::get($row, 'videoViewCount', 0),
                'likes' => (int) Arr::get($row, 'likesCount', 0),
                'comments' => (int) Arr::get($row, 'commentsCount', 0),
                'shares' => 0,
                'saves' => 0,
            ],
            'posted_at' => Arr::get($row, 'timestamp'),
        ];
    }

    /** @return list<string> */
    private function hashtags(?string $caption): array
    {
        preg_match_all('/#([\p{L}\p{N}_]+)/u', (string) $caption, $m);

        return array_values(array_unique($m[1] ?? []));
    }

    /** A hashtag the actors will accept, and a cache key that can't be poisoned. */
    private function tag(string $hashtag): string
    {
        return Str::lower(preg_replace('/[^\p{L}\p{N}_]/u', '', ltrim(trim($hashtag), '#')) ?? '');
    }
}

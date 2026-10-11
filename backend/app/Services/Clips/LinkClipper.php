<?php

namespace App\Services\Clips;

use App\Enums\PostFormat;
use App\Enums\PostStatus;
use App\Models\ActionLog;
use App\Models\Asset;
use App\Models\LinkClip;
use App\Services\Ai\UsageMeter;
use App\Services\Flows\SafeUrl;
use App\Services\Media\AssetStore;
use App\Services\Sound\AudioTools;
use App\Services\Sound\Listener;
use App\Services\Sound\ReelRenderer;
use App\Services\Sound\SoundClient;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * The complete source-link → vertical video → draft workflow. Each highlight keeps a clean
 * master (the video without any text), so its subtitles, look and music can be changed later
 * without going back to the source.
 */
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

    /** Render a finished highlight again from its master, with the subtitles, look and music it now has. */
    public function restyle(LinkClip $clip): void
    {
        $clip->loadMissing(['user', 'asset']);
        if (! $this->hasMaster($clip)) {
            $this->rebuildMaster($clip);
        }
        $clip->update(['status' => 'rendering']);
        $master = Storage::disk('local')->path($clip->master_path);
        $rendered = $this->styled($clip, $master);
        try {
            $old = $clip->asset;
            $title = $clip->title ?: 'Highlight';
            $asset = $this->assets->fromPath($clip->user, $rendered, 'video/mp4', Str::limit($title, 100, '').'.mp4', 'generated', [
                ...($old?->meta ?? []),
                'generator' => $clip->source_type === 'youtube' ? 'link-clip' : 'article-reel',
                'words' => $clip->analysis['words'] ?? [],
                'edited' => now()->toIso8601ZuluString(),
            ]);
            DB::transaction(function () use ($clip, $old, $asset) {
                if ($post = $clip->post) {
                    $ids = $post->assets()->pluck('assets.id')->all();
                    $post->syncAssets($old && in_array($old->id, $ids, true) ? array_map(fn (int $id) => $id === $old->id ? $asset->id : $id, $ids) : [...$ids, $asset->id]);
                }
                $clip->update(['status' => 'ready', 'asset_id' => $asset->id, 'error' => null]);
            });
            // The old render goes, unless something else still uses it.
            if ($old && ! DB::table('post_assets')->where('asset_id', $old->id)->exists()) {
                $old->delete();
            }
            ActionLog::record($clip->user, 'agent:clipper', 'clip.edited', $clip->post, 'Rendered an edited highlight: subtitles, style and music.', null, ['clip_id' => $clip->id]);
        } finally {
            @unlink($rendered);
        }
    }

    private function youtube(LinkClip $clip): void
    {
        $targets = $this->targets($clip);
        $targets->each->update(['status' => 'downloading', 'error' => null]);
        $source = $this->youtube->download($clip->source_url);
        try {
            $targets->each->update(['status' => 'analyzing', 'title' => $source['title']]);
            $heard = app(UsageMeter::class)->within($clip->user, $clip, 'clips:listen', fn () => $this->listener->file($source['path'], maxSeconds: YouTubeDownloader::MAX_SOURCE_SECONDS));
            $wanted = (int) ($clip->settings['seconds'] ?? 30);
            $plans = $this->planner->videos($clip, $heard, $source['duration'], $wanted, $source['title'], $targets->count());

            foreach ($targets as $index => $target) {
                $rendered = null;
                try {
                    $plan = $plans[$index] ?? $plans[0];
                    $seconds = max(3, $plan['end'] - $plan['start']);
                    $words = $this->inside($heard, $plan['start'], $plan['end']);
                    $target->update(['status' => 'rendering', 'title' => $plan['title'], 'analysis' => [...$plan, 'source_title' => $source['title'], 'author' => $source['author'], 'words' => $words]]);
                    $this->keepMaster($target, $this->clips->master($source['path'], $plan['start'], $seconds));
                    $rendered = $this->styled($target, Storage::disk('local')->path($target->master_path));
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

        $voice = $this->voice();
        $image = $this->image($article['image']);
        try {
            foreach ($targets as $index => $target) {
                $rendered = null;
                try {
                    $plan = $plans[$index] ?? $plans[0];
                    [$master, $spoken] = $this->narrate($plan['script'], $voice, $image);
                    $target->update(['status' => 'rendering', 'title' => $plan['title'], 'analysis' => [...$plan, 'source_title' => $article['title'], 'image' => $article['image'], 'voice' => $spoken['voice'], 'words' => $spoken['words']]]);
                    $this->keepMaster($target, $master);
                    $rendered = $this->styled($target, Storage::disk('local')->path($target->master_path));
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
                    @unlink((string) $rendered);
                }
            }
        } finally {
            @unlink((string) $image);
        }
    }

    /** @return array{id: string} */
    private function voice(?string $preferred = null): array
    {
        if (! $this->sound->up()) {
            throw new RuntimeException('FlowAI Sound is needed to narrate an article reel. Start the sound service and try again.');
        }
        $voices = collect($this->sound->voices());
        $voice = ($preferred ? $voices->firstWhere('id', $preferred) : null) ?? $voices->first();
        if (! $voice) {
            throw new RuntimeException('FlowAI Sound has no available narration voice.');
        }

        return $voice;
    }

    /**
     * The script spoken over the article's picture, without any text on it.
     *
     * @return array{0: string, 1: array{wav: string, words: list<array>, voice: string, lang: string|null}}
     */
    private function narrate(string $script, array $voice, ?string $image): array
    {
        $wav = tempnam(sys_get_temp_dir(), 'clip-voice').'.wav';
        try {
            $spoken = $this->sound->speak($script, $voice['id'], 1.0, true);
            file_put_contents($wav, $spoken['wav']);
            $master = $this->reels->render([
                'voice' => $wav,
                'words' => [],
                'background' => $image,
                'background_kind' => $image ? 'image' : null,
                'style' => 'bold',
                'title' => null,
                'captions' => false,
            ], $this->audio);

            return [$master, $spoken];
        } finally {
            @unlink($wav);
        }
    }

    /** The finished video from a master: subtitles, title and music as the clip's settings say. */
    private function styled(LinkClip $clip, string $master): string
    {
        $settings = $clip->settings ?? [];
        $transcript = $clip->analysis['words'] ?? $clip->asset?->meta['words'] ?? [];
        $style = ClipStyle::resolve($settings['style'] ?? null, (string) ($settings['accent'] ?? '#a5b4fc'), $clip->source_type, ClipStyle::arabic($transcript));
        $music = ClipStyle::resolveMusic($settings['music'] ?? null);
        $track = $music['asset_id'] ? Asset::where('user_id', $clip->user_id)->where('kind', 'audio')->find($music['asset_id']) : null;
        $seconds = $this->audio->duration($master) ?? (float) ($settings['seconds'] ?? 30);
        $words = $style['captions'] ? $transcript : [];

        return $this->clips->finish(
            $master,
            $seconds,
            $words,
            ClipStyle::look($style, $clip->analysis['title'] ?? $clip->title, $seconds),
            $track ? Storage::disk('local')->path($track->path) : null,
            (float) $music['volume'],
            (float) $music['original'],
        );
    }

    private function hasMaster(LinkClip $clip): bool
    {
        return $clip->master_path && Storage::disk('local')->exists($clip->master_path);
    }

    private function keepMaster(LinkClip $clip, string $file): void
    {
        $disk = Storage::disk('local');
        $path = "clips/{$clip->user_id}/{$clip->id}-".Str::random(10).'.mp4';
        $disk->makeDirectory(dirname($path));
        if (! @rename($file, $disk->path($path))) {
            copy($file, $disk->path($path));
            @unlink($file);
        }
        $old = $clip->master_path;
        $clip->update(['master_path' => $path]);
        if ($old && $old !== $path) {
            $disk->delete($old);
        }
    }

    /**
     * Highlights made before masters were kept: cut the moment from the source again, or speak
     * the article script again, keeping the edited words on the new timing.
     */
    private function rebuildMaster(LinkClip $clip): void
    {
        $analysis = $clip->analysis ?? [];
        $words = $analysis['words'] ?? $clip->asset?->meta['words'] ?? [];

        if ($clip->source_type === 'youtube') {
            if (! isset($analysis['start'], $analysis['end'])) {
                throw new RuntimeException('This highlight has no saved moment to cut again. Make it again from the link.');
            }
            $clip->update(['status' => 'downloading']);
            $source = $this->youtube->download($clip->source_url);
            try {
                $clip->update(['status' => 'rendering']);
                $this->keepMaster($clip, $this->clips->master($source['path'], (float) $analysis['start'], max(3, $analysis['end'] - $analysis['start'])));
            } finally {
                File::deleteDirectory($source['cleanup']);
            }
            $clip->update(['analysis' => [...$analysis, 'words' => $words]]);

            return;
        }

        $script = $analysis['script'] ?? $clip->asset?->meta['script'] ?? null;
        if (! filled($script)) {
            throw new RuntimeException('This highlight has no saved script to narrate again. Make it again from the link.');
        }
        $clip->update(['status' => 'writing']);
        $imageUrl = $analysis['image'] ?? null;
        if (! array_key_exists('image', $analysis)) {
            try {
                $imageUrl = $this->articles->read($clip->source_url)['image'];
            } catch (Throwable) {
                $imageUrl = null; // the gradient background will do
            }
        }
        $image = $this->image($imageUrl);
        try {
            [$master, $spoken] = $this->narrate($script, $this->voice($analysis['voice'] ?? $clip->asset?->meta['voice'] ?? null), $image);
        } finally {
            @unlink((string) $image);
        }
        $this->keepMaster($clip, $master);
        $clip->update(['analysis' => [...$analysis, 'image' => $imageUrl, 'voice' => $spoken['voice'], 'words' => $this->retime($words, $spoken['words'], (float) ($clip->asset?->duration ?? 0))]]);
    }

    /** Edited words on a new narration: the new timing word for word, or the old timing stretched to fit. */
    private function retime(array $edited, array $spoken, float $oldDuration): array
    {
        if (! $edited || count($edited) === count($spoken)) {
            return $edited ? array_map(fn ($w, $s) => [...$s, 'text' => $w['text']], $edited, $spoken) : $spoken;
        }
        $newEnd = (float) (end($spoken)['end'] ?? 0);
        $oldEnd = (float) (end($edited)['end'] ?? $oldDuration);
        $k = $oldEnd > 0 && $newEnd > 0 ? $newEnd / $oldEnd : 1.0;

        return array_map(fn ($w) => [...$w, 'start' => round($w['start'] * $k, 3), 'end' => round($w['end'] * $k, 3)], $edited);
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
        $platform = array_key_exists($clip->settings['platform'] ?? null, LinkClip::PLACEMENTS) ? $clip->settings['platform'] : 'tiktok';
        $placement = $clip->placement();
        $post = $clip->user->posts()->create([
            'title' => Str::limit($plan['title'], 110, ''),
            // Stories show no caption.
            'body' => $placement === 'story' ? '' : Str::limit($plan['caption'], 2100, ''),
            'format' => PostFormat::Video,
            'placement' => $placement,
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

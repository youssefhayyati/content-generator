<?php

namespace App\Services\Ai\Media;

use App\Jobs\PollGeneration;
use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\Models\Recipes;
use App\Services\Ai\UsageMeter;
use App\Services\Campaigns\Pipeline;
use App\Services\Media\AssetStore;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Takes an image or video generation from queued to done: submit to the provider, poll
 * (through the queue, never a tight loop), bring the results into the media library, record
 * the cost, and move a recipe on to its next step.
 */
class GenerationRunner
{
    /** Give up on a provider that hasn't answered after this long. */
    public const MAX_MINUTES = 30;

    public function __construct(
        private readonly ModelRegistry $models,
        private readonly AssetStore $assets,
        private readonly UsageMeter $usage,
    ) {}

    public function start(Generation $generation): void
    {
        // A reel isn't a model's work: it's rendered here, from what's already in the library.
        $model = $generation->kind === 'reel' ? ['id' => 'studio/reel', 'provider' => 'studio', 'kind' => 'reel', 'label' => 'Reel renderer', 'available' => true] : $this->models->find($generation->model);
        try {
            if (! $model || $model['kind'] !== $generation->kind) {
                throw new GenerationFailed('That model can’t make '.(['video' => 'videos', 'image' => 'images', 'voice' => 'voiceovers', 'music' => 'music'][$generation->kind] ?? 'that').'.');
            }
            if (! $model['available']) {
                throw new GenerationFailed("{$model['label']} isn’t available: {$model['reason']}");
            }

            $generation->update(['status' => 'running', 'started_at' => now(), 'error' => null]);
            $result = $this->provider($model)->submit($model, $generation, $generation->inputs());

            if (isset($result['outputs'])) {
                $this->finish($generation, $result['outputs']);
            } else {
                $generation->update(['external_id' => $result['external_id'], 'status_url' => $result['status_url']]);
                PollGeneration::dispatch($generation->id)->delay(now()->addSeconds(5));
            }
        } catch (GenerationFailed $e) {
            $this->fail($generation, $e->getMessage());
        }
    }

    /**
     * @return bool whether the generation is finished
     */
    public function poll(Generation $generation): bool
    {
        if ($generation->isFinished()) {
            return true;
        }
        if ($generation->started_at && $generation->started_at->diffInMinutes(now()) >= self::MAX_MINUTES) {
            $this->fail($generation, 'The provider didn’t finish within '.self::MAX_MINUTES.' minutes.');

            return true;
        }

        try {
            $model = $this->models->find($generation->model);
            $result = $this->provider($model)->poll($generation);
        } catch (GenerationFailed $e) {
            // A hiccup while asking isn't a failed generation; ask again next time.
            report($e);

            return false;
        }

        if ($result['status'] === 'succeeded') {
            $this->finish($generation, $result['outputs'] ?? []);

            return true;
        }
        if ($result['status'] === 'failed') {
            $this->fail($generation, $result['error'] ?? 'The provider couldn’t make this one.');

            return true;
        }

        return false;
    }

    /**
     * @param  list<array{url?: string, b64?: string, mime: string}>  $outputs
     */
    public function finish(Generation $generation, array $outputs): void
    {
        $user = $generation->user;
        $ids = [];
        try {
            foreach ($outputs as $i => $out) {
                $contents = match (true) {
                    isset($out['b64']) => base64_decode($out['b64']),
                    isset($out['path']) => (string) file_get_contents($out['path']),
                    default => Http::timeout(300)->withHeaders($out['headers'] ?? [])->get($out['url'])->throw()->body(),
                };
                if (isset($out['path'])) {
                    @unlink($out['path']);
                }
                $mime = $out['mime'] === 'audio/mpeg' ? 'audio/mpeg' : ((new \finfo(FILEINFO_MIME_TYPE))->buffer($contents) ?: $out['mime']);
                $ids[] = $this->assets->fromContents($user, $contents, $mime, $this->name($generation, $i, $mime), 'generated', [
                    'generation_id' => $generation->id, 'model' => $generation->model, 'prompt' => $generation->prompt, ...$out['meta'] ?? [],
                ])->id;
            }
        } catch (ConnectionException|Throwable $e) {
            report($e);
            $this->fail($generation, 'The result was made, but couldn’t be downloaded. Try again.');

            return;
        }

        if (! $ids) {
            $this->fail($generation, 'The provider finished without returning anything.');

            return;
        }

        [$provider, $name] = explode('/', $generation->model, 2);
        $price = (config("ai.providers.{$provider}.models") ?? [])[$name]['price'] ?? null;
        $cost = $price ? $price * count($ids) : 0;
        $this->usage->within($user, $generation, 'studio', fn () => $this->usage->record($provider, $generation->model, 0, 0, $cost));

        $generation->update(['status' => 'succeeded', 'output_asset_ids' => $ids, 'cost' => $cost, 'finished_at' => now()]);
        app(Recipes::class)->advance($generation);
        $this->report($generation);
    }

    public function fail(Generation $generation, string $error): void
    {
        $generation->update(['status' => 'failed', 'error' => $error, 'finished_at' => now()]);
        $this->report($generation);
    }

    /** A campaign's media team is waiting on this one. */
    private function report(Generation $generation): void
    {
        if ($generation->campaign_item_id) {
            app(Pipeline::class)->mediaSettled($generation->fresh());
        }
    }

    /**
     * @param  array<string, mixed>  $model
     */
    private function provider(array $model): MediaProvider
    {
        return match ($model['provider']) {
            'higgsfield' => app(HiggsfieldProvider::class),
            'gateway' => app(GatewayImageProvider::class),
            'sound' => app(SoundProvider::class),
            'studio' => app(ReelProvider::class),
            'google' => app(GoogleGenAiProvider::class),
            default => throw new GenerationFailed('That provider doesn’t make media.'),
        };
    }

    private function name(Generation $generation, int $i, string $mime): string
    {
        $words = (string) str($generation->prompt)->lower()->replaceMatches('/[^\pL\pN]+/u', '-')->trim('-')->limit(40, '');

        $ext = match (true) {
            str_starts_with($mime, 'video/') => 'mp4',
            str_starts_with($mime, 'audio/') => 'mp3',
            default => 'png',
        };

        return ($words ?: $generation->kind)."{$this->suffix($i)}.{$ext}";
    }

    private function suffix(int $i): string
    {
        return $i ? '-'.($i + 1) : '';
    }
}

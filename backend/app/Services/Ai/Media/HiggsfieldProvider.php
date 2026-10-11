<?php

namespace App\Services\Ai\Media;

use App\Models\Asset;
use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use App\Services\Lab\Media;
use App\Services\Lab\NodeFailed;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

/**
 * Higgsfield's models and tools: a request per generation (pictures and video uploaded first), polled until
 * done. Soul ID is the exception: it trains a character, polled at its own address.
 */
class HiggsfieldProvider implements MediaProvider
{
    public function __construct(private readonly HiggsfieldClient $client) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        $spec = config('ai.providers.higgsfield.models.'.$model['model']);
        if ($generation->kind === 'character') {
            return $this->character($spec, $generation, $inputs);
        }
        $allParams = $generation->params ?? [];
        $images = $inputs->where('kind', 'image')->values();
        $videos = $inputs->where('kind', 'video')->values();

        if (! empty($spec['requires_image']) && $images->isEmpty()) {
            throw new GenerationFailed("{$spec['label']} starts from an image. Pick one first.");
        }
        if (! empty($spec['requires_video']) && $videos->isEmpty()) {
            throw new GenerationFailed("{$spec['label']} starts from a video. Pick one first.");
        }
        // An image-to-video route takes fewer settings than its text-to-video twin (the shape comes from
        // the picture), and a setting a route doesn't list is refused outright.
        $i2v = $images->isNotEmpty() && ! empty($spec['i2v_route']);
        $allowed = $i2v && isset($spec['i2v_params']) ? $spec['i2v_params'] : ($spec['params'] ?? []);
        $params = collect($allParams)->only($allowed)->filter(fn ($v) => $v !== null && $v !== '')->all();
        // A shape the model doesn't offer is refused outright (a bare 400), so ask for one it does.
        if (isset($params['aspect_ratio'])) {
            $params['aspect_ratio'] = self::fitRatio((string) $params['aspect_ratio'], $spec['capabilities']['aspect_ratios'] ?? []);
        }
        // So is a batch size it doesn't make (Soul: 1 or 4): the largest it makes, up to the one asked.
        if (isset($params['batch_size']) && ($sizes = $spec['capabilities']['batch_sizes'] ?? null)) {
            $params['batch_size'] = collect($sizes)->filter(fn ($n) => $n <= (int) $params['batch_size'])->max() ?? $sizes[0];
        }
        // An empty prompt is stored as "(no prompt)": never send that as an instruction.
        $prompt = trim((string) $generation->prompt);
        $prompt = $prompt === '(no prompt)' ? '' : $prompt;
        $body = array_merge($spec['extra'] ?? [], $prompt !== '' || empty($spec['prompt_optional']) ? ['prompt' => $prompt] : [], $params);

        $uploads = $images->map(fn ($image) => $this->client->upload(Storage::disk('local')->get($image->path), $image->mime))->all();
        if ($uploads && ! empty($spec['image_field'])) {
            $body[$spec['image_field']] = $uploads[0];
        }
        if ($uploads && ! empty($spec['reference_field'])) {
            $body[$spec['reference_field']] = ! empty($spec['reference_list']) ? array_slice($uploads, 0, max(1, (int) ($spec['capabilities']['max_inputs'] ?? 10))) : $uploads[0];
        }
        if (count($uploads) > 1 && ! empty($spec['end_frame_field'])) {
            $body[$spec['end_frame_field']] = $uploads[1];
        }
        if ($videos->isNotEmpty() && ! empty($spec['video_field'])) {
            $body[$spec['video_field']] = $this->client->upload($this->mp4($videos->first()), 'video/mp4');
        }
        if (array_key_exists('audio', $allParams) && ! empty($spec['audio_field'])) {
            $audio = filter_var($allParams['audio'], FILTER_VALIDATE_BOOLEAN);
            $body[$spec['audio_field']] = $spec['audio_values'][$audio ? 0 : 1] ?? $audio;
        }

        $route = $i2v ? $spec['i2v_route'] : $spec['route'];
        if (! $route) {
            throw new GenerationFailed("{$spec['label']} does not have an API route yet.");
        }
        $request = $this->client->submit($route, $body, $this->idempotencyKey($generation, $route, $body));

        return ['external_id' => $request['request_id'], 'status_url' => $request['status_url']];
    }

    /**
     * Soul ID: the pictures go up, and Higgsfield trains a character on them (a few minutes). Its id is
     * what Soul pictures take (custom_reference_id) to keep that face.
     *
     * @param  array<string, mixed>  $spec
     * @param  Collection<int, Asset>  $inputs
     * @return array{external_id: string, status_url: string}
     */
    private function character(array $spec, Generation $generation, Collection $inputs): array
    {
        $images = $inputs->where('kind', 'image')->take(100)->values();
        if ($images->isEmpty()) {
            throw new GenerationFailed('A character is trained from pictures of the person: connect some.');
        }
        $urls = $images->map(fn ($image) => $this->client->upload(Storage::disk('local')->get($image->path), $image->mime))->all();
        $p = $generation->params ?? [];
        $version = in_array($p['version'] ?? null, ['v1', 'v2', 'cinema'], true) ? $p['version'] : 'v2';
        $body = ['name' => (string) ($p['name'] ?? 'Character'), 'version' => $version, 'images' => $urls];
        $made = $this->client->createCharacter($body['name'], $version, $urls, $this->idempotencyKey($generation, $spec['route'], $body));

        return ['external_id' => $made['id'], 'status_url' => $made['status_url']];
    }

    /**
     * The file as an MP4 for upload (the only video Higgsfield takes): as it is when it is one,
     * otherwise converted. Its contents.
     */
    private function mp4(Asset $video): string
    {
        $path = Storage::disk('local')->path($video->path);
        if ($video->mime === 'video/mp4') {
            return (string) file_get_contents($path);
        }
        $out = Media::tmp('mp4');
        try {
            Media::ffmpeg(['-i', $path, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', $out], 'convert the video to MP4');

            return (string) file_get_contents($out);
        } catch (NodeFailed $e) {
            throw new GenerationFailed($e->getMessage());
        } finally {
            @unlink($out);
        }
    }

    /**
     * The shape to ask for: the one wanted if the model offers it, otherwise the closest it does
     * offer, stepping toward square. Callers ask for the shape a platform wants, and platform
     * limits cap how tall or wide a picture may be, so moving toward square stays inside them
     * where the merely nearest shape might not: an Instagram feed post asks for 4:5, and a model
     * without 4:5 should make 1:1 (allowed) rather than 3:4 (too tall for the feed).
     *
     * @param  list<string>  $offered
     */
    public static function fitRatio(string $wanted, array $offered): string
    {
        $value = fn (string $r): ?float => preg_match('/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/', $r, $m) && (float) $m[1] > 0 && (float) $m[2] > 0 ? (float) $m[1] / (float) $m[2] : null;
        $w = $value($wanted);
        if (! $offered || in_array($wanted, $offered, true) || $w === null) {
            return $wanted;
        }
        $shapes = collect($offered)->filter(fn ($r) => $value((string) $r) !== null);
        $towardSquare = $shapes->filter(fn ($r) => $value($r) >= min($w, 1.0) - 1e-9 && $value($r) <= max($w, 1.0) + 1e-9);

        return ($towardSquare->isNotEmpty() ? $towardSquare : $shapes)
            ->sortBy(fn ($r) => abs(log($value($r)) - log($w)))
            ->first() ?? $wanted;
    }

    /**
     * Stable for one body so a queue retry of the same job cannot be charged twice, and distinct
     * for anything else. The generation id alone is not enough: ids are reused once a row is
     * deleted, and Higgsfield remembers a key for about a day, so a reused id either earns a 422
     * ("already used with different request parameters") or — worse, silently — hands back the
     * image belonging to the deleted generation.
     *
     * @param  array<string, mixed>  $body
     */
    private function idempotencyKey(Generation $generation, string $route, array $body): string
    {
        $fingerprint = substr(hash('sha256', $route."\n".json_encode($body)), 0, 16);

        return "flowai-generation-{$generation->id}-".($generation->created_at?->getTimestamp() ?? 0)."-{$fingerprint}";
    }

    public function poll(Generation $generation): array
    {
        $status = $this->client->status($generation->status_url);
        if ($generation->kind === 'character') {
            return $this->characterStatus($generation, $status);
        }

        return match ($status['status'] ?? null) {
            'queued' => ['status' => 'queued'],
            'in_progress', 'processing' => ['status' => 'running'],
            'completed' => ['status' => 'succeeded', 'outputs' => [
                ...collect($status['images'] ?? [])->map(fn ($i) => ['url' => $i['url'], 'mime' => 'image/png'])->all(),
                ...(isset($status['video']['url']) ? [['url' => $status['video']['url'], 'mime' => 'video/mp4']] : []),
                ...collect($status['videos'] ?? [])->map(fn ($v) => ['url' => $v['url'], 'mime' => 'video/mp4'])->all(),
            ]],
            'nsfw' => ['status' => 'failed', 'error' => 'Higgsfield flagged the result as unsafe and withheld it. Edit the prompt and try again.'],
            'canceled' => ['status' => 'failed', 'error' => 'The request was canceled.'],
            // Higgsfield's own reason is often a bare "Generation failed", which reads like a blip
            // worth retrying. Name the model, since a model the plan can't run fails every time.
            default => ['status' => 'failed', 'error' => (config('ai.providers.higgsfield.models.'.str_replace('higgsfield/', '', (string) $generation->model).'.label') ?? 'This model')
                .' failed on Higgsfield’s side'.(filled($status['error'] ?? null) ? " (“{$status['error']}”)" : '').'. Try again, or pick another model.'],
        };
    }

    /**
     * A character in training. Done, it comes back as its thumbnail (or the first picture it learned
     * from), carrying its id for the Soul pictures made with it.
     *
     * @param  array<string, mixed>  $status
     * @return array<string, mixed>
     */
    private function characterStatus(Generation $generation, array $status): array
    {
        $meta = ['custom_reference_id' => (string) ($status['id'] ?? $generation->external_id), 'soul_version' => (string) ($status['model_version'] ?? $generation->params['version'] ?? 'v2')];

        return match ($status['status'] ?? null) {
            'not_ready', 'queued' => ['status' => 'queued'],
            'in_progress' => ['status' => 'running'],
            'completed' => ['status' => 'succeeded', 'outputs' => [filled($status['thumbnail_url'] ?? null)
                ? ['url' => $status['thumbnail_url'], 'mime' => 'image/png', 'meta' => $meta]
                : ['path' => $this->firstPicture($generation), 'mime' => 'image/png', 'meta' => $meta]]],
            default => ['status' => 'failed', 'error' => 'Higgsfield couldn’t train the character'.(filled($status['fail_reason'] ?? null) ? " (“{$status['fail_reason']}”)" : '').'. Use clear, well-lit photos of one person, the face visible.'],
        };
    }

    /** A copy of the first picture the character learned from (the runner removes it once kept). */
    private function firstPicture(Generation $generation): string
    {
        $asset = $generation->inputs()->firstWhere('kind', 'image') ?? throw new GenerationFailed('The character is trained, but there is no picture to show for it.');
        $copy = Media::tmp(pathinfo($asset->path, PATHINFO_EXTENSION) ?: 'png');
        copy(Storage::disk('local')->path($asset->path), $copy);

        return $copy;
    }
}

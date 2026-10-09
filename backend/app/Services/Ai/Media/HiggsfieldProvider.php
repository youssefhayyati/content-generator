<?php

namespace App\Services\Ai\Media;

use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

class HiggsfieldProvider implements MediaProvider
{
    public function __construct(private readonly HiggsfieldClient $client) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        $spec = config('ai.providers.higgsfield.models.'.$model['model']);
        $allParams = $generation->params ?? [];
        $params = collect($allParams)->only($spec['params'] ?? [])->filter(fn ($v) => $v !== null && $v !== '')->all();
        // A shape the model doesn't offer is refused outright (a bare 400), so ask for one it does.
        if (isset($params['aspect_ratio'])) {
            $params['aspect_ratio'] = self::fitRatio((string) $params['aspect_ratio'], $spec['capabilities']['aspect_ratios'] ?? []);
        }
        $body = array_merge($spec['extra'] ?? [], ['prompt' => $generation->prompt], $params);
        $images = $inputs->where('kind', 'image')->values();

        if (! empty($spec['requires_image']) && $images->isEmpty()) {
            throw new GenerationFailed("{$spec['label']} starts from an image. Pick one first.");
        }
        $uploads = $images->map(fn ($image) => $this->client->upload(Storage::disk('local')->get($image->path), $image->mime))->all();
        if ($uploads && ! empty($spec['image_field'])) {
            $body[$spec['image_field']] = $uploads[0];
        }
        if ($uploads && ! empty($spec['reference_field'])) {
            $body[$spec['reference_field']] = ! empty($spec['reference_list']) ? $uploads : $uploads[0];
        }
        if (count($uploads) > 1 && ! empty($spec['end_frame_field'])) {
            $body[$spec['end_frame_field']] = $uploads[1];
        }
        if (array_key_exists('audio', $allParams) && ! empty($spec['audio_field'])) {
            $audio = filter_var($allParams['audio'], FILTER_VALIDATE_BOOLEAN);
            $body[$spec['audio_field']] = $spec['audio_values'][$audio ? 0 : 1] ?? $audio;
        }

        $route = $uploads && ! empty($spec['i2v_route']) ? $spec['i2v_route'] : $spec['route'];
        if (! $route) {
            throw new GenerationFailed("{$spec['label']} does not have an API route yet.");
        }
        $request = $this->client->submit($route, $body, $this->idempotencyKey($generation, $route, $body));

        return ['external_id' => $request['request_id'], 'status_url' => $request['status_url']];
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
}

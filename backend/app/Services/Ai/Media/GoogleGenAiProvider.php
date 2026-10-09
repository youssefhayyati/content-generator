<?php

namespace App\Services\Ai\Media;

use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

class GoogleGenAiProvider implements MediaProvider
{
    public function __construct(private readonly GoogleGenAiClient $client) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        return $generation->kind === 'image'
            ? $this->image($model['model'], $generation, $inputs)
            : $this->video($model['model'], $generation, $inputs);
    }

    public function poll(Generation $generation): array
    {
        $operation = $this->client->operation((string) $generation->status_url);
        if (! ($operation['done'] ?? false)) {
            return ['status' => 'running'];
        }
        if (isset($operation['error'])) {
            return ['status' => 'failed', 'error' => $operation['error']['message'] ?? 'Google couldn’t make this video.'];
        }
        $uri = data_get($operation, 'response.generateVideoResponse.generatedSamples.0.video.uri')
            ?? data_get($operation, 'response.generatedVideos.0.video.uri');
        if (! $uri) {
            return ['status' => 'failed', 'error' => 'Google finished without returning a video.'];
        }

        return ['status' => 'succeeded', 'outputs' => [[
            'url' => $uri, 'mime' => 'video/mp4', 'headers' => $this->client->downloadHeaders(),
        ]]];
    }

    private function image(string $model, Generation $generation, Collection $inputs): array
    {
        $parts = [['text' => $generation->prompt]];
        foreach ($inputs->where('kind', 'image')->take(10) as $asset) {
            $parts[] = ['inline_data' => ['mime_type' => $asset->mime, 'data' => base64_encode(Storage::disk('local')->get($asset->path))]];
        }
        $params = $generation->params ?? [];
        $image = array_filter([
            'aspectRatio' => $params['aspect_ratio'] ?? null,
            'imageSize' => $params['resolution'] ?? null,
        ]);
        $response = $this->client->generateImage($model, [
            'contents' => [['parts' => $parts]],
            'generationConfig' => ['responseModalities' => ['IMAGE'], 'imageConfig' => (object) $image],
        ]);
        $outputs = collect(data_get($response, 'candidates.0.content.parts', []))
            ->map(function (array $part) {
                $blob = $part['inlineData'] ?? $part['inline_data'] ?? null;
                if (! $blob || empty($blob['data'])) {
                    return null;
                }

                return ['b64' => $blob['data'], 'mime' => $blob['mimeType'] ?? $blob['mime_type'] ?? 'image/png'];
            })->filter()->values()->all();
        if (! $outputs) {
            $blocked = data_get($response, 'promptFeedback.blockReason');
            throw new GenerationFailed($blocked ? "Google blocked that prompt ({$blocked}). Try different wording." : 'Google finished without returning an image.');
        }

        return ['outputs' => $outputs];
    }

    private function video(string $model, Generation $generation, Collection $inputs): array
    {
        $images = $inputs->where('kind', 'image')->take(2)->values();
        $instance = ['prompt' => $generation->prompt];
        if ($first = $images->get(0)) {
            $instance['image'] = $this->inlineImage($first);
        }
        if ($last = $images->get(1)) {
            $instance['lastFrame'] = $this->inlineImage($last);
        }
        $params = $generation->params ?? [];
        $parameters = array_filter([
            'aspectRatio' => $params['aspect_ratio'] ?? null,
            'durationSeconds' => isset($params['duration']) ? (string) $params['duration'] : null,
            'resolution' => $params['resolution'] ?? null,
            'seed' => $params['seed'] ?? null,
        ], fn ($value) => $value !== null && $value !== '');
        $operation = $this->client->generateVideo($model, ['instances' => [$instance], 'parameters' => (object) $parameters]);

        return ['external_id' => $operation['name'], 'status_url' => $operation['name']];
    }

    private function inlineImage($asset): array
    {
        return ['inlineData' => ['mimeType' => $asset->mime, 'data' => base64_encode(Storage::disk('local')->get($asset->path))]];
    }
}

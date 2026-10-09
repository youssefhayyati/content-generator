<?php

namespace App\Services\Ai\Media;

use App\Services\Ai\GenerationFailed;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

class GoogleGenAiClient
{
    private function http(): PendingRequest
    {
        return Http::baseUrl(rtrim((string) config('ai.providers.google.url'), '/'))
            ->withHeaders(['x-goog-api-key' => config('ai.providers.google.key')])
            ->acceptJson()->timeout(120);
    }

    /** @return array<string, mixed> */
    public function generateImage(string $model, array $body): array
    {
        return $this->call(fn () => $this->http()->post("/models/{$model}:generateContent", $body))->json() ?? [];
    }

    /** @return array{name: string} */
    public function generateVideo(string $model, array $body): array
    {
        $r = $this->call(fn () => $this->http()->post("/models/{$model}:predictLongRunning", $body));
        if (! $r->json('name')) {
            throw new GenerationFailed('Google didn’t start the video generation.');
        }

        return ['name' => $r->json('name')];
    }

    /** @return array<string, mixed> */
    public function operation(string $name): array
    {
        return $this->call(fn () => $this->http()->get('/'.ltrim($name, '/')))->json() ?? [];
    }

    public function downloadHeaders(): array
    {
        return ['x-goog-api-key' => (string) config('ai.providers.google.key')];
    }

    private function call(callable $send): Response
    {
        try {
            /** @var Response $r */
            $r = $send();
        } catch (ConnectionException) {
            throw new GenerationFailed('Couldn’t reach Google’s generation service. Try again in a moment.');
        }

        return match (true) {
            $r->successful() => $r,
            in_array($r->status(), [401, 403], true) => throw new GenerationFailed('Google rejected the Gemini API key or this model is not enabled for it.'),
            $r->status() === 429 => throw new GenerationFailed('Google is rate limiting this project. Give it a minute.'),
            $r->status() === 400 => throw new GenerationFailed('Google didn’t accept those settings: '.($r->json('error.message') ?? 'invalid request')),
            default => throw new GenerationFailed("Google couldn’t take the request ({$r->status()})."),
        };
    }
}

<?php

namespace App\Services\Ai\Media;

use App\Services\Ai\GenerationFailed;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Higgsfield's API (docs.higgsfield.ai): `Authorization: Key id:secret`, one POST route per
 * model, then poll the returned status_url until the request is completed. Input images go up
 * first through a presigned upload, since the studio's own files are private.
 */
class HiggsfieldClient
{
    private function http(): PendingRequest
    {
        return Http::baseUrl(rtrim((string) config('ai.providers.higgsfield.url'), '/'))
            ->withHeaders(['Authorization' => 'Key '.config('ai.providers.higgsfield.key_id').':'.config('ai.providers.higgsfield.key_secret')])
            ->acceptJson()
            ->timeout(60);
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{request_id: string, status_url: string}
     */
    public function submit(string $route, array $body, string $idempotencyKey): array
    {
        $r = $this->call(fn () => $this->http()->withHeaders(['Idempotency-Key' => $idempotencyKey])->post($route, $body));

        if (! $r->json('request_id')) {
            throw new GenerationFailed('Higgsfield didn’t accept the request.');
        }

        $id = (string) $r->json('request_id');

        return ['request_id' => $id, 'status_url' => (string) ($r->json('status_url') ?: "/requests/{$id}/status")];
    }

    /**
     * @return array<string, mixed>
     */
    public function status(string $statusUrl): array
    {
        return $this->call(fn () => $this->http()->get($statusUrl))->json() ?? [];
    }

    /**
     * Upload a file so a model can read it; returns the public URL to pass as image_url.
     */
    public function upload(string $contents, string $mime): string
    {
        $slot = $this->call(fn () => $this->http()->post('/files/generate-upload-url', ['content_type' => $mime]));
        // The presigned URL gets the file and its own headers, never the API credentials.
        $put = Http::timeout(120)->withHeaders((array) $slot->json('upload_headers', []) + ['Content-Type' => $mime])
            ->withBody($contents, $mime)->put($slot->json('upload_url'));
        if (! $put->successful()) {
            throw new GenerationFailed('Couldn’t upload the input image to Higgsfield.');
        }

        return (string) $slot->json('public_url');
    }

    /**
     * Check the credentials without starting (or paying for) anything: ask for a request that
     * doesn't exist. Bad credentials are refused; good ones get "not found".
     */
    public function test(): string
    {
        if (! filled(config('ai.providers.higgsfield.key_id')) || ! filled(config('ai.providers.higgsfield.key_secret'))) {
            throw new GenerationFailed('No Higgsfield API key is set.');
        }
        try {
            $r = $this->http()->timeout(10)->get('/requests/00000000-0000-0000-0000-000000000000/status');
        } catch (ConnectionException) {
            throw new GenerationFailed('Couldn’t reach Higgsfield.');
        }
        if (in_array($r->status(), [401, 403], true)) {
            throw new GenerationFailed('Higgsfield rejected the key.');
        }

        return 'Connected. The key is accepted.';
    }

    /**
     * Why Higgsfield refused, in its own words. `detail` is a list of field errors on a schema
     * failure but a bare string on everything else, and losing that string turns a precise
     * complaint ("Idempotency-Key was already used with different request parameters") into an
     * unactionable "invalid request".
     */
    private function reason(Response $r): string
    {
        $detail = $r->json('detail');

        return match (true) {
            is_string($detail) && trim($detail) !== '' => $detail,
            is_array($detail) => collect($detail)
                ->map(fn ($d) => is_array($d)
                    ? trim(implode(' ', array_filter([is_array($d['loc'] ?? null) ? implode('.', $d['loc']).':' : null, $d['msg'] ?? null])))
                    : (is_string($d) ? $d : null))
                ->filter()->take(3)->join('; ') ?: 'invalid request',
            default => $r->json('message') ?? 'invalid request',
        };
    }

    private function call(callable $send): Response
    {
        try {
            /** @var Response $r */
            $r = $send();
        } catch (ConnectionException) {
            throw new GenerationFailed('Couldn’t reach Higgsfield. Try again in a moment.');
        }

        return match (true) {
            $r->successful() => $r,
            in_array($r->status(), [401, 403], true) => throw new GenerationFailed('Higgsfield rejected the key.'),
            $r->status() === 402 => throw new GenerationFailed('Higgsfield says the plan is out of credit.'),
            $r->status() === 422 => throw new GenerationFailed('Higgsfield didn’t accept those settings: '.$this->reason($r).'.'),
            $r->status() === 429 => throw new GenerationFailed('Higgsfield is rate limiting. Give it a minute.'),
            default => throw new GenerationFailed("Higgsfield couldn’t take the request ({$r->status()})."),
        };
    }
}

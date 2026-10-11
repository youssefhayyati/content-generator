<?php

namespace App\Services\Lab;

use App\Services\Ai\GenerationFailed;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * The assistant service's engine (assistant/backend/engine.py): the GPU pod's models (ComfyUI
 * workflows, ACE-Step songs, LatentSync dubs, face swaps) and the assistant's own drawing (words on
 * pictures, pictures into a video with a voice, painting over part of a picture), one job at a time:
 * POST /engine/jobs gives an id, GET /engine/jobs/{id} says how far it has got, its files come from
 * /engine/jobs/{id}/files/{n}.
 */
class EngineClient
{
    public function url(): string
    {
        return rtrim((string) config('ai.engine.url'), '/');
    }

    public function configured(): bool
    {
        return filled(config('ai.engine.url'));
    }

    /**
     * @return array<string, string>
     */
    public function headers(): array
    {
        return filled(config('ai.engine.key')) ? ['X-Engine-Key' => (string) config('ai.engine.key')] : [];
    }

    /**
     * What the engine can do right now: its workflows, its services, its voices and fonts. Null when it
     * doesn't answer. Asked at most every 30 seconds.
     *
     * @return array<string, mixed>|null
     */
    public function catalog(bool $fresh = false): ?array
    {
        if (! $this->configured()) {
            return null;
        }
        if ($fresh) {
            Cache::forget('lab.engine.catalog');
        }

        return Cache::remember('lab.engine.catalog', 30, function () {
            try {
                $r = Http::timeout(6)->withHeaders($this->headers())->acceptJson()->get($this->url().'/engine/catalog');

                return match (true) {
                    $r->successful() => $r->json(),
                    // Both sides read ENGINE_KEY from the one .env: the assistant has an older copy of it.
                    in_array($r->status(), [401, 403], true) => ['error' => 'The assistant rejected ENGINE_KEY: it started before .env changed. Recreate it: docker compose up -d assistant.'],
                    default => ['error' => "The assistant’s engine answered {$r->status()}."],
                };
            } catch (ConnectionException) {
                return ['error' => 'The assistant service isn’t answering. Start it (docker compose up -d assistant).'];
            }
        });
    }

    /**
     * The voices to pick from, as the assistant's own picker shows them: `ready` (made, cloned or set
     * up), the `catalog` matching the words and language, its `languages`, and whether it `clonable`.
     *
     * @return array<string, mixed>
     *
     * @throws GenerationFailed
     */
    public function voiceList(string $query = '', string $lang = ''): array
    {
        return $this->call(fn () => Http::timeout(20)->withHeaders($this->headers())->acceptJson()->get($this->url().'/engine/voices/list', ['q' => $query, 'lang' => $lang]))->json();
    }

    /** How a voice sounds, as WAV bytes. */
    public function voiceSample(string $id, bool $catalog): string
    {
        return $this->call(fn () => Http::timeout(120)->withHeaders($this->headers())->get($this->url().'/engine/voices/sample', ['id' => $id, 'catalog' => $catalog ? 'true' : 'false']))->body();
    }

    /**
     * A catalog voice set up as a ready one (or a ready one by its id): its profile.
     *
     * @return array<string, mixed>
     */
    public function useVoice(string $id): array
    {
        return $this->call(fn () => Http::timeout(120)->withHeaders($this->headers())->acceptJson()->post($this->url().'/engine/voices/use', ['id' => $id]))->json();
    }

    /**
     * A voice cloned from a recording (audio, or a video's sound): its profile.
     *
     * @return array<string, mixed>
     */
    public function cloneVoice(string $path, string $filename, string $name): array
    {
        return $this->call(fn () => Http::timeout(300)->withHeaders($this->headers())->acceptJson()
            ->attach('recording', fopen($path, 'r'), $filename)
            ->post($this->url().'/engine/voices/clone', ['name' => $name]))->json();
    }

    /**
     * @param  callable(): Response  $request
     *
     * @throws GenerationFailed with the engine's own words when it refused
     */
    private function call(callable $request): Response
    {
        if (! $this->configured()) {
            throw new GenerationFailed('The assistant’s engine isn’t set up: set ENGINE_URL (and ENGINE_KEY) for the API.');
        }
        try {
            $r = $request();
        } catch (ConnectionException) {
            throw new GenerationFailed('The assistant service isn’t answering. Start it (docker compose up -d assistant).');
        }
        if ($r->failed()) {
            throw new GenerationFailed(is_string($r->json('detail')) ? ucfirst($r->json('detail')).'.' : "The assistant’s engine answered {$r->status()}.");
        }

        return $r;
    }

    /**
     * Voices the engine reads with (the assistant's TTS: VoiceStudio or OmniVoice), searched.
     *
     * @return list<array<string, mixed>>
     */
    public function voices(string $query = ''): array
    {
        try {
            $r = Http::timeout(15)->withHeaders($this->headers())->acceptJson()->get($this->url().'/engine/voices', ['q' => $query]);

            return $r->successful() ? (array) $r->json('voices', []) : [];
        } catch (ConnectionException) {
            return [];
        }
    }

    /**
     * @param  array<string, mixed>  $params
     * @param  array<string, array{0: string, 1: string}|list<array{0: string, 1: string}>>  $files  field => [path, name] or a list of them
     *
     * @throws GenerationFailed
     */
    public function submit(string $task, array $params, array $files = []): string
    {
        if (! $this->configured()) {
            throw new GenerationFailed('The assistant’s engine isn’t set up: set ENGINE_URL (and ENGINE_KEY) for the API.');
        }
        $request = Http::timeout(600)->asMultipart()->withHeaders($this->headers())->acceptJson();
        $handles = [];
        foreach ($files as $field => $list) {
            $list = isset($list[0]) && is_string($list[0]) ? [$list] : $list;
            foreach ($list as [$path, $name]) {
                $handles[] = $h = fopen($path, 'r');
                $request = $request->attach($field, $h, $name);
            }
        }
        try {
            $r = $request->post($this->url().'/engine/jobs', ['task' => $task, 'params' => json_encode($params, JSON_UNESCAPED_UNICODE)]);
        } catch (ConnectionException) {
            throw new GenerationFailed('The assistant service isn’t answering. Start it (docker compose up -d assistant).');
        } finally {
            foreach ($handles as $h) {
                if (is_resource($h)) {
                    fclose($h);
                }
            }
        }
        if (! $r->successful()) {
            throw new GenerationFailed($r->json('detail') ?: "The assistant’s engine answered {$r->status()}.");
        }

        return (string) $r->json('id');
    }

    /**
     * @return array{status: string, stage?: string|null, share?: float|null, error?: string|null, files?: list<array<string, mixed>>}
     */
    public function status(string $id): array
    {
        try {
            $r = Http::timeout(15)->withHeaders($this->headers())->acceptJson()->get($this->url()."/engine/jobs/{$id}");
        } catch (ConnectionException) {
            throw new GenerationFailed('The assistant service isn’t answering.');
        }
        if ($r->status() === 404) {
            return ['status' => 'failed', 'error' => 'The assistant service restarted and lost this job. Run it again.'];
        }
        if (! $r->successful()) {
            throw new GenerationFailed("The assistant’s engine answered {$r->status()}.");
        }

        return $r->json();
    }

    public function fileUrl(string $id, int $index): string
    {
        return $this->url()."/engine/jobs/{$id}/files/{$index}";
    }

    public function cancel(string $id): void
    {
        rescue(fn () => Http::timeout(10)->withHeaders($this->headers())->delete($this->url()."/engine/jobs/{$id}"), report: false);
    }
}

<?php

namespace App\Services\Sound;

use App\Services\Ai\GenerationFailed;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Talks to FlowAI Sound (the sound/ service): voices, listening and the composer. Every failure
 * comes back as a GenerationFailed with a message a person can act on.
 */
class SoundClient
{
    public function url(): string
    {
        return rtrim((string) config('ai.providers.sound.url'), '/');
    }

    public function configured(): bool
    {
        return filled(config('ai.providers.sound.url'));
    }

    /** Whether the service answers right now (asked at most every 20 seconds). */
    public function up(): bool
    {
        if (! $this->configured()) {
            return false;
        }

        return Cache::remember('sound.up', 20, function () {
            try {
                return Http::timeout(3)->get($this->url().'/health')->successful();
            } catch (ConnectionException) {
                return false;
            }
        });
    }

    /**
     * @return list<array{id: string, name: string, lang: string, language: string, gender: string, style: string, sample: string}>
     */
    public function voices(): array
    {
        return Cache::remember('sound.voices', 3600, fn () => $this->get('/v1/voices')->json()) ?? [];
    }

    /**
     * @return list<array{id: string, label: string, detail: string, bpm: list<int>, colors: list<string>}>
     */
    public function moods(): array
    {
        return Cache::remember('sound.moods', 3600, fn () => $this->get('/v1/moods')->json()) ?? [];
    }

    /**
     * Speak a script. Returns the WAV, how long it is, and when every word is said.
     *
     * @return array{wav: string, duration: float, words: list<array{text: string, start: float, end: float}>, voice: string, lang: string}
     */
    public function speak(string $text, string $voice, float $speed = 1.0, bool $timings = true): array
    {
        $r = $this->post('/v1/speech', ['text' => $text, 'voice' => $voice, 'speed' => $speed, 'timings' => $timings], 420);

        return [
            'wav' => base64_decode((string) $r->json('audio')),
            'duration' => (float) $r->json('duration'),
            'words' => $r->json('words', []),
            'voice' => (string) $r->json('voice'),
            'lang' => (string) $r->json('lang'),
        ];
    }

    /**
     * Write and render an original track.
     *
     * @param  array{mood?: string, seconds?: float, bpm?: float|null, key?: string|null, seed?: int|null, energy?: float}  $brief
     * @return array{wav: string, duration: float, meta: array<string, mixed>}
     */
    public function compose(array $brief): array
    {
        $r = $this->post('/v1/music', array_filter($brief, fn ($v) => $v !== null), 180);

        return ['wav' => base64_decode((string) $r->json('audio')), 'duration' => (float) $r->json('duration'), 'meta' => $r->json('meta', [])];
    }

    /**
     * Listen to 16 kHz mono WAV: the words, when each was said, the language.
     *
     * @return array{language: string, duration: float, text: string, segments: list<array>, words: list<array>}
     */
    public function transcribe(string $wav, ?string $language = null): array
    {
        try {
            $r = Http::timeout(1200)->withBody($wav, 'audio/wav')->post($this->url().'/v1/transcribe'.($language ? '?language='.urlencode($language) : ''));
        } catch (ConnectionException) {
            throw new GenerationFailed($this->down());
        }

        return $this->ok($r)->json();
    }

    private function get(string $path): Response
    {
        try {
            return $this->ok(Http::timeout(10)->acceptJson()->get($this->url().$path));
        } catch (ConnectionException) {
            throw new GenerationFailed($this->down());
        }
    }

    private function post(string $path, array $body, int $timeout): Response
    {
        try {
            return $this->ok(Http::timeout($timeout)->acceptJson()->post($this->url().$path, $body));
        } catch (ConnectionException) {
            throw new GenerationFailed($this->down());
        }
    }

    private function ok(Response $r): Response
    {
        if ($r->failed()) {
            throw new GenerationFailed('FlowAI Sound couldn’t do that: '.($r->json('detail') ? (is_string($r->json('detail')) ? $r->json('detail') : 'the request didn’t fit.') : "it answered {$r->status()}."));
        }

        return $r;
    }

    private function down(): string
    {
        return $this->configured()
            ? 'FlowAI Sound isn’t answering. Start it with `docker compose up -d sound`.'
            : 'FlowAI Sound isn’t set up: set SOUND_URL.';
    }
}

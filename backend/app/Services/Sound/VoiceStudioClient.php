<?php

namespace App\Services\Sound;

use App\Services\Ai\GenerationFailed;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Talks to a VoiceStudio server: cloned and designed voices, through its OpenAI-compatible
 * speech API ({url}/v1/audio/speech). Loopback calls need no credentials; anything remote
 * authenticates with the bearer key. Every failure comes back as a GenerationFailed with a
 * message a person can act on.
 *
 * Unlike FlowAI Sound, speech comes back without word timings: reels and the karaoke player
 * listen to the audio afterwards (the Listener already does this for uploaded audio).
 */
class VoiceStudioClient
{
    public function url(): string
    {
        return rtrim((string) config('ai.providers.voicestudio.url'), '/');
    }

    public function configured(): bool
    {
        return filled(config('ai.providers.voicestudio.url'));
    }

    /**
     * Whether the server answers right now: asked at most every 20 seconds, or every minute
     * while it's down, since an unreachable host costs the request that asks the full timeout.
     */
    public function up(): bool
    {
        if (! $this->configured()) {
            return false;
        }
        $known = Cache::get('voicestudio.up');
        if (is_bool($known)) {
            return $known;
        }
        try {
            $up = $this->http()->timeout(3)->get($this->url().'/health')->successful();
        } catch (ConnectionException) {
            $up = false;
        }
        Cache::put('voicestudio.up', $up, $up ? 20 : 60);

        return $up;
    }

    /**
     * The voice profiles, in the shape the Sound tab and the voice pickers understand. Each
     * keeps its VoiceStudio id behind the "vs:" prefix the VoiceRouter routes on.
     *
     * @return list<array{id: string, name: string, lang: string, language: string, gender: string, style: string, sample: string}>
     */
    public function voices(): array
    {
        $profiles = Cache::remember('voicestudio.voices', 3600, fn () => $this->get('/profiles')->json()) ?? [];
        $profiles = is_array($profiles) ? array_values($profiles) : [];

        return array_values(array_filter(array_map(fn ($p) => is_array($p) && filled($p['id'] ?? null) ? $this->shape($p) : null, $profiles)));
    }

    /** One voice profile, or null when it isn't there anymore. */
    public function voice(string $id): ?array
    {
        return collect($this->voices())->firstWhere('id', VoiceRouter::PREFIX.$id);
    }

    /**
     * Speak a script in a profile's voice. Returns the WAV and how long it is; word timings are
     * empty because VoiceStudio doesn't time words — the Listener aligns the audio when a reel
     * or the karaoke player needs them.
     *
     * @return array{wav: string, duration: float, words: list<array>, voice: string, lang: string}
     */
    public function speak(string $text, string $voice, float $speed = 1.0): array
    {
        $known = $this->voice(VoiceRouter::strip($voice));
        try {
            $r = $this->ok($this->http()->timeout(420)->post($this->url().'/v1/audio/speech', [
                'model' => 'omnivoice',
                'input' => $text,
                'voice' => VoiceRouter::strip($voice),
                'response_format' => 'wav',
                'speed' => $speed,
            ]));
        } catch (ConnectionException) {
            throw new GenerationFailed($this->down());
        }

        return [
            'wav' => $r->body(),
            'duration' => self::wavDuration($r->body()) ?? 0.0,
            'words' => [],
            'voice' => VoiceRouter::strip($voice),
            'lang' => $known['lang'] ?? '',
        ];
    }

    /** Duration of a PCM WAV from its header, without ffprobe. */
    public static function wavDuration(string $wav): ?float
    {
        if (strlen($wav) < 44 || substr($wav, 0, 4) !== 'RIFF') {
            return null;
        }
        $rate = unpack('V', substr($wav, 24, 4))[1];
        $byteRate = unpack('V', substr($wav, 28, 4))[1];
        // The data chunk's size sits after its 8-byte header; find it rather than assume 44.
        $offset = 12;
        while ($offset + 8 <= strlen($wav)) {
            $size = unpack('V', substr($wav, $offset + 4, 4))[1];
            if (substr($wav, $offset, 4) === 'data') {
                return $byteRate > 0 && $rate > 0 ? round($size / $byteRate, 2) : null;
            }
            $offset += 8 + $size + ($size % 2);
        }

        return null;
    }

    /** @param  array<string, mixed>  $p  a VoiceStudio voice profile */
    private function shape(array $p): array
    {
        $id = (string) $p['id'];
        $name = (string) ($p['name'] ?? $id);
        $language = (string) ($p['language'] ?? '');
        $gender = in_array($p['gender'] ?? null, ['female', 'male'], true) ? $p['gender'] : 'female';
        $kind = ucfirst((string) ($p['kind'] ?? 'voice'));
        $personality = (string) ($p['personality'] ?? '');

        return [
            'id' => VoiceRouter::PREFIX.$id,
            'name' => $name,
            'lang' => $language,
            'language' => $language !== '' ? $language : 'Multilingual',
            'gender' => $gender,
            'style' => trim($kind.($personality !== '' ? " · {$personality}" : '')),
            'sample' => "Hi, I'm {$name} — this is how I sound.",
        ];
    }

    private function get(string $path): Response
    {
        try {
            return $this->ok($this->http()->timeout(10)->get($this->url().$path));
        } catch (ConnectionException) {
            throw new GenerationFailed($this->down());
        }
    }

    private function http(): PendingRequest
    {
        return Http::acceptJson()->when(
            filled(config('ai.providers.voicestudio.key')),
            fn (PendingRequest $h) => $h->withToken((string) config('ai.providers.voicestudio.key')),
        );
    }

    private function ok(Response $r): Response
    {
        if ($r->failed()) {
            throw new GenerationFailed('VoiceStudio couldn’t do that: '.($r->json('detail') ? (is_string($r->json('detail')) ? $r->json('detail') : 'the request didn’t fit.') : "it answered {$r->status()}."));
        }

        return $r;
    }

    public function down(): string
    {
        return $this->configured()
            ? 'VoiceStudio isn’t answering. Check VOICESTUDIO_URL and that the server is up.'
            : 'VoiceStudio isn’t set up: set VOICESTUDIO_URL (and VOICESTUDIO_KEY for a remote server).';
    }
}

<?php

namespace App\Services\Sound;

use App\Models\Asset;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

/**
 * Turns speech into text with every word's timing: voice notes, podcasts, the audio of a video.
 * FlowAI Sound's Whisper on this server, or any OpenAI-compatible Whisper (Groq's is free).
 */
class Listener
{
    public function __construct(private readonly SoundClient $sound, private readonly AudioTools $tools, private readonly ModelRegistry $models) {}

    /** The listening model to use: the one asked for if it can run, else the first that can. */
    public function model(?string $id = null): ?string
    {
        $listeners = collect($this->models->all('listen'))->where('available', true);

        return ($id && $listeners->firstWhere('id', $id) ? $id : null) ?? $listeners->first()['id'] ?? null;
    }

    public function available(): bool
    {
        return $this->model() !== null;
    }

    /**
     * @return array{language: string, duration: float, text: string, segments: list<array>, words: list<array{text: string, start: float, end: float}>, model: string}
     */
    public function file(string $path, ?string $language = null, ?string $model = null, int $maxSeconds = 1800): array
    {
        $model = $this->model($model) ?? throw new GenerationFailed('Nothing can listen yet: start FlowAI Sound (docker compose up -d sound).');
        $wav = $this->tools->toListenWav($path, $maxSeconds);
        [$provider, $name] = explode('/', $model, 2);

        $result = $provider === 'sound' ? $this->sound->transcribe($wav, $language) : $this->openAi($provider, $name, $wav, $language);

        return [...$result, 'model' => $model];
    }

    public function asset(Asset $asset, ?string $language = null): array
    {
        return $this->file(Storage::disk('local')->path($asset->path), $language);
    }

    /** OpenAI's /audio/transcriptions, which Groq, OpenRouter-style gateways and others speak too. */
    private function openAi(string $provider, string $name, string $wav, ?string $language): array
    {
        try {
            $r = Http::timeout(600)
                ->when(filled(config("ai.providers.{$provider}.key")), fn ($h) => $h->withToken((string) config("ai.providers.{$provider}.key")))
                ->attach('file', $wav, 'audio.wav')
                ->post(rtrim((string) config("ai.providers.{$provider}.url"), '/').'/audio/transcriptions', array_filter([
                    'model' => $name,
                    'response_format' => 'verbose_json',
                    'timestamp_granularities[]' => 'word',
                    'language' => $language,
                ]));
        } catch (ConnectionException) {
            throw new GenerationFailed(config("ai.providers.{$provider}.reach").' isn’t answering.');
        }
        if ($r->failed()) {
            throw new GenerationFailed(config("ai.providers.{$provider}.reach").' couldn’t transcribe that ('.$r->status().').');
        }

        return [
            'language' => (string) $r->json('language', ''),
            'duration' => (float) $r->json('duration', 0),
            'text' => trim((string) $r->json('text', '')),
            'segments' => collect($r->json('segments', []))->map(fn ($s) => ['start' => (float) $s['start'], 'end' => (float) $s['end'], 'text' => trim((string) $s['text'])])->all(),
            'words' => collect($r->json('words', []))->map(fn ($w) => ['text' => trim((string) $w['word']), 'start' => (float) $w['start'], 'end' => (float) $w['end']])->all(),
        ];
    }
}

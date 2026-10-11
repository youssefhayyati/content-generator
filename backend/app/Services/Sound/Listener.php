<?php

namespace App\Services\Sound;

use App\Models\Asset;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Turns speech into text with every word's timing: voice notes, podcasts, the audio of a video.
 * FlowAI Sound's Whisper on this server, or any OpenAI-compatible Whisper (Groq's is free); the best that runs
 * first, and the next when it plainly didn't hear (on music or noise Whisper invents subtitlers' credits).
 */
class Listener
{
    public function __construct(private readonly SoundClient $sound, private readonly AudioTools $tools, private readonly ModelRegistry $models) {}

    /**
     * Who listens best first: Whisper large-v3 on the GPU pod (VoiceStudio), then hosted Whispers, and this
     * server's own (FlowAI Sound's Whisper base, quick but rough: it mangles names, Arabic and Darija) last.
     */
    private const PREFERENCE = ['voicestudio', 'groq', 'openrouter', 'gateway', 'ollama_cloud', 'sound'];

    /**
     * The listening model to use: the one asked for if it can run, else AI_DEFAULT_LISTEN if it can, else the
     * best that can (PREFERENCE).
     */
    public function model(?string $id = null): ?string
    {
        $listeners = collect($this->models->all('listen'))->where('available', true);
        $default = config('ai.default_listen');
        $best = $listeners->sortBy(fn (array $m) => array_search($m['provider'], self::PREFERENCE, true) === false ? 99 : array_search($m['provider'], self::PREFERENCE, true))->first();

        return collect([$id, $default])->first(fn ($want) => $want && $listeners->firstWhere('id', $want)) ?? $best['id'] ?? null;
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
        $first = $this->model($model) ?? throw new GenerationFailed('Nothing can listen yet: start FlowAI Sound (docker compose up -d sound).');
        $wav = $this->tools->toListenWav($path, $maxSeconds);
        // Asked for one model: that one. Else the best first, and the next when it plainly didn't hear (see heard()).
        $tries = $model ? [$first] : collect([$first])->merge($this->fallbacks($first))->unique()->values()->all();

        $kept = null;
        foreach ($tries as $i => $try) {
            [$provider, $name] = explode('/', $try, 2);
            try {
                $result = [...($provider === 'sound' ? $this->sound->transcribe($wav, $language) : $this->openAi($provider, $name, $wav, $language)), 'model' => $try];
            } catch (GenerationFailed $e) {
                if ($i === count($tries) - 1 && ! $kept) {
                    throw $e;
                }

                continue;
            }
            if (self::heard($result)) {
                return $result;
            }
            Log::info('Listening: '.$try.' gave no real words; trying the next', ['text' => Str::limit($result['text'], 80)]);
            $kept ??= $result;
        }

        // Nobody heard words: no speech (music, recitation, noise), said honestly rather than a made-up line.
        return [...$kept, 'text' => '', 'segments' => [], 'words' => []];
    }

    /**
     * Whisper's well-known inventions on silence, music or noise: subtitlers' credits and channel outros it
     * learned from video subtitles, in Arabic, French and English.
     */
    private const INVENTED = ['ترجمة نانسي قنقر', 'اشتركوا في القناة', 'اشترك في القناة', 'شكرا للمشاهدة', 'شكرا على المشاهدة', 'لا تنسوا الاشتراك',
        'sous-titres réalisés par', 'sous-titrage', "merci d'avoir regardé", 'amara.org', 'subtitles by', 'thanks for watching', 'thank you for watching', 'please subscribe'];

    /** Whether a transcript holds words someone said, not one of Whisper's inventions or a word on repeat. */
    public static function heard(array $result): bool
    {
        $text = mb_strtolower(trim((string) ($result['text'] ?? '')));
        if ($text === '') {
            return false;
        }
        foreach (self::INVENTED as $phrase) {
            if (str_contains($text, $phrase) && mb_strlen($text) < mb_strlen($phrase) + 40) {
                return false;
            }
        }
        $words = preg_split('/\s+/u', $text, -1, PREG_SPLIT_NO_EMPTY);
        // "أشهر أشهر أشهر أشهر": the same word over and over is a loop, not speech
        return ! (count($words) >= 3 && count(array_unique($words)) <= max(1, intdiv(count($words), 4)));
    }

    /**
     * The other listeners that can run, best first, to try when one didn't hear.
     *
     * @return list<string>
     */
    private function fallbacks(string $first): array
    {
        return collect($this->models->all('listen'))->where('available', true)
            ->sortBy(fn (array $m) => array_search($m['provider'], self::PREFERENCE, true) === false ? 99 : array_search($m['provider'], self::PREFERENCE, true))
            ->pluck('id')->reject(fn (string $id) => $id === $first)->values()->all();
    }

    public function asset(Asset $asset, ?string $language = null): array
    {
        return $this->file(Storage::disk('local')->path($asset->path), $language);
    }

    /** OpenAI's /audio/transcriptions, which Groq, OpenRouter-style gateways and others speak too. */
    private function openAi(string $provider, string $name, string $wav, ?string $language): array
    {
        // VoiceStudio (on the GPU pod) speaks the same API under /v1, with Whisper large-v3.
        $base = $provider === 'voicestudio' ? rtrim((string) config('ai.providers.voicestudio.url'), '/').'/v1' : rtrim((string) config("ai.providers.{$provider}.url"), '/');
        try {
            $r = Http::timeout(900)
                ->when(filled(config("ai.providers.{$provider}.key")), fn ($h) => $h->withToken((string) config("ai.providers.{$provider}.key")))
                ->attach('file', $wav, 'audio.wav')
                ->post($base.'/audio/transcriptions', array_filter([
                    'model' => $name,
                    'response_format' => 'verbose_json',
                    'timestamp_granularities[]' => 'word',
                    'language' => $language,
                ]));
        } catch (ConnectionException) {
            throw new GenerationFailed(config("ai.providers.{$provider}.reach").' isn’t answering.');
        }
        if ($r->failed()) {
            $why = $r->json('error.message');
            throw new GenerationFailed(config("ai.providers.{$provider}.reach").' couldn’t transcribe that ('.$r->status().')'.($why ? ': '.$why : '.'));
        }

        $segments = collect($r->json('segments', []))->map(fn ($s) => ['start' => (float) $s['start'], 'end' => (float) $s['end'], 'text' => trim((string) $s['text'])])->all();
        $words = collect($r->json('words', []) ?: collect($r->json('segments', []))->flatMap(fn ($s) => $s['words'] ?? [])->all())
            ->map(fn ($w) => ['text' => trim((string) ($w['word'] ?? $w['text'] ?? '')), 'start' => (float) $w['start'], 'end' => (float) $w['end']])->filter(fn ($w) => $w['text'] !== '')->values()->all();

        return [
            'language' => (string) $r->json('language', ''),
            'duration' => (float) $r->json('duration', 0),
            'text' => trim((string) $r->json('text', '')),
            'segments' => $segments,
            // Without word times, the words of each segment share its time by their length.
            'words' => $words ?: self::spread($segments),
        ];
    }

    /**
     * @param  list<array{start: float, end: float, text: string}>  $segments
     * @return list<array{text: string, start: float, end: float}>
     */
    public static function spread(array $segments): array
    {
        $words = [];
        foreach ($segments as $s) {
            $parts = preg_split('/\s+/u', trim($s['text'])) ?: [];
            $chars = max(1, array_sum(array_map('mb_strlen', $parts)));
            $t = $s['start'];
            foreach ($parts as $p) {
                if ($p === '') {
                    continue;
                }
                $d = ($s['end'] - $s['start']) * mb_strlen($p) / $chars;
                $words[] = ['text' => $p, 'start' => round($t, 3), 'end' => round($t + $d, 3)];
                $t += $d;
            }
        }

        return $words;
    }
}

<?php

namespace App\Services\Lab;

use App\Models\Asset;
use App\Services\Ai\GenerationFailed;
use App\Services\Sound\Listener;

/**
 * Every word said in a recording, timed, however long it is: the listener takes about 25 minutes at a
 * time, so a long recording is heard in parts and the parts put back together. What's heard is kept
 * on the asset (meta.transcript), so nothing is listened to twice.
 */
class Listening
{
    public const PART = 1500;

    public function __construct(private readonly Listener $listener) {}

    /**
     * @return array{text: string, words: list<array{text: string, start: float, end: float}>, language: string|null, duration: float}
     *
     * @throws NodeFailed
     */
    public function asset(Asset $asset, ?string $language = null, ?callable $progress = null): array
    {
        $known = $asset->meta['transcript'] ?? null;
        // Heard before by the model that listens now: kept. By another (older ones were this server's rough
        // Whisper base, which named no model), it's heard again by the better one.
        $model = $this->listener->model();
        if (! empty($known['words']) && ($known['model'] ?? 'sound/whisper') === $model) {
            return ['text' => (string) ($known['text'] ?? ''), 'words' => $known['words'], 'language' => $known['language'] ?? null, 'duration' => (float) ($known['duration'] ?? $asset->duration ?? 0)];
        }
        $heard = $this->file(Media::path($asset), (float) ($asset->duration ?? 0), $language, $progress);
        $asset->update(['meta' => [...$asset->meta ?? [], 'transcript' => [...$heard, 'model' => $model]]]);

        return $heard;
    }

    /**
     * @return array{text: string, words: list<array{text: string, start: float, end: float}>, language: string|null, duration: float}
     */
    public function file(string $path, float $duration = 0, ?string $language = null, ?callable $progress = null): array
    {
        if (! $this->listener->available()) {
            throw new NodeFailed('Nothing can listen yet: start FlowAI Sound (docker compose up -d sound), or add a Whisper model (Groq’s is free).');
        }
        $duration = $duration ?: Media::probe($path)['duration'];
        $parts = max(1, (int) ceil($duration / self::PART));
        $words = [];
        $texts = [];
        $lang = $language ?: null;
        for ($i = 0; $i < $parts; $i++) {
            $progress && $progress($parts > 1 ? 'Listening, part '.($i + 1)." of {$parts}" : 'Listening', $i / $parts);
            $offset = $i * self::PART;
            $chunk = $path;
            if ($parts > 1) {
                $chunk = Media::tmp('wav');
                Media::ffmpeg(['-ss', (string) $offset, '-t', (string) self::PART, '-i', $path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', $chunk], 'cut the recording into parts');
            }
            try {
                $heard = $this->listener->file($chunk, $lang, maxSeconds: self::PART + 5);
            } catch (GenerationFailed $e) {
                throw new NodeFailed($e->getMessage());
            } finally {
                if ($chunk !== $path) {
                    @unlink($chunk);
                }
            }
            $lang ??= $heard['language'] ?? null;
            $texts[] = trim((string) ($heard['text'] ?? ''));
            foreach ($heard['words'] ?? [] as $w) {
                $words[] = ['text' => trim((string) $w['text']), 'start' => round((float) $w['start'] + $offset, 3), 'end' => round((float) $w['end'] + $offset, 3)];
            }
        }

        return ['text' => trim(implode(' ', array_filter($texts))), 'words' => array_values(array_filter($words, fn ($w) => $w['text'] !== '')), 'language' => $lang, 'duration' => round($duration, 2)];
    }

    /**
     * The words between two times, moved to start at zero.
     *
     * @param  list<array{text: string, start: float, end: float}>  $words
     * @return list<array{text: string, start: float, end: float}>
     */
    public static function between(array $words, float $from, float $to): array
    {
        $out = [];
        foreach ($words as $w) {
            if ($w['end'] > $from && $w['start'] < $to) {
                $out[] = ['text' => $w['text'], 'start' => round(max(0, $w['start'] - $from), 3), 'end' => round(min($to, $w['end']) - $from, 3)];
            }
        }

        return $out;
    }
}

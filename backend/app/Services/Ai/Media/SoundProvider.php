<?php

namespace App\Services\Ai\Media;

use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use App\Services\Sound\AudioTools;
use App\Services\Sound\SoundClient;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * Voiceovers and music from FlowAI Sound. Both finish in one go: a voiceover comes back with
 * every word's timing (for captions), a track with what was written (key, tempo, chords).
 */
class SoundProvider implements MediaProvider
{
    public function __construct(private readonly SoundClient $sound, private readonly AudioTools $tools) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        $p = $generation->params ?? [];
        try {
            if ($generation->kind === 'voice') {
                $voice = (string) ($p['voice'] ?? 'af_heart');
                $said = $this->sound->speak($generation->prompt, $voice, (float) ($p['speed'] ?? 1.0));
                $name = collect($this->sound->voices())->firstWhere('id', $voice)['name'] ?? $voice;

                return ['outputs' => [[
                    'b64' => base64_encode($this->tools->toMp3($said['wav'], 160)),
                    'mime' => 'audio/mpeg',
                    'meta' => ['sound' => 'voice', 'voice' => $voice, 'voice_name' => $name, 'lang' => $said['lang'], 'speed' => (float) ($p['speed'] ?? 1.0), 'script' => $generation->prompt, 'words' => $said['words']],
                ]]];
            }

            $track = $this->sound->compose([
                'mood' => (string) ($p['mood'] ?? 'golden-hour'),
                'seconds' => (float) ($p['seconds'] ?? 30),
                'energy' => (float) ($p['energy'] ?? 0.6),
                'bpm' => isset($p['bpm']) ? (float) $p['bpm'] : null,
                'key' => $p['key'] ?? null,
                'seed' => isset($p['seed']) ? (int) $p['seed'] : null,
            ]);

            return ['outputs' => [[
                'b64' => base64_encode($this->tools->toMp3($track['wav'], 224)),
                'mime' => 'audio/mpeg',
                'meta' => ['sound' => 'music', ...$track['meta']],
            ]]];
        } catch (RuntimeException $e) {
            throw $e instanceof GenerationFailed ? $e : new GenerationFailed($e->getMessage());
        }
    }

    public function poll(Generation $generation): array
    {
        return ['status' => $generation->status];
    }
}

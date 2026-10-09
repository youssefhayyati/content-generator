<?php

namespace App\Services\Ai\Media;

use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use App\Services\Sound\AudioTools;
use App\Services\Sound\VoiceStudioClient;
use Illuminate\Support\Collection;
use RuntimeException;

/**
 * Voiceovers from a VoiceStudio server: a cloned or designed voice reads the script. Speech
 * comes back without word timings (words is empty); a reel that needs captions listens to the
 * audio afterwards, the same way it treats uploaded audio.
 */
class VoiceStudioProvider implements MediaProvider
{
    public function __construct(private readonly VoiceStudioClient $vs, private readonly AudioTools $tools) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        if ($generation->kind !== 'voice') {
            throw new GenerationFailed('VoiceStudio only reads voiceovers here.');
        }
        $p = $generation->params ?? [];
        $voice = (string) ($p['voice'] ?? '');
        try {
            $said = $this->vs->speak($generation->prompt, $voice, (float) ($p['speed'] ?? 1.0));
            $name = collect($this->vs->voices())->firstWhere('id', $voice)['name'] ?? $voice;

            return ['outputs' => [[
                'b64' => base64_encode($this->tools->toMp3($said['wav'], 160)),
                'mime' => 'audio/mpeg',
                'meta' => ['sound' => 'voice', 'voice' => $voice, 'voice_name' => $name, 'lang' => $said['lang'], 'speed' => (float) ($p['speed'] ?? 1.0), 'script' => $generation->prompt, 'words' => $said['words']],
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

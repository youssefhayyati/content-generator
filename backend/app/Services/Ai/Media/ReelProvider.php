<?php

namespace App\Services\Ai\Media;

use App\Models\Asset;
use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use App\Services\Sound\AudioTools;
use App\Services\Sound\Listener;
use App\Services\Sound\ReelRenderer;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

/**
 * A reel: the voice (or music), a background, music under the voice, and captions that follow
 * every word. Rendered on this server with ffmpeg.
 *
 * Inputs, in order: the sound (a voiceover, a track, any audio or a video's sound), then an
 * optional photo or video for the background. params.music_asset_id adds a track under a voice.
 */
class ReelProvider implements MediaProvider
{
    public function __construct(private readonly ReelRenderer $renderer, private readonly AudioTools $tools, private readonly Listener $listener) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        $p = $generation->params ?? [];
        $sound = $inputs->first(fn (Asset $a) => $a->kind === 'audio');
        $background = $inputs->first(fn (Asset $a) => in_array($a->kind, ['image', 'video'], true));
        $music = isset($p['music_asset_id']) ? $generation->user->assets()->where('kind', 'audio')->find($p['music_asset_id']) : null;
        if (! $sound && ! $music) {
            throw new GenerationFailed('Pick the voice or the music the reel plays.');
        }

        // A track alone is music; anything else is a voice the captions follow.
        $isMusic = $sound && ($sound->meta['sound'] ?? null) === 'music';
        $voice = $sound && ! $isMusic ? $sound : null;
        $music ??= $isMusic ? $sound : null;

        $words = [];
        if ($voice && ($p['captions'] ?? true)) {
            $words = $voice->meta['words'] ?? $voice->meta['transcript']['words'] ?? [];
            if (! $words && $this->listener->available()) {
                // Uploaded audio: listen to it once, and keep the transcript on the asset.
                $heard = $this->listener->asset($voice);
                $voice->update(['meta' => [...$voice->meta ?? [], 'transcript' => $heard]]);
                $words = $heard['words'];
            }
        }

        $disk = Storage::disk('local');
        try {
            $path = $this->renderer->render([
                'voice' => $voice ? $disk->path($voice->path) : null,
                'words' => $words,
                'music' => $music ? $disk->path($music->path) : null,
                'music_volume' => (float) ($p['music_volume'] ?? 0.3),
                'background' => $background ? $disk->path($background->path) : null,
                'background_kind' => $background?->kind,
                'style' => $p['style'] ?? 'bold',
                'accent' => $p['accent'] ?? '#a5b4fc',
                'title' => filled($p['title'] ?? null) ? (string) $p['title'] : null,
                'handle' => $p['handle'] ?? null,
                'seconds' => isset($p['seconds']) ? (float) $p['seconds'] : null,
                'captions' => (bool) ($p['captions'] ?? true),
            ], $this->tools);
        } catch (RuntimeException $e) {
            throw new GenerationFailed($e->getMessage());
        }

        return ['outputs' => [[
            'path' => $path,
            'mime' => 'video/mp4',
            'meta' => ['sound' => 'reel', 'style' => $p['style'] ?? 'bold', 'voice_asset_id' => $voice?->id, 'music_asset_id' => $music?->id, 'background_asset_id' => $background?->id, 'words' => $words],
        ]]];
    }

    public function poll(Generation $generation): array
    {
        return ['status' => $generation->status];
    }
}

<?php

namespace App\Models;

use Database\Factories\AssetFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

/**
 * An image, video or sound in the media library. Files live on the private disk and are only
 * served to their owner.
 */
#[Fillable(['kind', 'source', 'name', 'path', 'poster_path', 'mime', 'size', 'width', 'height', 'duration', 'meta'])]
class Asset extends Model
{
    /** @use HasFactory<AssetFactory> */
    use HasFactory;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'width' => 'integer',
            'height' => 'integer',
            'duration' => 'float',
            'meta' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::deleted(fn (Asset $asset) => Storage::disk('local')->delete(array_filter([$asset->path, $asset->poster_path])));
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function url(): string
    {
        return "/api/assets/{$this->id}/file";
    }

    public function posterUrl(): ?string
    {
        return $this->kind === 'image' ? $this->url() : ($this->poster_path ? "/api/assets/{$this->id}/poster" : null);
    }

    /**
     * What a player needs to know about a sound, without its whole transcript: the waveform,
     * whose voice or which mood, and whether its words are timed.
     *
     * @return array<string, mixed>|null
     */
    public function sound(): ?array
    {
        if ($this->kind !== 'audio' && ($this->meta['sound'] ?? null) !== 'reel') {
            return null;
        }
        $m = $this->meta ?? [];

        return array_filter([
            'type' => $m['sound'] ?? 'audio',
            'peaks' => $m['peaks'] ?? null,
            'voice' => $m['voice'] ?? null,
            'voice_name' => $m['voice_name'] ?? null,
            'lang' => $m['lang'] ?? $m['transcript']['language'] ?? null,
            'script' => isset($m['script']) ? mb_substr((string) $m['script'], 0, 400) : (isset($m['transcript']['text']) ? mb_substr((string) $m['transcript']['text'], 0, 400) : null),
            'mood' => $m['mood'] ?? null,
            'label' => $m['label'] ?? null,
            'bpm' => $m['bpm'] ?? null,
            'key' => $m['key'] ?? null,
            'seed' => $m['seed'] ?? null,
            'style' => $m['style'] ?? null,
            'timed' => ! empty($m['words']) || ! empty($m['transcript']['words']),
            'transcript' => $m['transcript_status'] ?? (isset($m['transcript']) ? 'done' : null),
        ], fn ($v) => $v !== null);
    }

    /** Width ÷ height, when known. */
    public function ratio(): ?float
    {
        return $this->width && $this->height ? $this->width / $this->height : null;
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'source' => $this->source,
            'name' => $this->name,
            'url' => $this->url(),
            'poster_url' => $this->posterUrl(),
            'mime' => $this->mime,
            'size' => $this->size,
            'width' => $this->width,
            'height' => $this->height,
            'duration' => $this->duration,
            'sound' => $this->sound(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}

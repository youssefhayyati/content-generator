<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A video from YouTube (or another site yt-dlp reads) and the permission to use it. Its details are
 * read without downloading anything; the audio, and later the parts that are cut from it, are only
 * downloaded once a person has said whose video it is and why it may be used (`permission` allowed).
 */
#[Fillable(['url', 'site', 'external_id', 'title', 'channel', 'channel_url', 'duration', 'license', 'thumbnail', 'permission', 'basis', 'permission_note', 'credit', 'permission_at', 'status', 'audio_asset_id', 'video_asset_id', 'transcript', 'meta', 'error'])]
class VideoSource extends Model
{
    public const BASES = ['own', 'permission', 'creative_commons'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'duration' => 'float',
            'transcript' => 'array',
            'meta' => 'array',
            'permission_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<Asset, $this>
     */
    public function audio(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'audio_asset_id');
    }

    /**
     * @return BelongsTo<Asset, $this>
     */
    public function video(): BelongsTo
    {
        return $this->belongsTo(Asset::class, 'video_asset_id');
    }

    public function allowed(): bool
    {
        return $this->permission === 'allowed';
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        return [
            'id' => $this->id,
            'url' => $this->url,
            'site' => $this->site,
            'external_id' => $this->external_id,
            'title' => $this->title,
            'channel' => $this->channel,
            'channel_url' => $this->channel_url,
            'duration' => $this->duration,
            'license' => $this->license,
            'thumbnail' => $this->thumbnail,
            'permission' => $this->permission,
            'basis' => $this->basis,
            'permission_note' => $this->permission_note,
            'credit' => $this->credit,
            'status' => $this->status,
            'error' => $this->error,
            'transcribed' => ! empty($this->transcript['words'] ?? null),
            'chapters' => $this->meta['chapters'] ?? [],
        ];
    }
}

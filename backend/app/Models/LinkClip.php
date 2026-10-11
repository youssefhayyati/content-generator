<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

#[Fillable(['batch_id', 'batch_index', 'batch_total', 'source_url', 'source_type', 'status', 'title', 'settings', 'analysis', 'error', 'asset_id', 'post_id', 'master_path'])]
class LinkClip extends Model
{
    /** Where a highlight can go, and as what (config/platforms.php): the first is the default. */
    public const PLACEMENTS = [
        'tiktok' => ['video'],
        'instagram' => ['reel', 'story'],
        'facebook' => ['reel', 'story'],
        'youtube' => ['short'],
    ];

    protected static function booted(): void
    {
        static::deleted(fn (LinkClip $clip) => $clip->master_path && Storage::disk('local')->delete($clip->master_path));
    }

    protected function casts(): array
    {
        return [
            'settings' => 'array',
            'analysis' => 'array',
            'batch_index' => 'integer',
            'batch_total' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function post(): BelongsTo
    {
        return $this->belongsTo(Post::class);
    }

    /** Everything the clipper page needs, without the downloaded source or full transcript. */
    public function summary(): array
    {
        $analysis = $this->analysis ?? [];

        return [
            'id' => $this->id,
            'batch_id' => $this->batch_id,
            'batch_index' => $this->batch_index,
            'batch_total' => $this->batch_total,
            'source_url' => $this->source_url,
            'source_type' => $this->source_type,
            'status' => $this->status,
            'title' => $this->title,
            'platform' => $this->settings['platform'] ?? 'tiktok',
            'placement' => $this->placement(),
            'source_title' => $analysis['source_title'] ?? null,
            'seconds' => $this->settings['seconds'] ?? 30,
            'progress' => $this->progress(),
            'start' => $analysis['start'] ?? null,
            'end' => $analysis['end'] ?? null,
            'reason' => $analysis['reason'] ?? null,
            'caption' => $analysis['caption'] ?? null,
            'asset' => $this->asset?->summary(),
            'post_id' => $this->post_id,
            // Its subtitles, look and music can be changed once it has a video.
            'editable' => $this->status === 'ready' && $this->asset_id !== null,
            'edited' => filled($this->settings['style'] ?? null) || filled($this->settings['music']['asset_id'] ?? null),
            'error' => $this->error,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }

    /** The kind of post it becomes: a reel, a story, a TikTok video or a YouTube Short. */
    public function placement(): string
    {
        $options = self::PLACEMENTS[$this->settings['platform'] ?? 'tiktok'] ?? self::PLACEMENTS['tiktok'];
        $chosen = $this->settings['placement'] ?? null;

        return in_array($chosen, $options, true) ? $chosen : $options[0];
    }

    private function progress(): int
    {
        return match ($this->status) {
            'queued' => 5,
            'downloading', 'reading' => 25,
            'analyzing', 'writing' => 50,
            'rendering' => 75,
            'ready', 'failed' => 100,
            default => 0,
        };
    }
}

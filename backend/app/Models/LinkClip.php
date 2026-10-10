<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['source_url', 'source_type', 'status', 'title', 'settings', 'analysis', 'error', 'asset_id', 'post_id'])]
class LinkClip extends Model
{
    protected function casts(): array
    {
        return [
            'settings' => 'array',
            'analysis' => 'array',
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
            'source_url' => $this->source_url,
            'source_type' => $this->source_type,
            'status' => $this->status,
            'title' => $this->title,
            'platform' => $this->settings['platform'] ?? 'tiktok',
            'seconds' => $this->settings['seconds'] ?? 30,
            'progress' => $this->progress(),
            'start' => $analysis['start'] ?? null,
            'end' => $analysis['end'] ?? null,
            'reason' => $analysis['reason'] ?? null,
            'caption' => $analysis['caption'] ?? null,
            'asset' => $this->asset?->summary(),
            'post_id' => $this->post_id,
            'error' => $this->error,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
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

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One run of a Creative Lab node: what it ran with and what it made. A node's runs are its history
 * (version 1, 2, ...); the newest good one flows on to the nodes after it unless another is pinned.
 *
 * `outputs` is keyed by port: {"image": {"type": "image", "assets": [12, 13]}, "text": {"type": "text",
 * "text": "..."}, "brief": {"type": "brief", "brief": {...}}, "moments": {"type": "moments", "moments": [...]}}.
 */
#[Fillable(['user_id', 'project_id', 'node_id', 'type', 'version', 'status', 'inputs_hash', 'params', 'inputs', 'outputs', 'state', 'stage', 'share', 'error', 'cost', 'by', 'started_at', 'finished_at'])]
class NodeRun extends Model
{
    public const FINISHED = ['succeeded', 'failed', 'canceled'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'params' => 'array',
            'inputs' => 'array',
            'outputs' => 'array',
            'state' => 'array',
            'share' => 'float',
            'cost' => 'float',
            'version' => 'integer',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
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
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * @return HasMany<Generation, $this>
     */
    public function generations(): HasMany
    {
        return $this->hasMany(Generation::class);
    }

    public function isFinished(): bool
    {
        return in_array($this->status, self::FINISHED, true);
    }

    /**
     * Every asset id it made, on every port.
     *
     * @return list<int>
     */
    public function outputAssetIds(): array
    {
        return collect($this->outputs ?? [])->flatMap(fn ($o) => $o['assets'] ?? [])->map(fn ($id) => (int) $id)->values()->all();
    }
}

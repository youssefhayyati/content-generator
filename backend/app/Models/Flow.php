<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An automation the operator drew or described: one trigger, then AI steps, conditions,
 * waits, a person's approval and actions, joined by edges. Runs are its history.
 *
 * @property array{nodes: list<array{id: string, type: string, x: int, y: int, config: array<string, mixed>}>, edges: list<array{from: string, to: string, port: string}>} $graph
 */
#[Fillable(['name', 'description', 'enabled', 'graph', 'trigger', 'template', 'next_run_at', 'polled_at', 'state'])]
class Flow extends Model
{
    /** @var array<string, mixed> */
    protected $attributes = ['enabled' => false];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'graph' => 'array',
            'state' => 'array',
            'next_run_at' => 'datetime',
            'polled_at' => 'datetime',
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
     * @return HasMany<FlowRun, $this>
     */
    public function runs(): HasMany
    {
        return $this->hasMany(FlowRun::class);
    }

    /** @return array{id: string, type: string, x: int, y: int, config: array<string, mixed>}|null */
    public function triggerNode(): ?array
    {
        return collect($this->graph['nodes'] ?? [])->first(fn (array $n) => str_starts_with($n['type'], 'trigger.'));
    }

    /** The trigger's own settings, e.g. {"account_id": 3} or {"every": "day", "at": "09:00"}. */
    public function triggerConfig(): array
    {
        return $this->triggerNode()['config'] ?? [];
    }
}

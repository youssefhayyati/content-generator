<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One trip through a flow: what started it, the variables it carried, every node it visited
 * with what that node did, and where it's holding when it waits for a timer or a person.
 */
#[Fillable(['flow_id', 'user_id', 'status', 'cause', 'context', 'pending', 'trail', 'waiting_on', 'resume_at', 'error', 'finished_at'])]
class FlowRun extends Model
{
    public const LIVE = ['running', 'waiting', 'approval'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'running'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'context' => 'array',
            'pending' => 'array',
            'trail' => 'array',
            'resume_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Flow, $this>
     */
    public function flow(): BelongsTo
    {
        return $this->belongsTo(Flow::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isLive(): bool
    {
        return in_array($this->status, self::LIVE, true);
    }

    /** The approval this run is holding for, if it is: the node and what it asks. */
    public function approval(): ?array
    {
        return $this->status === 'approval' ? ($this->context['_approval'] ?? null) : null;
    }
}

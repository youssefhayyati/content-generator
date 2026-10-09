<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A note left in the Inbox — by a flow's "Tell me" step — until someone dismisses it. */
#[Fillable(['flow_run_id', 'title', 'detail', 'tone', 'link', 'dismissed_at'])]
class InboxNote extends Model
{
    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['dismissed_at' => 'datetime'];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<FlowRun, $this>
     */
    public function run(): BelongsTo
    {
        return $this->belongsTo(FlowRun::class, 'flow_run_id');
    }
}

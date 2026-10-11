<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * One model call: tokens in and out, what it cost, and how that's known (billing: billed, estimated
 * from pod time, free, unpriced; see App\Services\Ai\Pricing). `seconds`: how long a pod job ran.
 */
#[Fillable(['user_id', 'provider', 'model', 'purpose', 'input_tokens', 'output_tokens', 'cost', 'billing', 'seconds', 'context_type', 'context_id'])]
class AiUsage extends Model
{
    public const UPDATED_AT = null;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'cost' => 'float',
            'seconds' => 'integer',
        ];
    }
}

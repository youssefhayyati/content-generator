<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A reference photo for a campaign. Claude's description of it is what the content kit's
 * image prompts build on.
 */
#[Fillable(['path', 'mime', 'kind', 'title', 'description', 'asset_id'])]
class CampaignPhoto extends Model
{
    public const KINDS = ['logo', 'person', 'product', 'place', 'other'];

    /**
     * @return BelongsTo<Asset, $this>
     */
    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    /**
     * @return BelongsTo<Campaign, $this>
     */
    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }
}

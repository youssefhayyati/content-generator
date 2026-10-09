<?php

namespace App\Jobs;

use App\Models\Asset;
use App\Models\CampaignItem;
use App\Services\Campaigns\Pipeline;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** The media team gives a campaign video its voice, its music and its captions. */
class SoundCampaignVideo implements ShouldQueue
{
    use Queueable;

    public int $timeout = 900;

    public int $tries = 1;

    public function __construct(public int $itemId, public ?int $filmId = null)
    {
        $this->onQueue('media');
    }

    public function handle(Pipeline $pipeline): void
    {
        $item = CampaignItem::with('campaign.user')->find($this->itemId);
        if ($item) {
            $pipeline->soundVideo($item, $this->filmId ? Asset::find($this->filmId) : null);
        }
    }
}

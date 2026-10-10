<?php

namespace App\Http\Resources;

use App\Models\Asset;
use App\Models\CampaignItem;
use App\Models\ItemVariant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An item with everything the plan, production and review screens show: the master content,
 * its media and video shots, and each account's version with its checks and posting times.
 *
 * @mixin CampaignItem
 */
class CampaignItemResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $shotAssets = Asset::whereIn('id', collect($this->shots ?? [])->flatMap(fn ($s) => [$s['still_id'] ?? null, $s['asset_id'] ?? null])->filter())->get()->keyBy('id');

        return [
            'id' => $this->id,
            'position' => $this->position,
            'title' => $this->title,
            'pillar' => $this->pillar,
            'format' => $this->format,
            'message' => $this->message,
            'hook' => $this->hook,
            'caption' => $this->caption,
            'visual' => $this->visual,
            'prompts' => $this->prompts ?? [],
            'reference_photo' => $this->reference_photo,
            'account_ids' => $this->account_ids ?? [],
            'source' => $this->source,
            'status' => $this->status,
            'error' => $this->error,
            'assets' => $this->assets()->map->summary(),
            'shots' => collect($this->shots ?? [])->map(fn ($s, $n) => [
                'n' => $n,
                'description' => $s['description'],
                'camera' => $s['camera'] ?? '',
                'duration' => $s['duration'] ?? 3,
                'status' => $s['status'] ?? 'planned',
                'error' => $s['error'] ?? null,
                'still' => isset($s['still_id'], $shotAssets[$s['still_id']]) ? $shotAssets[$s['still_id']]->summary() : null,
                'clip' => isset($s['asset_id'], $shotAssets[$s['asset_id']]) ? $shotAssets[$s['asset_id']]->summary() : null,
            ])->values(),
            'generating' => $this->generations()->whereIn('status', ['queued', 'running'])->count(),
            'variants' => $this->variants()->with(['account', 'posts'])->get()->map(fn (ItemVariant $v) => [
                'id' => $v->id,
                'account' => ['id' => $v->account->id, 'platform' => $v->account->platform, 'handle' => $v->account->handle, 'name' => $v->account->name, 'timezone' => $v->account->timezoneOrUsers()],
                'mode' => $v->mode,
                'caption' => $v->caption,
                'placement' => $v->placement,
                // Its own media for this account; null: it shares the item's.
                'assets' => $v->asset_ids !== null ? $v->assets()->map->summary() : null,
                'checks' => $v->checks,
                'qa' => $v->qa,
                'status' => $v->status,
                'feedback' => $v->feedback,
                'approved_at' => $v->approved_at?->toIso8601ZuluString(),
                'posts' => $v->posts->sortBy('scheduled_at')->values()->map(fn ($p) => ['id' => $p->id, 'status' => $p->status, 'scheduled_at' => $p->scheduled_at?->toIso8601ZuluString(), 'post_url' => $p->post_url]),
            ]),
        ];
    }
}

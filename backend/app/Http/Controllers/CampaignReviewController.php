<?php

namespace App\Http\Controllers;

use App\Http\Resources\CampaignItemResource;
use App\Jobs\RedoVariant;
use App\Models\ActionLog;
use App\Models\Campaign;
use App\Models\ItemVariant;
use App\Services\Campaigns\NotAllowed;
use App\Services\Campaigns\Pipeline;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Gate 6B: a person approves each account's version before anything can be scheduled.
 */
class CampaignReviewController extends Controller
{
    public function approve(Request $request, Campaign $campaign, ItemVariant $variant, Pipeline $pipeline): CampaignItemResource
    {
        $this->authorizeVariant($campaign, $variant);
        try {
            $pipeline->approve($variant, $request->user());
        } catch (NotAllowed $e) {
            throw ValidationException::withMessages(['variant' => $e->getMessage()]);
        }

        return CampaignItemResource::make($variant->item->fresh());
    }

    /** Approve every version that passes its checks and QA. */
    public function approveAll(Request $request, Campaign $campaign, Pipeline $pipeline): JsonResponse
    {
        Gate::authorize('update', $campaign);
        $approved = 0;
        foreach (ItemVariant::with(['item', 'account'])->whereIn('campaign_item_id', $campaign->items()->pluck('id'))->where('status', 'draft')->get() as $variant) {
            if ($variant->passes() && ($variant->qa['status'] ?? null) === 'pass') {
                $pipeline->approve($variant, $request->user());
                $approved++;
            }
        }

        return response()->json(['approved' => $approved]);
    }

    /** Rejected, with a note: the adapter rewrites it to fix what the note says. */
    public function reject(Request $request, Campaign $campaign, ItemVariant $variant): CampaignItemResource
    {
        $this->authorizeVariant($campaign, $variant);
        $data = $request->validate(['feedback' => ['required', 'string', 'max:1000']], ['feedback.required' => 'Say what’s wrong, so it can be fixed.']);
        $variant->update(['status' => 'rejected', 'feedback' => $data['feedback'], 'approved_at' => null, 'approved_by' => null]);
        ActionLog::record($request->user(), 'you', 'variant.rejected', $variant, "Sent back “{$variant->item->title}” for @{$variant->account->handle}: {$data['feedback']}", 'blocked');
        RedoVariant::dispatch($variant->id);

        return CampaignItemResource::make($variant->item->fresh());
    }

    /** A person's own edit to the caption or placement, or to the media: this account's own slides. */
    public function update(Request $request, Campaign $campaign, ItemVariant $variant, Pipeline $pipeline): CampaignItemResource
    {
        $this->authorizeVariant($campaign, $variant);
        $data = $request->validate([
            'caption' => ['required', 'string', 'max:70000'],
            'placement' => ['nullable', 'string', 'in:'.implode(',', array_keys(config("platforms.{$variant->account->platform->value}")))],
            'asset_ids' => ['sometimes', 'array', 'min:1', 'max:10'],
            'asset_ids.*' => ['integer', Rule::exists('assets', 'id')->where('user_id', $request->user()->id)],
        ]);
        $pipeline->edit($variant, $data['caption'], $data['placement'] ?? null, isset($data['asset_ids']) ? array_map('intval', $data['asset_ids']) : null);

        return CampaignItemResource::make($variant->item->fresh());
    }

    /** "More like this": remembered as a liked example for the account. */
    public function like(Campaign $campaign, ItemVariant $variant, Pipeline $pipeline): JsonResponse
    {
        $this->authorizeVariant($campaign, $variant);
        $pipeline->like($variant);

        return response()->json(['liked' => true]);
    }

    private function authorizeVariant(Campaign $campaign, ItemVariant $variant): void
    {
        Gate::authorize('update', $campaign);
        abort_unless($variant->item->campaign_id === $campaign->id, 404);
    }
}

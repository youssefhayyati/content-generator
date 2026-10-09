<?php

namespace App\Http\Controllers;

use App\Http\Resources\CampaignItemResource;
use App\Http\Resources\CampaignResource;
use App\Jobs\PlanCampaign;
use App\Jobs\ProduceCampaign;
use App\Models\Campaign;
use App\Models\CampaignItem;
use App\Services\Campaigns\NotAllowed;
use App\Services\Campaigns\Pipeline;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Planning and production: the agents' plan, gate 6A, the items, their media and video shots.
 */
class CampaignPlanController extends Controller
{
    public function items(Campaign $campaign): AnonymousResourceCollection
    {
        Gate::authorize('view', $campaign);

        return CampaignItemResource::collection($campaign->items()->get());
    }

    /**
     * Hand the brief to the writer and the visual director. Again, before approval, to re-plan.
     *
     * Accounts aren't needed to plan: the brief is enough to decide the big idea, the pillars and
     * the posts. They're needed for the adapter to write each account's version, so the campaign
     * waits for them at that point instead of refusing to start (see `resume`).
     */
    public function plan(Campaign $campaign): CampaignResource
    {
        Gate::authorize('update', $campaign);

        $errors = array_filter([
            'brief' => ! $campaign->briefReady() ? 'Finish the brief first.' : null,
            'period_start' => ! $campaign->period_start || ! $campaign->period_end ? 'Set when the campaign runs.' : null,
            'stage' => ! in_array($campaign->stage, ['brief', 'plan_review'], true) ? 'The plan is already approved.' : null,
        ]);
        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        $campaign->update(['stage' => 'planning']);
        PlanCampaign::dispatch($campaign->id);

        return CampaignResource::make($campaign->fresh());
    }

    /** Gate 6A: the plan is approved, production starts. */
    public function approvePlan(Request $request, Campaign $campaign, Pipeline $pipeline): CampaignResource
    {
        Gate::authorize('update', $campaign);
        if ($campaign->stage !== 'plan_review') {
            throw ValidationException::withMessages(['stage' => 'There’s no plan waiting for approval.']);
        }
        try {
            $pipeline->approvePlan($campaign, $request->user());
        } catch (NotAllowed $e) {
            throw ValidationException::withMessages(['stage' => $e->getMessage()]);
        }

        return CampaignResource::make($campaign->fresh());
    }

    /**
     * Pick up where it stopped: re-run production after a failed step, or move on once media
     * that had to be uploaded is in.
     */
    public function resume(Campaign $campaign, Pipeline $pipeline): CampaignResource
    {
        Gate::authorize('update', $campaign);

        // Planned before an account was picked: the content got made, but there was nobody to
        // write a version for. Now that there's an account, put the adapter over it.
        if ($campaign->stage === 'content_review' && $campaign->items()->whereHas('variants')->doesntExist()) {
            if ($campaign->accounts()->isEmpty()) {
                throw ValidationException::withMessages(['account_ids' => 'Add an account for this content to go to.']);
            }
            $campaign->update(['stage' => 'producing']);
            $pipeline->maybeFinish($campaign);

            return CampaignResource::make($campaign->fresh());
        }

        if ($campaign->stage === 'adapting') {
            $campaign->update(['stage' => 'producing']);
        }
        if ($campaign->stage !== 'producing') {
            throw ValidationException::withMessages(['stage' => 'Nothing to resume.']);
        }

        // Captions missing, or media still to start: production again. Otherwise on to the adapter.
        $unstarted = $campaign->items()->where(fn ($q) => $q->whereNull('caption')->orWhereIn('status', ['planned', 'needs_media', 'failed']))->exists();
        $unstarted ? ProduceCampaign::dispatch($campaign->id) : $pipeline->maybeFinish($campaign);

        return CampaignResource::make($campaign->fresh());
    }

    /** Gate 6A edits: change a planned item. */
    public function update(Request $request, Campaign $campaign, CampaignItem $item): CampaignItemResource
    {
        Gate::authorize('update', $campaign);
        $item->update($this->validated($request, $campaign, partial: true));

        return CampaignItemResource::make($item->fresh());
    }

    /** Add an item by hand: from the operator's own media, or for the agents to make. */
    public function store(Request $request, Campaign $campaign, Pipeline $pipeline): JsonResponse
    {
        Gate::authorize('update', $campaign);
        $data = $this->validated($request, $campaign);
        $item = $campaign->items()->create($data + ['position' => $campaign->items()->max('position') + 1, 'account_ids' => $data['account_ids'] ?? $campaign->account_ids, 'status' => 'planned']);

        if ($ids = $request->input('asset_ids')) {
            $pipeline->useMedia($item, $this->assets($request, $ids));
        }

        return CampaignItemResource::make($item->fresh())->response()->setStatusCode(201);
    }

    public function destroy(Campaign $campaign, CampaignItem $item, Pipeline $pipeline): Response
    {
        Gate::authorize('update', $campaign);
        $item->delete();
        // Removing the post production was waiting on lets it move on.
        if ($campaign->stage === 'producing') {
            $pipeline->maybeFinish($campaign);
        }

        return response()->noContent();
    }

    /** Drag to reorder: the order the scheduler follows. */
    public function reorder(Request $request, Campaign $campaign): AnonymousResourceCollection
    {
        Gate::authorize('update', $campaign);
        $ids = $request->validate(['ids' => ['required', 'array'], 'ids.*' => ['integer']])['ids'];
        foreach ($campaign->items()->get() as $item) {
            $item->update(['position' => ($p = array_search($item->id, $ids, true)) === false ? 999 : $p]);
        }

        return CampaignItemResource::collection($campaign->items()->get());
    }

    /** The operator's own photos or video for an item, in place of generated media. */
    public function media(Request $request, Campaign $campaign, CampaignItem $item, Pipeline $pipeline): CampaignItemResource
    {
        Gate::authorize('update', $campaign);
        $pipeline->useMedia($item, $this->assets($request, $request->input('asset_ids', [])));

        return CampaignItemResource::make($item->fresh());
    }

    /** Shot-by-shot video: make one shot again, optionally described differently. */
    public function regenerateShot(Request $request, Campaign $campaign, CampaignItem $item, int $shot, Pipeline $pipeline): CampaignItemResource
    {
        Gate::authorize('update', $campaign);
        abort_unless($item->format === 'video' && isset($item->shots[$shot]), 404);
        $data = $request->validate(['description' => ['nullable', 'string', 'max:500']]);
        if (! $pipeline->pick('image') || ! $pipeline->pick('video')) {
            throw ValidationException::withMessages(['shot' => 'No image and video models are set up to make shots with.']);
        }
        $pipeline->startShot($item, $shot, $data['description'] ?? null);

        return CampaignItemResource::make($item->fresh());
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, Campaign $campaign, bool $partial = false): array
    {
        $need = $partial ? 'sometimes' : 'required';

        return $request->validate([
            'title' => [$need, 'string', 'max:120'],
            'format' => [$need, Rule::in(CampaignItem::FORMATS)],
            'pillar' => ['sometimes', 'nullable', 'string', 'max:80'],
            'message' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'hook' => ['sometimes', 'nullable', 'string', 'max:500'],
            'caption' => ['sometimes', 'nullable', 'string', 'max:3000'],
            'visual' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'account_ids' => ['sometimes', 'array', 'min:1'],
            'account_ids.*' => ['integer', Rule::in($campaign->account_ids ?? [])],
        ], ['account_ids.*.in' => 'Pick accounts that are in this campaign.']);
    }

    /**
     * @return list<int>
     */
    private function assets(Request $request, mixed $ids): array
    {
        $request->validate(['asset_ids' => ['required', 'array', 'min:1', 'max:10'], 'asset_ids.*' => ['integer', Rule::exists('assets', 'id')->where('user_id', $request->user()->id)]]);

        return array_map('intval', (array) $ids);
    }
}

<?php

namespace App\Services\Campaigns;

use App\Jobs\AdaptItem;
use App\Jobs\FinishProduction;
use App\Jobs\ProduceCampaign;
use App\Jobs\RunGeneration;
use App\Jobs\SoundCampaignVideo;
use App\Models\Account;
use App\Models\ActionLog;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\CampaignItem;
use App\Models\CampaignPhoto;
use App\Models\Generation;
use App\Models\ItemVariant;
use App\Models\User;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Media\GenerationRunner;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Media\AssetStore;
use App\Services\Publishing\PlatformSpecs;
use App\Services\Sound\SoundClient;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * A campaign from brief to approved content:
 *
 *   brief → writer plans → visual director → gate 6A (a person approves the plan)
 *         → writer's master copy → media team → adapter (a version per account) → QA
 *         → gate 6B (a person approves each version) → scheduler
 *
 * Media is made in the background; each finished generation reports back here, and once
 * nothing is still being made the adapter and QA run.
 */
class Pipeline
{
    public function __construct(
        private readonly Agents $agents,
        private readonly PlatformSpecs $specs,
        private readonly ModelRegistry $models,
        private readonly AssetStore $assets,
        private readonly VideoAssembler $assembler,
        private readonly SoundClient $sound,
    ) {}

    /* ------------------------------------------------------------------ */
    /* Planning, and gate 6A */
    /* ------------------------------------------------------------------ */

    public function plan(Campaign $campaign): void
    {
        $campaign->update(['stage' => 'planning']);

        try {
            $plan = $this->agents->plan($campaign);
            DB::transaction(function () use ($campaign, $plan) {
                $campaign->items()->delete();
                foreach ($plan['items'] as $i => $item) {
                    $campaign->items()->create([
                        'position' => $i,
                        'title' => Str::limit($item['title'], 120, ''),
                        'pillar' => $item['pillar'] ?? null,
                        'format' => $item['format'],
                        'message' => $item['message'] ?? null,
                        'hook' => $item['hook'] ?? null,
                        'account_ids' => $item['account_ids'],
                        'status' => 'planned',
                    ]);
                }
                $campaign->update(['plan' => ['big_idea' => $plan['big_idea'] ?? '', 'pillars' => $plan['pillars'] ?? []]]);
            });

            $items = $campaign->items()->get();
            foreach ($this->agents->visuals($campaign, $items) as $v) {
                $item = $items->values()[$v['index'] - 1] ?? null;
                if (! $item) {
                    continue;
                }
                $photos = $campaign->photos->count();
                $item->update([
                    'visual' => $v['visual'] ?? null,
                    'prompts' => $item->format === 'text' ? [] : array_slice(array_values(array_filter($v['image_prompts'] ?? [])), 0, $item->format === 'carousel' ? 5 : 1),
                    'reference_photo' => ($v['reference_photo'] ?? 0) >= 1 && $v['reference_photo'] <= $photos ? $v['reference_photo'] : null,
                    'shots' => $item->format === 'video' ? collect($v['shots'] ?? [])->take(5)->map(fn ($s) => [
                        'description' => $s['description'], 'camera' => $s['camera'] ?? '', 'duration' => max(2, min(5, (int) ($s['duration'] ?? 3))), 'status' => 'planned',
                    ])->values()->all() : null,
                ]);
            }

            $campaign->update(['stage' => 'plan_review']);
            ActionLog::record($campaign->user, 'agent:writer', 'campaign.planned', $campaign, 'Planned “'.$campaign->title().'”: '.$items->count().' posts, waiting for approval.', 'queued');
        } catch (GenerationFailed) {
            // The failed step says why; the brief is where to start again.
            $campaign->update(['stage' => 'brief']);
        }
    }

    public function approvePlan(Campaign $campaign, User $user): void
    {
        if ($campaign->items()->doesntExist()) {
            throw new NotAllowed('There’s nothing in the plan to approve.');
        }
        $campaign->update(['stage' => 'producing', 'plan_approved_at' => now(), 'plan_approved_by' => $user->id]);
        ActionLog::record($user, 'you', 'campaign.plan_approved', $campaign, 'Approved the plan for “'.$campaign->title().'” (gate 6A).', 'approved');
        ProduceCampaign::dispatch($campaign->id);
    }

    /* ------------------------------------------------------------------ */
    /* Production */
    /* ------------------------------------------------------------------ */

    public function produce(Campaign $campaign): void
    {
        $items = $campaign->items()->get();
        $uncaptioned = $items->filter(fn (CampaignItem $i) => blank($i->caption));

        if ($uncaptioned->isNotEmpty()) {
            try {
                foreach ($this->agents->copy($campaign, $uncaptioned) as $id => $caption) {
                    $items->firstWhere('id', $id)?->update(['caption' => $caption]);
                }
            } catch (GenerationFailed) {
                $campaign->update(['stage' => 'plan_review']);

                return;
            }
        }

        $this->startMedia($campaign);
        $this->maybeFinish($campaign);
    }

    /**
     * The media team: generate what each item needs, or say what has to be uploaded.
     */
    public function startMedia(Campaign $campaign): void
    {
        $step = $campaign->steps()->create(['agent' => 'media', 'status' => 'running', 'started_at' => now()]);
        $started = 0;
        $missing = [];

        // Items already being made, or done, are left alone.
        foreach ($campaign->items()->whereNotIn('status', ['producing', 'ready'])->get() as $item) {
            if ($item->format === 'text') {
                $item->update(['status' => 'ready']);

                continue;
            }
            if (! empty($item->asset_ids)) {
                $item->update(['status' => 'ready']);

                continue;
            }

            $image = $this->pick('image');
            $video = $this->pick('video');
            if ($item->format === 'video' && ! $video && $this->sound->up()) {
                // No video model, but the studio has a voice: the media team makes the video
                // itself — narrated, scored and captioned — from the post's own words.
                $item->update(['status' => 'producing', 'error' => null]);
                SoundCampaignVideo::dispatch($item->id);
                $started++;

                continue;
            }
            if (! $image || ($item->format === 'video' && ! $video)) {
                $item->update(['status' => 'needs_media', 'error' => 'No '.(! $image ? 'image' : 'video').' model is set up. Upload media for this post, or set one up under Models.']);
                $missing[] = $item->title;

                continue;
            }

            $item->update(['status' => 'producing', 'error' => null]);
            if ($item->format === 'video') {
                foreach (array_keys($item->shots ?? []) as $n) {
                    $this->startShot($item, $n);
                    $started++;
                }
            } else {
                foreach (($item->prompts ?: [$item->visual ?: $item->title]) as $prompt) {
                    $this->generate($item, 'image', $image, $prompt, ['aspect_ratio' => '4:5'], $this->reference($item));
                    $started++;
                }
            }
        }

        $step->update([
            'status' => 'done',
            'summary' => "Started {$started} generations.".($missing ? ' '.count($missing).' '.Str::plural('post', count($missing)).' need media uploaded.' : ''),
            'output' => ['started' => $started, 'needs_media' => $missing],
            'finished_at' => now(),
        ]);
    }

    /** A video shot starts as a still, which then becomes the shot's clip. */
    public function startShot(CampaignItem $item, int $n, ?string $description = null): void
    {
        $shot = $this->withItem($item, function (CampaignItem $fresh) use ($n, $description) {
            $shots = $fresh->shots;
            if ($description) {
                $shots[$n]['description'] = $description;
            }
            $shots[$n] = [...$shots[$n], 'status' => 'still', 'still_id' => null, 'asset_id' => null, 'error' => null];
            $fresh->update(['shots' => $shots, 'status' => 'producing']);

            return $shots[$n];
        });

        $this->generate($item, 'image', $this->pick('image'),
            "{$shot['description']}. {$item->visual}", ['aspect_ratio' => '9:16'], $this->reference($item), shot: $n);
    }

    /**
     * Change an item from its latest saved state, holding its row: generations finish in other
     * processes, and a stale copy would undo what they wrote.
     *
     * @template T
     *
     * @param  callable(CampaignItem): T  $change
     * @return T
     */
    private function withItem(CampaignItem $item, callable $change): mixed
    {
        return DB::transaction(function () use ($item, $change) {
            $result = $change($fresh = CampaignItem::lockForUpdate()->findOrFail($item->id));
            $item->setRawAttributes($fresh->getAttributes(), true);

            return $result;
        });
    }

    /**
     * A generation for a campaign item finished or failed: move it along.
     */
    public function mediaSettled(Generation $generation): void
    {
        $item = CampaignItem::find($generation->campaign_item_id);
        if (! $item) {
            return;
        }

        if ($generation->shot !== null) {
            $this->shotSettled($item, $generation);
        } else {
            $this->withItem($item, function (CampaignItem $fresh) use ($generation) {
                if ($generation->status !== 'succeeded') {
                    return $fresh->update(['status' => 'failed', 'error' => $generation->error]);
                }
                $assets = [...($fresh->asset_ids ?? []), ...($generation->output_asset_ids ?? [])];
                $expected = max(1, count($fresh->prompts ?? []));
                $fresh->update(['asset_ids' => $assets, 'status' => count($assets) >= $expected ? 'ready' : $fresh->status]);
            });
        }

        $item->refresh();
        if ($item->status === 'ready' || $item->campaign->stage === 'producing') {
            // Production may be done; or, in review, a regenerated shot means checking its versions again.
            $this->itemReady($item);
        }
    }

    private function shotSettled(CampaignItem $item, Generation $generation): void
    {
        $n = $generation->shot;

        // A finished still becomes the shot's clip.
        if ($generation->status === 'succeeded' && $generation->kind === 'image') {
            $still = $generation->output_asset_ids[0];
            $shot = $this->withItem($item, function (CampaignItem $fresh) use ($n, $still) {
                $shots = $fresh->shots;
                $shots[$n] = [...$shots[$n], 'status' => 'moving', 'still_id' => $still];
                $fresh->update(['shots' => $shots]);

                return $shots[$n];
            });
            $this->generate($item, 'video', $this->pick('video'), "{$shot['description']}. Camera: {$shot['camera']}.", ['duration' => $shot['duration']], [$still], shot: $n);

            return;
        }

        $shots = $this->withItem($item, function (CampaignItem $fresh) use ($n, $generation) {
            $shots = $fresh->shots;
            $shots[$n] = $generation->status === 'succeeded'
                ? [...$shots[$n], 'status' => 'done', 'asset_id' => $generation->output_asset_ids[0]]
                : [...$shots[$n], 'status' => 'failed', 'error' => $generation->error];
            $fresh->update(['shots' => $shots]);

            return $shots;
        });

        $states = collect($shots)->pluck('status');
        if ($states->every(fn ($s) => $s === 'done')) {
            // Every shot is in: join them into one clip.
            $order = collect($shots)->pluck('asset_id');
            $clips = Asset::whereIn('id', $order)->get()->sortBy(fn ($a) => $order->search($a->id))->values();
            $film = $this->assembler->concat($item->campaign->user, $clips, Str::slug($item->title) ?: 'campaign-video');
            // A joined film gets its voice, music and captions before it's ready; without FlowAI
            // Sound it's ready as it is.
            $scoring = $film && $this->sound->up();
            $this->withItem($item, fn (CampaignItem $fresh) => $fresh->update(['asset_ids' => $film ? [$film->id] : $clips->pluck('id')->all(), 'status' => $scoring ? 'producing' : 'ready', 'error' => null]));
            if ($scoring) {
                SoundCampaignVideo::dispatch($item->id, $film->id);
            }
        } elseif ($states->contains('failed') && ! $states->contains(fn ($s) => in_array($s, ['still', 'moving'], true))) {
            $first = $states->search('failed');
            $this->withItem($item, fn (CampaignItem $fresh) => $fresh->update(['status' => 'failed', 'error' => 'Shot '.($first + 1).' failed: '.($shots[$first]['error'] ?? 'unknown').' Make it again.']));
        }
    }

    /**
     * Once nothing is still being made, hand over to the adapter and QA (once).
     */
    public function maybeFinish(Campaign $campaign): void
    {
        // Wait for everything: media being made, media to upload, failures to fix or remove.
        if ($campaign->items()->where('status', '!=', 'ready')->exists() || $campaign->items()->doesntExist()) {
            return;
        }
        if (Campaign::whereKey($campaign->id)->where('stage', 'producing')->update(['stage' => 'adapting'])) {
            FinishProduction::dispatch($campaign->id);
        }
    }

    /**
     * The adapter writes each account's version; the pre-export check and QA look them over.
     */
    public function finish(Campaign $campaign): void
    {
        try {
            $this->adaptItems($campaign, $campaign->items()->where('status', 'ready')->get());
        } catch (GenerationFailed) {
            $campaign->update(['stage' => 'producing']);

            return;
        }

        $campaign->update(['stage' => 'content_review']);
        ActionLog::record($campaign->user, 'agent:qa', 'campaign.content_ready', $campaign, 'Content for “'.$campaign->title().'” is ready for approval (gate 6B).', 'queued');
    }

    /**
     * Versions of these items for each of their accounts, checked against the platform and QA'd.
     *
     * @param  Collection<int, CampaignItem>  $items
     *
     * @throws GenerationFailed
     */
    public function adaptItems(Campaign $campaign, Collection $items): void
    {
        $made = collect();
        foreach ($campaign->accounts() as $account) {
            $mine = $items->filter(fn (CampaignItem $i) => in_array($account->id, $i->account_ids ?? [], true));
            if ($mine->isEmpty()) {
                continue;
            }
            foreach ($this->agents->adapt($campaign, $account, $mine) as $itemId => $v) {
                $variant = ItemVariant::updateOrCreate(
                    ['campaign_item_id' => $itemId, 'account_id' => $account->id],
                    ['mode' => $v['mode'], 'caption' => $v['caption'], 'placement' => $v['placement'], 'status' => 'draft', 'qa' => null, 'approved_at' => null, 'approved_by' => null],
                );
                $made->push($this->check($variant));
            }
        }
        $this->review($campaign, $made->each->load('account'));
    }

    /**
     * @param  Collection<int, ItemVariant>  $variants
     */
    private function review(Campaign $campaign, Collection $variants): void
    {
        if ($variants->isEmpty()) {
            return;
        }
        $results = $this->agents->qa($campaign, $variants);
        foreach ($variants as $variant) {
            $variant->update(['qa' => $results[$variant->id] ?? ['status' => 'warn', 'issues' => ['QA didn’t return a verdict for this one.']]]);
        }
    }

    /**
     * The pre-export check, against the variant's placement and media. If that placement fails
     * but another on the same platform passes (a vertical video sent to the feed instead of
     * Reels, say), the variant moves there.
     */
    public function check(ItemVariant $variant): ItemVariant
    {
        $variant->loadMissing(['account', 'item']);
        $platform = $variant->account->platform;
        $assets = $variant->assets();
        $result = $this->specs->check($platform, $variant->placement, (string) $variant->caption, $assets);

        if (! $result['ok']) {
            foreach (array_keys(config("platforms.{$platform->value}")) as $placement) {
                $other = $this->specs->check($platform, $placement, (string) $variant->caption, $assets);
                if ($other['ok']) {
                    $other['moved_from'] = $result['placement'];
                    [$result, $variant->placement] = [$other, $placement];
                    break;
                }
            }
        }
        $variant->update(['checks' => $result, 'placement' => $result['placement']]);

        return $variant;
    }

    /* ------------------------------------------------------------------ */
    /* Gate 6B */
    /* ------------------------------------------------------------------ */

    public function approve(ItemVariant $variant, User $user): void
    {
        if (! ($variant->checks['ok'] ?? false)) {
            throw new NotAllowed('It doesn’t pass the platform check yet: '.collect($variant->checks['checks'] ?? [])->firstWhere('status', 'fail')['detail']);
        }
        if (($variant->qa['status'] ?? null) === 'fail') {
            throw new NotAllowed('QA failed it. Edit it, or reject it with a note so it’s rewritten.');
        }
        $variant->update(['status' => 'approved', 'approved_at' => now(), 'approved_by' => $user->id]);
        ActionLog::record($user, 'you', 'variant.approved', $variant, "Approved “{$variant->item->title}” for @{$variant->account->handle} (gate 6B).", 'approved');
    }

    /** Rejected with a note: the adapter rewrites it, fixing what the note says. */
    public function redo(ItemVariant $variant): void
    {
        $campaign = $variant->item->campaign;
        try {
            $v = $this->agents->adapt($campaign, $variant->account, collect([$variant->item]), [$variant->item->id => (string) $variant->feedback])[$variant->item->id] ?? null;
            if ($v) {
                $variant->update(['mode' => $v['mode'], 'caption' => $v['caption'], 'placement' => $v['placement'], 'status' => 'draft']);
                $this->check($variant);
                $this->review($campaign, collect([$variant->fresh('account')]));
            }
        } catch (GenerationFailed) {
            $variant->update(['status' => 'rejected']);
        }
    }

    /** Edited by a person: checked against the platform again; QA's earlier verdict no longer applies. */
    public function edit(ItemVariant $variant, string $caption, ?string $placement): void
    {
        $variant->update(['caption' => $caption, 'placement' => $placement ?? $variant->placement, 'qa' => ['status' => 'pass', 'issues' => [], 'edited' => true], 'status' => 'draft']);
        $this->check($variant);
    }

    /** "More like this": the variant joins the account's liked examples. */
    public function like(ItemVariant $variant): void
    {
        $variant->account->memories()->create([
            'kind' => 'example', 'content' => (string) $variant->caption, 'source' => 'liked',
            'meta' => ['variant_id' => $variant->id, 'campaign_id' => $variant->item->campaign_id],
        ]);
    }

    /**
     * The operator's own media for an item (instead of, or replacing, generated media).
     *
     * @param  list<int>  $assetIds
     */
    public function useMedia(CampaignItem $item, array $assetIds): void
    {
        $item->update(['asset_ids' => $assetIds, 'source' => 'upload', 'status' => 'ready', 'error' => null]);
        $this->itemReady($item);
    }

    /** An item's media is in: finish production, or, in review, check or make its versions. */
    public function itemReady(CampaignItem $item): void
    {
        $campaign = $item->campaign;
        if ($campaign->stage === 'producing') {
            $this->maybeFinish($campaign);
        } elseif ($item->variants()->exists()) {
            $item->variants->each(fn (ItemVariant $v) => $this->check($v));
        } elseif (in_array($campaign->stage, ['content_review', 'scheduled'], true)) {
            AdaptItem::dispatch($item->id);
        }
    }

    /**
     * The media team's sound pass on a video: the post's hook and message read in its account's
     * voice, a track in the account's signature mood under it, captions on every word — over
     * the film the shots made, or the post's reference photo, or a moving gradient. If any of
     * it fails, the silent film stands; with no film, the item waits for a person.
     */
    public function soundVideo(CampaignItem $item, ?Asset $film = null): void
    {
        $campaign = $item->campaign;
        $user = $campaign->user;
        $account = Account::whereIn('id', $item->account_ids ?: $campaign->accounts()->pluck('id'))->first();
        $sound = $account?->soundSettings() ?? Account::SOUND_DEFAULTS;
        $script = Str::limit(trim(preg_replace('/\s+/', ' ', trim("{$item->hook} {$item->message}"))), 700, '');
        if ($script === '') {
            $script = Str::limit(Str::before((string) $item->caption, "\n\n"), 700, '');
        }
        $step = $campaign->steps()->create(['agent' => 'media', 'status' => 'running', 'started_at' => now(), 'model' => 'sound/kokoro']);

        try {
            $voice = $this->sounded($user, 'voice', 'sound/kokoro', $script, ['voice' => $sound['voice'], 'speed' => $sound['speed']]);
            $music = $this->sounded($user, 'music', 'sound/composer', str_replace('-', ' ', ucfirst($sound['mood'])), ['mood' => $sound['mood'], 'seconds' => max(12, (float) $voice->duration + 3), 'energy' => 0.5]);
            $picture = $film ?? Asset::find($this->reference($item)[0] ?? 0);
            $reel = $this->sounded($user, 'reel', 'studio/reel', $item->title ?: 'Campaign video', array_filter([
                'style' => 'bold', 'accent' => $sound['accent'], 'title' => $film ? null : $item->title, 'handle' => $account?->handle,
                'music_asset_id' => $music->id, 'music_volume' => 0.28, 'captions' => true,
            ], fn ($v) => $v !== null), array_values(array_filter([$voice->id, $picture?->id])));

            $this->withItem($item, fn (CampaignItem $fresh) => $fresh->update(['asset_ids' => [$reel->id], 'status' => 'ready', 'error' => null]));
            $step->update([
                'status' => 'done',
                'summary' => Str::limit(($film ? 'Scored the film' : 'Made the video').' for “'.$item->title.'”: '.($voice->meta['voice_name'] ?? 'a voice').' reads it, '.($music->meta['label'] ?? 'music').' plays under it, every word captioned.', 250),
                'output' => ['voice_asset_id' => $voice->id, 'music_asset_id' => $music->id, 'reel_asset_id' => $reel->id],
                'finished_at' => now(),
            ]);
        } catch (GenerationFailed $e) {
            $step->update(['status' => 'failed', 'error' => $e->getMessage(), 'finished_at' => now()]);
            $this->withItem($item, fn (CampaignItem $fresh) => $film
                ? $fresh->update(['asset_ids' => [$film->id], 'status' => 'ready', 'error' => null])
                : $fresh->update(['status' => 'needs_media', 'error' => 'Couldn’t make the video: '.$e->getMessage().' Upload one, or try again.']));
        }

        $item->refresh();
        $this->itemReady($item);
    }

    /**
     * Make sound (or a reel) through the studio's own generators, right here, and hand back
     * what came out. Not tied to the item: the item takes only the finished video.
     *
     * @param  array<string, mixed>  $params
     * @param  list<int>  $inputs
     */
    private function sounded(User $user, string $kind, string $model, string $prompt, array $params, array $inputs = []): Asset
    {
        $generation = $user->generations()->create([
            'kind' => $kind, 'model' => $model, 'prompt' => Str::limit($prompt, 3900, ''), 'params' => $params,
            'input_asset_ids' => $inputs ?: null, 'status' => 'queued',
        ]);
        app(GenerationRunner::class)->start($generation);
        $generation->refresh();
        if ($generation->status !== 'succeeded') {
            throw new GenerationFailed($generation->error ?: 'That didn’t come out.');
        }

        return $generation->outputs()->first() ?? throw new GenerationFailed('Nothing came back.');
    }

    /* ------------------------------------------------------------------ */

    /** The model the media team uses for a kind: the configured one if it can run, else any that can. */
    public function pick(string $kind): ?string
    {
        $models = collect($this->models->all($kind))->where('available', true);
        $preferred = config("ai.agents.{$kind}_model");

        return $models->firstWhere('id', $preferred)['id'] ?? $models->first()['id'] ?? null;
    }

    /**
     * @param  array<string, mixed>  $params
     * @param  list<int>  $inputs
     */
    private function generate(CampaignItem $item, string $kind, string $model, string $prompt, array $params, array $inputs, ?int $shot = null): Generation
    {
        $generation = $item->campaign->user->generations()->create([
            'kind' => $kind, 'model' => $model, 'prompt' => Str::limit($prompt, 3900, ''), 'params' => $params,
            'input_asset_ids' => $inputs ?: null, 'campaign_item_id' => $item->id, 'shot' => $shot, 'status' => 'queued',
        ]);
        RunGeneration::dispatch($generation->id);

        return $generation;
    }

    /**
     * The intake photo an item builds on, as a library asset (made once).
     *
     * @return list<int>
     */
    private function reference(CampaignItem $item): array
    {
        $photo = $item->reference_photo ? $item->campaign->photos->values()[$item->reference_photo - 1] ?? null : null;
        if (! $photo instanceof CampaignPhoto) {
            return [];
        }
        $user = $item->campaign->user;
        $asset = $user->assets()->where('source', 'intake')->where('meta->campaign_photo_id', $photo->id)->first()
            ?? $this->assets->fromContents($user, Storage::disk('local')->get($photo->path), $photo->mime, $photo->title ?: 'Reference photo', 'intake', ['campaign_photo_id' => $photo->id]);

        return [$asset->id];
    }
}

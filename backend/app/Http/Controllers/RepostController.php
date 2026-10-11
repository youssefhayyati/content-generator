<?php

namespace App\Http\Controllers;

use App\Enums\Platform;
use App\Enums\PostStatus;
use App\Jobs\AdaptRepost;
use App\Jobs\FetchRepostSource;
use App\Models\Account;
use App\Models\ActionLog;
use App\Models\Asset;
use App\Models\Repost;
use App\Services\Ai\GenerationFailed;
use App\Services\Community\Community;
use App\Services\Community\RepostSource;
use App\Services\Publishing\PlatformSpecs;
use App\Services\Studio\Autonomy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Repost between X and Instagram: paste a post's link, and its text, author and media are read
 * in the background. Whether reuse is allowed, and why, is always a person's call; then the AI
 * adapts it for the other network, and it goes out as an ordinary post through the phone agent,
 * crediting the original author.
 */
class RepostController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $reposts = $request->user()->reposts()->with(['account:id,platform,handle,device_id,automation', 'post:id,status'])->latest('id')->limit(100)->get()
            ->each->setRelation('user', $request->user());

        return response()->json($reposts->map(fn (Repost $r) => $this->out($r)));
    }

    /**
     * Pick a post to reuse, by its link. Without its text, the post is read in the background
     * (status "fetching"); with it, nothing is fetched. It can't be adapted until permission is
     * recorded.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'account_id' => ['required', Rule::exists('accounts', 'id')->where('user_id', $request->user()->id)],
            'source_url' => ['required', 'url', 'max:500'],
            'author' => ['nullable', 'required_with:source_text', 'string', 'max:120'],
            'source_text' => ['nullable', 'string', 'max:5000'],
            'asset_ids' => ['nullable', 'array', 'max:10'],
            'asset_ids.*' => ['integer', Rule::exists('assets', 'id')->where('user_id', $request->user()->id)],
        ]);
        $from = RepostSource::platformOf($data['source_url']);
        if (! $from) {
            throw ValidationException::withMessages(['source_url' => 'Paste the link to one post on X (x.com/…/status/…) or Instagram (instagram.com/p/… or /reel/…).']);
        }
        $account = Account::findOrFail($data['account_id']);
        $to = $account->platform->value;
        if (! in_array($to, Repost::PLATFORMS, true) || $to === $from) {
            $other = $from === 'x' ? 'Instagram' : 'X';
            throw ValidationException::withMessages(['account_id' => 'That’s a post from '.Platform::from($from)->label().". Pick one of your {$other} accounts to repost it to."]);
        }

        // Picked with where it goes (feed, reel, story), it's adapted for that as soon as it's read.
        $placement = $request->validate(['placement' => ['nullable', Rule::in(array_keys(config("platforms.{$to}", [])))]])['placement'] ?? null;
        $manual = filled($data['source_text'] ?? null);
        $repost = $request->user()->reposts()->create([
            'account_id' => $account->id,
            'placement' => $placement,
            'source_platform' => $from,
            'source_url' => $data['source_url'],
            'author' => ltrim((string) ($data['author'] ?? ''), '@'),
            'source_text' => (string) ($data['source_text'] ?? ''),
            'asset_ids' => $data['asset_ids'] ?? [],
            'status' => $manual ? ($placement ? 'adapting' : 'captured') : 'fetching',
        ]);
        if (! $manual) {
            FetchRepostSource::dispatch($repost->id);
        } elseif ($placement) {
            AdaptRepost::dispatch($repost->id);
        }

        return response()->json($this->out($repost->load('account')), 201);
    }

    /** Read the source again, after it failed. */
    public function fetch(Request $request, Repost $repost): JsonResponse
    {
        $this->own($request, $repost);
        abort_unless($repost->status === 'failed', 409, 'Only a post that couldn’t be read is read again.');
        $repost->update(['status' => 'fetching', 'error' => null]);
        FetchRepostSource::dispatch($repost->id);

        return response()->json($this->out($repost->load('account')));
    }

    /** The permission check: whether reuse is allowed, and why. Always a person, never the AI. */
    public function permission(Request $request, Repost $repost): JsonResponse
    {
        $this->own($request, $repost);
        abort_unless($repost->status === 'captured', 409, 'This repost already moved on.');
        $data = $request->validate([
            'decision' => ['required', Rule::in(['allowed', 'denied'])],
            'note' => ['required', 'string', 'max:500'],
            'attribution' => ['sometimes', 'boolean'],
        ]);
        $repost->update([
            'permission' => $data['decision'],
            'permission_note' => $data['note'],
            'attribution' => $data['attribution'] ?? $repost->attribution,
            'status' => $data['decision'] === 'denied' ? 'dropped' : 'captured',
        ]);
        ActionLog::record($request->user(), 'you', 'repost.permission', $repost,
            "Reuse of @{$repost->author}’s post {$data['decision']}: {$data['note']}", $data['decision'] === 'allowed' ? 'approved' : 'blocked');

        return response()->json($this->out($repost->load('account')));
    }

    /**
     * Rewrite it for the other network and the placement picked (feed, reel, story), as three takes;
     * the first is the caption until the person picks another. Again on an adapted one, with what the
     * person asks ("in Darija", "funnier"). The credit line is added by the model, not the AI.
     */
    public function adapt(Request $request, Repost $repost, Community $community): JsonResponse
    {
        $this->own($request, $repost);
        abort_unless(in_array($repost->status, ['captured', 'adapted'], true), 409, 'This repost already moved on.');
        abort_if($repost->permission === 'denied', 422, 'Reuse was denied for this post.');
        // The person asking to adapt it is the one allowing its reuse: recorded as theirs, credit on as it was.
        // (The assistant's token can't reach this; its reposts are allowed on the Approve card.)
        if ($repost->permission === 'pending') {
            $repost->update(['permission' => 'allowed', 'permission_note' => 'Allowed by '.$request->user()->name.' when adapting it.']);
            ActionLog::record($request->user(), 'you', 'repost.permission', $repost,
                "Reuse of @{$repost->author}’s post allowed when adapting it.", 'approved');
        }
        abort_unless($community->aiAvailable($request->user()), 502, 'The adaptation needs AI and a confirmed account.');
        $data = $request->validate([
            'placement' => ['nullable', 'string', 'max:20'],
            'instruction' => ['nullable', 'string', 'max:300'],
        ]);

        $first = $repost->status === 'captured';
        try {
            $options = $community->adapt($repost, $data['placement'] ?? null, $data['instruction'] ?? null);
        } catch (GenerationFailed $e) {
            abort(502, $e->getMessage());
        }
        $repost->update(['caption' => $options[0]['caption'], 'hashtags' => $options[0]['hashtags'], 'options' => $options, 'status' => 'adapted', 'error' => null]
            + (filled($data['placement'] ?? null) ? ['placement' => $data['placement']] : []));

        // Mode B: a rule the operator approved schedules it on its own — when it has what it needs.
        if ($first && ! $this->missingMedia($repost, $repost->assets()) && app(Autonomy::class)->decide($repost->account, 'repost.schedule') === 'run') {
            $this->schedule($request, $repost->fresh(), ['auto' => true]);
        }

        return response()->json($this->out($repost->fresh('account')));
    }

    /** The person's pick among the takes, or their own edit of the caption and hashtags, before scheduling. */
    public function update(Request $request, Repost $repost): JsonResponse
    {
        $this->own($request, $repost);
        abort_unless($repost->status === 'adapted', 409, 'Only an adapted repost is edited here.');
        $data = $request->validate([
            'caption' => ['sometimes', 'string', 'max:'.$repost->account->platform->characterLimit()],
            'hashtags' => ['sometimes', 'array', 'max:15'],
            'hashtags.*' => ['string', 'max:60'],
            'story_text' => ['sometimes', 'nullable', 'string', 'max:160'],
            'placement' => ['sometimes', 'nullable', Rule::in(array_keys(config("platforms.{$repost->account->platform->value}", [])))],
        ]);
        if (array_key_exists('hashtags', $data)) {
            $data['hashtags'] = Community::tags($data['hashtags'], 15);
        }
        $repost->update($data);

        return response()->json($this->out($repost->fresh(['account', 'post'])));
    }

    /**
     * Make it a real post: approved and scheduled (6B by the operator, here), with the source's
     * media, for the phone agent to publish like any other post. A post the assistant redesigned
     * comes with its own caption and pictures, so it skips the adaptation once reuse is allowed.
     */
    public function schedule(Request $request, Repost $repost, array $flags = []): JsonResponse
    {
        $this->own($request, $repost);
        $redesigned = $repost->status === 'captured' && $repost->permission === 'allowed' && $request->filled('caption');
        abort_unless($repost->status === 'adapted' || $redesigned, 409, 'Adapt it first, or it’s already a post.');
        $account = $repost->account;
        $data = $request->validate([
            'scheduled_at' => ['nullable', 'date', 'after:now'],
            'caption' => ['nullable', 'string', 'max:'.$account->platform->characterLimit()],
            // A photo or video to post instead of the source's, e.g. when it had none.
            'asset_ids' => ['nullable', 'array', 'min:1', 'max:10'],
            'asset_ids.*' => ['integer', Rule::exists('assets', 'id')->where('user_id', $request->user()->id)],
            // Where it goes on the network, picked on the preview: Instagram's feed, reel or story.
            'placement' => ['nullable', Rule::in(array_keys(config("platforms.{$account->platform->value}", [])))],
            // A story's line, drawn on it (stories show no caption); the credit tag goes under it.
            'story_text' => ['nullable', 'string', 'max:160'],
        ]);

        if (isset($data['caption'])) {
            $repost->update(['caption' => $data['caption']]);
        }
        if (isset($data['asset_ids'])) {
            $repost->update(['asset_ids' => $data['asset_ids']]);
        }
        $assets = $repost->assets()->filter(fn (Asset $a) => in_array($a->kind, ['image', 'video'], true))->values();
        if ($problem = $this->missingMedia($repost, $assets)) {
            throw ValidationException::withMessages(['asset_ids' => $problem]);
        }
        $placement = $data['placement'] ?? $repost->placement ?? $this->placement($account->platform, $assets);
        $spec = app(PlatformSpecs::class)->spec($account->platform, $placement);
        if ($wrong = $assets->first(fn (Asset $a) => ! in_array($a->kind, $spec['media'], true))) {
            throw ValidationException::withMessages(['placement' => "{$account->platform->label()} ".strtolower($spec['label'])."s can’t take {$wrong->kind}s. Pick another."]);
        }
        // As many files as it takes, each in its shape (a landscape video made 9:16 for a reel or a story).
        $source = app(RepostSource::class);
        $assets = $assets->take($spec['items'][1])->map(fn (Asset $a) => $account->platform === Platform::Instagram ? $source->fit($repost, $a, $spec) : $a)->values();
        if ($placement === 'story') {
            $line = array_key_exists('story_text', $data) ? $data['story_text'] : $repost->story_text;
            $repost->update(['story_text' => $line, 'placement' => 'story']);
            $credit = $repost->attribution ? '@'.ltrim($repost->author, '@').' on '.$repost->sourceLabel() : null;
            $assets = $assets->map(fn (Asset $a) => $source->sticker($repost, $a, $line, $credit))->values();
        } else {
            $repost->update(['placement' => $placement]);
        }

        $post = $request->user()->posts()->create([
            'title' => 'Repost of @'.ltrim($repost->author, '@').' from '.$repost->sourceLabel(),
            'body' => $repost->body(),
            'format' => $assets->contains('kind', 'video') ? 'video' : ($assets->isNotEmpty() ? 'image' : 'text'),
            'placement' => $placement,
            'platforms' => [$account->platform->value],
            'status' => PostStatus::Scheduled,
            'account_id' => $account->id,
            'scheduled_at' => $data['scheduled_at'] ?? now()->addHour(),
            'approved_at' => now(), // 6B: the operator reviewed the adaptation and scheduled it
            'approved_by' => $request->user()->id,
        ]);
        $post->syncAssets($assets->pluck('id')->all());
        $repost->update(['status' => 'scheduled', 'post_id' => $post->id]);
        ActionLog::record($request->user(), ($flags['auto'] ?? false) ? 'agent:autonomy' : 'you', 'repost.scheduled', $post,
            "Repost of @{$repost->author} from {$repost->sourceLabel()} scheduled on {$account->label()}".(($flags['auto'] ?? false) ? ' by a mode-B rule.' : '.'), 'auto');

        return response()->json($this->out($repost->fresh('account')), 201);
    }

    /**
     * Drop a repost, and its post with it while that hasn't gone out. One that's up stays on the record
     * (deleting it here wouldn't take it off the network); one the phone is posting right now can't go.
     */
    public function destroy(Request $request, Repost $repost): Response
    {
        $this->own($request, $repost);
        $post = $repost->post;
        abort_if($post?->status === PostStatus::Publishing, 409, 'The phone is posting it right now. Wait until it’s done, then delete it.');
        if ($post && ! in_array($post->status, [PostStatus::Submitted, PostStatus::Published], true)) {
            ActionLog::record($request->user(), 'you', 'repost.deleted', $repost,
                "Repost of @{$repost->author} from {$repost->sourceLabel()} deleted, with its {$post->status->value} post.", 'approved');
            $post->delete();
        }
        $repost->delete();

        return response()->noContent();
    }

    private function own(Request $request, Repost $repost): void
    {
        abort_unless($repost->user()->is($request->user()), 404);
    }

    /** Instagram won't take a post without a photo or video; X will. */
    private function missingMedia(Repost $repost, $assets): ?string
    {
        return $repost->account->platform === Platform::Instagram && $assets->isEmpty()
            ? 'Instagram needs a photo or video, and this post had none. Add one to schedule it.'
            : null;
    }

    /** Instagram: a tall video is a reel, anything else a feed post. Elsewhere, the usual default. */
    private function placement(Platform $platform, $assets): string
    {
        if ($platform === Platform::Instagram) {
            $first = $assets->first();

            return $first?->kind === 'video' && ($first->ratio() ?? 1) < 0.7 ? 'reel' : 'feed';
        }

        return app(PlatformSpecs::class)->defaultPlacement($platform, $assets);
    }

    /**
     * @return array<string, mixed>
     */
    private function out(Repost $r): array
    {
        return [
            'id' => $r->id,
            'source_platform' => $r->source_platform,
            'source_url' => $r->source_url,
            'author' => $r->author,
            'source_text' => $r->source_text,
            'media' => $r->assets()->map(fn (Asset $a) => ['id' => $a->id, 'kind' => $a->kind, 'url' => $a->url(), 'poster_url' => $a->posterUrl(), 'width' => $a->width, 'height' => $a->height])->all(),
            'permission' => $r->permission,
            'permission_note' => $r->permission_note,
            'status' => $r->status,
            'error' => $r->error,
            'caption' => $r->caption,
            'caption_with_credit' => $r->caption ? $r->creditedCaption() : null,
            'body' => $r->caption && $r->account ? $r->body() : null,
            'hashtags' => $r->hashtags ?? [],
            'options' => $r->options ?? [],
            'placement' => $r->placement,
            'story_text' => $r->story_text,
            'attribution' => $r->attribution,
            'post_id' => $r->post_id,
            // Its post's own status (scheduled, publishing, published…): what deleting the repost does to it.
            'post_status' => $r->post_id ? $r->post?->status->value : null,
            'account' => $r->relationLoaded('account') && $r->account ? [
                'id' => $r->account->id, 'platform' => $r->account->platform, 'handle' => $r->account->handle,
                // Without a phone and automation, a scheduled repost waits for ever: say so before it's booked.
                'posts_from_phone' => $r->account->device_id !== null && $r->account->automation,
                'phone' => $r->account->device_id === null ? 'none' : ($r->account->automation ? 'ready' : 'automation_off'),
            ] : null,
            'created_at' => $r->created_at?->toIso8601ZuluString(),
        ];
    }
}

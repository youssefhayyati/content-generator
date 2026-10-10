<?php

namespace App\Http\Controllers;

use App\Enums\Platform;
use App\Enums\PostStatus;
use App\Jobs\FetchRepostSource;
use App\Models\Account;
use App\Models\ActionLog;
use App\Models\Asset;
use App\Models\Repost;
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
        $reposts = $request->user()->reposts()->with('account:id,platform,handle')->latest('id')->limit(100)->get()
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

        $manual = filled($data['source_text'] ?? null);
        $repost = $request->user()->reposts()->create([
            'account_id' => $account->id,
            'source_platform' => $from,
            'source_url' => $data['source_url'],
            'author' => ltrim((string) ($data['author'] ?? ''), '@'),
            'source_text' => (string) ($data['source_text'] ?? ''),
            'asset_ids' => $data['asset_ids'] ?? [],
            'status' => $manual ? 'captured' : 'fetching',
        ]);
        if (! $manual) {
            FetchRepostSource::dispatch($repost->id);
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

    /** Rewrite it for the other network. The credit line is added by the model, not the AI. */
    public function adapt(Request $request, Repost $repost, Community $community): JsonResponse
    {
        $this->own($request, $repost);
        abort_unless($repost->status === 'captured', 409, 'This repost already moved on.');
        abort_if($repost->permission === 'pending', 422, 'Record whether reuse is allowed first.');
        abort_if($repost->permission === 'denied', 422, 'Reuse was denied for this post.');
        abort_unless($community->aiAvailable($request->user()), 502, 'The adaptation needs AI and a confirmed account.');

        $adapted = $community->adapt($repost);
        $repost->update(['caption' => $adapted['caption'], 'hashtags' => $adapted['hashtags'], 'status' => 'adapted']);

        // Mode B: a rule the operator approved schedules it on its own — when it has what it needs.
        if (! $this->missingMedia($repost, $repost->assets()) && app(Autonomy::class)->decide($repost->account, 'repost.schedule') === 'run') {
            $this->schedule($request, $repost->fresh(), ['auto' => true]);
        }

        return response()->json($this->out($repost->fresh('account')));
    }

    /**
     * Make it a real post: approved and scheduled (6B by the operator, here), with the source's
     * media, for the phone agent to publish like any other post.
     */
    public function schedule(Request $request, Repost $repost, array $flags = []): JsonResponse
    {
        $this->own($request, $repost);
        abort_unless($repost->status === 'adapted', 409, 'Adapt it first, or it’s already a post.');
        $account = $repost->account;
        $data = $request->validate([
            'scheduled_at' => ['nullable', 'date', 'after:now'],
            'caption' => ['nullable', 'string', 'max:'.$account->platform->characterLimit()],
            // A photo or video to post instead of the source's, e.g. when it had none.
            'asset_ids' => ['nullable', 'array', 'min:1', 'max:10'],
            'asset_ids.*' => ['integer', Rule::exists('assets', 'id')->where('user_id', $request->user()->id)],
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
        if ($account->platform === Platform::X) {
            $assets = $assets->take(4);
        }

        $post = $request->user()->posts()->create([
            'title' => 'Repost of @'.ltrim($repost->author, '@').' from '.$repost->sourceLabel(),
            'body' => $repost->body(),
            'format' => $assets->contains('kind', 'video') ? 'video' : ($assets->isNotEmpty() ? 'image' : 'text'),
            'placement' => $this->placement($account->platform, $assets),
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

    public function destroy(Request $request, Repost $repost): Response
    {
        $this->own($request, $repost);
        abort_if($repost->status === 'scheduled', 409, 'It’s already a post. Delete the post instead.');
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
            'media' => $r->assets()->map(fn (Asset $a) => ['id' => $a->id, 'kind' => $a->kind, 'url' => $a->url(), 'poster_url' => $a->posterUrl()])->all(),
            'permission' => $r->permission,
            'permission_note' => $r->permission_note,
            'status' => $r->status,
            'error' => $r->error,
            'caption' => $r->caption,
            'caption_with_credit' => $r->caption ? $r->creditedCaption() : null,
            'body' => $r->caption && $r->account ? $r->body() : null,
            'hashtags' => $r->hashtags ?? [],
            'attribution' => $r->attribution,
            'post_id' => $r->post_id,
            'account' => $r->relationLoaded('account') && $r->account ? ['id' => $r->account->id, 'platform' => $r->account->platform, 'handle' => $r->account->handle] : null,
            'created_at' => $r->created_at?->toIso8601ZuluString(),
        ];
    }
}

<?php

namespace App\Services\Studio;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\Campaign;
use App\Models\Comment;
use App\Models\FlowRun;
use App\Models\InboxNote;
use App\Models\ItemVariant;
use App\Models\Post;
use App\Models\ProfileChange;
use App\Models\Repost;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Everything waiting on a person, in one list: plans and content to approve, posts a phone
 * couldn't publish or prove, exceptions no rule covered, replies to review, profile changes.
 * Each source adds items here; the sidebar shows the count.
 */
class Inbox
{
    /**
     * @return Collection<int, array{kind: string, key: string, title: string, detail: string, at: string|null, link: string, tone: string, post_id?: int}>
     */
    public function items(User $user): Collection
    {
        return collect()
            ->concat($this->storms($user))
            ->concat($this->flowApprovals($user))
            ->concat($this->notes($user))
            ->concat($this->gates($user))
            ->concat($this->profileChanges($user))
            ->concat($this->posts($user))
            ->concat($this->comments($user))
            ->concat($this->reposts($user))
            // A frozen account comes before everything else; then oldest first.
            ->sortBy(fn (array $item) => [$item['kind'] === 'storm' ? 0 : 1, $item['at'] ?? '9999'])
            ->values();
    }

    public function count(User $user): int
    {
        return $user->posts()->whereIn('status', [PostStatus::Failed, PostStatus::Submitted])->count()
            + $user->campaigns()->whereIn('stage', ['plan_review', 'content_review'])->count()
            + ProfileChange::whereIn('account_id', $user->accounts()->select('id'))->where('status', 'pending')->count()
            + $user->comments()->whereIn('status', ['human', 'drafted'])->count()
            + $user->reposts()->where('status', 'captured')->where('permission', 'pending')->count()
            + $user->flowRuns()->where('status', 'approval')->count()
            + $user->inboxNotes()->whereNull('dismissed_at')->count()
            + $user->accounts()->whereNotNull('storm_at')->count();
    }

    /**
     * Accounts Storm Guard froze: nothing approved before the storm publishes until a person
     * gives the all clear. Always first in the list.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function storms(User $user): Collection
    {
        return $user->accounts()->whereNotNull('storm_at')->withCount(['posts as held' => fn ($q) => $q->where('status', PostStatus::Scheduled)])->get()
            ->map(fn (Account $a) => [
                'kind' => 'storm',
                'key' => "storm-{$a->id}",
                'account_id' => $a->id,
                'title' => "Storm Guard froze {$a->label()}",
                'detail' => trim(($a->storm_reason ?? '').' '.($a->held ? "{$a->held} scheduled ".Str::plural('post', $a->held).' held.' : 'Nothing scheduled was waiting.')),
                'at' => $a->storm_at?->toIso8601ZuluString(),
                'link' => '/dashboard/comments',
                'tone' => 'fail',
            ]);
    }

    /**
     * Flows holding at an "Ask me first": the draft, ready to approve (or edit, or reject).
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function flowApprovals(User $user): Collection
    {
        return $user->flowRuns()->with('flow:id,name')->where('status', 'approval')->oldest('updated_at')->limit(20)->get()
            ->map(fn (FlowRun $r) => [
                'kind' => 'flow_approval',
                'key' => "flow-run-{$r->id}",
                'run_id' => $r->id,
                'title' => "{$r->flow->name}: ".($r->approval()['ask'] ?? 'Go ahead?'),
                'detail' => filled($r->approval()['draft'] ?? null) ? '“'.Str::limit((string) $r->approval()['draft'], 140).'”' : (string) $r->cause,
                'flow' => $r->flow->name,
                'ask' => $r->approval()['ask'] ?? 'Go ahead?',
                'draft' => $r->approval()['draft'] ?? null,
                'media' => $r->approval()['media'] ?? null,
                'account' => $r->approval()['account'] ?? null,
                'platform' => $r->approval()['platform'] ?? null,
                'at' => $r->updated_at?->toIso8601ZuluString(),
                'link' => "/dashboard/flows?id={$r->flow_id}&run={$r->id}",
                'tone' => 'accent',
            ]);
    }

    /**
     * @return Collection<int, array<string, mixed>>
     */
    private function notes(User $user): Collection
    {
        return $user->inboxNotes()->whereNull('dismissed_at')->latest('id')->limit(20)->get()
            ->map(fn (InboxNote $n) => [
                'kind' => 'note',
                'key' => "note-{$n->id}",
                'note_id' => $n->id,
                'title' => $n->title,
                'detail' => (string) $n->detail,
                'at' => $n->created_at?->toIso8601ZuluString(),
                'link' => $n->link ?? '/dashboard/flows',
                'tone' => $n->tone,
            ]);
    }

    /**
     * Campaigns waiting at a gate: the plan (6A), or the finished content (6B).
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function gates(User $user): Collection
    {
        return $user->campaigns()->whereIn('stage', ['plan_review', 'content_review'])->get()->map(function (Campaign $c) {
            $review = $c->stage === 'content_review';
            $waiting = $review ? ItemVariant::whereIn('campaign_item_id', $c->items()->pluck('id'))->where('status', 'draft')->count() : $c->items()->count();

            return [
                'kind' => $review ? 'content_review' : 'plan_review',
                'key' => "campaign-{$c->id}-{$c->stage}",
                'title' => ($review ? 'Approve the content: ' : 'Approve the plan: ').($c->title() ?? 'Untitled campaign'),
                'detail' => $review
                    ? "{$waiting} ".Str::plural('version', $waiting).' waiting for gate 6B. Nothing is scheduled until you approve them.'
                    : "{$waiting} ".Str::plural('post', $waiting).' planned. Production starts when you approve the plan (gate 6A).',
                'at' => ($c->period_start ?? $c->updated_at)?->toIso8601ZuluString(),
                'link' => "/dashboard/campaigns?id={$c->id}&tab=".($review ? 'review' : 'plan'),
                'tone' => 'accent',
            ];
        });
    }

    /**
     * @return Collection<int, array<string, mixed>>
     */
    private function profileChanges(User $user): Collection
    {
        return ProfileChange::with('account')->whereIn('account_id', $user->accounts()->select('id'))->where('status', 'pending')->latest('id')->get()
            ->map(fn (ProfileChange $c) => [
                'kind' => 'profile_change',
                'key' => "profile-{$c->id}",
                'title' => ($c->source === 'ai' ? 'The AI suggests' : 'Proposed').": a new {$c->field} for @{$c->account->handle}",
                'detail' => '“'.Str::limit((string) $c->to, 120).'”'.($c->reason ? ' · '.Str::limit($c->reason, 120) : ''),
                'at' => $c->created_at?->toIso8601ZuluString(),
                'link' => "/dashboard/accounts?id={$c->account_id}",
                'tone' => 'plan',
            ]);
    }

    /**
     * Comments the AI sent to a human, or replies waiting for the human's approval. In mode B
     * these are the exceptions: no approved rule covered them.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function comments(User $user): Collection
    {
        return $user->comments()->with('account')->whereIn('status', ['human', 'drafted'])->oldest('id')->limit(20)->get()
            ->map(fn (Comment $c) => [
                'kind' => $c->status === 'human' ? 'comment_human' : 'comment_drafted',
                'key' => "comment-{$c->id}",
                'title' => ($c->status === 'human' ? 'Comment needs a human: ' : 'Reply waiting for review: ').'@'.$c->author,
                'detail' => Str::limit($c->body, 100).($c->triage['reason'] ?? '' ? ' · '.Str::limit((string) $c->triage['reason'], 80) : ''),
                'at' => $c->created_at?->toIso8601ZuluString(),
                'link' => '/dashboard/comments',
                'tone' => $c->status === 'human' ? 'warn' : 'plan',
            ]);
    }

    /**
     * Reposts waiting for the permission check: a person records whether reuse is allowed, and why.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function reposts(User $user): Collection
    {
        return $user->reposts()->where('status', 'captured')->where('permission', 'pending')->oldest('id')->limit(10)->get()
            ->map(fn (Repost $r) => [
                'kind' => 'repost_permission',
                'key' => "repost-{$r->id}",
                'title' => 'May we repost this? @'.$r->author,
                'detail' => Str::limit($r->source_text, 100).' Record whether reuse is allowed, and why.',
                'at' => $r->created_at?->toIso8601ZuluString(),
                'link' => '/dashboard/reposts',
                'tone' => 'plan',
            ]);
    }

    /**
     * Posts the phones couldn't publish, or couldn't prove they published.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function posts(User $user): Collection
    {
        return $user->posts()->with('account')
            ->whereIn('status', [PostStatus::Failed, PostStatus::Submitted])
            ->orderBy('scheduled_at')
            ->get()
            ->map(fn (Post $post) => [
                'kind' => $post->status === PostStatus::Failed ? 'publish_failed' : 'publish_unconfirmed',
                'key' => "post-{$post->id}",
                'post_id' => $post->id,
                'title' => $post->status === PostStatus::Failed
                    ? 'Couldn’t publish: '.Str::limit($post->title ?: $post->body, 60)
                    : 'Not confirmed live: '.Str::limit($post->title ?: $post->body, 60),
                'detail' => $post->status === PostStatus::Failed
                    ? ($post->error ?: 'Every attempt failed.').' Take over and post it by hand, or try again.'
                    : 'The phone was told to post, but nothing proves it went live. Check the account and confirm.',
                'at' => $post->scheduled_at?->toIso8601ZuluString(),
                'link' => "/dashboard/create?post={$post->id}",
                'tone' => $post->status === PostStatus::Failed ? 'fail' : 'warn',
            ]);
    }
}

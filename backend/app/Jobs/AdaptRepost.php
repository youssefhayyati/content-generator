<?php

namespace App\Jobs;

use App\Models\ActionLog;
use App\Models\Repost;
use App\Services\Community\Community;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Str;
use Throwable;

/**
 * A repost picked with its placement, adapted for it as soon as it's read, off the request (the model takes
 * up to a couple of minutes). The person who picked it is the one allowing its reuse, as when adapting by hand.
 * If the AI fails, it goes back to "picked" with the reason, to adapt by hand.
 */
class AdaptRepost implements ShouldQueue
{
    use Queueable;

    public int $timeout = 300;

    public int $tries = 1;

    public function __construct(public int $repostId) {}

    public function handle(Community $community): void
    {
        $repost = Repost::with(['user', 'account'])->find($this->repostId);
        if (! $repost || $repost->status !== 'adapting') {
            return;
        }
        if ($repost->permission === 'pending') {
            $repost->update(['permission' => 'allowed', 'permission_note' => 'Allowed by '.$repost->user->name.' when picking it.']);
            ActionLog::record($repost->user, 'you', 'repost.permission', $repost, "Reuse of @{$repost->author}’s post allowed when picking it.", 'approved');
        }
        try {
            if (! $community->aiAvailable($repost->user)) {
                throw new \RuntimeException('The adaptation needs AI and a confirmed account.');
            }
            $options = $community->adapt($repost, $repost->placement);
            $repost->update(['caption' => $options[0]['caption'], 'hashtags' => $options[0]['hashtags'], 'options' => $options, 'status' => 'adapted', 'error' => null]);
        } catch (Throwable $e) {
            report($e);
            $repost->update(['status' => 'captured', 'error' => 'Couldn’t adapt it: '.Str::limit($e->getMessage() ?: 'the AI didn’t answer.', 300)]);
        }
    }
}

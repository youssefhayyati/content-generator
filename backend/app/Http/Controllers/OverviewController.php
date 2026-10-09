<?php

namespace App\Http\Controllers;

use App\Enums\PostStatus;
use App\Http\Resources\PostResource;
use App\Models\Post;
use App\Models\User;
use App\Services\PostQueue;
use App\Services\Studio\Inbox;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class OverviewController extends Controller
{
    /**
     * Everything the dashboard home needs in one request.
     */
    public function __invoke(Request $request, PostQueue $queue, Inbox $inbox): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $tz = $user->timezoneOrUtc();

        $counts = $user->posts()
            ->selectRaw('status, count(*) as n')
            ->groupBy('status')
            ->pluck('n', 'status');

        $today = CarbonImmutable::now($tz)->startOfDay();
        $inWeek = $user->posts()
            ->whereIn('status', [PostStatus::Scheduled, PostStatus::Published])
            ->where('scheduled_at', '>=', $today->utc())
            ->where('scheduled_at', '<', $today->addDays(7)->utc())
            ->get(['scheduled_at']);

        $week = collect(range(0, 6))->map(function (int $i) use ($today, $inWeek, $tz) {
            $date = $today->addDays($i)->toDateString();

            return [
                'date' => $date,
                'count' => $inWeek->filter(
                    fn (Post $p) => CarbonImmutable::instance($p->scheduled_at)->setTimezone($tz)->toDateString() === $date
                )->count(),
            ];
        });

        $platforms = [];
        foreach ($user->posts()->pluck('platforms') as $list) {
            foreach ($list as $platform) {
                $platforms[$platform] = ($platforms[$platform] ?? 0) + 1;
            }
        }
        arsort($platforms);

        return response()->json([
            'counts' => [
                'draft' => (int) ($counts['draft'] ?? 0),
                'scheduled' => (int) ($counts['scheduled'] ?? 0),
                'published' => (int) ($counts['published'] ?? 0),
                'publishing' => (int) ($counts['publishing'] ?? 0) + (int) ($counts['submitted'] ?? 0),
                'failed' => (int) ($counts['failed'] ?? 0),
                'total' => (int) $counts->sum(),
            ],
            'inbox' => $inbox->count($user),
            'publishing_paused' => $user->publishingPaused(),
            // Scheduled for a time that has passed. Nothing publishes to the networks yet,
            // so these are waiting to be posted by hand and marked as published.
            'due' => $user->posts()
                ->where('status', PostStatus::Scheduled)
                ->where('scheduled_at', '<', now())
                ->count(),
            'upcoming' => PostResource::collection($user->posts()->with(['account', 'assets'])
                ->where('status', PostStatus::Scheduled)
                ->where('scheduled_at', '>=', now())
                ->orderBy('scheduled_at')
                ->limit(5)
                ->get()),
            'drafts' => PostResource::collection($user->posts()->with(['account', 'assets'])
                ->where('status', PostStatus::Draft)
                ->latest('updated_at')
                ->limit(4)
                ->get()),
            'week' => $week,
            'platforms' => $platforms,
            'next_slot' => $queue->nextFree($user)?->toIso8601ZuluString(),
            // The automation layer at a glance: flows working, runs waiting on you, frozen accounts.
            'automation' => [
                'flows_on' => $user->flows()->where('enabled', true)->count(),
                'runs_today' => $user->flowRuns()->where('created_at', '>=', now()->startOfDay())->count(),
                'waiting_on_you' => $user->flowRuns()->where('status', 'approval')->count(),
                'frozen' => $user->accounts()->whereNotNull('storm_at')->get(['id', 'handle', 'platform'])->map(fn ($a) => ['id' => $a->id, 'handle' => $a->handle, 'platform' => $a->platform]),
            ],
        ]);
    }
}

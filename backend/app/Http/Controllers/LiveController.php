<?php

namespace App\Http\Controllers;

use App\Enums\PostStatus;
use App\Models\Device;
use App\Models\FlowRun;
use App\Models\Generation;
use App\Models\Post;
use App\Models\PublishingRun;
use App\Models\User;
use App\Services\Flows\Catalog;
use App\Services\Studio\StormGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Mission Control: everything the automation is doing, right now, in one read the live wall
 * polls every few seconds. Departures (the posts going out), the phones and what they're doing,
 * flows at work, sound and video being made, and the weather on every account.
 */
class LiveController extends Controller
{
    public function __invoke(Request $request, StormGuard $guard): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();

        $posts = $user->posts()->with('account')
            ->whereNotNull('scheduled_at')
            ->where(fn ($q) => $q
                ->whereBetween('scheduled_at', [now()->subHours(6), now()->addHours(48)])
                ->orWhereIn('status', [PostStatus::Publishing, PostStatus::Submitted]))
            ->orderBy('scheduled_at')
            ->limit(18)
            ->get();

        $devices = $user->devices()->with('accounts:id,device_id,platform,handle')->orderBy('name')->get();
        $runs = PublishingRun::whereIn('id', $devices->pluck('booked_run_id')->filter())->get()->keyBy('device_id');
        $lastRuns = PublishingRun::where('user_id', $user->id)->whereIn('device_id', $devices->pluck('id'))
            ->whereIn('id', PublishingRun::selectRaw('max(id)')->where('user_id', $user->id)->groupBy('device_id'))->get()->keyBy('device_id');

        $flowRuns = $user->flowRuns()->with('flow:id,name,graph')->whereIn('status', FlowRun::LIVE)->latest('updated_at')->limit(6)->get();
        $nodes = Catalog::nodes();

        $making = $user->generations()->whereIn('status', ['queued', 'running'])->latest('id')->limit(8)->get();
        $made = $user->generations()->where('status', 'succeeded')->whereIn('kind', ['image', 'video', 'voice', 'music', 'reel'])->latest('finished_at')->limit(4)->get();

        $today = now()->setTimezone($user->timezoneOrUtc())->startOfDay()->utc();

        return response()->json([
            'now' => now()->toIso8601ZuluString(),
            'timezone' => $user->timezoneOrUtc(),
            'paused' => $user->publishingPaused(),
            'departures' => $posts->map(fn (Post $p) => [
                'id' => $p->id,
                'at' => $p->scheduled_at?->toIso8601ZuluString(),
                'title' => Str::limit(trim($p->title ?: $p->body), 60, '…'),
                'account' => $p->account ? ['handle' => $p->account->handle, 'platform' => $p->account->platform] : null,
                'platforms' => $p->platforms,
                'format' => $p->format->value,
                'status' => $this->boardStatus($p),
                'url' => $p->post_url,
            ])->values(),
            'phones' => $devices->map(function (Device $d) use ($runs, $lastRuns) {
                $run = $runs->get($d->id);
                $last = $lastRuns->get($d->id);

                return [
                    'id' => $d->id,
                    'name' => $d->name,
                    'driver' => $d->driver,
                    'status' => $d->isPaused() ? 'paused' : $d->status,
                    'screenshot_url' => $d->last_screenshot ? "/api/devices/{$d->id}/screenshot?v=".$d->updated_at?->timestamp : null,
                    'accounts' => $d->accounts->map(fn ($a) => ['platform' => $a->platform, 'handle' => $a->handle])->values(),
                    'run' => $run ? [
                        'goal' => $run->goal,
                        'started_at' => $run->started_at?->toIso8601ZuluString(),
                        'steps' => collect($run->steps ?? [])->take(-5)->values(),
                    ] : null,
                    'last' => $last && ! $run ? ['status' => $last->status, 'goal' => $last->goal, 'ended_at' => $last->ended_at?->toIso8601ZuluString()] : null,
                    'seen_at' => $d->last_seen_at?->toIso8601ZuluString(),
                ];
            })->values(),
            'flows' => $flowRuns->map(function (FlowRun $r) use ($nodes) {
                $here = $r->status === 'running' ? ($r->pending[0] ?? null) : $r->waiting_on;
                $node = collect($r->flow->graph['nodes'] ?? [])->firstWhere('id', $here);

                return [
                    'id' => $r->id,
                    'flow_id' => $r->flow_id,
                    'name' => $r->flow->name,
                    'status' => $r->status,
                    'cause' => $r->cause,
                    'graph' => $r->flow->graph,
                    'visited' => collect($r->trail ?? [])->pluck('node')->unique()->values(),
                    'here' => $here,
                    'step' => $node ? ($nodes[$node['type']]['label'] ?? $node['type']) : null,
                    'resume_at' => $r->resume_at?->toIso8601ZuluString(),
                ];
            })->values(),
            'making' => $making->map(fn (Generation $g) => ['id' => $g->id, 'kind' => $g->kind, 'prompt' => Str::limit($g->prompt, 60), 'since' => ($g->started_at ?? $g->created_at)?->toIso8601ZuluString()])->values(),
            'made' => $made->map(fn (Generation $g) => ['id' => $g->id, 'kind' => $g->kind, 'prompt' => Str::limit($g->prompt, 60), 'output' => $g->outputs()->first()?->summary(), 'at' => $g->finished_at?->toIso8601ZuluString()])->values(),
            'weather' => $user->accounts()->orderBy('platform')->get()->map(fn ($a) => [...$guard->pressure($a), 'handle' => $a->handle, 'platform' => $a->platform])->values(),
            'today' => [
                'published' => $user->posts()->where('published_at', '>=', $today)->count(),
                'runs' => $user->publishingRuns()->where('created_at', '>=', $today)->count(),
                'flows' => $user->flowRuns()->where('created_at', '>=', $today)->count(),
                'made' => $user->generations()->where('status', 'succeeded')->where('finished_at', '>=', $today)->count(),
                'comments' => $user->comments()->where('created_at', '>=', $today)->count(),
            ],
        ]);
    }

    /** One word for the board, the way a departures board would say it. */
    private function boardStatus(Post $p): string
    {
        $soon = $p->scheduled_at && $p->scheduled_at->isFuture() && $p->scheduled_at->diffInMinutes(now(), true) <= 15;

        return match (true) {
            $p->status === PostStatus::Published => 'live',
            $p->status === PostStatus::Publishing => 'publishing',
            $p->status === PostStatus::Submitted => 'checking',
            $p->status === PostStatus::Failed => 'needs_you',
            $p->status === PostStatus::Draft => 'draft',
            $p->account?->isHeld() && (! $p->approved_at || $p->approved_at->lessThan($p->account->storm_at)) => 'held',
            ! $p->approved_at => 'waiting',
            filled($p->error) => 'delayed',
            $soon => 'boarding',
            $p->scheduled_at?->isPast() && ! ($p->account?->automation) => 'by_hand',
            $p->scheduled_at?->isPast() => 'due',
            default => 'on_time',
        };
    }
}

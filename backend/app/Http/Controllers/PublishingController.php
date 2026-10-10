<?php

namespace App\Http\Controllers;

use App\Http\Resources\PostResource;
use App\Http\Resources\PublishingRunResource;
use App\Models\ActionLog;
use App\Models\Post;
use App\Models\PublishingRun;
use App\Services\Publishing\Publisher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Publishing runs: the records, the stop button, and the operator's recovery moves
 * (try again, confirm live). The agent token for the automation service lives here too.
 */
class PublishingController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $runs = $request->user()->publishingRuns()->with(['post', 'device'])->latest('id')->limit(100)->get();

        return PublishingRunResource::collection($runs);
    }

    public function show(Request $request, PublishingRun $run): PublishingRunResource
    {
        abort_unless($run->user()->is($request->user()), 404);

        return PublishingRunResource::make($run->load(['post', 'device']));
    }

    /** What a typical run costs: steps, wall-clock and spend, averaged over the finished runs. */
    public function usage(Request $request): JsonResponse
    {
        $runs = $request->user()->publishingRuns()->where('status', '!=', 'running')->get(['steps', 'started_at', 'ended_at', 'spend']);
        $n = max(1, $runs->count());

        return response()->json([
            'runs' => $runs->count(),
            'typical' => [
                'steps' => round($runs->avg(fn ($r) => count($r->steps ?? [])) ?? 0, 1),
                'wall_clock_ms' => (int) round($runs->avg(fn ($r) => $r->started_at?->diffInMilliseconds($r->ended_at) ?? 0) ?? 0),
                'spend' => round((float) $runs->avg('spend'), 4),
            ],
            'outcomes' => $request->user()->publishingRuns()->where('status', '!=', 'running')
                ->selectRaw('status, count(*) as n')->groupBy('status')->pluck('n', 'status'),
        ]);
    }

    /** The stop button: while it's pressed, nothing publishes automatically. */
    public function pause(Request $request): JsonResponse
    {
        $request->user()->forceFill(['publishing_paused_at' => now()])->save();
        ActionLog::record($request->user(), 'you', 'publishing.paused', null, 'Pressed the stop button: automated publishing is paused.');

        return response()->json(['paused' => true]);
    }

    public function resume(Request $request): JsonResponse
    {
        $request->user()->forceFill(['publishing_paused_at' => null])->save();
        ActionLog::record($request->user(), 'you', 'publishing.resumed', null, 'Automated publishing is running again.');

        return response()->json(['paused' => false]);
    }

    /** Operator recovery: try a failed or unconfirmed post again, right away. */
    public function retry(Request $request, Post $post, Publisher $publisher): JsonResponse
    {
        Gate::authorize('update', $post);
        $run = $publisher->retry($post);

        // On the sync queue the simulator run has already finished: answer with how it ended.
        return PublishingRunResource::make($run->refresh()->load(['post', 'device']))->response()->setStatusCode(201);
    }

    /** Operator recovery: they checked the account themselves; it's live, here's the proof. */
    public function confirm(Request $request, Post $post, Publisher $publisher): JsonResponse
    {
        Gate::authorize('update', $post);
        $data = $request->validate(['post_url' => ['required', 'url', 'max:500']]);
        $publisher->confirmLive($post, $data['post_url'], $request->user());

        return response()->json(['status' => 'published', 'post_url' => $data['post_url']]);
    }

    /**
     * The voice assistant posted this from the team's phone because the person told it to, right then:
     * the run as the phone did it, with the screenshot it ended on. Confirmed, the post is published at
     * that moment (and shows on the calendar there); uncertain, a person checks; failed, nothing changes
     * but the error.
     */
    public function phoneRun(Request $request, Post $post, Publisher $publisher): JsonResponse
    {
        Gate::authorize('update', $post);
        $data = $request->validate([
            'outcome' => ['required', Rule::in(['confirmed', 'uncertain', 'failed'])],
            'note' => ['nullable', 'string', 'max:2000'],
            'steps' => ['nullable', 'json'],
            'started_at' => ['nullable', 'date'],
            'ended_at' => ['nullable', 'date'],
            'device_ref' => ['nullable', 'string', 'max:100'],
            'post_url' => ['nullable', 'url', 'max:500'],
            'screenshot' => ['nullable', 'file', 'image', 'max:10240'],
        ]);
        abort_if($data['outcome'] === 'confirmed' && ! $request->hasFile('screenshot') && empty($data['post_url']), 422, 'Confirmed needs proof: the screenshot, or the post’s URL.');
        $run = $publisher->recordPhoneRun($post, $request->user(), $data, $request->file('screenshot'));

        return response()->json([
            'run' => PublishingRunResource::make($run->load(['post', 'device'])),
            'post' => PostResource::make($post->fresh(['account', 'assets', 'campaign', 'latestRun'])),
        ], 201);
    }

    /** The token the automation service signs its calls with. Shown once per page load; rotate any time. */
    public function token(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->agent_token) {
            $user->forceFill(['agent_token' => Str::random(48)])->save();
        }

        return response()->json(['token' => $user->agent_token]);
    }

    public function rotateToken(Request $request): JsonResponse
    {
        $request->user()->forceFill(['agent_token' => Str::random(48)])->save();
        ActionLog::record($request->user(), 'you', 'agent_token.rotated', null, 'Rotated the automation service token.');

        return response()->json(['token' => $request->user()->agent_token]);
    }
}

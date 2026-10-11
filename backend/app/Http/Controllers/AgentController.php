<?php

namespace App\Http\Controllers;

use App\Models\Asset;
use App\Models\Post;
use App\Models\PublishingRun;
use App\Services\Publishing\Publisher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * The agent API: how the automation service (the Python dev) works its phones. Bearer-token
 * auth (EnsureAgentToken). The loop is: ask for the next job on your phone, drive it with the
 * phone-control API, report steps and screenshots as you go, then finish — with proof, with
 * a failure, or honestly uncertain.
 */
class AgentController extends Controller
{
    /** The run booked on one of the caller's phones, with everything needed to drive it. 204 when idle. */
    public function nextJob(Request $request, Publisher $publisher): JsonResponse
    {
        $device = $request->user()->devices()->where('driver', 'http')->where('ref', $request->query('device_ref'))->first();
        abort_unless($device, 404, 'No HTTP phone of yours has that device ID.');
        $job = $publisher->nextJob($device);

        return $job ? response()->json($job) : response()->json(null, 204);
    }

    /** Steps as they happen; each call is also the run's heartbeat against the sweep. */
    public function steps(Request $request, PublishingRun $run, Publisher $publisher): JsonResponse
    {
        $this->ownRun($request, $run);
        abort_unless($run->isRunning(), 409, 'This run already ended.');
        abort_if(count($run->steps ?? []) + count($request->input('steps', [])) > (int) config('publishing.step_budget'), 422, 'Step budget exceeded (R7). End the run.');
        $data = $request->validate([
            'steps' => ['required', 'array', 'min:1'],
            'steps.*.action' => ['required', 'string', 'max:60'],
            'steps.*.ok' => ['required', 'boolean'],
            'steps.*.ms' => ['required', 'integer', 'min:0', 'max:600000'],
            'steps.*.note' => ['nullable', 'string', 'max:200'],
        ]);
        $publisher->addSteps($run, $data['steps']);

        return response()->json(['steps' => count($run->steps ?? [])]);
    }

    /** A screenshot: kept as evidence, and shown as the phone's latest on the Devices page. */
    public function screenshot(Request $request, PublishingRun $run, Publisher $publisher): JsonResponse
    {
        $this->ownRun($request, $run);
        abort_unless($run->isRunning(), 409, 'This run already ended.');
        $request->validate(['file' => ['required', 'image', 'max:10240']]);
        $asset = $publisher->attachScreenshot($run, (string) file_get_contents($request->file('file')->getRealPath()), $request->file('file')->getMimeType() ?? 'image/png');

        return response()->json(['asset_id' => $asset->id, 'url' => "/api/assets/{$asset->id}/file"], 201);
    }

    /**
     * End the run. confirmed needs proof (a post URL, or a screenshot already uploaded);
     * uncertain is the honest answer when the command was sent but nothing confirms it.
     */
    public function finish(Request $request, PublishingRun $run, Publisher $publisher): JsonResponse
    {
        $this->ownRun($request, $run);
        $data = $request->validate([
            'outcome' => ['required', Rule::in(['confirmed', 'failed', 'uncertain'])],
            'post_url' => ['nullable', 'url', 'max:500'],
            'note' => ['nullable', 'string', 'max:500'],
        ]);
        abort_if($data['outcome'] === 'confirmed' && ! ($data['post_url'] ?? null) && ! $run->screenshot_id, 422, 'Confirmed needs proof: a post_url, or upload a screenshot first.');
        $publisher->finish($run, $data['outcome'], $data['post_url'] ?? null, $data['note'] ?? null);

        return response()->json(['outcome' => $run->fresh()->status]);
    }

    /** The media for a job, so it can be copied to the phone before the job starts. */
    public function assetFile(Request $request, Asset $asset): BinaryFileResponse
    {
        abort_unless($asset->user()->is($request->user()), 404);

        return response()->file(Storage::disk('local')->path($asset->path), ['Content-Type' => $asset->mime]);
    }

    /**
     * How a post it published is doing, as the phone read it: likes, comments, shares, saves, views
     * (null where it couldn't see), and the newest comments.
     */
    public function metrics(Request $request, Post $post): JsonResponse
    {
        abort_unless($post->user()->is($request->user()), 404);
        $data = $request->validate([
            'likes' => ['nullable', 'integer', 'min:0'], 'comments' => ['nullable', 'integer', 'min:0'], 'shares' => ['nullable', 'integer', 'min:0'],
            'saves' => ['nullable', 'integer', 'min:0'], 'views' => ['nullable', 'integer', 'min:0'],
            'latest_comments' => ['nullable', 'array', 'max:10'], 'latest_comments.*.author' => ['nullable', 'string', 'max:80'], 'latest_comments.*.text' => ['nullable', 'string', 'max:500'],
        ]);
        $post->update(['metrics' => $data, 'metrics_at' => now()]);

        return response()->json(['ok' => true]);
    }

    private function ownRun(Request $request, PublishingRun $run): void
    {
        abort_unless($run->user()->is($request->user()), 404);
    }
}

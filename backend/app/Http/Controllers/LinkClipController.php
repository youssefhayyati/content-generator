<?php

namespace App\Http\Controllers;

use App\Jobs\CreateLinkClip;
use App\Models\LinkClip;
use App\Services\Clips\YouTubeDownloader;
use App\Services\Flows\SafeUrl;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class LinkClipController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $clips = $request->user()->linkClips()->with(['asset', 'post'])->latest()->limit(30)->get();

        return response()->json(['data' => $clips->map->summary()]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'url' => ['required', 'url:http,https', 'max:2048'],
            'platform' => ['required', Rule::in(['instagram', 'tiktok'])],
            'seconds' => ['required', 'integer', 'min:10', 'max:90'],
            'count' => ['sometimes', 'integer', 'min:1', 'max:10'],
            'accent' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'rights_confirmed' => ['accepted'],
        ], [
            'rights_confirmed.accepted' => 'Confirm that you own this source or have permission to reuse it.',
        ]);
        if ($problem = SafeUrl::problem($data['url'])) {
            throw ValidationException::withMessages(['url' => $problem]);
        }

        $count = (int) ($data['count'] ?? 3);
        $batchId = (string) Str::uuid();
        $clips = DB::transaction(function () use ($request, $data, $count, $batchId) {
            return collect(range(1, $count))->map(fn (int $index) => $request->user()->linkClips()->create([
                'batch_id' => $batchId,
                'batch_index' => $index,
                'batch_total' => $count,
                'source_url' => $data['url'],
                'source_type' => YouTubeDownloader::supports($data['url']) ? 'youtube' : 'article',
                'status' => 'queued',
                'settings' => [
                    'platform' => $data['platform'],
                    'seconds' => (int) $data['seconds'],
                    'accent' => $data['accent'] ?? '#a5b4fc',
                    'rights_confirmed_at' => now()->toIso8601ZuluString(),
                ],
            ]));
        });
        CreateLinkClip::dispatch($clips->first()->id);

        return response()->json(['data' => $clips->map->summary()], 202);
    }

    public function show(Request $request, LinkClip $clip): JsonResponse
    {
        $this->mine($request, $clip);

        return response()->json($clip->load(['asset', 'post'])->summary());
    }

    public function retry(Request $request, LinkClip $clip): JsonResponse
    {
        $this->mine($request, $clip);
        abort_unless($clip->status === 'failed', 409, 'Only a failed clip can be tried again.');
        $clips = $clip->batch_id
            ? $request->user()->linkClips()->where('batch_id', $clip->batch_id)->where('status', 'failed')->orderBy('batch_index')->get()
            : collect([$clip]);
        $clips->each->update(['status' => 'queued', 'error' => null]);
        CreateLinkClip::dispatch($clips->first()->id);

        return response()->json(['data' => $clips->map->summary()], 202);
    }

    public function destroy(Request $request, LinkClip $clip): Response
    {
        $this->mine($request, $clip);
        abort_if(! in_array($clip->status, ['ready', 'failed'], true), 409, 'Wait for this clip to finish before removing it.');
        $clip->delete();

        return response()->noContent();
    }

    private function mine(Request $request, LinkClip $clip): void
    {
        abort_unless($clip->user_id === $request->user()->id, 404);
    }
}

<?php

namespace App\Http\Controllers;

use App\Jobs\CreateLinkClip;
use App\Jobs\RestyleLinkClip;
use App\Models\LinkClip;
use App\Services\Clips\ClipFonts;
use App\Services\Clips\ClipStyle;
use App\Services\Clips\YouTubeDownloader;
use App\Services\Flows\SafeUrl;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use RuntimeException;

class LinkClipController extends Controller
{
    /** The latest clip jobs; with ?ready=1, every finished clip that has its video (the Gallery's Clips). */
    public function index(Request $request): JsonResponse
    {
        $ready = $request->boolean('ready');
        $clips = $request->user()->linkClips()
            ->when($ready, fn ($q) => $q->where('status', 'ready')->whereHas('asset'))
            ->with(['asset', 'post'])->latest()->limit($ready ? 300 : 30)->get();

        return response()->json(['data' => $clips->map->summary()]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'url' => ['required', 'url:http,https', 'max:2048'],
            'platform' => ['required', Rule::in(array_keys(LinkClip::PLACEMENTS))],
            'placement' => ['sometimes', 'nullable', Rule::in(is_string($request->input('platform')) ? (LinkClip::PLACEMENTS[$request->input('platform')] ?? []) : [])],
            'seconds' => ['required', 'integer', 'min:10', 'max:90'],
            'count' => ['sometimes', 'integer', 'min:1', 'max:10'],
            'accent' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            // The subtitles' main colour; the editor can change it, and everything else, later.
            'caption_color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'rights_confirmed' => ['accepted'],
        ], [
            'placement.in' => 'That type isn’t available on this platform.',
            'rights_confirmed.accepted' => 'Confirm that you own this source or have permission to reuse it.',
        ]);
        if ($problem = SafeUrl::problem($data['url'])) {
            throw ValidationException::withMessages(['url' => $problem]);
        }
        // A video that can't be clipped (too long, live, unavailable) is said now, not after a download.
        if (YouTubeDownloader::supports($data['url'])) {
            try {
                app(YouTubeDownloader::class)->check($data['url']);
            } catch (RuntimeException $e) {
                throw ValidationException::withMessages(['url' => $e->getMessage()]);
            }
        }
        $placement = $data['placement'] ?? LinkClip::PLACEMENTS[$data['platform']][0];
        // A story is at most 60 seconds.
        if ($placement === 'story' && $data['seconds'] > 60) {
            throw ValidationException::withMessages(['seconds' => 'A story can be at most 60 seconds.']);
        }

        $count = (int) ($data['count'] ?? 3);
        $batchId = (string) Str::uuid();
        $clips = DB::transaction(function () use ($request, $data, $count, $batchId, $placement) {
            return collect(range(1, $count))->map(fn (int $index) => $request->user()->linkClips()->create([
                'batch_id' => $batchId,
                'batch_index' => $index,
                'batch_total' => $count,
                'source_url' => $data['url'],
                'source_type' => YouTubeDownloader::supports($data['url']) ? 'youtube' : 'article',
                'status' => 'queued',
                'settings' => [
                    'platform' => $data['platform'],
                    'placement' => $placement,
                    'seconds' => (int) $data['seconds'],
                    'accent' => $data['accent'] ?? '#a5b4fc',
                    'rights_confirmed_at' => now()->toIso8601ZuluString(),
                    ...(filled($data['caption_color'] ?? null) ? ['style' => ['color' => strtolower($data['caption_color'])]] : []),
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
        abort_unless($clip->status === 'failed', 409, 'Only a failed highlight can be tried again.');
        $clips = $clip->batch_id
            ? $request->user()->linkClips()->where('batch_id', $clip->batch_id)->where('status', 'failed')->orderBy('batch_index')->get()
            : collect([$clip]);
        $clips->each->update(['status' => 'queued', 'error' => null]);
        CreateLinkClip::dispatch($clips->first()->id);

        return response()->json(['data' => $clips->map->summary()], 202);
    }

    /** Everything the highlight editor needs: the words, the look, the music and the clean master to preview over. */
    public function edit(Request $request, LinkClip $clip): JsonResponse
    {
        $this->mine($request, $clip);
        $clip->load(['asset', 'post']);
        $settings = $clip->settings ?? [];
        $accent = (string) ($settings['accent'] ?? '#a5b4fc');
        $music = ClipStyle::resolveMusic($settings['music'] ?? null);
        $track = $music['asset_id'] ? $request->user()->assets()->where('kind', 'audio')->find($music['asset_id']) : null;
        $analysis = $clip->analysis ?? [];
        $seconds = $clip->asset?->duration ?? (isset($analysis['start'], $analysis['end']) ? $analysis['end'] - $analysis['start'] : ($settings['seconds'] ?? 30));
        $words = array_values($analysis['words'] ?? $clip->asset?->meta['words'] ?? []);
        $arabic = ClipStyle::arabic($words);

        return response()->json([
            'clip' => $clip->summary(),
            'seconds' => round((float) $seconds, 2),
            'title' => $analysis['title'] ?? $clip->title,
            'words' => $words,
            'style' => ClipStyle::resolve($settings['style'] ?? null, $accent, $clip->source_type, $arabic),
            'defaults' => ClipStyle::defaults($accent, $clip->source_type, $arabic),
            'music' => [...$music, 'asset_id' => $track?->id, 'asset' => $track?->summary()],
            'master_url' => $clip->master_path && Storage::disk('local')->exists($clip->master_path) ? "/api/clips/{$clip->id}/master" : null,
            'batch_ready' => $clip->batch_id ? $request->user()->linkClips()->where('batch_id', $clip->batch_id)->where('status', 'ready')->whereNotNull('asset_id')->count() : 1,
            'fonts' => ClipFonts::catalog(),
        ]);
    }

    /** Save the editor's subtitles, look and music, and render the highlight again in the background. */
    public function update(Request $request, LinkClip $clip): JsonResponse
    {
        $this->mine($request, $clip);
        abort_unless($clip->status === 'ready' && $clip->asset_id, 409, 'Wait for this highlight to finish before editing it.');
        $data = $request->validate([...ClipStyle::rules(), 'apply_to_batch' => ['sometimes', 'boolean']]);
        if (filled($data['music']['asset_id'] ?? null) && ! $request->user()->assets()->where('kind', 'audio')->whereKey($data['music']['asset_id'])->exists()) {
            throw ValidationException::withMessages(['music.asset_id' => 'Choose a sound from your library.']);
        }

        $settings = $clip->settings ?? [];
        $style = array_key_exists('style', $data) ? [...($settings['style'] ?? []), ...$data['style']] : ($settings['style'] ?? null);
        $music = array_key_exists('music', $data) ? [...($settings['music'] ?? []), ...$data['music']] : ($settings['music'] ?? null);
        $clips = collect([$clip]);
        if (($data['apply_to_batch'] ?? false) && $clip->batch_id) {
            // The look and the music go to every finished highlight from the same link; the words stay each clip's own.
            $clips = $clips->merge($request->user()->linkClips()->where('batch_id', $clip->batch_id)->whereKeyNot($clip->id)
                ->where('status', 'ready')->whereNotNull('asset_id')->get());
        }

        DB::transaction(function () use ($clips, $clip, $data, $style, $music) {
            foreach ($clips as $target) {
                $target->settings = [...($target->settings ?? []), 'style' => $style, 'music' => $music];
                if ($target->is($clip) && array_key_exists('words', $data)) {
                    $target->analysis = [...($target->analysis ?? []), 'words' => self::words($data['words'])];
                }
                $target->status = 'rendering';
                $target->error = null;
                $target->save();
            }
        });
        $clips->each(fn (LinkClip $target) => RestyleLinkClip::dispatch($target->id));

        return response()->json(['data' => $clips->map(fn (LinkClip $target) => $target->load(['asset', 'post'])->summary())->values()], 202);
    }

    /** The clean master, for the editor's live preview (a file response, so the video can seek). */
    public function master(Request $request, LinkClip $clip): BinaryFileResponse
    {
        $this->mine($request, $clip);
        abort_unless($clip->master_path && Storage::disk('local')->exists($clip->master_path), 404);

        return response()->file(Storage::disk('local')->path($clip->master_path), [
            'Content-Type' => 'video/mp4',
            'Cache-Control' => 'private, max-age=86400',
        ]);
    }

    /** A subtitle font, so the editor previews exactly the file the video is burned with. */
    public function font(string $font): BinaryFileResponse
    {
        abort_unless(ClipFonts::has($font) && is_file((string) ClipFonts::path($font)), 404);

        return response()->file((string) ClipFonts::path($font), [
            'Content-Type' => 'font/ttf',
            'Cache-Control' => 'public, max-age=2592000, immutable',
        ]);
    }

    /**
     * Edited words, tidied: trimmed, in order, each at least a moment long.
     *
     * @return list<array{text: string, start: float, end: float}>
     */
    private static function words(array $words): array
    {
        return collect($words)
            ->map(fn (array $w) => ['text' => trim(preg_replace('/\s+/u', ' ', (string) $w['text'])), 'start' => round((float) $w['start'], 3), 'end' => round(max((float) $w['end'], (float) $w['start'] + 0.05), 3)])
            ->filter(fn (array $w) => $w['text'] !== '')
            ->sortBy('start')
            ->values()
            ->all();
    }

    public function destroy(Request $request, LinkClip $clip): Response
    {
        $this->mine($request, $clip);
        abort_if(! in_array($clip->status, ['ready', 'failed'], true), 409, 'Wait for this highlight to finish before removing it.');
        $clip->delete();

        return response()->noContent();
    }

    private function mine(Request $request, LinkClip $clip): void
    {
        abort_unless($clip->user_id === $request->user()->id, 404);
    }
}

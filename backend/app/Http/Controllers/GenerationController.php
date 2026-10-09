<?php

namespace App\Http\Controllers;

use App\Http\Resources\GenerationResource;
use App\Jobs\RunGeneration;
use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use App\Services\Campaigns\Voice;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Http\StreamedEvent;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The generators: text (streamed as it's written); photos, videos, voiceovers, music and reels
 * (queued, then made in the background).
 * Anything that fails can be retried as it was, on another model, or with an edited prompt.
 */
class GenerationController extends Controller
{
    private const TEXT_SYSTEM = 'You write content for a brand studio: posts, captions, scripts, hooks and ideas. Reply with the content only, in plain text: no preamble, no notes, no Markdown.';

    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'kind' => ['nullable', Rule::in(Generation::KINDS)],
            'kinds' => ['nullable', 'string', 'max:80'],
            'project_id' => ['nullable', 'integer'],
            'ids' => ['nullable', 'string'],
        ]);

        return GenerationResource::collection($request->user()->generations()
            ->when($filters['kind'] ?? null, fn ($q, $kind) => $q->where('kind', $kind))
            ->when($filters['kinds'] ?? null, fn ($q, $kinds) => $q->whereIn('kind', array_values(array_intersect(explode(',', $kinds), Generation::KINDS))))
            ->when($filters['project_id'] ?? null, fn ($q, $id) => $q->where('project_id', $id))
            ->when($filters['ids'] ?? null, fn ($q, $ids) => $q->whereIn('id', array_map('intval', explode(',', $ids))))
            ->latest('id')
            ->limit(60)
            ->get());
    }

    public function show(Generation $generation): GenerationResource
    {
        Gate::authorize('view', $generation);

        return GenerationResource::make($generation);
    }

    /**
     * A photo, video, voiceover, track or reel: queued, then made in the background.
     */
    public function store(Request $request, ModelRegistry $models): JsonResponse
    {
        $data = $this->validated($request, $models);
        abort_if($data['kind'] === 'text', 422, 'Text streams from POST /generations/text.');

        $generation = $request->user()->generations()->create($data + ['status' => 'queued']);
        RunGeneration::dispatch($generation->id);

        return GenerationResource::make($generation)->response()->setStatusCode(201);
    }

    /**
     * Text, streamed as server-sent events: `start` (the generation's id), `delta`s, then `done`,
     * or `error` with a message to show. The result is kept either way.
     */
    public function text(Request $request, ModelRegistry $models, UsageMeter $usage): StreamedResponse|JsonResponse
    {
        $data = $this->validated($request, $models, text: true);
        $generation = $request->user()->generations()->create($data + ['kind' => 'text', 'status' => 'running', 'started_at' => now()]);

        try {
            [$generator, $name] = $models->text($data['model']);
        } catch (GenerationFailed $e) {
            $generation->update(['status' => 'failed', 'error' => $e->getMessage(), 'finished_at' => now()]);

            return response()->json(['message' => $e->getMessage(), 'generation' => GenerationResource::make($generation)], 503);
        }
        $user = $request->user();
        $account = $request->filled('account_id') ? $user->accounts()->find($request->input('account_id')) : null;
        $system = self::TEXT_SYSTEM.($account ? "\n\nWrite for this account, in its voice; its rules win over everything else:\n".app(Voice::class)->context($account) : '');

        return response()->eventStream(function () use ($generation, $generator, $name, $usage, $user, $system) {
            yield new StreamedEvent('start', ['id' => $generation->id]);
            $text = '';
            $usage->push($user, $generation, 'studio');
            try {
                foreach ($generator->stream($name, $system, $generation->prompt) as $chunk) {
                    $text .= $chunk;
                    yield new StreamedEvent('delta', ['text' => $chunk]);
                }
                $generation->update(['status' => 'succeeded', 'output_text' => trim($text), 'finished_at' => now()]);
                yield new StreamedEvent('done', ['id' => $generation->id]);
            } catch (GenerationFailed $e) {
                $generation->update(['status' => 'failed', 'error' => $e->getMessage(), 'output_text' => trim($text) ?: null, 'finished_at' => now()]);
                yield new StreamedEvent('error', ['message' => $e->getMessage(), 'id' => $generation->id]);
            } finally {
                $usage->pop();
            }
        }, endStreamWith: null);
    }

    /**
     * Try again: as it was, on another model (`model`), or with an edited prompt (`prompt`).
     * Text retries go through POST /generations/text with `retry_of`.
     */
    public function retry(Request $request, Generation $generation, ModelRegistry $models): JsonResponse
    {
        Gate::authorize('update', $generation);
        abort_if($generation->kind === 'text', 422, 'Retry text through POST /generations/text with retry_of.');

        $request->merge(['kind' => $generation->kind] + array_filter([
            'model' => $request->input('model', $generation->model),
            'prompt' => $request->input('prompt', $generation->prompt),
        ]) + ['params' => $request->input('params', $generation->params), 'input_asset_ids' => $request->input('input_asset_ids', $generation->input_asset_ids), 'project_id' => $generation->project_id]);
        $data = $this->validated($request, $models);

        $retry = $request->user()->generations()->create($data + [
            'status' => 'queued', 'retry_of' => $generation->id,
            'recipe' => $generation->recipe, 'recipe_step' => $generation->recipe_step, 'parent_id' => $generation->parent_id,
        ]);
        RunGeneration::dispatch($retry->id);

        return GenerationResource::make($retry)->response()->setStatusCode(201);
    }

    public function destroy(Generation $generation): Response
    {
        Gate::authorize('delete', $generation);
        $generation->delete();

        return response()->noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, ModelRegistry $models, bool $text = false): array
    {
        $kind = $text ? 'text' : $request->input('kind');
        $known = $kind === 'reel' ? ['studio/reel'] : collect($models->all())->where('kind', $kind)->pluck('id')->all();
        $user = $request->user();

        $data = $request->validate([
            'kind' => $text ? [] : ['required', Rule::in(['image', 'video', 'voice', 'music', 'reel'])],
            'model' => ['nullable', Rule::in($known)],
            'prompt' => ['required', 'string', 'max:4000'],
            'params' => ['nullable', 'array'],
            'params.aspect_ratio' => ['nullable', 'string', 'max:8'],
            'params.duration' => ['nullable', 'integer', 'min:2', 'max:30'],
            'params.resolution' => ['nullable', Rule::in(['480p', '720p', '1080p', '4k', '1k', '2k', '1K', '2K', '4K'])],
            'params.rendering_speed' => ['nullable', Rule::in(['TURBO', 'DEFAULT', 'QUALITY'])],
            'params.negative_prompt' => ['nullable', 'string', 'max:500'],
            // Voiceovers
            'params.voice' => ['nullable', 'string', 'max:40'],
            'params.speed' => ['nullable', 'numeric', 'min:0.5', 'max:1.6'],
            // Music
            'params.mood' => ['nullable', 'string', 'max:40'],
            'params.seconds' => ['nullable', 'numeric', 'min:5', 'max:180'],
            'params.energy' => ['nullable', 'numeric', 'min:0', 'max:1'],
            'params.bpm' => ['nullable', 'numeric', 'min:50', 'max:170'],
            'params.key' => ['nullable', Rule::in(['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'])],
            'params.seed' => ['nullable', 'integer', 'min:1', 'max:2147483646'],
            // Reels
            'params.style' => ['nullable', Rule::in(['bold', 'editorial', 'pulse'])],
            'params.accent' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'params.title' => ['nullable', 'string', 'max:80'],
            'params.handle' => ['nullable', 'string', 'max:60', 'regex:/^@?[\w.\-]+$/u'],
            'params.captions' => ['nullable', 'boolean'],
            'params.music_volume' => ['nullable', 'numeric', 'min:0', 'max:1'],
            'params.music_asset_id' => ['nullable', 'integer', Rule::exists('assets', 'id')->where('user_id', $user->id)->where('kind', 'audio')],
            'params.batch_size' => ['nullable', 'integer', 'min:1', 'max:4'],
            'params.audio' => ['nullable', 'boolean'],
            'input_asset_ids' => ['nullable', 'array', 'max:10'],
            'input_asset_ids.*' => ['integer', Rule::exists('assets', 'id')->where('user_id', $user->id)],
            'project_id' => ['nullable', Rule::exists('projects', 'id')->where('user_id', $user->id)],
            'retry_of' => ['nullable', Rule::exists('generations', 'id')->where('user_id', $user->id)],
            'account_id' => ['nullable', Rule::exists('accounts', 'id')->where('user_id', $user->id)],
        ], [
            'prompt.required' => match ($kind) {
                'voice' => 'Write what the voice should say.',
                'reel' => 'Give the reel a name.',
                default => 'Describe what you want.',
            },
            'model.in' => 'Pick a model that makes '.(['video' => 'videos', 'image' => 'images', 'voice' => 'voiceovers', 'music' => 'music'][$kind] ?? 'text').'.',
            'params.handle.regex' => 'Use the handle as it appears on the platform.',
        ]);

        // A voiceover for an account speaks in the account's voice unless another was picked.
        if (in_array($kind, ['voice', 'music', 'reel'], true) && ($data['account_id'] ?? null)) {
            $sound = $user->accounts()->find($data['account_id'])?->soundSettings();
            $data['params'] = [...match ($kind) {
                'voice' => ['voice' => $sound['voice'], 'speed' => $sound['speed']],
                'music' => ['mood' => $sound['mood']],
                default => ['accent' => $sound['accent']],
            }, ...$data['params'] ?? []];
        }
        if ($kind === 'reel') {
            abort_unless(collect($data['input_asset_ids'] ?? [])->isNotEmpty() || isset($data['params']['music_asset_id']), 422, 'Pick the voice or the music the reel plays.');
            $data['model'] = 'studio/reel';
        }
        if ($kind === 'voice' && mb_strlen($data['prompt']) > 2500) {
            abort(422, 'Keep a voiceover under 2,500 characters (about two and a half minutes).');
        }

        unset($data['account_id']);
        $data['model'] ??= $kind === 'text'
            ? $models->defaultText()
            : (collect($models->all($kind))->firstWhere('available', true)['id'] ?? collect($models->all($kind))->first()['id'] ?? null);
        if (! $data['model']) {
            abort(422, 'No model can make that yet. Set one up under Models.');
        }

        return $data;
    }
}

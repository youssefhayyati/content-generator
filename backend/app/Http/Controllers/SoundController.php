<?php

namespace App\Http\Controllers;

use App\Enums\PostFormat;
use App\Enums\PostStatus;
use App\Jobs\TranscribeAsset;
use App\Models\Account;
use App\Models\ActionLog;
use App\Models\Asset;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use App\Services\Campaigns\Voice;
use App\Services\Sound\AudioTools;
use App\Services\Sound\Listener;
use App\Services\Sound\ReelRenderer;
use App\Services\Sound\SoundClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Sound: the voices and moods on offer, voice samples, dictation, scripts written for a voice,
 * transcripts of anything in the library, and an account's sound.
 */
class SoundController extends Controller
{
    public function __construct(private readonly SoundClient $sound) {}

    /** Everything the Sound tab needs to draw itself. */
    public function index(Request $request, Listener $listener): JsonResponse
    {
        $up = $this->sound->up();

        return response()->json([
            'available' => $up,
            'reason' => $up ? null : ($this->sound->configured() ? 'FlowAI Sound isn’t answering. Start it with docker compose up -d sound.' : 'FlowAI Sound isn’t set up: set SOUND_URL.'),
            'voices' => $up ? collect($this->sound->voices())->map(fn (array $v) => [...$v, 'sample_url' => "/api/sound/voices/{$v['id']}/sample"])->all() : [],
            'moods' => $up ? $this->sound->moods() : [],
            'styles' => [
                ['id' => 'bold', 'label' => 'Bold', 'detail' => 'Full-bleed picture, big words that light up as they’re said.'],
                ['id' => 'editorial', 'label' => 'Editorial', 'detail' => 'A magazine page: the photo on top, serif text you read along with.'],
                ['id' => 'pulse', 'label' => 'Pulse', 'detail' => 'An audiogram: a cover, a big waveform, one clean caption line.'],
            ],
            'listen' => $listener->available(),
            'max_reel_seconds' => ReelRenderer::MAX_SECONDS,
        ]);
    }

    /** A voice reading its sample line, made once and kept. */
    public function sample(string $voice, AudioTools $tools): BinaryFileResponse
    {
        $known = collect($this->sound->voices())->firstWhere('id', $voice);
        abort_unless($known, 404);
        $path = "sound-samples/{$voice}.mp3";
        $disk = Storage::disk('local');
        if (! $disk->exists($path)) {
            try {
                $said = $this->sound->speak($known['sample'], $voice, 1.0, timings: false);
            } catch (GenerationFailed $e) {
                abort(503, $e->getMessage());
            }
            $disk->put($path, $tools->toMp3($said['wav'], 128));
        }

        return response()->file($disk->path($path), ['Content-Type' => 'audio/mpeg', 'Cache-Control' => 'private, max-age=604800']);
    }

    /** Speak instead of typing: a short recording comes back as text. */
    public function dictate(Request $request, Listener $listener): JsonResponse
    {
        $request->validate(['audio' => ['required', 'file', 'max:20480'], 'language' => ['nullable', 'string', 'max:5']], [
            'audio.max' => 'Keep dictation under two minutes.',
        ]);
        $file = $request->file('audio');
        try {
            $heard = $listener->file($file->getRealPath(), $request->input('language'), maxSeconds: 150);
        } catch (GenerationFailed $e) {
            abort(503, $e->getMessage());
        } catch (\RuntimeException) {
            abort(422, 'That recording couldn’t be read. Try again.');
        }

        return response()->json(['text' => $heard['text'], 'language' => $heard['language'], 'duration' => $heard['duration']]);
    }

    /** A voiceover script written for an account's voice, about as long as asked. */
    public function script(Request $request, ModelRegistry $models, UsageMeter $usage, Voice $voice): JsonResponse
    {
        $data = $request->validate([
            'brief' => ['required', 'string', 'min:4', 'max:1500'],
            'seconds' => ['nullable', 'integer', 'min:5', 'max:120'],
            'account_id' => ['nullable', Rule::exists('accounts', 'id')->where('user_id', $request->user()->id)],
            'language' => ['nullable', 'string', 'max:30'],
        ]);
        $seconds = (int) ($data['seconds'] ?? 30);
        $account = isset($data['account_id']) ? Account::find($data['account_id']) : null;
        $words = (int) round($seconds * 2.9); // these voices speak about 175 words a minute
        try {
            $agents = (string) config('ai.agents.model');
            [$generator, $model] = $models->text(($models->find($agents)['available'] ?? false) ? $agents : $models->defaultText());
            $answer = $usage->within($request->user(), null, 'sound:script', fn () => $generator->json(
                $model,
                'You write voiceover scripts for short social videos. Written to be heard, not read: short sentences, natural rhythm, one idea, a hook in the first line, a soft call to action at the end. No stage directions, no emoji, no hashtags, no quotation marks around the script.'
                    .($account ? "\n\nWrite in this account's voice:\n".$voice->context($account) : ''),
                "Brief: {$data['brief']}\n\nAbout {$words} words (around {$seconds} seconds spoken)."
                    .(filled($data['language'] ?? null) ? " Write it in {$data['language']}." : ''),
                ['type' => 'object', 'properties' => ['script' => ['type' => 'string'], 'title' => ['type' => 'string', 'description' => 'A 2-5 word title for the reel']], 'required' => ['script', 'title'], 'additionalProperties' => false],
            ));
        } catch (GenerationFailed $e) {
            abort(502, $e->getMessage());
        }

        return response()->json(['script' => trim((string) ($answer['script'] ?? '')), 'title' => Str::limit(trim((string) ($answer['title'] ?? '')), 60, '')]);
    }

    /** Listen to an audio or video in the library; the transcript lands on the asset. */
    public function transcribe(Request $request, Asset $asset, Listener $listener): JsonResponse
    {
        Gate::authorize('view', $asset);
        abort_unless(in_array($asset->kind, ['audio', 'video'], true), 422, 'Only audio and video have words to hear.');
        abort_unless($listener->available(), 503, 'Nothing can listen yet: start FlowAI Sound.');
        abort_if(($asset->meta['transcript_status'] ?? null) === 'running', 409, 'Already listening to this one.');
        $asset->update(['meta' => [...$asset->meta ?? [], 'transcript_status' => 'running', 'transcript_error' => null]]);
        TranscribeAsset::dispatch($asset->id, $request->input('language'));

        return response()->json($asset->fresh()->summary(), 202);
    }

    /** The words of a voiceover or a transcript, with their timing: what the karaoke player follows. */
    public function words(Asset $asset): JsonResponse
    {
        Gate::authorize('view', $asset);
        $m = $asset->meta ?? [];

        return response()->json([
            'words' => $m['words'] ?? $m['transcript']['words'] ?? [],
            'text' => $m['script'] ?? $m['transcript']['text'] ?? null,
            'segments' => $m['transcript']['segments'] ?? [],
            'language' => $m['lang'] ?? $m['transcript']['language'] ?? null,
            'status' => $m['transcript_status'] ?? (isset($m['transcript']) || isset($m['words']) ? 'done' : null),
            'error' => $m['transcript_error'] ?? null,
        ]);
    }

    /**
     * A podcast, a voice memo, a talk: its transcript becomes a handful of post drafts for an
     * account, each built on one moment worth sharing. Drafts only: a person schedules them.
     */
    public function posts(Request $request, Asset $asset, ModelRegistry $models, UsageMeter $usage, Voice $voice): JsonResponse
    {
        Gate::authorize('view', $asset);
        $data = $request->validate([
            'account_id' => ['required', Rule::exists('accounts', 'id')->where('user_id', $request->user()->id)],
            'count' => ['nullable', 'integer', 'min:1', 'max:8'],
        ]);
        $text = $asset->meta['transcript']['text'] ?? $asset->meta['script'] ?? null;
        abort_unless(filled($text), 422, 'Listen to it first: there’s no transcript yet.');
        $account = Account::find($data['account_id']);
        $count = (int) ($data['count'] ?? 4);
        $limit = $account->platform->characterLimit();

        try {
            $agents = (string) config('ai.agents.model');
            [$generator, $model] = $models->text(($models->find($agents)['available'] ?? false) ? $agents : $models->defaultText());
            $answer = $usage->within($request->user(), $asset, 'sound:posts', fn () => $generator->json(
                $model,
                "You turn long recordings into social posts. Find the moments worth sharing — a sharp idea, a story, a surprising fact, a quotable line — and write one post per moment, in the account's voice. Never invent facts the transcript doesn't say. Keep each post under {$limit} characters.\n\nThe account:\n".$voice->context($account),
                "Transcript:\n".Str::limit((string) $text, 14000)."\n\nWrite {$count} posts, each on a different moment. For each: a short title, the post, and the quote from the transcript it's built on.",
                ['type' => 'object', 'properties' => ['posts' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                    'title' => ['type' => 'string'], 'body' => ['type' => 'string'], 'quote' => ['type' => 'string'],
                ], 'required' => ['title', 'body', 'quote'], 'additionalProperties' => false]]], 'required' => ['posts'], 'additionalProperties' => false],
                'medium',
            ));
        } catch (GenerationFailed $e) {
            abort(502, $e->getMessage());
        }

        $made = collect($answer['posts'] ?? [])->take($count)->filter(fn ($p) => filled($p['body'] ?? null))->map(function (array $p) use ($request, $account, $limit, $asset) {
            $post = $request->user()->posts()->create([
                'title' => Str::limit(trim((string) $p['title']), 110, ''),
                'body' => Str::limit(trim((string) $p['body']), $limit - 1, '…'),
                'format' => PostFormat::Text,
                'platforms' => [$account->platform->value],
                'account_id' => $account->id,
                'status' => PostStatus::Draft,
            ]);
            ActionLog::record($request->user(), 'agent:sound', 'post.draft', $post, 'Drafted from “'.Str::limit((string) $asset->name, 40).'”.', null, ['quote' => Str::limit((string) ($p['quote'] ?? ''), 300)]);

            return ['id' => $post->id, 'title' => $post->title, 'body' => $post->body, 'quote' => Str::limit((string) ($p['quote'] ?? ''), 300)];
        })->values();

        return response()->json(['posts' => $made], 201);
    }

    /** An account's sound: its voice, its music mood, its reel accent. */
    public function account(Request $request, Account $account): JsonResponse
    {
        Gate::authorize('update', $account);
        $voices = collect($this->sound->up() ? $this->sound->voices() : [])->pluck('id')->all();
        $data = $request->validate([
            'voice' => ['sometimes', 'string', $voices ? Rule::in($voices) : 'max:40'],
            'speed' => ['sometimes', 'numeric', 'min:0.7', 'max:1.4'],
            'mood' => ['sometimes', 'string', 'max:40'],
            'accent' => ['sometimes', 'regex:/^#[0-9a-fA-F]{6}$/'],
        ]);
        $account->update(['sound' => [...$account->soundSettings(), ...$data]]);
        ActionLog::record($request->user(), 'you', 'account.sound', $account, "Set the sound of {$account->label()}.");

        return response()->json($account->soundSettings());
    }
}

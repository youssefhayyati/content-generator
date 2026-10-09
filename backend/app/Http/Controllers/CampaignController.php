<?php

namespace App\Http\Controllers;

use App\Http\Resources\CampaignResource;
use App\Http\Resources\CampaignSummaryResource;
use App\Models\Campaign;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Intake\Brief;
use App\Services\Intake\IntakePrompt;
use App\Services\Intake\Interviewer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Http\StreamedEvent;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class CampaignController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return CampaignSummaryResource::collection(
            $request->user()->campaigns()->with('photos')->latest('updated_at')->get()
        );
    }

    /**
     * Start a campaign: with the interview, quick (about 8 questions, Claude suggests the rest) or
     * full (about 20), or with the short brief form (goal, audience, message, key facts, deadline).
     */
    public function store(Request $request, Interviewer $interviewer): JsonResponse
    {
        $form = $request->input('source') === 'form';
        $data = $request->validate([
            'source' => ['nullable', Rule::in(['intake', 'form'])],
            'depth' => [$form ? 'nullable' : 'required', Rule::in(['quick', 'full'])],
            'name' => ['nullable', 'string', 'max:80'],
            ...$this->briefRules($form),
        ], $this->briefMessages());

        if (! $form) {
            $campaign = $interviewer->start($request->user(), $data['depth']);
            if (filled($data['name'] ?? null)) {
                $campaign->update(['name' => $data['name']]);
            }

            return CampaignResource::make($campaign)->response()->setStatusCode(201);
        }

        $campaign = $request->user()->campaigns()->create([
            'name' => $data['name'] ?? null,
            'source' => 'form',
            'depth' => 'quick',
            'mode' => 'script',
            'fields' => Brief::blank(),
            'brief' => array_map(fn ($v) => is_string($v) ? trim($v) : $v, $data['brief']),
            'messages' => [],
            'asked' => 0,
            'completed_at' => now(),
            'period_end' => $data['brief']['deadline'] ?? null,
        ]);

        return CampaignResource::make($campaign)->response()->setStatusCode(201);
    }

    /**
     * Name it, pick its accounts and period, adjust the form brief (until the plan is approved).
     */
    public function update(Request $request, Campaign $campaign): CampaignResource
    {
        Gate::authorize('update', $campaign);
        $user = $request->user();

        $data = $request->validate([
            'name' => ['sometimes', 'nullable', 'string', 'max:80'],
            'account_ids' => ['sometimes', 'array', 'max:20'],
            'account_ids.*' => ['integer', Rule::exists('accounts', 'id')->where('user_id', $user->id)],
            'period_start' => ['sometimes', 'nullable', 'date'],
            'period_end' => ['sometimes', 'nullable', 'date', 'after_or_equal:period_start'],
            ...($campaign->source === 'form' && ! $campaign->plan_approved_at ? $this->briefRules(true, partial: true) : []),
        ], $this->briefMessages());

        if (isset($data['brief'])) {
            $data['brief'] = [...($campaign->brief ?? []), ...array_map(fn ($v) => is_string($v) ? trim($v) : $v, $data['brief'])];
        }
        $campaign->update($data);

        return CampaignResource::make($campaign->fresh());
    }

    /**
     * @return array<string, mixed>
     */
    private function briefRules(bool $required, bool $partial = false): array
    {
        $need = $required && ! $partial ? 'required' : 'sometimes';

        return [
            'brief' => [$need, 'array'],
            'brief.goal' => [$need, 'string', 'max:300'],
            'brief.audience' => [$need, 'string', 'max:500'],
            'brief.message' => [$need, 'string', 'max:800'],
            'brief.key_facts' => ['nullable', 'string', 'max:2000'],
            'brief.deadline' => ['nullable', 'date'],
            'brief.rhythm' => ['nullable', 'string', 'max:120'],
        ];
    }

    /**
     * @return array<string, string>
     */
    private function briefMessages(): array
    {
        return [
            'brief.goal.required' => 'Say what the campaign is for.',
            'brief.audience.required' => 'Say who it’s for.',
            'brief.message.required' => 'Say what it has to get across.',
            'period_end.after_or_equal' => 'The campaign has to end after it starts.',
        ];
    }

    public function show(Campaign $campaign): CampaignResource
    {
        Gate::authorize('view', $campaign);

        return CampaignResource::make($campaign);
    }

    public function destroy(Campaign $campaign): Response
    {
        Gate::authorize('delete', $campaign);

        $campaign->delete();

        return response()->noContent();
    }

    /**
     * The interview moves on: answer the open question (`text`), finish now and let Claude suggest
     * the rest (`finish`), or, with neither, try again after a turn that failed.
     */
    public function turn(Request $request, Campaign $campaign, Interviewer $interviewer): CampaignResource|JsonResponse
    {
        Gate::authorize('update', $campaign);

        $data = $request->validate([
            'text' => ['nullable', 'string', 'max:2000'],
            'finish' => ['boolean'],
        ]);
        $text = trim($data['text'] ?? '');

        if ($campaign->isComplete()) {
            throw ValidationException::withMessages(['text' => 'This interview is finished.']);
        }
        if ($text === '' && ! $request->boolean('finish') && ! $campaign->awaitingReply()) {
            throw ValidationException::withMessages(['text' => 'Answer the question first.']);
        }

        return $this->attempt($campaign, fn () => $text !== ''
            ? $interviewer->answer($campaign, $text)
            : $interviewer->proceed($campaign, finishNow: $request->boolean('finish')));
    }

    /**
     * "Answer more questions" after a quick interview: Claude's guesses are cleared and asked about.
     */
    public function deeper(Campaign $campaign, Interviewer $interviewer): CampaignResource|JsonResponse
    {
        Gate::authorize('update', $campaign);

        if (! $campaign->isComplete()) {
            throw ValidationException::withMessages(['campaign' => 'The interview is still going.']);
        }

        return $this->attempt($campaign, fn () => $interviewer->deepen($campaign));
    }

    /**
     * Write the content kit from the brief, streamed as server-sent events like the composer's
     * writing: `delta` events, then `done` (once it's saved), or an `error` with a message to show.
     */
    public function kit(Campaign $campaign, ModelRegistry $models): StreamedResponse|JsonResponse
    {
        Gate::authorize('update', $campaign);

        $id = $models->availableText((string) config('ai.intake.model'));
        if (! $id) {
            return response()->json(['message' => 'AI writing isn’t switched on yet.'], 503);
        }
        if (! $campaign->isComplete()) {
            throw ValidationException::withMessages(['campaign' => 'Finish the interview first.']);
        }

        [$generator, $model] = $models->text($id);
        $prompt = IntakePrompt::kit($campaign);

        return response()->eventStream(function () use ($generator, $campaign, $model, $prompt) {
            $kit = '';
            try {
                foreach ($generator->stream($model, IntakePrompt::kitSystem(), $prompt, config('ai.intake.kit_effort')) as $text) {
                    $kit .= $text;
                    yield new StreamedEvent('delta', ['text' => $text]);
                }

                $campaign->update(['kit' => trim($kit)]);
                yield new StreamedEvent('done', ['model' => $model]);
            } catch (GenerationFailed $e) {
                yield new StreamedEvent('error', ['message' => $e->getMessage()]);
            }
        }, endStreamWith: null);
    }

    /**
     * Run a step that may ask Claude. If Claude fails, what the person said is already saved;
     * the message says what went wrong, and the page offers to try again.
     */
    private function attempt(Campaign $campaign, callable $step): CampaignResource|JsonResponse
    {
        try {
            $step();
        } catch (GenerationFailed $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }

        return CampaignResource::make($campaign->fresh());
    }
}

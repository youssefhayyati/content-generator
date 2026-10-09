<?php

namespace App\Services\Intake;

use App\Models\Campaign;
use App\Models\CampaignPhoto;
use App\Models\User;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\TextGenerator;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Runs a campaign intake. A model asks the questions when one can be reached; otherwise the
 * standard question list does, one brief field at a time.
 *
 * Anything the person says is saved before the model is asked for the next question, so if that
 * fails (GenerationFailed propagates), nothing is lost and `proceed()` picks it up again.
 */
final class Interviewer
{
    public const GREETING = 'Hi! I’m your campaign strategist. I’ll ask short questions so we can create content that really feels like you. How much time do you have?';

    /** The interviewer reads this many photos per request. */
    private const PHOTOS_PER_REQUEST = 4;

    public function __construct(private readonly ModelRegistry $models) {}

    /**
     * Some text model can run, and the account is confirmed (every AI request needs both).
     */
    public function aiAvailable(User $user): bool
    {
        return $this->model() !== null && $user->hasVerifiedEmail();
    }

    /**
     * Which model will take the next turn: the configured one, or any other that can run.
     */
    private function model(): ?string
    {
        return $this->models->availableText((string) config('ai.intake.model'));
    }

    /**
     * @return array{0: TextGenerator, 1: string}
     *
     * @throws GenerationFailed when no model can run.
     */
    private function generator(): array
    {
        return $this->models->text($this->model() ?? (string) config('ai.intake.model'));
    }

    /**
     * A new interview, already past the greeting: the depth is chosen, and the first question is asked.
     */
    public function start(User $user, string $depth): Campaign
    {
        $first = Brief::FIELDS['focus'];
        $campaign = $user->campaigns()->make([
            'depth' => $depth,
            'mode' => $this->aiAvailable($user) ? 'ai' : 'script',
            'fields' => Brief::blank(),
            'messages' => [],
            'prompt' => ['options' => $first['options'], 'photos' => false],
            'pending' => 'focus',
            'asked' => 1,
        ]);
        $campaign->say('agency', self::GREETING);
        $campaign->say('client', $depth === 'quick' ? 'Quick' : 'Full');
        $campaign->say('agency', ($depth === 'quick' ? 'Quick it is. ' : 'Great, let’s do it properly. ').$first['question']);
        $campaign->save();

        return $campaign;
    }

    public function answer(Campaign $campaign, string $text): void
    {
        $campaign->say('client', $text);
        if ($campaign->mode === 'script' && $campaign->pending) {
            $campaign->fields = [...$campaign->fields, $campaign->pending => Str::limit($text, 500)];
        }
        $campaign->prompt = null;
        $campaign->save();

        $this->proceed($campaign);
    }

    /**
     * Ask the next question, or wrap up when there's nothing left to ask (or `$finishNow`).
     */
    public function proceed(Campaign $campaign, bool $finishNow = false): void
    {
        if ($campaign->isComplete()) {
            return;
        }

        if ($campaign->mode === 'ai' && ! $this->aiAvailable($campaign->user)) {
            $this->switchToScript($campaign);
        }

        match (true) {
            $campaign->mode === 'ai' => $this->askModel($campaign, $finishNow),
            $finishNow => $this->finish($campaign),
            default => $this->askScripted($campaign),
        };

        $campaign->save();
    }

    /**
     * "Answer more questions": drop the model's guesses and carry on as a full interview.
     */
    public function deepen(Campaign $campaign): void
    {
        $campaign->fields = array_map(fn (string $v) => Brief::isSuggested($v) ? '' : $v, $campaign->fields);
        $campaign->depth = 'full';
        $campaign->completed_at = null;
        $campaign->asked = min($campaign->asked, 6);
        $campaign->say('client', 'Answer more questions');
        $campaign->save();

        $this->proceed($campaign);
    }

    /**
     * Keep the photos, have the model describe them for the image prompts, then carry on.
     *
     * @param  list<UploadedFile>  $files
     */
    public function addPhotos(Campaign $campaign, array $files): void
    {
        $photos = collect($files)->map(fn (UploadedFile $file) => $campaign->photos()->create([
            'path' => $file->store($campaign->directory(), 'local'),
            'mime' => $file->getMimeType(),
        ]));
        $n = $photos->count();
        $campaign->say('client', 'Shared '.$n.' '.Str::plural('photo', $n), $photos->pluck('id')->all());
        $campaign->save();

        $this->describe($campaign, $photos);
        $campaign->unsetRelation('photos');

        if ($campaign->isComplete()) {
            $campaign->say('note', 'Photos added to the brief.');
            $campaign->save();
        } elseif ($campaign->mode === 'ai' || $campaign->pending === 'photos') {
            $campaign->prompt = null;
            $this->proceed($campaign);
        } else {
            // The standard list is in the middle of another question: leave it open.
            $campaign->save();
        }
    }

    /* ------------------------------------------------------------------ */

    private function askModel(Campaign $campaign, bool $finishNow): void
    {
        [$ai, $model] = $this->generator();
        $reply = $ai->json(
            $model,
            IntakePrompt::interviewSystem(),
            IntakePrompt::interview($campaign, $finishNow),
            IntakePrompt::interviewSchema(),
            config('ai.intake.interview_effort'),
        );

        // The model sends the whole brief back; take what it adds or corrects, never let it blank a field.
        $fields = $campaign->fields;
        foreach (Brief::keys() as $key) {
            $value = is_string($reply['fields'][$key] ?? null) ? trim($reply['fields'][$key]) : '';
            if ($value !== '' && ! ($key === 'photos' && $campaign->photos->isNotEmpty())) {
                $fields[$key] = Str::limit($value, 500);
            }
        }
        $campaign->fields = $fields;

        $question = is_string($reply['question'] ?? null) ? trim($reply['question']) : '';
        $covered = collect(Brief::needed($campaign->depth))->every(fn (string $key) => $campaign->value($key) !== '');

        if ($finishNow || $question === '' || (($reply['done'] ?? false) && $covered)
            || $campaign->asked >= Brief::MAX_QUESTIONS[$campaign->depth]) {
            $this->finish($campaign);

            return;
        }

        $topic = $reply['topic'] ?? '';
        $campaign->asked++;
        $campaign->pending = in_array($topic, Brief::keys(), true) ? $topic : null;
        $campaign->say('agency', $question);
        $campaign->prompt = [
            'options' => collect($reply['options'] ?? [])->filter(fn ($o) => is_string($o) && trim($o) !== '')
                ->map(fn (string $o) => Str::limit(trim($o), 60))->take(4)->values()->all(),
            'photos' => (bool) ($reply['photo_request'] ?? false),
        ];
    }

    private function askScripted(Campaign $campaign): void
    {
        $next = collect(Brief::keys())->first(fn (string $key) => $campaign->value($key) === ''
            && ($campaign->depth === 'full' || in_array($key, Brief::QUICK, true)));

        if (! $next) {
            $this->finish($campaign);

            return;
        }

        $field = Brief::FIELDS[$next];
        $campaign->asked++;
        $campaign->pending = $next;
        $campaign->say('agency', $field['question']);
        $campaign->prompt = ['options' => $field['options'], 'photos' => $field['photo'] ?? false];
    }

    private function finish(Campaign $campaign): void
    {
        $campaign->completed_at = now();
        $campaign->pending = null;
        $campaign->prompt = null;

        if ($campaign->mode === 'ai') {
            $campaign->say('agency', 'That’s everything I need. Your brief is filled in'.($campaign->hasSuggestions()
                ? '. I suggested some answers for you (dashed underline). Check them, or answer more questions to make the content more personal.'
                : '. You can still add photos.').' Want me to write your content kit, then start making the content?');
        } else {
            $campaign->say('agency', 'Your brief is complete. Copy it or download the package to share it.');
        }
    }

    /**
     * No model is reachable any more mid-interview (the key was removed, say): carry on with the
     * standard list, and file the answer that's waiting under the field the question was about.
     */
    private function switchToScript(Campaign $campaign): void
    {
        $campaign->mode = 'script';
        $campaign->say('note', 'AI isn’t available right now, so I’ll continue with a standard question list.');

        $said = array_values(array_filter($campaign->messages, fn (array $m) => $m['who'] !== 'note'));
        $last = end($said);
        if ($last && $last['who'] === 'client' && empty($last['photos'])) {
            $key = $campaign->pending && $campaign->value($campaign->pending) === ''
                ? $campaign->pending
                : collect(Brief::keys())->first(fn (string $k) => $campaign->value($k) === '');
            if ($key) {
                $campaign->fields = [...$campaign->fields, $key => Str::limit($last['text'], 500)];
            }
        }
    }

    /**
     * @param  Collection<int, CampaignPhoto>  $photos
     */
    private function describe(Campaign $campaign, Collection $photos): void
    {
        if (! $this->aiAvailable($campaign->user)) {
            return;
        }

        try {
            [$ai, $model] = $this->generator();
            foreach ($photos->chunk(self::PHOTOS_PER_REQUEST) as $batch) {
                $reply = $ai->json(
                    $model,
                    IntakePrompt::photosSystem(),
                    IntakePrompt::photos($campaign, $batch),
                    IntakePrompt::photosSchema(),
                    config('ai.intake.interview_effort'),
                );

                foreach ($batch->values() as $i => $photo) {
                    $about = $reply['photos'][$i] ?? [];
                    $photo->update([
                        'kind' => in_array($about['kind'] ?? null, CampaignPhoto::KINDS, true) ? $about['kind'] : null,
                        'title' => is_string($about['title'] ?? null) ? Str::limit($about['title'], 60) : null,
                        'description' => is_string($about['description'] ?? null) ? Str::limit($about['description'], 800) : null,
                    ]);
                }
            }
        } catch (GenerationFailed) {
            $campaign->say('note', 'Photos saved. I couldn’t describe them automatically.');
            $campaign->save();
        }
    }
}

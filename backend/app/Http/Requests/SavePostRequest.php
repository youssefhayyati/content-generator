<?php

namespace App\Http\Requests;

use App\Enums\Platform;
use App\Enums\PostFormat;
use App\Enums\PostStatus;
use App\Http\Controllers\AssistantController;
use App\Models\Account;
use App\Models\Post;
use App\Services\Publishing\PlatformSpecs;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;
use Laravel\Sanctum\PersonalAccessToken;

class SavePostRequest extends FormRequest
{
    private const ASSISTANT_DRAFTS = 'The assistant saves drafts; scheduling needs your approval on the Assistant page.';

    /**
     * Get the validation rules that apply to the request.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        // Picking a time by hand means it has to be in the future; the queue picks its own.
        $scheduling = $this->input('status') === PostStatus::Scheduled->value && ! $this->boolean('queue') && ! $this->boolean('now');
        // Any status but draft counts as the person's approval (PostController::fill), so the voice
        // assistant saves drafts only; the person schedules them on the Assistant page.
        $assistant = $this->byAssistant();

        return [
            'title' => ['nullable', 'string', 'max:120'],
            'body' => ['required', 'string', 'max:5000'],
            'format' => ['required', Rule::enum(PostFormat::class)],
            'platforms' => ['required', 'array', 'min:1'],
            'platforms.*' => ['distinct', Rule::enum(Platform::class)],
            // Publishing, submitted and failed come from publishing runs, not from the composer.
            'status' => ['required', Rule::in($assistant ? [PostStatus::Draft->value] : array_map(fn (PostStatus $s) => $s->value, PostStatus::chosenByHand()))],
            'account_id' => ['nullable', Rule::exists('accounts', 'id')->where('user_id', $this->user()->id)],
            'placement' => ['nullable', 'string', 'max:20'],
            'asset_ids' => ['nullable', 'array', 'max:35'],
            'asset_ids.*' => ['integer', 'distinct', Rule::exists('assets', 'id')->where('user_id', $this->user()->id)],
            'queue' => $assistant ? ['prohibited'] : ['sometimes', 'boolean'],
            // Post now: the account's phone publishes it straight away (PostController::publishNow).
            'now' => $assistant ? ['prohibited'] : ['sometimes', 'boolean'],
            'scheduled_at' => $assistant ? ['prohibited'] : ($scheduling ? ['required', 'date', 'after:now'] : ['nullable', 'date']),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'platforms.required' => 'Pick at least one platform.',
            'platforms.min' => 'Pick at least one platform.',
            'scheduled_at.required' => 'Pick a date and time to publish.',
            'scheduled_at.after' => 'That time has already passed. Pick one in the future.',
            ...($this->byAssistant() ? array_fill_keys(['status.in', 'queue.prohibited', 'now.prohibited', 'scheduled_at.prohibited'], self::ASSISTANT_DRAFTS) : []),
        ];
    }

    /**
     * A post has to fit the strictest network it's going to.
     *
     * @return array<int, callable>
     */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                $length = mb_strlen((string) $this->input('body'));

                $account = $this->account();
                $platforms = $account ? [$account->platform->value] : (array) $this->input('platforms');

                foreach ($platforms as $value) {
                    $platform = Platform::tryFrom((string) $value);

                    if ($platform && $length > $platform->characterLimit()) {
                        $validator->errors()->add(
                            'body',
                            "{$platform->label()} allows {$platform->characterLimit()} characters. This post has {$length}."
                        );
                    }
                }

                if ($this->boolean('now')) {
                    $post = $this->route('post');
                    if (! $account) {
                        $validator->errors()->add('now', 'Pick the account to post from: its phone posts it.');
                    } elseif (! $account->device_id && ! ($post instanceof Post && $post->device_id)) {
                        $validator->errors()->add('now', "@{$account->handle} has no phone to post from. Connect one on the Phones page.");
                    }
                }

                // Posts that a phone will publish on their own must pass the platform's spec first.
                $scheduling = $this->input('status') === PostStatus::Scheduled->value || $this->boolean('queue') || $this->boolean('now');
                if (($account?->automation || $this->boolean('now')) && $scheduling &&! $validator->errors()->hasAny(['asset_ids', 'asset_ids.*'])) {
                    $ids = (array) $this->input('asset_ids', []);
                    $assets = $this->user()->assets()->whereIn('id', $ids)->get()->sortBy(fn ($a) => array_search($a->id, $ids))->values();
                    $result = app(PlatformSpecs::class)->check($account->platform, $this->input('placement'), (string) $this->input('body'), $assets);

                    foreach (collect($result['checks'])->where('status', 'fail') as $check) {
                        $validator->errors()->add('checks', $check['detail']);
                    }
                }
            },
        ];
    }

    /** Sent by the voice assistant, with the token the Assistant page gave it (AssistantController). */
    public function byAssistant(): bool
    {
        $token = $this->user()->currentAccessToken();

        return $token instanceof PersonalAccessToken && $token->can(AssistantController::ABILITY);
    }

    public function account(): ?Account
    {
        return $this->filled('account_id') ? $this->user()->accounts()->find($this->input('account_id')) : null;
    }
}

<?php

namespace App\Services\Community;

use App\Models\Account;
use App\Models\Comment;
use App\Models\Repost;
use App\Models\User;
use App\Services\Ai\Models\ModelRegistry;

/**
 * The community agents: adapt an X post into an Instagram caption (area 02), and triage
 * comments — reply, ignore, or send to a human (area 11). Both write in the account's voice.
 */
class Community
{
    public function __construct(private readonly ModelRegistry $models) {}

    /** Any model that can write will do: Claude, Ollama Cloud, Groq, a local Ollama. */
    public function aiAvailable(User $user): bool
    {
        return $user->hasVerifiedEmail() && collect($this->models->all('text'))->contains('available', true);
    }

    /** The default writer, wherever it lives. */
    private function ai(): array
    {
        return $this->models->text($this->models->defaultText());
    }

    /**
     * X → Instagram: the same post, native to the account. The credit line is added by the
     * model class (Repost::creditedCaption), never by the AI, so attribution can't be lost.
     *
     * @return array{caption: string, hashtags: list<string>}
     */
    public function adapt(Repost $repost): array
    {
        $account = $repost->account;
        [$ai, $model] = $this->ai();
        $reply = $ai->json(
            $model,
            $this->voiceSystem($account, 'You adapt posts from X for Instagram. Same idea, native to the account and the format: a caption people read, not a tweet pasted elsewhere.'),
            "Turn this X post by @{$repost->author} into an Instagram caption for @{$account->handle}.\n\n"
                ."X post:\n{$repost->source_text}\n\n"
                .'Write the caption (max 150 words, no credit line — it is added separately) and 5-12 hashtags.',
            [
                'type' => 'object',
                'properties' => [
                    'caption' => ['type' => 'string'],
                    'hashtags' => ['type' => 'array', 'items' => ['type' => 'string']],
                ],
                'required' => ['caption', 'hashtags'],
                'additionalProperties' => false,
            ],
        );

        return [
            'caption' => trim((string) ($reply['caption'] ?? '')),
            'hashtags' => collect($reply['hashtags'] ?? [])->filter(fn ($t) => is_string($t) && trim($t) !== '')
                ->map(fn (string $t) => ltrim(trim($t), '#'))->take(15)->values()->all(),
        ];
    }

    /**
     * Reply, ignore, or send to a human — with a drafted reply in the account's voice when it's
     * a reply. "human" is the honest answer for anything sensitive, angry, or ambiguous.
     *
     * @return array{decision: 'reply'|'ignore'|'human', reason: string, draft: string|null, sentiment: int|null}
     */
    public function triage(Comment $comment): array
    {
        $account = $comment->account;
        [$ai, $model] = $this->ai();
        $reply = $ai->json(
            $model,
            $this->voiceSystem($account, 'You triage comments for a social account. Reply to what is friendly, curious or useful; ignore spam and bots; send anything sensitive, angry, legal or ambiguous to a human. Never argue.'),
            "Comment by @{$comment->author}".($comment->post_ref ? " on “{$comment->post_ref}”" : '').":\n{$comment->body}\n\n"
                ."Decide: reply (with a short, warm draft in the account's voice, max 40 words), ignore, or human. Give a one-line reason.",
            [
                'type' => 'object',
                'properties' => [
                    'decision' => ['type' => 'string', 'enum' => ['reply', 'ignore', 'human']],
                    'reason' => ['type' => 'string'],
                    'draft' => ['type' => 'string', 'description' => 'The reply to send, when decision is reply; "" otherwise.'],
                    'sentiment' => ['type' => 'string', 'enum' => ['negative', 'neutral', 'positive'], 'description' => 'How the commenter feels about the account.'],
                ],
                'required' => ['decision', 'reason', 'draft', 'sentiment'],
                'additionalProperties' => false,
            ],
        );

        $decision = in_array($reply['decision'] ?? null, ['reply', 'ignore', 'human'], true) ? $reply['decision'] : 'human';

        return [
            'decision' => $decision,
            'reason' => trim((string) ($reply['reason'] ?? '')),
            'draft' => $decision === 'reply' ? trim((string) ($reply['draft'] ?? '')) ?: null : null,
            // The AI's read of the mood, for Storm Guard; null when it didn't give one.
            'sentiment' => ['negative' => -70, 'neutral' => 0, 'positive' => 70][$reply['sentiment'] ?? ''] ?? null,
        ];
    }

    private function voiceSystem(Account $account, string $role): string
    {
        $profile = collect($account->profile ?? [])->filter()->map(fn (string $v, string $k) => "{$k}: {$v}")->implode("\n");

        return $role."\n\nThe account: @{$account->handle} on {$account->platform->label()}."
            .($profile ? "\nIts voice:\n{$profile}" : '')
            ."\nWrite in that voice.";
    }
}

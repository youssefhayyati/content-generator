<?php

namespace App\Services\Community;

use App\Models\Account;
use App\Models\Comment;
use App\Models\Repost;
use App\Models\User;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Campaigns\Voice;

/**
 * The community agents: adapt a post between X and Instagram (area 02), and triage
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

    /** What each placement wants from the words: how long, and how they read there. */
    private const FORMATS = [
        'feed' => 'an Instagram feed post. The caption shows under the picture or video, cut after the first line ("… more"): '
            .'that first line is the hook and must make sense alone. 25 to 90 words, in two to four short paragraphs.',
        'reel' => 'an Instagram reel. The caption sits over the video and only its first line or two are seen: one or two short '
            .'sentences, 8 to 30 words, the hook first.',
        'story' => 'an Instagram story. Stories show no caption: write one short line (max 12 words) for the record, as a sticker would say it.',
        'post' => 'a post on X: one sharp post, the hook first, max 230 characters (a credit line is added after it).',
    ];

    /**
     * X → Instagram or Instagram → X: the same post, native to the account and to where it goes
     * (feed, reel, story or an X post), as three takes to choose from. The credit line is added by
     * the model class (Repost::body), never by the AI, so attribution can't be lost.
     *
     * @return list<array{angle: string, caption: string, hashtags: list<string>}>
     */
    public function adapt(Repost $repost, ?string $placement = null, ?string $instruction = null): array
    {
        $account = $repost->account;
        $from = $repost->sourceLabel();
        $x = $account->platform->value === 'x';
        $placement = $x ? 'post' : (isset(self::FORMATS[$placement ?? '']) && $placement !== 'post' ? $placement : 'feed');
        [$minTags, $maxTags] = match ($placement) {
            'post' => [0, 2],
            'story' => [0, 3],
            default => [3, 6],
        };
        $media = $repost->assets()->countBy('kind')->map(fn (int $n, string $kind) => "{$n} {$kind}".($n > 1 ? 's' : ''))->implode(', ');
        $language = $account->profile['language'] ?? null;

        $system = "You are the social editor of @{$account->handle}. You repost other people's posts for it, from {$from} to "
            ."{$account->platform->label()}, rewritten so they feel native there, never pasted.\n\n"
            ."How you write a repost:\n"
            ."- Keep what the original says: its facts, its joke, its point. Never invent facts, names, numbers, events, quotes or "
            ."feelings that aren't in it. When it's thin, say less rather than make things up.\n"
            ."- The original is @{$repost->author}'s, not this account's. Never tell their experience as the account's own (no \"I woke "
            ."up early\" for something they did): name them, quote them, or react to what they posted.\n"
            ."- Lead with the hook: the most striking thing, in the first words. No filler openers (\"Check this out\", \"Wow\").\n"
            ."- Short sentences, one idea each. Emoji only where they carry tone, at most three. No questions to the audience unless the post invites one.\n"
            .'- Language: '.($language ? "write in {$language}." : 'write in the original\'s language, unless told otherwise.')."\n"
            ."- No credit line, no @{$repost->author} mention at the end and no \"via\": the credit is added after your caption.\n"
            ."- Hashtags: {$minTags} to {$maxTags}, specific to what the post is about (the people, the team, the topic). Never generic "
            ."ones (#viral, #fyp, #explore, #instagood, #trending). Without the #.\n\n"
            ."The account's voice (follow it over everything above, except never inventing):\n".app(Voice::class)->context($account);

        $prompt = "The {$from} post by @{$repost->author}".($media ? " (it comes with {$media}, which are reposted with it)" : '').":\n"
            .'"""'."\n".(trim($repost->source_text) ?: '(no text)')."\n".'"""'."\n\n"
            .'It goes to '.self::FORMATS[$placement]."\n\n"
            ."Write three takes, each a different angle:\n"
            ."1. faithful: the original's words and point, told clearly for this audience.\n"
            ."2. take: the account reacts, with its own short angle on it, still true to the post.\n"
            ."3. punchy: the shortest, boldest version.\n"
            .(filled($instruction) ? "\nThe operator asks: {$instruction}\nDo what they ask in all three takes." : '');

        [$ai, $model] = $this->ai();
        $reply = $ai->json($model, $system, $prompt, [
            'type' => 'object',
            'properties' => [
                'options' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'angle' => ['type' => 'string', 'enum' => ['faithful', 'take', 'punchy']],
                            'caption' => ['type' => 'string'],
                            'hashtags' => ['type' => 'array', 'items' => ['type' => 'string']],
                        ],
                        'required' => ['angle', 'caption', 'hashtags'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
            'required' => ['options'],
            'additionalProperties' => false,
        ]);

        $limit = $account->platform->characterLimit();
        $options = collect($reply['options'] ?? [])->filter(fn ($o) => is_array($o) && trim((string) ($o['caption'] ?? '')) !== '')
            ->map(fn (array $o) => [
                'angle' => in_array($o['angle'] ?? null, ['faithful', 'take', 'punchy'], true) ? $o['angle'] : 'take',
                'caption' => mb_substr(trim((string) $o['caption']), 0, $limit),
                'hashtags' => self::tags($o['hashtags'] ?? [], $maxTags),
            ])->take(3)->values()->all();
        if ($options === []) {
            throw new GenerationFailed('The model gave back no caption. Try again.');
        }

        return $options;
    }

    /**
     * Hashtags as the network takes them: no #, no spaces, no generic ones, no repeats.
     *
     * @return list<string>
     */
    public static function tags(mixed $tags, int $max = 6): array
    {
        $generic = ['viral', 'fyp', 'foryou', 'foryoupage', 'explore', 'explorepage', 'instagood', 'trending', 'reels', 'reelsinstagram', 'instadaily'];

        return collect(is_array($tags) ? $tags : [])
            ->filter(fn ($t) => is_string($t) && trim($t) !== '')
            ->map(fn (string $t) => preg_replace('/[^\p{L}\p{N}_]/u', '', ltrim(trim($t), '#')))
            ->filter(fn (string $t) => $t !== '' && ! in_array(mb_strtolower($t), $generic, true))
            ->unique(fn (string $t) => mb_strtolower($t))->take($max)->values()->all();
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

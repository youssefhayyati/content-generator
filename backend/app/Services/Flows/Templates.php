<?php

namespace App\Services\Flows;

use App\Enums\Platform;
use App\Models\Account;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * Ready-made flows, each one a whole automation that works the moment it's switched on. Built
 * per user, so they point at the user's own accounts and topics.
 */
final class Templates
{
    public const KEYS = ['talking-reel', 'daily-drop', 'second-life', 'signal', 'storm-response', 'rescue', 'kind-words'];

    /**
     * @return list<array{key: string, name: string, tagline: string, detail: string, graph: array}>
     */
    public static function all(User $user): array
    {
        return array_map(fn (string $key) => self::make($key, $user), self::KEYS);
    }

    /**
     * @return array{key: string, name: string, tagline: string, detail: string, graph: array}
     */
    public static function make(string $key, User $user): array
    {
        $accounts = $user->accounts()->get();
        // Text-first platforms can post words alone; the visual ones need a picture.
        $wordy = $accounts->first(fn (Account $a) => in_array($a->platform, [Platform::X, Platform::LinkedIn, Platform::Facebook], true)) ?? $accounts->first();
        $any = $accounts->first();
        // Reels belong where video lives.
        $visual = $accounts->first(fn (Account $a) => in_array($a->platform, [Platform::Instagram, Platform::TikTok, Platform::YouTube], true)) ?? $any;
        $topics = trim((string) ($wordy?->profile['topics'] ?? '')) ?: ($wordy?->name ?? 'small business marketing');
        $feed = 'https://news.google.com/rss/search?'.http_build_query(['q' => Str::limit(preg_replace('/[,;\/]+/', ' OR ', $topics), 80, ''), 'hl' => 'en']);

        [$name, $tagline, $detail, $nodes, $edges] = match ($key) {
            'talking-reel' => [
                'Talking reel',
                'A narrated reel with music and captions, every weekday. You just watch it and say yes.',
                'Every weekday at 11:00 the AI writes a short spoken script in the account’s voice, reads it aloud, composes an original track in the account’s signature mood, and renders a vertical reel with captions that follow every word. You watch it right in the Inbox; approved, it goes into the next free slot.',
                [
                    ['t', 'trigger.schedule', ['every' => 'weekdays', 'at' => '11:00']],
                    ['w', 'ai.write', ['account_id' => $visual?->id, 'brief' => 'A spoken script for a vertical video, about 45 words: a hook in the first line, one useful, specific idea from the account’s topics, a soft call to action at the end. Written to be heard, not read.']],
                    ['n', 'ai.narrate', ['account_id' => $visual?->id]],
                    ['m', 'ai.compose', ['account_id' => $visual?->id, 'mood' => 'account', 'seconds' => 30]],
                    ['r', 'action.reel', ['account_id' => $visual?->id, 'style' => 'bold', 'background' => 'none']],
                    ['a', 'human.approve', ['ask' => 'Post this reel?']],
                    ['p', 'action.post', ['account_id' => $visual?->id, 'when' => 'next_slot']],
                ],
                [['t', 'w'], ['w', 'n'], ['n', 'm'], ['m', 'r'], ['r', 'a'], ['a', 'p', 'approved']],
            ],
            'daily-drop' => [
                'Daily drop',
                'A fresh post every weekday, in your voice. You just say yes.',
                'Every weekday at 08:30 the AI writes one post from the account’s topics and voice, then waits for you. Approve it from the Inbox in one tap and it goes into the next free slot — and the approved post becomes a liked example, so tomorrow’s is closer to what you like.',
                [
                    ['t', 'trigger.schedule', ['every' => 'weekdays', 'at' => '08:30']],
                    ['w', 'ai.write', ['account_id' => $wordy?->id, 'brief' => 'One post for today. Pick one of the account’s topics and say one useful, specific thing about it. A different angle from the recent posts.']],
                    ['a', 'human.approve', ['ask' => 'Today’s post. Send it?']],
                    ['p', 'action.post', ['account_id' => $wordy?->id, 'when' => 'next_slot']],
                    ['m', 'action.remember', ['account_id' => $wordy?->id, 'kind' => 'example', 'content' => '{{draft}}']],
                ],
                [['t', 'w'], ['w', 'a'], ['a', 'p', 'approved'], ['p', 'm']],
            ],
            'second-life' => [
                'Second life',
                'Your best old posts, back on the calendar with a new hook.',
                'Every Monday at 10:00 it picks a post published more than 30 days ago (never the same one twice), rewrites its opening so it feels new, and asks you. Approved, it goes back into the next free slot with its original photo or video.',
                [
                    ['t', 'trigger.schedule', ['every' => 'week', 'weekday' => '1', 'at' => '10:00']],
                    ['e', 'logic.evergreen', ['account_id' => $any?->id, 'older_than_days' => 30]],
                    ['r', 'ai.rewrite', ['source' => '{{post.body}}', 'how' => 'Same message and facts, a brand-new opening line. Make it feel fresh, not recycled.']],
                    ['a', 'human.approve', ['ask' => 'Bring this one back?']],
                    ['p', 'action.post', ['when' => 'next_slot']],
                ],
                [['t', 'e'], ['e', 'r'], ['r', 'a'], ['a', 'p', 'approved']],
            ],
            'signal' => [
                'Signal to post',
                'News about your topics becomes a post idea before your competitors wake up.',
                'Watches Google News for the account’s topics every 15 minutes. The AI scores each new story for fit; anything 70 or above becomes a drafted reaction post in the account’s voice, waiting for your yes. Everything else is ignored quietly.',
                [
                    ['t', 'trigger.rss', ['url' => $feed]],
                    ['s', 'ai.score', ['account_id' => $wordy?->id, 'input' => '{{item.title}} — {{item.summary}}', 'question' => 'Would this account’s audience care about this story, and can the account speak about it credibly?']],
                    ['i', 'logic.if', ['value' => '{{score}}', 'op' => 'gte', 'compare' => '70']],
                    ['w', 'ai.write', ['account_id' => $wordy?->id, 'brief' => "A short post reacting to this story from the account’s point of view. Add the account’s own angle; don’t just repeat the headline.\n\nStory: {{item.title}} — {{item.summary}}\nLink: {{item.link}}"]],
                    ['a', 'human.approve', ['ask' => 'React to this story?']],
                    ['p', 'action.post', ['account_id' => $wordy?->id, 'when' => 'next_slot']],
                ],
                [['t', 's'], ['s', 'i'], ['i', 'w', 'yes'], ['w', 'a'], ['a', 'p', 'approved']],
            ],
            'storm-response' => [
                'Storm response',
                'When comments turn, a calm holding statement is ready before you are.',
                'When Storm Guard freezes an account, this tells you why, drafts a calm, accountable holding statement in the account’s voice, and waits for you. Approve it and it goes out in 15 minutes — the freeze holds everything else, but not what you approved knowing about the storm.',
                [
                    ['t', 'trigger.storm', []],
                    ['n', 'action.notify', ['message' => "Storm Guard froze @{{account.handle}}\n{{storm.reason}} A holding statement is drafted for you to approve."]],
                    ['w', 'ai.write', ['brief' => 'A short, calm holding statement: we hear the concerns, we are looking into it, and we will update soon. Accountable and human. No excuses, no promises we can’t keep, no marketing, no emoji.']],
                    ['a', 'human.approve', ['ask' => 'Post this holding statement?']],
                    ['p', 'action.post', ['when' => 'in_hours', 'hours' => 0.25]],
                ],
                [['t', 'n'], ['n', 'w'], ['w', 'a'], ['a', 'p', 'approved']],
            ],
            'rescue' => [
                'Failure rescue',
                'A failed post pings your team, then quietly tries again.',
                'When a post fails on every attempt, it leaves you a note (and pings Slack or Discord if you paste a webhook), gives the phone an hour to recover, then puts the post back in the next free slot. The approved content isn’t touched.',
                [
                    ['t', 'trigger.post_failed', []],
                    ['n', 'action.notify', ['message' => "Couldn’t publish “{{post.title}}” on @{{account.handle}}\n{{post.error}} The flow tries it again in an hour."]],
                    ['h', 'action.webhook', ['url' => '', 'message' => 'FlowAI couldn’t publish “{{post.title}}” on @{{account.handle}}: {{post.error}}. Retrying in an hour.']],
                    ['z', 'logic.wait', ['amount' => 1, 'unit' => 'hours']],
                    ['r', 'action.reschedule', []],
                ],
                [['t', 'n'], ['n', 'h'], ['h', 'z'], ['z', 'r']],
            ],
            'kind-words' => [
                'Kind words back',
                'Happy comments get a warm reply. Angry ones are left to you.',
                'When a comment comes in and reads positive, the AI drafts a short, warm reply in the account’s voice. In mode B an approved rule sends it; otherwise it waits for you in Comments. Anything negative goes nowhere near the AI.',
                [
                    ['t', 'trigger.comment', []],
                    ['i', 'logic.if', ['value' => '{{comment.sentiment}}', 'op' => 'gte', 'compare' => '25']],
                    ['d', 'ai.reply', ['guidance' => 'Thank them by name, answer if they asked something, keep it light.']],
                    ['s', 'action.reply', ['body' => '{{draft}}']],
                ],
                [['t', 'i'], ['i', 'd', 'yes'], ['d', 's']],
            ],
        };

        $graph = [
            'nodes' => array_map(fn (array $n) => ['id' => $n[0], 'type' => $n[1], 'x' => 0, 'y' => 0, 'config' => Catalog::configure($n[1], $n[2])], $nodes),
            'edges' => array_map(fn (array $e) => ['from' => $e[0], 'to' => $e[1], 'port' => $e[2] ?? 'next'], $edges),
        ];

        return ['key' => $key, 'name' => $name, 'tagline' => $tagline, 'detail' => $detail, 'graph' => Graph::layout($graph)];
    }
}

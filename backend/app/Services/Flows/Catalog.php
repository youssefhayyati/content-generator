<?php

namespace App\Services\Flows;

/**
 * Every kind of node a flow can hold: what it does, the settings it takes, where it can lead
 * (its ports), and the variables it leaves for the nodes after it. The canvas draws from this,
 * the graph is validated against it, and the "say it" compiler is taught it.
 *
 * Variables are written {{like.this}} in any text setting and filled in from the run.
 */
final class Catalog
{
    public const GROUPS = [
        'trigger' => 'When',
        'ai' => 'AI',
        'logic' => 'Logic',
        'human' => 'You',
        'action' => 'Do',
    ];

    private const EVERY = [
        ['value' => 'hour', 'label' => 'Every hour'],
        ['value' => 'day', 'label' => 'Every day'],
        ['value' => 'weekdays', 'label' => 'Every weekday'],
        ['value' => 'week', 'label' => 'Every week'],
    ];

    private const WEEKDAYS = [
        ['value' => '1', 'label' => 'Monday'], ['value' => '2', 'label' => 'Tuesday'], ['value' => '3', 'label' => 'Wednesday'],
        ['value' => '4', 'label' => 'Thursday'], ['value' => '5', 'label' => 'Friday'], ['value' => '6', 'label' => 'Saturday'],
        ['value' => '7', 'label' => 'Sunday'],
    ];

    /** What the variables that aren't plain text hold, so the compiler checks them the right way. */
    public const VARIABLES = [
        'comment.sentiment' => 'a number from -100 (furious) to 100 (delighted); -25 or below is upset, 25 or above is happy',
        'score' => 'a number from 0 to 100; 70 or above is a good fit',
        'storm.negative' => 'the share of recent comments that are negative, 0 to 100',
        'now' => 'the date and time the run started, in the operator’s timezone',
        'draft' => 'the text the last AI step wrote (or the operator edited when approving)',
        'audio.id' => 'the voiceover Read it aloud made; Make a reel uses it',
        'video.id' => 'the reel Make a reel rendered; Schedule a post attaches it',
    ];

    /**
     * @return array<string, array{group: string, label: string, detail: string, ports: list<string>, fields: list<array<string, mixed>>, produces: list<string>}>
     */
    public static function nodes(): array
    {
        $account = fn (string $hint = 'Any account') => ['key' => 'account_id', 'label' => 'Account', 'kind' => 'account', 'hint' => $hint];

        return [
            /* -------------------------------------------------------------- */
            /* When: one per flow, the first node */
            /* -------------------------------------------------------------- */
            'trigger.manual' => [
                'group' => 'trigger', 'label' => 'When I press Run',
                'detail' => 'Runs only when you start it by hand.',
                'ports' => ['next'], 'fields' => [], 'produces' => [],
            ],
            'trigger.schedule' => [
                'group' => 'trigger', 'label' => 'On a schedule',
                'detail' => 'Every hour, day, weekday or week, in your timezone.',
                'ports' => ['next'],
                'fields' => [
                    ['key' => 'every', 'label' => 'How often', 'kind' => 'select', 'options' => self::EVERY, 'default' => 'day'],
                    ['key' => 'at', 'label' => 'At', 'kind' => 'time', 'default' => '09:00'],
                    ['key' => 'weekday', 'label' => 'On', 'kind' => 'select', 'options' => self::WEEKDAYS, 'default' => '1', 'when' => ['every' => 'week']],
                ],
                'produces' => ['now'],
            ],
            'trigger.rss' => [
                'group' => 'trigger', 'label' => 'A feed publishes',
                'detail' => 'Watches an RSS or Atom feed — news, a blog, a competitor — every 15 minutes.',
                'ports' => ['next'],
                'fields' => [['key' => 'url', 'label' => 'Feed URL', 'kind' => 'text', 'placeholder' => 'https://example.com/feed.xml', 'default' => '']],
                'produces' => ['item.title', 'item.summary', 'item.link'],
            ],
            'trigger.post_published' => [
                'group' => 'trigger', 'label' => 'A post goes live',
                'detail' => 'A phone proved a post is live, or you marked it published.',
                'ports' => ['next'], 'fields' => [$account()],
                'produces' => ['post.title', 'post.body', 'post.url', 'account.handle'],
            ],
            'trigger.post_failed' => [
                'group' => 'trigger', 'label' => 'A post fails',
                'detail' => 'Every automatic attempt to publish a post failed.',
                'ports' => ['next'], 'fields' => [$account()],
                'produces' => ['post.title', 'post.body', 'post.error', 'account.handle'],
            ],
            'trigger.comment' => [
                'group' => 'trigger', 'label' => 'A comment arrives',
                'detail' => 'Someone comments on one of the account’s posts.',
                'ports' => ['next'], 'fields' => [$account()],
                'produces' => ['comment.author', 'comment.body', 'comment.sentiment', 'account.handle'],
            ],
            'trigger.storm' => [
                'group' => 'trigger', 'label' => 'Storm Guard trips',
                'detail' => 'An account’s comments turned negative fast, and its publishing froze.',
                'ports' => ['next'], 'fields' => [$account()],
                'produces' => ['storm.reason', 'storm.negative', 'account.handle'],
            ],

            /* -------------------------------------------------------------- */
            /* AI */
            /* -------------------------------------------------------------- */
            'ai.write' => [
                'group' => 'ai', 'label' => 'Write a post',
                'detail' => 'Writes a post from a brief, in the account’s voice and within its platform’s limit.',
                'ports' => ['next'],
                'fields' => [
                    $account('The account from the trigger'),
                    ['key' => 'brief', 'label' => 'Brief', 'kind' => 'textarea', 'placeholder' => 'A short post about {{item.title}}…', 'default' => ''],
                ],
                'produces' => ['draft'],
            ],
            'ai.rewrite' => [
                'group' => 'ai', 'label' => 'Rewrite',
                'detail' => 'Rewrites a text the way you ask, in the account’s voice.',
                'ports' => ['next'],
                'fields' => [
                    $account('The account from the trigger'),
                    ['key' => 'source', 'label' => 'Text', 'kind' => 'textarea', 'default' => '{{post.body}}'],
                    ['key' => 'how', 'label' => 'How', 'kind' => 'textarea', 'default' => 'Same message, a fresh opening line. Make it feel new.'],
                ],
                'produces' => ['draft'],
            ],
            'ai.score' => [
                'group' => 'ai', 'label' => 'Score it',
                'detail' => 'Rates a text from 0 to 100 against your question, with a one-line reason.',
                'ports' => ['next'],
                'fields' => [
                    $account('The account from the trigger'),
                    ['key' => 'input', 'label' => 'Text', 'kind' => 'textarea', 'default' => '{{item.title}} — {{item.summary}}'],
                    ['key' => 'question', 'label' => 'Question', 'kind' => 'textarea', 'default' => 'How well does this fit the account’s topics and audience?'],
                ],
                'produces' => ['score', 'reason'],
            ],
            'ai.reply' => [
                'group' => 'ai', 'label' => 'Draft a reply',
                'detail' => 'Drafts a short, warm reply to the comment, in the account’s voice.',
                'ports' => ['next'],
                'fields' => [['key' => 'guidance', 'label' => 'Guidance', 'kind' => 'textarea', 'default' => 'Thank them, answer if they asked something, never argue.']],
                'produces' => ['draft'],
            ],

            'ai.narrate' => [
                'group' => 'ai', 'label' => 'Read it aloud',
                'detail' => 'Turns the text into a voiceover in the account’s voice, every word timed for captions.',
                'ports' => ['next'],
                'fields' => [
                    $account('The account from the trigger'),
                    ['key' => 'voice', 'label' => 'Voice', 'kind' => 'voice', 'default' => '', 'hint' => 'The account’s voice'],
                    ['key' => 'text', 'label' => 'Text', 'kind' => 'textarea', 'default' => '{{draft}}'],
                ],
                'produces' => ['audio.id', 'audio.duration'],
            ],
            'ai.compose' => [
                'group' => 'ai', 'label' => 'Compose music',
                'detail' => 'Writes an original, licence-free track in a mood.',
                'ports' => ['next'],
                'fields' => [
                    $account('The account from the trigger'),
                    ['key' => 'mood', 'label' => 'Mood', 'kind' => 'select', 'default' => 'account', 'options' => [
                        ['value' => 'account', 'label' => 'The account’s signature mood'],
                        ['value' => 'golden-hour', 'label' => 'Golden hour · warm lo-fi'], ['value' => 'linen', 'label' => 'Linen · airy ambient'],
                        ['value' => 'atelier', 'label' => 'Atelier · bright acoustic'], ['value' => 'pulse', 'label' => 'Pulse · upbeat house'],
                        ['value' => 'night-drive', 'label' => 'Night drive · synthwave'], ['value' => 'bloom', 'label' => 'Bloom · dreamy, cinematic'],
                    ]],
                    ['key' => 'seconds', 'label' => 'Length (seconds)', 'kind' => 'number', 'default' => 30],
                ],
                'produces' => ['music.id'],
            ],

            /* -------------------------------------------------------------- */
            /* Logic */
            /* -------------------------------------------------------------- */
            'logic.if' => [
                'group' => 'logic', 'label' => 'If',
                'detail' => 'Goes one way when the check holds, the other way when it doesn’t.',
                'ports' => ['yes', 'no'],
                'fields' => [
                    ['key' => 'value', 'label' => 'Value', 'kind' => 'text', 'default' => '{{score}}'],
                    ['key' => 'op', 'label' => 'Check', 'kind' => 'select', 'default' => 'gte', 'options' => [
                        ['value' => 'gte', 'label' => 'is at least'], ['value' => 'lte', 'label' => 'is at most'],
                        ['value' => 'eq', 'label' => 'is'], ['value' => 'contains', 'label' => 'contains'],
                        ['value' => 'not_contains', 'label' => 'doesn’t contain'], ['value' => 'empty', 'label' => 'is empty'],
                    ]],
                    ['key' => 'compare', 'label' => 'Than', 'kind' => 'text', 'default' => '70'],
                ],
                'produces' => [],
            ],
            'logic.wait' => [
                'group' => 'logic', 'label' => 'Wait',
                'detail' => 'Holds the run, then carries on by itself.',
                'ports' => ['next'],
                'fields' => [
                    ['key' => 'amount', 'label' => 'For', 'kind' => 'number', 'default' => 1],
                    ['key' => 'unit', 'label' => 'Unit', 'kind' => 'select', 'default' => 'hours', 'options' => [
                        ['value' => 'minutes', 'label' => 'minutes'], ['value' => 'hours', 'label' => 'hours'], ['value' => 'days', 'label' => 'days'],
                    ]],
                ],
                'produces' => [],
            ],
            'logic.evergreen' => [
                'group' => 'logic', 'label' => 'Bring back a past post',
                'detail' => 'Finds a published post old enough to bring back, never the same one twice.',
                'ports' => ['next'],
                'fields' => [
                    $account('Any account'),
                    ['key' => 'older_than_days', 'label' => 'Older than (days)', 'kind' => 'number', 'default' => 30],
                ],
                'produces' => ['post.title', 'post.body', 'post.url', 'account.handle'],
            ],

            /* -------------------------------------------------------------- */
            /* You */
            /* -------------------------------------------------------------- */
            'human.approve' => [
                'group' => 'human', 'label' => 'Ask me first',
                'detail' => 'Holds the run in your Inbox. You approve (and can edit the draft) or reject.',
                'ports' => ['approved', 'rejected'],
                'fields' => [['key' => 'ask', 'label' => 'What to ask', 'kind' => 'text', 'default' => 'Post this?']],
                'produces' => ['draft'],
            ],

            /* -------------------------------------------------------------- */
            /* Do */
            /* -------------------------------------------------------------- */
            'action.reel' => [
                'group' => 'action', 'label' => 'Make a reel',
                'detail' => 'Renders a vertical video: the voiceover, music under it, and captions that follow every word.',
                'ports' => ['next'],
                'fields' => [
                    $account('The account from the trigger'),
                    ['key' => 'style', 'label' => 'Look', 'kind' => 'select', 'default' => 'bold', 'options' => [
                        ['value' => 'bold', 'label' => 'Bold · big words that light up'], ['value' => 'editorial', 'label' => 'Editorial · a magazine page'],
                        ['value' => 'pulse', 'label' => 'Pulse · an audiogram'],
                    ]],
                    ['key' => 'background', 'label' => 'Picture', 'kind' => 'select', 'default' => 'post', 'options' => [
                        ['value' => 'post', 'label' => 'The post’s photo or video, if it has one'], ['value' => 'none', 'label' => 'A moving gradient'],
                    ]],
                    ['key' => 'title', 'label' => 'Title on screen', 'kind' => 'text', 'default' => ''],
                ],
                'produces' => ['video.id'],
            ],
            'action.post' => [
                'group' => 'action', 'label' => 'Schedule a post',
                'detail' => 'Puts the text on the calendar for the account, with the reel if the run made one. Only what you approved in this run is scheduled; anything else is saved as a draft.',
                'ports' => ['next'],
                'fields' => [
                    $account('The account from the trigger'),
                    ['key' => 'body', 'label' => 'Text', 'kind' => 'textarea', 'default' => '{{draft}}'],
                    ['key' => 'when', 'label' => 'When', 'kind' => 'select', 'default' => 'next_slot', 'options' => [
                        ['value' => 'next_slot', 'label' => 'Next free queue slot'], ['value' => 'in_hours', 'label' => 'In a few hours'],
                        ['value' => 'draft', 'label' => 'Save as a draft'],
                    ]],
                    ['key' => 'hours', 'label' => 'Hours from now', 'kind' => 'number', 'default' => 2, 'when' => ['when' => 'in_hours']],
                ],
                'produces' => ['post.id', 'post.scheduled_at'],
            ],
            'action.reply' => [
                'group' => 'action', 'label' => 'Send the reply',
                'detail' => 'Replies to the comment. In mode B an approved rule sends it; otherwise it waits for you in Comments.',
                'ports' => ['next'],
                'fields' => [['key' => 'body', 'label' => 'Reply', 'kind' => 'textarea', 'default' => '{{draft}}']],
                'produces' => [],
            ],
            'action.reschedule' => [
                'group' => 'action', 'label' => 'Try the post again',
                'detail' => 'Moves the failed post to the next free queue slot. The approved content stays as it was.',
                'ports' => ['next'], 'fields' => [],
                'produces' => ['post.scheduled_at'],
            ],
            'action.hold' => [
                'group' => 'action', 'label' => 'Freeze the account',
                'detail' => 'Holds every post on the account until you give the all clear.',
                'ports' => ['next'],
                'fields' => [$account('The account from the trigger'), ['key' => 'reason', 'label' => 'Why', 'kind' => 'text', 'default' => 'Held by a flow.']],
                'produces' => [],
            ],
            'action.pause_all' => [
                'group' => 'action', 'label' => 'Press the stop button',
                'detail' => 'Pauses all automated publishing, on every phone.',
                'ports' => ['next'], 'fields' => [], 'produces' => [],
            ],
            'action.remember' => [
                'group' => 'action', 'label' => 'Teach the account',
                'detail' => 'Adds the text to the account’s memory, so every later post learns from it.',
                'ports' => ['next'],
                'fields' => [
                    $account('The account from the trigger'),
                    ['key' => 'kind', 'label' => 'As', 'kind' => 'select', 'default' => 'example', 'options' => [
                        ['value' => 'example', 'label' => 'A liked example'], ['value' => 'instruction', 'label' => 'An instruction'],
                    ]],
                    ['key' => 'content', 'label' => 'Text', 'kind' => 'textarea', 'default' => '{{draft}}'],
                ],
                'produces' => [],
            ],
            'action.notify' => [
                'group' => 'action', 'label' => 'Tell me',
                'detail' => 'Leaves a note in your Inbox.',
                'ports' => ['next'],
                'fields' => [['key' => 'message', 'label' => 'Note', 'kind' => 'textarea', 'default' => '']],
                'produces' => [],
            ],
            'action.webhook' => [
                'group' => 'action', 'label' => 'Send a webhook',
                'detail' => 'Posts a message to Slack, Discord, Zapier, Make, or any URL that takes JSON.',
                'ports' => ['next'],
                'fields' => [
                    ['key' => 'url', 'label' => 'Webhook URL', 'kind' => 'text', 'placeholder' => 'https://hooks.slack.com/services/…', 'default' => ''],
                    ['key' => 'message', 'label' => 'Message', 'kind' => 'textarea', 'default' => ''],
                ],
                'produces' => [],
            ],
        ];
    }

    /** @return array<string, mixed>|null */
    public static function find(string $type): ?array
    {
        return self::nodes()[$type] ?? null;
    }

    public static function isTrigger(string $type): bool
    {
        return str_starts_with($type, 'trigger.');
    }

    /**
     * A node's settings with every default filled in and nothing it doesn't know about.
     *
     * @param  array<string, mixed>  $config
     * @return array<string, mixed>
     */
    public static function configure(string $type, array $config): array
    {
        $out = [];
        foreach (self::find($type)['fields'] ?? [] as $field) {
            $value = $config[$field['key']] ?? $field['default'] ?? null;
            $out[$field['key']] = match ($field['kind']) {
                'number' => is_numeric($value) ? $value + 0 : ($field['default'] ?? 0),
                'account' => is_numeric($value) && (int) $value > 0 ? (int) $value : null,
                'select' => in_array((string) $value, array_column($field['options'], 'value'), true) ? (string) $value : (string) ($field['default'] ?? $field['options'][0]['value']),
                'time' => is_string($value) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $value) ? $value : (string) ($field['default'] ?? '09:00'),
                'voice' => is_string($value) && preg_match('/^([a-z]{2}_[a-z]+)?$/', $value) ? $value : '',
                default => mb_substr(trim((string) ($value ?? '')), 0, 2000),
            };
        }

        return $out;
    }
}

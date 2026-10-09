<?php

namespace App\Services\Flows;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\Comment;
use App\Models\Flow;
use App\Models\FlowRun;
use App\Models\Post;
use App\Models\User;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use SimpleXMLElement;
use Throwable;

/**
 * Where flows meet the rest of the studio. Events (a post went live, a comment came in, Storm
 * Guard tripped) start the flows listening for them; the clock, every minute, starts scheduled
 * flows, wakes runs whose Wait is over and reads the feeds flows are watching.
 */
class Flows
{
    /** More runs than this in an hour and a flow is skipped: it's probably feeding on itself. */
    private const MAX_RUNS_PER_HOUR = 30;

    private const FEED_MINUTES = 15;

    public function __construct(private readonly Engine $engine, private readonly Steps $steps) {}

    /**
     * Start every switched-on flow that listens for this event (and, when the flow names an
     * account, only for that account). Returns how many runs started.
     */
    public function fire(User $user, string $trigger, array $context, ?int $accountId, string $cause): int
    {
        $flows = $user->flows()->where('enabled', true)->where('trigger', $trigger)->get();
        $started = 0;
        foreach ($flows as $flow) {
            $only = $flow->triggerConfig()['account_id'] ?? null;
            if ($only && $only !== $accountId) {
                continue;
            }
            if ($flow->runs()->where('created_at', '>=', now()->subHour())->count() >= self::MAX_RUNS_PER_HOUR) {
                continue;
            }
            $this->engine->start($flow, $context, $cause);
            $started++;
        }

        return $started;
    }

    public function postPublished(Post $post): void
    {
        $post->loadMissing(['account', 'user']);
        $this->fire($post->user, 'trigger.post_published', $this->postContext($post), $post->account_id, 'Went live: “'.Str::limit($post->title ?: $post->body, 60).'”');
    }

    public function postFailed(Post $post): void
    {
        $post->loadMissing(['account', 'user']);
        $this->fire($post->user, 'trigger.post_failed', $this->postContext($post), $post->account_id, 'Failed: “'.Str::limit($post->title ?: $post->body, 60).'”');
    }

    public function commentArrived(Comment $comment): void
    {
        $comment->loadMissing(['account', 'user']);
        $this->fire($comment->user, 'trigger.comment', $this->commentContext($comment), $comment->account_id, "@{$comment->author} commented: “".Str::limit($comment->body, 60).'”');
    }

    public function stormTripped(Account $account, array $pressure): void
    {
        $this->fire($account->user, 'trigger.storm', [
            'storm' => ['reason' => $account->storm_reason, 'negative' => $pressure['share'], 'comments' => $pressure['total']],
            'account' => $this->steps->accountVars($account),
        ], $account->id, "Storm Guard froze {$account->label()}");
    }

    /**
     * Every minute: scheduled flows whose time came, runs whose Wait is over, feeds due a read.
     *
     * @return array{scheduled: int, resumed: int, feeds: int}
     */
    public function tick(): array
    {
        $scheduled = 0;
        foreach (Flow::with('user')->where('enabled', true)->where('trigger', 'trigger.schedule')->where('next_run_at', '<=', now())->limit(50)->get() as $flow) {
            $flow->update(['next_run_at' => $this->nextRunAt($flow)]);
            $this->engine->start($flow, ['now' => CarbonImmutable::now($flow->user->timezoneOrUtc())->toDateTimeString()], $this->scheduleLabel($flow));
            $scheduled++;
        }

        $resumed = 0;
        foreach (FlowRun::where('status', 'waiting')->where('resume_at', '<=', now())->limit(100)->get() as $run) {
            $this->engine->resume($run);
            $resumed++;
        }

        $feeds = 0;
        $due = Flow::with('user')->where('enabled', true)->where('trigger', 'trigger.rss')
            ->where(fn ($q) => $q->whereNull('polled_at')->orWhere('polled_at', '<=', now()->subMinutes(self::FEED_MINUTES)))
            ->limit(20)->get();
        foreach ($due as $flow) {
            $feeds += $this->poll($flow);
        }

        return compact('scheduled', 'resumed', 'feeds');
    }

    /**
     * Read the flow's feed and start a run for each item it hasn't seen. The first read only
     * takes the newest item, so switching a flow on doesn't flood the Inbox with old news.
     */
    public function poll(Flow $flow): int
    {
        $state = $flow->state ?? [];
        $first = ! isset($state['seen']);
        $seen = $state['seen'] ?? [];
        $flow->update(['polled_at' => now()]);

        try {
            $items = $this->readFeed((string) ($flow->triggerConfig()['url'] ?? ''));
        } catch (Throwable $e) {
            $flow->update(['state' => [...$state, 'error' => Str::limit($e->getMessage(), 200)]]);

            return 0;
        }

        $fresh = array_values(array_filter($items, fn (array $i) => ! in_array($i['guid'], $seen, true)));
        $fire = $first ? array_slice($fresh, 0, 1) : array_slice($fresh, 0, 3);
        $flow->update(['state' => [...$state, 'error' => null, 'seen' => array_slice(array_values(array_unique([...array_column($items, 'guid'), ...$seen])), 0, 300)]]);

        foreach ($fire as $item) {
            $this->engine->start($flow, ['item' => $item], 'New in the feed: “'.Str::limit($item['title'], 70).'”');
        }

        return count($fire);
    }

    /**
     * The items of an RSS or Atom feed, newest first as the feed lists them.
     *
     * @return list<array{guid: string, title: string, summary: string, link: string}>
     */
    public function readFeed(string $url): array
    {
        if ($problem = SafeUrl::problem($url)) {
            throw new \RuntimeException($problem);
        }
        $response = Http::timeout(10)->withHeaders(['Accept' => 'application/rss+xml, application/atom+xml, application/xml, text/xml'])->get($url);
        if ($response->failed()) {
            throw new \RuntimeException("The feed answered {$response->status()}.");
        }
        $previous = libxml_use_internal_errors(true);
        $xml = simplexml_load_string($response->body(), SimpleXMLElement::class, LIBXML_NOCDATA | LIBXML_NONET);
        libxml_use_internal_errors($previous);
        if (! $xml) {
            throw new \RuntimeException('That URL isn’t an RSS or Atom feed.');
        }

        $clean = fn ($html) => Str::limit(trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags((string) $html), ENT_QUOTES | ENT_HTML5))), 600);
        $items = [];
        foreach ($xml->channel->item ?? [] as $item) {
            $link = (string) $item->link;
            $items[] = ['guid' => (string) ($item->guid ?: $link ?: $item->title), 'title' => $clean($item->title), 'summary' => $clean($item->description), 'link' => $link];
        }
        foreach ($xml->entry ?? [] as $entry) {
            $link = (string) ($entry->link['href'] ?? '');
            $items[] = ['guid' => (string) ($entry->id ?: $link ?: $entry->title), 'title' => $clean($entry->title), 'summary' => $clean($entry->summary ?: $entry->content), 'link' => $link];
        }

        return array_slice(array_values(array_filter($items, fn (array $i) => $i['title'] !== '')), 0, 30);
    }

    /** When a schedule trigger fires next, in UTC. Null for any other trigger, or a flow that's off. */
    public function nextRunAt(Flow $flow, ?CarbonImmutable $after = null): ?Carbon
    {
        if (! $flow->enabled || $flow->trigger !== 'trigger.schedule') {
            return null;
        }
        $c = $flow->triggerConfig();
        $tz = $flow->user->timezoneOrUtc();
        $now = ($after ?? CarbonImmutable::now())->setTimezone($tz);
        [$h, $m] = array_map('intval', explode(':', $c['at'] ?? '09:00'));

        $at = match ($c['every'] ?? 'day') {
            'hour' => $now->setTime($now->hour, $m)->lessThanOrEqualTo($now) ? $now->setTime($now->hour, $m)->addHour() : $now->setTime($now->hour, $m),
            'week' => (function () use ($now, $h, $m, $c) {
                $day = (int) ($c['weekday'] ?? 1);
                $at = $now->startOfWeek(CarbonInterface::MONDAY)->addDays($day - 1)->setTime($h, $m);

                return $at->lessThanOrEqualTo($now) ? $at->addWeek() : $at;
            })(),
            default => (function () use ($now, $h, $m, $c) {
                $at = $now->setTime($h, $m);
                for ($i = 0; $i < 8 && ($at->lessThanOrEqualTo($now) || (($c['every'] ?? 'day') === 'weekdays' && $at->isWeekend())); $i++) {
                    $at = $at->addDay();
                }

                return $at;
            })(),
        };

        return Carbon::instance($at->utc());
    }

    public function scheduleLabel(Flow $flow): string
    {
        $c = $flow->triggerConfig();
        $days = [1 => 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        return 'Scheduled: '.match ($c['every'] ?? 'day') {
            'hour' => 'every hour at :'.substr($c['at'] ?? '09:00', 3),
            'weekdays' => 'every weekday at '.($c['at'] ?? '09:00'),
            'week' => 'every '.($days[(int) ($c['weekday'] ?? 1)] ?? 'Monday').' at '.($c['at'] ?? '09:00'),
            default => 'every day at '.($c['at'] ?? '09:00'),
        };
    }

    /**
     * "Run now" on any flow: a real example of what its trigger would carry — the account's
     * latest published post, latest comment, the newest feed item — so a test run is honest.
     *
     * @return array{0: array<string, mixed>, 1: string}
     */
    public function sample(Flow $flow): array
    {
        $user = $flow->user;
        $only = $flow->triggerConfig()['account_id'] ?? null;
        $posts = fn () => $user->posts()->with('account')->when($only, fn ($q) => $q->where('account_id', $only));

        switch ($flow->trigger) {
            case 'trigger.post_published':
                $post = $posts()->where('status', PostStatus::Published)->latest('published_at')->first();
                abort_unless($post, 422, 'A test run needs a published post to start from, and there isn’t one yet.');

                return [$this->postContext($post), 'Test run with “'.Str::limit($post->title ?: $post->body, 50).'”'];

            case 'trigger.post_failed':
                $post = $posts()->where('status', PostStatus::Failed)->latest('updated_at')->first() ?? $posts()->latest('id')->first();
                abort_unless($post, 422, 'A test run needs a post to start from, and there isn’t one yet.');

                return [$this->postContext($post), 'Test run with “'.Str::limit($post->title ?: $post->body, 50).'”'];

            case 'trigger.comment':
                $comment = $user->comments()->with('account')->when($only, fn ($q) => $q->where('account_id', $only))->latest('id')->first();
                abort_unless($comment, 422, 'A test run needs a comment to start from. Report one in Comments first.');

                return [$this->commentContext($comment), "Test run with @{$comment->author}’s comment"];

            case 'trigger.storm':
                $account = $only ? $user->accounts()->find($only) : $user->accounts()->first();
                abort_unless($account, 422, 'A test run needs an account.');

                return [[
                    'storm' => ['reason' => 'A test: no storm is actually happening.', 'negative' => 0, 'comments' => 0],
                    'account' => $this->steps->accountVars($account),
                ], "Test run for {$account->label()} (no real storm)"];

            case 'trigger.rss':
                try {
                    $item = $this->readFeed((string) ($flow->triggerConfig()['url'] ?? ''))[0] ?? null;
                } catch (Throwable $e) {
                    abort(422, 'Couldn’t read the feed: '.$e->getMessage());
                }
                abort_unless($item, 422, 'The feed is empty.');

                return [['item' => $item], 'Test run with “'.Str::limit($item['title'], 60).'”'];

            case 'trigger.schedule':
                return [['now' => CarbonImmutable::now($user->timezoneOrUtc())->toDateTimeString()], 'Run by hand (normally: '.Str::after($this->scheduleLabel($flow), 'Scheduled: ').')'];

            default:
                return [[], 'Run by hand'];
        }
    }

    private function postContext(Post $post): array
    {
        return ['post' => $this->steps->postVars($post), 'account' => $post->account ? $this->steps->accountVars($post->account) : null];
    }

    private function commentContext(Comment $comment): array
    {
        return [
            'comment' => ['id' => $comment->id, 'author' => $comment->author, 'body' => $comment->body, 'sentiment' => $comment->sentiment],
            'account' => $this->steps->accountVars($comment->account),
        ];
    }
}

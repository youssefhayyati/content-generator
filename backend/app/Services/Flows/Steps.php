<?php

namespace App\Services\Flows;

use App\Enums\Platform;
use App\Enums\PostFormat;
use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\ActionLog;
use App\Models\Asset;
use App\Models\Comment;
use App\Models\FlowRun;
use App\Models\Post;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Media\GenerationRunner;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\PostPrompt;
use App\Services\Ai\UsageMeter;
use App\Services\Campaigns\Voice;
use App\Services\PostQueue;
use App\Services\Sound\VoiceRouter;
use App\Services\Studio\Autonomy;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Throwable;

/**
 * What each kind of node does when a run reaches it. Every step answers with:
 *   status   ok (carry on through `port`), end (this branch is done), wait (a timer),
 *            approval (a person), fail (the run stops)
 *   summary  one line for the trail, written for the operator
 *   set      variables for the nodes after it
 *
 * @phpstan-type Result array{status: string, summary: string, port?: string, set?: array<string, mixed>, resume_at?: Carbon}
 */
class Steps
{
    /** Platforms whose apps won't publish without an image or video. */
    private const VISUAL = [Platform::Instagram, Platform::TikTok, Platform::YouTube, Platform::Pinterest];

    public function __construct(
        private readonly ModelRegistry $models,
        private readonly UsageMeter $usage,
        private readonly Voice $voice,
        private readonly PostQueue $queue,
        private readonly Autonomy $autonomy,
    ) {}

    /**
     * @return Result
     */
    public function run(array $node, FlowRun $run): array
    {
        $c = $node['config'] ?? [];
        $ctx = $run->context ?? [];
        $fill = fn (string $key) => trim(Vars::fill((string) ($c[$key] ?? ''), $ctx));

        $result = $this->step($node, $run, $c, $fill);

        // A step that names an account hands it on: a scheduled flow has no account of its own,
        // and the voice, the music and the reel should all be the same account's.
        if (empty($ctx['account']) && ! empty($c['account_id']) && ($account = $run->user->accounts()->find($c['account_id']))) {
            $result['set'] = ['account' => $this->accountVars($account), ...$result['set'] ?? []];
        }

        return $result;
    }

    /**
     * @return Result
     */
    private function step(array $node, FlowRun $run, array $c, \Closure $fill): array
    {
        return match ($node['type']) {
            'ai.write' => $this->write($run, $c, $fill('brief')),
            'ai.rewrite' => $this->rewrite($run, $c, $fill('source'), $fill('how')),
            'ai.score' => $this->score($run, $c, $fill('input'), $fill('question')),
            'ai.reply' => $this->reply($run, $fill('guidance')),
            'ai.narrate' => $this->narrate($run, $c, $fill('text')),
            'ai.compose' => $this->composeMusic($run, $c),
            'action.reel' => $this->reel($run, $c, $fill('title')),
            'logic.if' => $this->check($fill('value'), (string) ($c['op'] ?? 'gte'), $fill('compare')),
            'logic.wait' => $this->wait((int) ($c['amount'] ?? 1), (string) ($c['unit'] ?? 'hours')),
            'logic.evergreen' => $this->evergreen($run, $c),
            'human.approve' => $this->approval($run, $fill('ask')),
            'action.post' => $this->post($run, $c, $fill('body')),
            'action.reply' => $this->sendReply($run, $fill('body')),
            'action.reschedule' => $this->reschedule($run),
            'action.hold' => $this->hold($run, $c, $fill('reason')),
            'action.pause_all' => $this->pauseAll($run),
            'action.remember' => $this->remember($run, $c, $fill('content')),
            'action.notify' => $this->notify($run, $fill('message')),
            'action.webhook' => $this->webhook($run, $fill('url'), $fill('message')),
            default => ['status' => 'ok', 'summary' => 'Nothing to do.'],
        };
    }

    /* ------------------------------------------------------------------ */
    /* AI */
    /* ------------------------------------------------------------------ */

    private function write(FlowRun $run, array $c, string $brief): array
    {
        $account = $this->account($run, $c);
        if (! $account) {
            return $this->fail('Pick the account this post is for.');
        }
        if ($brief === '') {
            return $this->fail('The brief is empty: say what the post should be about.');
        }
        $draft = $this->compose($run, new PostPrompt($brief, PostFormat::Text, [$account->platform], voice: $this->voice->context($account)), 'flow:write');

        return ['status' => 'ok', 'summary' => '“'.Str::limit($draft, 140).'”', 'set' => ['draft' => $draft]];
    }

    private function rewrite(FlowRun $run, array $c, string $source, string $how): array
    {
        $account = $this->account($run, $c);
        if ($source === '') {
            return $this->fail('There’s no text to rewrite yet.');
        }
        $platforms = $account ? [$account->platform] : [Platform::Instagram];
        $prompt = new PostPrompt($how ?: 'Rewrite it so it feels new.', PostFormat::Text, $platforms, draft: $source, voice: $account ? $this->voice->context($account) : null);
        $draft = $this->compose($run, $prompt, 'flow:rewrite');

        return ['status' => 'ok', 'summary' => '“'.Str::limit($draft, 140).'”', 'set' => ['draft' => $draft]];
    }

    private function score(FlowRun $run, array $c, string $input, string $question): array
    {
        if ($input === '') {
            return $this->fail('There’s nothing to score: the text is empty.');
        }
        $account = $this->account($run, $c);
        $answer = $this->askJson(
            $run,
            'You score texts for a social media studio. 0 means no fit at all, 100 a perfect fit. Be strict and honest; most things are not a perfect fit.'
                .($account ? "\n\nThe account:\n".$this->voice->context($account) : ''),
            "Question: {$question}\n\nText:\n{$input}\n\nGive a score from 0 to 100 and one short sentence why.",
            ['type' => 'object', 'properties' => ['score' => ['type' => 'integer'], 'reason' => ['type' => 'string']], 'required' => ['score', 'reason'], 'additionalProperties' => false],
            'flow:score',
        );
        $score = max(0, min(100, (int) ($answer['score'] ?? 0)));
        $reason = trim((string) ($answer['reason'] ?? ''));

        return ['status' => 'ok', 'summary' => "{$score}/100 — ".Str::limit($reason, 160), 'set' => ['score' => $score, 'reason' => $reason]];
    }

    private function reply(FlowRun $run, string $guidance): array
    {
        $comment = $this->comment($run);
        if (! $comment) {
            return $this->end('There’s no comment in this run to reply to.');
        }
        $account = $comment->account;
        $answer = $this->askJson(
            $run,
            "You reply to comments for a social account, in its voice. Short (max 40 words), warm, human. {$guidance}\n\nThe account:\n".$this->voice->context($account),
            "Comment by @{$comment->author}:\n{$comment->body}\n\nWrite the reply.",
            ['type' => 'object', 'properties' => ['reply' => ['type' => 'string']], 'required' => ['reply'], 'additionalProperties' => false],
            'flow:reply',
        );
        $draft = trim((string) ($answer['reply'] ?? ''));
        if ($draft === '') {
            return $this->fail('The model wrote an empty reply.');
        }

        return ['status' => 'ok', 'summary' => '“'.Str::limit($draft, 140).'”', 'set' => ['draft' => $draft]];
    }

    /** A voiceover of the text, in the account's voice, made through the studio's voice generator. */
    private function narrate(FlowRun $run, array $c, string $text): array
    {
        if ($text === '') {
            return $this->fail('There’s nothing to read aloud. Put a “Write a post” step before this one.');
        }
        $account = $this->account($run, $c);
        $sound = $account?->soundSettings() ?? Account::SOUND_DEFAULTS;
        $voice = filled($c['voice'] ?? null) ? $c['voice'] : $sound['voice'];
        $asset = $this->generate($run, 'voice', VoiceRouter::modelFor($voice), mb_substr($text, 0, 2500), ['voice' => $voice, 'speed' => $sound['speed']]);
        $name = $asset->meta['voice_name'] ?? $voice;

        return ['status' => 'ok', 'summary' => "{$name} read it: ".round((float) $asset->duration, 1).' seconds, every word timed.', 'set' => [
            'audio' => ['id' => $asset->id, 'duration' => $asset->duration, 'url' => $asset->url()],
        ]];
    }

    /** An original track in the account's mood (or the one picked), for under the voice. */
    private function composeMusic(FlowRun $run, array $c): array
    {
        $account = $this->account($run, $c);
        $mood = ($c['mood'] ?? 'account') === 'account' ? ($account?->soundSettings()['mood'] ?? 'golden-hour') : $c['mood'];
        $seconds = (float) max(8, min(180, (float) ($c['seconds'] ?? 30)));
        // Long enough for the voiceover, if there is one.
        $voice = (float) ($run->context['audio']['duration'] ?? 0);
        $seconds = max($seconds, $voice ? $voice + 2 : 0);
        $asset = $this->generate($run, 'music', 'sound/composer', ucfirst(str_replace('-', ' ', $mood)), ['mood' => $mood, 'seconds' => $seconds, 'energy' => 0.55]);

        return ['status' => 'ok', 'summary' => 'Composed '.($asset->meta['label'] ?? $mood).' in '.($asset->meta['key'] ?? '?').', '.round((float) ($asset->meta['bpm'] ?? 0)).' bpm.', 'set' => [
            'music' => ['id' => $asset->id, 'url' => $asset->url()],
        ]];
    }

    /** A vertical reel from the run's voiceover (and music, and the post's picture if asked). */
    private function reel(FlowRun $run, array $c, string $title): array
    {
        $ctx = $run->context ?? [];
        $user = $run->user;
        $voice = isset($ctx['audio']['id']) ? $user->assets()->where('kind', 'audio')->find($ctx['audio']['id']) : null;
        $music = isset($ctx['music']['id']) ? $user->assets()->where('kind', 'audio')->find($ctx['music']['id']) : null;
        if (! $voice && ! $music) {
            return $this->fail('A reel needs a voice or music: put “Read it aloud” or “Compose music” before this step.');
        }
        $picture = null;
        if (($c['background'] ?? 'post') === 'post' && isset($ctx['post']['id'])) {
            $picture = $user->posts()->with('assets')->find($ctx['post']['id'])?->assets->first(fn ($a) => in_array($a->kind, ['image', 'video'], true));
        }
        $account = $this->account($run, $c);
        $inputs = array_values(array_filter([$voice?->id ?? $music?->id, $picture?->id]));
        $asset = $this->generate($run, 'reel', 'studio/reel', $title ?: 'Reel', array_filter([
            'style' => $c['style'] ?? 'bold',
            'accent' => $account?->soundSettings()['accent'] ?? null,
            'title' => $title ?: null,
            'handle' => $account?->handle,
            'music_asset_id' => $voice && $music ? $music->id : null,
            'captions' => true,
        ], fn ($v) => $v !== null), $inputs);

        return ['status' => 'ok', 'summary' => 'Rendered a '.round((float) $asset->duration, 1).'-second reel'.($picture ? ' over the post’s picture.' : '.'), 'set' => [
            'video' => ['id' => $asset->id, 'url' => $asset->url()],
        ]];
    }

    /**
     * Make media through the studio's own generators, right here, so it lands in the library
     * and the Studio's history like anything made by hand.
     */
    private function generate(FlowRun $run, string $kind, string $model, string $prompt, array $params, array $inputs = []): Asset
    {
        $generation = $run->user->generations()->create([
            'kind' => $kind, 'model' => $model, 'prompt' => $prompt, 'params' => $params,
            'input_asset_ids' => $inputs ?: null, 'status' => 'queued',
        ]);
        app(GenerationRunner::class)->start($generation);
        $generation->refresh();
        if ($generation->status !== 'succeeded') {
            throw new GenerationFailed($generation->error ?: 'That didn’t come out. Try again.');
        }

        return $generation->outputs()->first() ?? throw new GenerationFailed('Nothing came back.');
    }

    /* ------------------------------------------------------------------ */
    /* Logic */
    /* ------------------------------------------------------------------ */

    private function check(string $value, string $op, string $compare): array
    {
        $numeric = is_numeric($value) && is_numeric($compare);
        $holds = match ($op) {
            'gte' => $numeric ? (float) $value >= (float) $compare : strcmp($value, $compare) >= 0,
            'lte' => $numeric ? (float) $value <= (float) $compare : strcmp($value, $compare) <= 0,
            'eq' => $numeric ? (float) $value === (float) $compare : mb_strtolower($value) === mb_strtolower($compare),
            'contains' => $compare !== '' && str_contains(mb_strtolower($value), mb_strtolower($compare)),
            'not_contains' => $compare === '' || ! str_contains(mb_strtolower($value), mb_strtolower($compare)),
            'empty' => $value === '',
            default => false,
        };
        $words = ['gte' => 'is at least', 'lte' => 'is at most', 'eq' => 'is', 'contains' => 'contains', 'not_contains' => 'doesn’t contain', 'empty' => 'is empty'][$op] ?? $op;
        $shown = $value === '' ? '(empty)' : '“'.Str::limit($value, 40).'”';

        return ['status' => 'ok', 'port' => $holds ? 'yes' : 'no', 'summary' => $op === 'empty'
            ? "{$shown} ".($holds ? 'is empty' : 'isn’t empty').' → '.($holds ? 'yes' : 'no')
            : "{$shown} ".($holds ? '' : 'not: ').$words.' '.Str::limit($compare, 40).' → '.($holds ? 'yes' : 'no')];
    }

    private function wait(int $amount, string $unit): array
    {
        $minutes = max(1, min(60 * 24 * 30, $amount * (['minutes' => 1, 'hours' => 60, 'days' => 1440][$unit] ?? 60)));
        $until = now()->addMinutes($minutes);

        return ['status' => 'wait', 'resume_at' => $until, 'summary' => "Waiting {$amount} {$unit}, until ".$until->toIso8601ZuluString().'.'];
    }

    private function evergreen(FlowRun $run, array $c): array
    {
        $flow = $run->flow;
        $used = $flow->state['recycled'] ?? [];
        $days = max(1, (int) ($c['older_than_days'] ?? 30));
        $post = $run->user->posts()->with('account')
            ->where('status', PostStatus::Published)
            ->where('published_at', '<', now()->subDays($days))
            ->when($c['account_id'] ?? null, fn ($q, $id) => $q->where('account_id', $id))
            ->whereNotIn('id', $used ?: [0])
            ->oldest('published_at')
            ->first();
        if (! $post) {
            return $this->end("Nothing published more than {$days} days ago is left to bring back.");
        }
        $flow->update(['state' => [...$flow->state ?? [], 'recycled' => array_slice([...$used, $post->id], -500)]]);

        return ['status' => 'ok', 'summary' => 'Bringing back “'.Str::limit($post->title ?: $post->body, 80).'” from '.$post->published_at->diffForHumans().'.', 'set' => [
            'post' => $this->postVars($post),
            'account' => $post->account ? $this->accountVars($post->account) : ($run->context['account'] ?? null),
        ]];
    }

    /* ------------------------------------------------------------------ */
    /* You */
    /* ------------------------------------------------------------------ */

    private function approval(FlowRun $run, string $ask): array
    {
        $ctx = $run->context ?? [];

        $video = isset($ctx['video']['id']) ? $run->user->assets()->find($ctx['video']['id']) : null;

        return ['status' => 'approval', 'summary' => 'Waiting for you in the Inbox.', 'set' => ['_approval' => [
            'ask' => $ask ?: 'Go ahead?',
            'draft' => $ctx['draft'] ?? null,
            'account' => $ctx['account']['handle'] ?? null,
            'platform' => $ctx['account']['platform'] ?? null,
            // A reel the run made is part of what's being approved: show it.
            'media' => $video ? ['kind' => 'video', 'url' => $video->url(), 'poster_url' => $video->posterUrl(), 'duration' => $video->duration] : null,
            'since' => now()->toIso8601ZuluString(),
        ]]];
    }

    /* ------------------------------------------------------------------ */
    /* Do */
    /* ------------------------------------------------------------------ */

    private function post(FlowRun $run, array $c, string $body): array
    {
        $account = $this->account($run, $c);
        if (! $account) {
            return $this->fail('Pick the account to post on.');
        }
        if ($body === '') {
            return $this->fail('There’s no text to post. Put a “Write a post” step before this one.');
        }
        $limit = $account->platform->characterLimit();
        if (mb_strlen($body) > $limit) {
            return $this->fail('The text is '.mb_strlen($body)." characters; {$account->platform->label()} allows {$limit}.");
        }

        // The media: a reel this run made, or else what the post the run started from carried
        // (when it was on the same account).
        $ctx = $run->context ?? [];
        $reel = isset($ctx['video']['id']) ? $run->user->assets()->where('kind', 'video')->find($ctx['video']['id']) : null;
        $source = isset($ctx['post']['id']) ? $run->user->posts()->with('assets')->find($ctx['post']['id']) : null;
        $assets = $reel ? [$reel->id] : ($source && $source->account_id === $account->id ? $source->assets->pluck('id')->all() : []);
        $format = $reel ? PostFormat::Video : ($assets && $source ? $source->format : PostFormat::Text);

        // Gate 6B, flow edition: only what a person approved in this run goes on the calendar.
        $approved = isset($ctx['_approved_by']);
        $why = null;
        $at = null;
        if (($c['when'] ?? 'next_slot') === 'draft') {
            $why = 'Saved as a draft, as asked.';
        } elseif (! $approved) {
            $why = 'Saved as a draft: nobody approved it in this run. Add an “Ask me first” before this step to schedule.';
        } elseif (in_array($account->platform, self::VISUAL, true) && ! $assets) {
            $why = "Saved as a draft: {$account->platform->label()} needs an image or video. Add one in the composer, then schedule it.";
        } else {
            $at = ($c['when'] ?? 'next_slot') === 'in_hours'
                ? now()->addMinutes((int) round(max(0.25, (float) ($c['hours'] ?? 2)) * 60))
                : $this->queue->nextFree($run->user);
            if (! $at) {
                $why = 'Saved as a draft: your queue has no free posting times. Add some under Automations.';
            }
        }

        $post = $run->user->posts()->create([
            'title' => Str::limit(Str::before($body, "\n"), 60, '…'),
            'body' => $body,
            'format' => $format,
            'platforms' => [$account->platform->value],
            'account_id' => $account->id,
            'status' => $at ? PostStatus::Scheduled : PostStatus::Draft,
            'scheduled_at' => $at,
            'approved_at' => $at ? Carbon::parse($ctx['_approved_at']) : null,
            'approved_by' => $at ? $ctx['_approved_by'] : null,
        ]);
        if ($assets) {
            $post->syncAssets($assets);
        }
        ActionLog::record($run->user, "flow:{$run->flow->name}", $at ? 'post.scheduled' : 'post.draft', $post,
            ($at ? 'Scheduled “' : 'Drafted “').Str::limit($body, 48).'” for '.$account->label().'.', $at ? 'approved' : null, ['flow_run_id' => $run->id]);

        return [
            'status' => 'ok',
            'summary' => $why ?? 'Scheduled for '.$at->toIso8601ZuluString().' on '.$account->label().'.',
            'set' => ['post' => [...$ctx['post'] ?? [], 'id' => $post->id, 'scheduled_at' => $at?->toIso8601ZuluString()]],
        ];
    }

    private function sendReply(FlowRun $run, string $body): array
    {
        $comment = $this->comment($run);
        if (! $comment) {
            return $this->end('There’s no comment in this run to reply to.');
        }
        if ($comment->status === 'sent' || $comment->status === 'ignored') {
            return $this->end('That comment was already handled.');
        }
        if ($body === '') {
            return $this->fail('The reply is empty. Put a “Draft a reply” step before this one.');
        }
        $account = $comment->account;
        if ($this->autonomy->decide($account, 'comment.send_reply', ['today' => $account->repliesSentToday()]) === 'run') {
            $comment->update(['reply' => $body, 'draft' => $body, 'status' => 'sent', 'sent_at' => now()]);
            ActionLog::record($run->user, "flow:{$run->flow->name}", 'comment.auto_replied', $comment, "Replied to @{$comment->author} by a mode-B rule.", 'auto');

            return ['status' => 'ok', 'summary' => "Sent to @{$comment->author}: a mode-B rule allows replies on {$account->label()}."];
        }
        $comment->update(['draft' => $body, 'status' => 'drafted', 'triage' => ['decision' => 'reply', 'reason' => "Drafted by the flow “{$run->flow->name}”."]]);

        return ['status' => 'ok', 'summary' => "Drafted for @{$comment->author}. No rule lets replies go out alone here, so it waits for you in Comments."];
    }

    private function reschedule(FlowRun $run): array
    {
        $post = isset($run->context['post']['id']) ? $run->user->posts()->find($run->context['post']['id']) : null;
        if (! $post) {
            return $this->end('There’s no post in this run to try again.');
        }
        if ($post->status !== PostStatus::Failed) {
            return $this->end('The post isn’t failed any more: nothing to do.');
        }
        $at = $this->queue->nextFree($run->user, $post->id);
        if (! $at) {
            return $this->fail('Your queue has no free posting times. Add some under Automations.');
        }
        $post->update(['status' => PostStatus::Scheduled, 'scheduled_at' => $at, 'error' => null]);
        ActionLog::record($run->user, "flow:{$run->flow->name}", 'publish.rescheduled', $post, 'Moved the failed post to '.$at->toIso8601ZuluString().'.', 'auto');

        return ['status' => 'ok', 'summary' => 'Back on the calendar for '.$at->toIso8601ZuluString().'.', 'set' => ['post' => [...$run->context['post'], 'scheduled_at' => $at->toIso8601ZuluString()]]];
    }

    private function hold(FlowRun $run, array $c, string $reason): array
    {
        $account = $this->account($run, $c);
        if (! $account) {
            return $this->fail('Pick the account to freeze.');
        }
        if ($account->isHeld()) {
            return ['status' => 'ok', 'summary' => "{$account->label()} was already frozen."];
        }
        $account->update(['storm_at' => now(), 'storm_reason' => Str::limit($reason ?: 'Held by a flow.', 290)]);
        ActionLog::record($run->user, "flow:{$run->flow->name}", 'storm.held', $account, "Froze publishing on {$account->label()}: {$reason}", 'auto');

        return ['status' => 'ok', 'summary' => "Froze {$account->label()}: nothing publishes there until you give the all clear."];
    }

    private function pauseAll(FlowRun $run): array
    {
        $user = $run->user;
        if (! $user->publishingPaused()) {
            $user->forceFill(['publishing_paused_at' => now()])->save();
            ActionLog::record($user, "flow:{$run->flow->name}", 'publishing.paused', null, 'Pressed the stop button: all automated publishing is paused.', 'auto');
        }

        return ['status' => 'ok', 'summary' => 'All automated publishing is paused.'];
    }

    private function remember(FlowRun $run, array $c, string $content): array
    {
        $account = $this->account($run, $c);
        if (! $account) {
            return $this->fail('Pick the account to teach.');
        }
        if ($content === '') {
            return $this->end('Nothing to remember: the text is empty.');
        }
        $kind = ($c['kind'] ?? 'example') === 'instruction' ? 'instruction' : 'example';
        $account->memories()->create(['kind' => $kind, 'content' => Str::limit($content, 1500), 'source' => 'flow', 'meta' => ['flow_run_id' => $run->id]]);

        return ['status' => 'ok', 'summary' => ($kind === 'example' ? 'Kept as a liked example' : 'Kept as an instruction')." for {$account->label()}."];
    }

    private function notify(FlowRun $run, string $message): array
    {
        $message = $message ?: "“{$run->flow->name}” got here.";
        $run->user->inboxNotes()->create([
            'flow_run_id' => $run->id,
            'title' => Str::limit(Str::before($message, "\n"), 190),
            'detail' => Str::contains($message, "\n") ? Str::limit(Str::after($message, "\n"), 1000) : "From the flow “{$run->flow->name}”.",
            'tone' => 'plan',
            'link' => "/dashboard/flows?id={$run->flow_id}&run={$run->id}",
        ]);

        return ['status' => 'ok', 'summary' => 'Left you a note: “'.Str::limit($message, 100).'”'];
    }

    private function webhook(FlowRun $run, string $url, string $message): array
    {
        if ($url === '') {
            return ['status' => 'ok', 'summary' => 'No webhook URL yet: skipped.'];
        }
        if ($problem = SafeUrl::problem($url)) {
            return $this->fail($problem);
        }
        $text = $message ?: "“{$run->flow->name}” ran: {$run->cause}";
        try {
            $response = Http::timeout(8)->acceptJson()->post($url, [
                'text' => $text, // Slack, Mattermost, Google Chat
                'content' => Str::limit($text, 1990), // Discord
                'flow' => $run->flow->name,
                'run_id' => $run->id,
                'cause' => $run->cause,
                'draft' => $run->context['draft'] ?? null,
            ]);
        } catch (Throwable $e) {
            return $this->fail('The webhook didn’t answer: '.Str::limit($e->getMessage(), 120));
        }
        if ($response->failed()) {
            return $this->fail("The webhook answered {$response->status()}.");
        }

        return ['status' => 'ok', 'summary' => 'Sent to '.parse_url($url, PHP_URL_HOST)." ({$response->status()})."];
    }

    /* ------------------------------------------------------------------ */

    /** The node's account, or else the account the run is about. */
    private function account(FlowRun $run, array $c): ?Account
    {
        $id = $c['account_id'] ?? ($run->context['account']['id'] ?? null);

        return $id ? $run->user->accounts()->find($id) : null;
    }

    private function comment(FlowRun $run): ?Comment
    {
        $id = $run->context['comment']['id'] ?? null;

        return $id ? $run->user->comments()->with('account')->find($id) : null;
    }

    /** Collect a whole post from the model, trimmed. */
    private function compose(FlowRun $run, PostPrompt $prompt, string $purpose): string
    {
        [$generator, $model] = $this->brain();
        $text = $this->usage->within($run->user, $run, $purpose, function () use ($generator, $model, $prompt) {
            $out = '';
            foreach ($generator->stream($model, $prompt->system(), $prompt->user()) as $chunk) {
                $out .= $chunk;
            }

            return $out;
        });
        $text = trim(preg_replace('/^["“]|["”]$/u', '', trim($text)));
        if ($text === '') {
            throw new GenerationFailed('The model wrote nothing. Try again, or switch model.');
        }

        return $text;
    }

    private function askJson(FlowRun $run, string $system, string $prompt, array $schema, string $purpose): array
    {
        [$generator, $model] = $this->brain();

        return $this->usage->within($run->user, $run, $purpose, fn () => $generator->json($model, $system, $prompt, $schema));
    }

    /** The agents' model when it can run, or else whatever text model can. */
    private function brain(): array
    {
        $agents = (string) config('ai.agents.model');
        $model = ($this->models->find($agents)['available'] ?? false) ? $agents : $this->models->defaultText();

        return $this->models->text($model);
    }

    private function fail(string $why): array
    {
        return ['status' => 'fail', 'summary' => $why];
    }

    private function end(string $why): array
    {
        return ['status' => 'end', 'summary' => $why];
    }

    /** @return array<string, mixed> */
    public function postVars(Post $post): array
    {
        return [
            'id' => $post->id,
            'title' => $post->title,
            'body' => $post->body,
            'url' => $post->post_url,
            'error' => $post->error,
            'format' => $post->format->value,
        ];
    }

    /** @return array<string, mixed> */
    public function accountVars(Account $account): array
    {
        return ['id' => $account->id, 'handle' => $account->handle, 'platform' => $account->platform->value];
    }
}

<?php

namespace App\Services\Publishing;

use App\Enums\PostStatus;
use App\Jobs\PublishPost;
use App\Models\Account;
use App\Models\ActionLog;
use App\Models\Asset;
use App\Models\Device;
use App\Models\Post;
use App\Models\PublishingRun;
use App\Models\User;
use App\Services\Flows\Flows;
use App\Services\Media\AssetStore;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * The publisher. When a post's time comes it books the phone (one job at a time, R8), and the
 * run goes: transfer the media, open the app, caption in, tap Publish, then read the screen —
 * because sending the command is not the same as publishing. Proof ends the run as confirmed;
 * no proof is an honest uncertain; failure waits, then tries again (R3), and after the last
 * attempt it goes to a person.
 *
 * Simulator phones are driven in-process (see PublishPost). HTTP phones are driven by the
 * external automation agent: it picks the booked run up, reports steps and a screenshot, and
 * finishes it. Either way the record is the same shape.
 */
class Publisher
{
    public function __construct(private readonly AssetStore $assets) {}

    /**
     * Every minute: start the posts whose time has come. Returns how many runs started.
     */
    public function dispatchDue(): int
    {
        $posts = Post::with(['account.device', 'user'])
            ->where('status', PostStatus::Scheduled)
            ->where('scheduled_at', '<=', now())
            ->whereNotNull('approved_at') // only approved content publishes automatically (gate 6B)
            ->whereHas('account', fn ($q) => $q->where('automation', true)->whereNotNull('device_id'))
            ->oldest('scheduled_at')
            ->limit(20)
            ->get();

        $started = 0;
        foreach ($posts as $post) {
            $latest = $post->runs()->latest('id')->first();
            if ($latest?->isRunning()) {
                continue;
            }
            $attempt = $latest?->status === 'failed' ? $latest->attempt + 1 : 1;
            if ($attempt > (int) config('publishing.max_attempts')) {
                $this->failForGood($post, 'Every attempt failed. Take over and post it by hand, or try again.');

                continue;
            }
            if ($this->open($post, $attempt)) {
                $started++;
            }
        }

        return $started;
    }

    /**
     * Open a run: guard, book the phone atomically, mark the post publishing. Null when the
     * phone is busy — the post stays scheduled and the next minute tries again.
     */
    public function open(Post $post, int $attempt = 1): ?PublishingRun
    {
        $post->loadMissing(['account.device', 'user']);
        $account = $post->account;
        $device = $account?->device;
        if (! $account || ! $device || ! $post->isApproved() || ! $account->automation) {
            return null;
        }
        if ($post->user->publishingPaused() || $device->isPaused()) {
            return null; // the stop button: nothing starts while it's pressed
        }
        // Storm Guard: a frozen account holds everything approved before the storm. What a
        // person approves during it (a holding statement) was approved knowing, so it goes.
        if ($account->isHeld() && $post->approved_at->lessThan($account->storm_at)) {
            return null;
        }

        $run = $post->runs()->create([
            'user_id' => $post->user_id,
            'device_id' => $device->id,
            'attempt' => $attempt,
            'goal' => Str::limit(trim($post->title ?: $post->body), 140, ''),
            'started_at' => now(),
        ]);

        // One job per phone: taken and released with conditional updates, never read-then-write.
        $booked = Device::whereKey($device->id)->whereNull('booked_run_id')
            ->update(['booked_run_id' => $run->id, 'booked_at' => now(), 'status' => 'busy']);
        if (! $booked) {
            $run->delete();

            return null;
        }

        $post->update(['status' => PostStatus::Publishing, 'error' => null]);
        if ($device->driver === 'simulator') {
            PublishPost::dispatch($run->id);
        }

        return $run;
    }

    /**
     * Drive a simulator run to the end. The queue worker calls this; an HTTP phone's run is
     * driven by the agent instead, through nextJob/addSteps/attachScreenshot/finish.
     */
    public function runOnSimulator(PublishingRun $run): void
    {
        $run->loadMissing(['post.assets', 'post.account.device', 'device']);
        $post = $run->post;
        $device = $run->device;
        $account = $post->account;
        $app = config('publishing.apps.'.$account->platform->value) ?? ['package' => 'unknown', 'targets' => []];
        $phone = Phones::simulator($device, $post->body);
        $budget = (int) config('publishing.step_budget');
        $deadline = microtime(true) + (int) config('publishing.hard_timeout_seconds');

        try {
            $this->timed($run, 'app-stop', fn () => null); // start cold
            foreach ($post->assets as $asset) {
                $this->timed($run, 'transfer', fn () => $phone->transfer(
                    (string) Storage::disk('local')->get($asset->path), $asset->name ?? "asset-{$asset->id}", $asset->mime));
            }
            $this->timed($run, 'app-start', fn () => $phone->appStart($app['package']));
            $this->timed($run, 'tap:compose-button', fn () => $phone->tap('compose-button'));
            if ($post->assets->isNotEmpty()) {
                $this->timed($run, 'tap:media-picker', fn () => $phone->tap('media-picker'));
            }
            $this->timed($run, 'type', fn () => $phone->type($post->body));
            $this->timed($run, 'tap:post-button', fn () => $phone->tap('post-button'));
            $shot = $this->timed($run, 'screenshot', fn () => $phone->screenshot());

            if (count($run->steps ?? []) > $budget || microtime(true) > $deadline) {
                throw new PhoneFailed('The run ran out of budget: too many steps, or too slow.');
            }

            $this->settleFromScreen($run, $shot);
        } catch (PhoneFailed $e) {
            $this->fail($run, $e->getMessage());
        }
    }

    /** The automation agent's next job: the run booked on its phone, with everything it needs. */
    public function nextJob(Device $device): ?array
    {
        $run = PublishingRun::with(['post.assets', 'post.account'])->where('device_id', $device->id)->where('status', 'running')->latest('id')->first();
        if (! $run || $device->isPaused() || $run->user->publishingPaused()) {
            return null;
        }
        $account = $run->post->account;
        $app = config('publishing.apps.'.$account->platform->value) ?? ['package' => 'unknown', 'targets' => []];

        return [
            'run_id' => $run->uuid,
            'goal' => $run->goal,
            'account' => ['platform' => $account->platform->value, 'handle' => $account->handle, 'app' => $app],
            'post' => ['caption' => $run->post->body, 'format' => $run->post->format->value, 'placement' => $run->post->placement],
            'media' => $run->post->assets->map(fn (Asset $a) => ['id' => $a->id, 'kind' => $a->kind, 'mime' => $a->mime, 'url' => "/api/agent/assets/{$a->id}/file"])->values()->all(),
            // R7: the budget the run must stay within, so the agent doesn't have to guess.
            'limits' => ['step_budget' => (int) config('publishing.step_budget'), 'hard_timeout_seconds' => (int) config('publishing.hard_timeout_seconds')],
        ];
    }

    /**
     * Steps the agent reports, appended to the record.
     *
     * @param  list<array{action: string, ok: bool, ms: int, note?: string}>  $steps
     */
    public function addSteps(PublishingRun $run, array $steps): void
    {
        foreach ($steps as $step) {
            $run->step((string) $step['action'], (bool) $step['ok'], (int) $step['ms'], $step['note'] ?? null);
        }
        $run->touch(); // a heartbeat: the sweep leaves reporting runs alone
        $run->save();
    }

    /** Keep the agent's screenshot as the run's and the phone's latest. */
    public function attachScreenshot(PublishingRun $run, string $contents, string $mime = 'image/png'): Asset
    {
        $asset = $this->assets->fromContents($run->user, $contents, $mime, "run-{$run->uuid}.png", 'screenshot', ['run_id' => $run->uuid]);
        $run->update(['screenshot_id' => $asset->id]);
        $run->device?->update(['last_screenshot' => $asset->path, 'last_seen_at' => now()]);

        return $asset;
    }

    /** End an agent-driven run: confirmed with proof, failed (it tries again later), or uncertain. */
    public function finish(PublishingRun $run, string $outcome, ?string $postUrl, ?string $note): void
    {
        abort_unless($run->isRunning(), 409, 'This run already ended.');
        match ($outcome) {
            'confirmed' => $this->settle($run, true, $postUrl, $note),
            'uncertain' => $this->uncertain($run, $note),
            default => $this->fail($run, $note ?: 'The agent reported failure.'),
        };
    }

    /** The operator tries a failed (or unconfirmed) post again: a fresh attempt, right away. */
    public function retry(Post $post): ?PublishingRun
    {
        abort_unless(in_array($post->status, [PostStatus::Failed, PostStatus::Submitted], true), 422, 'Only a failed or unconfirmed post can be tried again.');
        $run = $this->open($post, 1);
        if (! $run) {
            $post->update(['status' => $post->status]); // keep it where a person can see it
            abort_if($post->account?->device?->booked_run_id, 409, 'The phone is busy with another post. It starts as soon as it’s free.');
            abort(422, 'This post can’t publish automatically: it needs approval, automation on, and a phone that isn’t paused.');
        }
        ActionLog::record($post->user, 'you', 'publish.retry', $post, "Trying “{$run->goal}” again.", 'approved');

        return $run;
    }

    /** The operator checked the account themselves: it is live, here is the proof. */
    public function confirmLive(Post $post, string $postUrl, User $by): void
    {
        abort_unless(in_array($post->status, [PostStatus::Submitted, PostStatus::Failed, PostStatus::Publishing], true), 422, 'This post is already confirmed.');
        $run = $post->runs()->where('status', 'running')->latest('id')->first();
        if ($run) {
            $this->settle($run, true, $postUrl, 'Confirmed by hand.');
        } else {
            $post->update(['status' => PostStatus::Published, 'published_at' => now(), 'post_url' => $postUrl, 'error' => null]);
        }
        ActionLog::record($by, 'you', 'publish.confirmed', $post, 'Confirmed live by hand: '.$postUrl, 'approved');
    }

    /**
     * A run that reports nothing goes stale: release the phone and end it honestly —
     * uncertain if it got as far as tapping Publish, failed (and retried) otherwise.
     */
    public function sweepStale(): int
    {
        $stale = PublishingRun::with(['post', 'device'])->where('status', 'running')
            ->where('updated_at', '<', now()->subMinutes((int) config('publishing.stale_minutes')))->get();
        foreach ($stale as $run) {
            $published = collect($run->steps ?? [])->contains(fn ($s) => str_contains((string) $s['action'], 'post-button') && $s['ok']);
            $published ? $this->uncertain($run, 'The agent went quiet after tapping Publish.') : $this->fail($run, 'The agent went quiet before finishing.');
        }

        return $stale->count();
    }

    /* ------------------------------------------------------------------ */

    /** Time one step and put it on the record; a thrown PhoneFailed already carries why. */
    private function timed(PublishingRun $run, string $action, callable $do): mixed
    {
        $started = microtime(true);
        try {
            $out = $do();
            $run->step($action, true, (int) round((microtime(true) - $started) * 1000));
            $run->save();

            return $out;
        } catch (PhoneFailed $e) {
            $run->step($action, false, (int) round((microtime(true) - $started) * 1000), $e->getMessage());
            $run->save();

            throw $e;
        }
    }

    /** The screenshot decides: the caption on screen is proof; anything else is not. */
    private function settleFromScreen(PublishingRun $run, array $shot): void
    {
        $asset = $this->attachScreenshot($run, $shot['png']);
        $needle = Str::limit(trim($run->post->body), 40, '');
        $live = $shot['text'] !== null && $needle !== '' && str_contains($shot['text'], $needle);
        if ($live) {
            $this->settle($run, true, null, 'The caption is on the account’s screen.');
        } else {
            $this->uncertain($run, 'The screen shows no proof the post went live.');
        }
    }

    /** Proven live: the post is Published, with the evidence on the record. */
    private function settle(PublishingRun $run, bool $ok, ?string $postUrl, ?string $note): void
    {
        $post = $run->post;
        $run->update([
            'status' => 'confirmed',
            'evidence' => array_filter([
                'kind' => $postUrl ? 'post_url' : 'screenshot',
                'ref' => $postUrl ?: ($run->screenshot_id ? "/api/assets/{$run->screenshot_id}/file" : null),
                'note' => $note,
            ]),
            'ended_at' => now(),
        ]);
        $post->update(['status' => PostStatus::Published, 'published_at' => now(), 'post_url' => $postUrl, 'error' => null]);
        $this->release($run);
        ActionLog::record($run->user, 'agent:publisher', 'publish.confirmed', $post, "Published “{$run->goal}”".($postUrl ? ": {$postUrl}" : ' (screenshot proof).'), 'auto');
        // Flows listening for "a post goes live". A broken flow never breaks publishing.
        rescue(fn () => app(Flows::class)->postPublished($post->fresh()));
    }

    /** Told to post, nothing proves it: Submitted, and the Inbox asks a person to look. */
    private function uncertain(PublishingRun $run, ?string $note): void
    {
        $run->update([
            'status' => 'uncertain',
            'evidence' => array_filter(['kind' => 'screenshot', 'ref' => $run->screenshot_id ? "/api/assets/{$run->screenshot_id}/file" : null, 'note' => $note]),
            'error' => $note,
            'ended_at' => now(),
        ]);
        $run->post->update(['status' => PostStatus::Submitted, 'error' => $note]);
        $this->release($run);
        ActionLog::record($run->user, 'agent:publisher', 'publish.uncertain', $run->post, "Not confirmed live: “{$run->goal}”. {$note}", 'queued');
    }

    /** It failed: release the phone, wait (R3), and either try again or hand it to a person. */
    private function fail(PublishingRun $run, string $why): void
    {
        $run->update(['status' => 'failed', 'error' => $why, 'ended_at' => now()]);
        $this->release($run);
        $post = $run->post;
        if ($run->attempt >= (int) config('publishing.max_attempts')) {
            $this->failForGood($post, $why);

            return;
        }
        $wait = config('publishing.backoff_minutes')[$run->attempt - 1] ?? 30;
        $post->update(['status' => PostStatus::Scheduled, 'scheduled_at' => now()->addMinutes($wait), 'error' => $why]);
        ActionLog::record($run->user, 'agent:publisher', 'publish.retry_scheduled', $post, "Attempt {$run->attempt} failed: {$why} Trying again in {$wait} minutes.", 'auto');
    }

    private function failForGood(Post $post, string $why): void
    {
        $post->update(['status' => PostStatus::Failed, 'error' => $why]);
        ActionLog::record($post->user, 'agent:publisher', 'publish.failed', $post, 'Couldn’t publish: '.$why, 'queued');
        rescue(fn () => app(Flows::class)->postFailed($post->fresh()));
    }

    private function release(PublishingRun $run): void
    {
        Device::whereKey($run->device_id)->where('booked_run_id', $run->id)
            ->update(['booked_run_id' => null, 'booked_at' => null, 'status' => 'idle', 'last_seen_at' => now()]);
    }
}

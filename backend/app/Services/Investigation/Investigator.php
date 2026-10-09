<?php

namespace App\Services\Investigation;

use App\Enums\PostStatus;
use App\Models\Device;
use App\Models\Investigation;
use App\Models\Post;
use App\Models\PublishingRun;
use App\Services\Ai\Models\ModelRegistry;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * The investigator (area 12): collect → compare → validate → report. It lines up what the
 * studio claims happened — posts published, runs confirmed — against the evidence that
 * actually exists, and reports what's worth a person's attention. Validation uses the AI
 * when it can; otherwise the compare stage's own verdicts stand.
 */
class Investigator
{
    public function __construct(private readonly ModelRegistry $models) {}

    /**
     * Whether any text model can weigh the findings.
     */
    private function aiAvailable(): bool
    {
        return $this->models->availableText((string) config('ai.default_text')) !== null;
    }

    public function run(Investigation $inv): void
    {
        try {
            $t = microtime(true);
            [$posts, $runs, $devices] = $this->collect($inv);
            $inv->stageDone('collect', "{$posts->count()} posts, {$runs->count()} runs, {$devices->count()} phones", $t);

            $t = microtime(true);
            $findings = $this->compare($inv, $posts, $runs, $devices);
            $inv->stageDone('compare', count($findings).' things to check', $t);

            $t = microtime(true);
            $findings = $this->validate($inv, $findings);
            $inv->update(['findings' => $findings]);
            $inv->stageDone('validate', $this->aiAvailable() ? 'The AI weighed each finding' : 'No AI: the compare verdicts stand', $t);

            $t = microtime(true);
            $issues = collect($findings)->where('verdict', 'issue')->count();
            $inv->update([
                'counts' => ['posts' => $posts->count(), 'runs' => $runs->count(), 'devices' => $devices->count(), 'issues' => $issues],
                'report' => $this->report($inv, $findings),
                'status' => 'done',
            ]);
            $inv->stageDone('report', $issues === 0 ? 'Clean: nothing needs a person' : "{$issues} ".Str::plural('issue', $issues).' for a person', $t);
        } catch (\Throwable $e) {
            $inv->update(['status' => 'failed', 'error' => Str::limit($e->getMessage(), 500)]);
        }
    }

    /* ------------------------------------------------------------------ */

    /** What's in scope: recent posts and runs (the account's, or the whole studio's), and the phones. */
    private function collect(Investigation $inv): array
    {
        $user = $inv->user;
        $posts = Post::with('account.device')->where('user_id', $user->id)
            ->when($inv->account_id, fn ($q) => $q->where('account_id', $inv->account_id))
            ->latest('id')->limit(200)->get();
        $runs = PublishingRun::with('post')->where('user_id', $user->id)
            ->when($inv->account_id, fn ($q) => $q->whereHas('post', fn ($p) => $p->where('account_id', $inv->account_id)))
            ->latest('id')->limit(200)->get();
        $devices = $inv->account_id
            ? Device::where('user_id', $user->id)->whereHas('accounts', fn ($a) => $a->where('accounts.id', $inv->account_id))->get()
            : Device::where('user_id', $user->id)->get();

        return [$posts, $runs, $devices];
    }

    /**
     * The claims against the proof. Every finding is concrete: rule, severity, what, and why.
     *
     * @return list<array<string, mixed>>
     */
    private function compare(Investigation $inv, Collection $posts, Collection $runs, Collection $devices): array
    {
        $findings = [];

        foreach ($posts as $post) {
            $account = $post->account?->label() ?? 'no account';
            if ($post->status === PostStatus::Published) {
                $proof = $post->post_url || $runs->where('post_id', $post->id)->contains(fn ($r) => $r->status === 'confirmed' && ! empty($r->evidence));
                if (! $proof) {
                    $findings[] = ['rule' => 'published_without_proof', 'severity' => 'high',
                        'subject' => '“'.Str::limit($post->title ?: $post->body, 60)."” on {$account}",
                        'detail' => 'Marked published, but nothing proves it: no post URL and no confirmed run with evidence.'];
                }
            }
            if ($post->status === PostStatus::Submitted && $post->updated_at?->lt(now()->subDay())) {
                $findings[] = ['rule' => 'unconfirmed_aging', 'severity' => 'medium',
                    'subject' => '“'.Str::limit($post->title ?: $post->body, 60)."” on {$account}",
                    'detail' => 'Told to post over a day ago, still unconfirmed. Nobody has checked the account.'];
            }
            if ($post->status === PostStatus::Failed) {
                $findings[] = ['rule' => 'failed_waiting', 'severity' => 'medium',
                    'subject' => '“'.Str::limit($post->title ?: $post->body, 60)."” on {$account}",
                    'detail' => 'Every attempt failed: '.Str::limit($post->error ?: 'no error recorded', 120)];
            }
        }

        foreach ($runs->where('status', 'uncertain') as $run) {
            $findings[] = ['rule' => 'uncertain_run', 'severity' => 'medium',
                'subject' => '“'.Str::limit($run->goal, 60).'”',
                'detail' => 'The phone was told to post but proved nothing: '.$run->error];
        }

        foreach ($devices as $device) {
            if ($device->isPaused() && $device->accounts->contains(fn ($a) => $a->automation)) {
                $findings[] = ['rule' => 'paused_with_automation', 'severity' => 'low',
                    'subject' => $device->name,
                    'detail' => 'The phone is paused, but accounts on it still publish automatically: nothing will go out.'];
            }
        }
        // Accounts with automation on and no phone at all.
        foreach ($inv->user->accounts()->where('automation', true)->whereNull('device_id')->get() as $account) {
            if ($inv->account_id && $account->id !== $inv->account_id) {
                continue;
            }
            $findings[] = ['rule' => 'automation_without_phone', 'severity' => 'medium',
                'subject' => $account->label(),
                'detail' => 'Publishes automatically, but has no phone: due posts will wait forever.'];
        }

        return $findings;
    }

    /**
     * The AI weighs each finding — real problem, or explainable — and writes a note. Without
     * AI the compare verdicts stand, which errs on the side of showing a person everything.
     *
     * @param  list<array<string, mixed>>  $findings
     * @return list<array<string, mixed>>
     */
    private function validate(Investigation $inv, array $findings): array
    {
        if (! $findings || ! $this->aiAvailable() || ! $inv->user->hasVerifiedEmail()) {
            return array_map(fn ($f) => $f + ['verdict' => 'issue', 'note' => null], $findings);
        }

        [$ai, $model] = $this->models->text($this->models->defaultText());
        $reply = $ai->json(
            $model,
            'You are the studio’s investigator. You are given findings from comparing publishing records with their evidence. '
                .'Judge each: is it a real problem that needs a person (issue), or explainable and fine (explained)? '
                .'Be strict about proof of publishing — a post marked live without evidence is always an issue. One short note each.',
            "Findings:\n".collect($findings)->map(fn ($f, $i) => "{$i}. [{$f['severity']}] {$f['rule']}: {$f['subject']} — {$f['detail']}")->implode("\n"),
            [
                'type' => 'object',
                'properties' => [
                    'verdicts' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                        'index' => ['type' => 'integer'],
                        'verdict' => ['type' => 'string', 'enum' => ['issue', 'explained']],
                        'note' => ['type' => 'string'],
                    ], 'required' => ['index', 'verdict', 'note'], 'additionalProperties' => false]],
                ],
                'required' => ['verdicts'],
                'additionalProperties' => false,
            ],
        );

        $byIndex = collect($reply['verdicts'] ?? [])->keyBy('index');

        return array_map(function ($f, $i) use ($byIndex) {
            $v = $byIndex->get($i);

            return $f + [
                'verdict' => in_array($v['verdict'] ?? null, ['issue', 'explained'], true) ? $v['verdict'] : 'issue',
                'note' => is_string($v['note'] ?? null) ? Str::limit($v['note'], 300) : null,
            ];
        }, $findings, array_keys($findings));
    }

    /** The report, as markdown: scope, counts, the issues first, then the explained. */
    private function report(Investigation $inv, array $findings): string
    {
        $scope = $inv->account ? $inv->account->label() : 'the whole studio';
        $issues = collect($findings)->where('verdict', 'issue')->sortByDesc('severity')->values();
        $explained = collect($findings)->where('verdict', 'explained')->values();

        $md = "# Investigation: {$scope}\n\n";
        $md .= 'Ran '.$inv->created_at->toDayDateTimeString()." — collect → compare → validate → report.\n\n";
        $md .= '**'.$issues->count().' '.Str::plural('issue', $issues->count()).'** to look at, '.$explained->count()." explained.\n";

        if ($issues->isNotEmpty()) {
            $md .= "\n## Needs a person\n";
            foreach ($issues as $f) {
                $md .= "\n- **[{$f['severity']}]** {$f['subject']}\n  {$f['detail']}".($f['note'] ? "\n  _{$f['note']}_" : '');
            }
        }
        if ($explained->isNotEmpty()) {
            $md .= "\n\n## Checked, fine\n";
            foreach ($explained as $f) {
                $md .= "\n- {$f['subject']}".($f['note'] ? " — {$f['note']}" : '');
            }
        }
        if ($findings === []) {
            $md .= "\nNothing out of place. The records and the evidence agree.\n";
        }

        return $md;
    }
}

<?php

namespace App\Services\Studio;

use App\Models\Account;
use App\Models\AutonomyRule;
use Illuminate\Support\Str;

/**
 * Mode A prepares everything and a person approves every action. Mode B lets actions run on
 * their own when a rule the operator approved covers them — and anything no rule covers waits
 * for a person: that waiting list is the exception queue, and it is just the Inbox.
 *
 * The matrix (ACTIONS) documents every kind of action the studio can take and what each mode
 * does with it; `decide()` is what enforces it at the moment an action could run.
 */
class Autonomy
{
    /** What runs on its own, per action kind. mode_a is always "ask": a person decides. */
    public const ACTIONS = [
        'publish.approved_post' => [
            'label' => 'Publish approved posts',
            'detail' => 'A post that passed gate 6B goes out from the account’s phone at its time.',
            'mode_b' => 'Runs when the account’s “publish automatically” switch is on.',
        ],
        'profile.apply_ai_change' => [
            'label' => 'Apply AI profile changes',
            'detail' => 'Changes the AI proposes to the account’s voice profile apply without asking.',
            'mode_b' => 'Runs when a rule allows it.',
        ],
        'comment.send_reply' => [
            'label' => 'Send comment replies',
            'detail' => 'A reply the AI drafted for a comment is sent without a per-reply approval.',
            'mode_b' => 'Runs when a rule allows it.',
        ],
        'repost.schedule' => [
            'label' => 'Schedule adapted reposts',
            'detail' => 'A repost with recorded permission and attribution is scheduled without asking.',
            'mode_b' => 'Runs when a rule allows it.',
        ],
        'flow.schedule_post' => [
            'label' => 'Schedule posts from flows',
            'detail' => 'A flow puts a post it wrote on the calendar.',
            'mode_b' => 'Never on its own: a flow schedules only what a person approved in the run.',
        ],
    ];

    /** Kinds a rule can govern (publishing keeps its own switch; gate 6B is always a person). */
    public const RULEABLE = ['profile.apply_ai_change', 'comment.send_reply', 'repost.schedule'];

    /**
     * May this action run on its own right now? Mode A never; mode B when a rule covers it
     * (a deny rule carves out exceptions). Anything else asks a person.
     */
    public function decide(Account $account, string $action, array $context = []): string
    {
        if ($account->autonomy !== 'rules') {
            return 'ask';
        }

        $rules = $account->rules()->where('action', $action)->get();
        foreach ($rules as $rule) {
            if (! $rule->allow && $rule->matches($context)) {
                return 'ask';
            }
        }
        foreach ($rules as $rule) {
            if ($rule->allow && $rule->matches($context)) {
                return 'run';
            }
        }

        return 'ask';
    }

    /** The rule that would decide an action, for the preview. Null when none covers it. */
    public function matchedRule(Account $account, string $action, array $context = []): ?AutonomyRule
    {
        return $account->rules()->where('action', $action)->get()->first(fn (AutonomyRule $r) => $r->matches($context) && $r->allow);
    }

    /**
     * The action matrix for one account: every action kind, what each mode does with it, and
     * what would happen right now with the account's current mode and rules.
     *
     * @return list<array{action: string, label: string, detail: string, mode_a: string, mode_b: string, now: string, rule_id: int|null}>
     */
    public function matrix(Account $account): array
    {
        $modeB = $account->autonomy === 'rules';
        $rows = [];
        foreach (self::ACTIONS as $action => $info) {
            if ($action === 'publish.approved_post') {
                $now = $account->automation ? 'runs' : 'asks';
                $ruleId = null;
            } else {
                $now = $modeB && $this->decide($account, $action) === 'run' ? 'runs' : 'asks';
                $ruleId = $modeB ? $this->matchedRule($account, $action)?->id : null;
            }
            $rows[] = [
                'action' => $action,
                'label' => $info['label'],
                'detail' => $info['detail'],
                'mode_a' => 'Waits for a person, every time.',
                'mode_b' => $info['mode_b'],
                'now' => $now,
                'rule_id' => $ruleId,
            ];
        }

        return $rows;
    }

    /**
     * The policy preview: what the current mode and rules would do with the things actually
     * waiting right now — before the operator turns anything on.
     *
     * @return list<array{kind: string, label: string, verdict: string}>
     */
    public function preview(Account $account): array
    {
        $out = [];
        foreach ($account->profileChanges()->where('status', 'pending')->where('source', 'ai')->limit(5)->get() as $change) {
            $run = $this->decide($account, 'profile.apply_ai_change') === 'run';
            $out[] = [
                'kind' => 'profile.apply_ai_change',
                'label' => "Change {$change->field} to “{$change->to}”",
                'verdict' => $run ? 'Would apply on its own' : 'Would wait for you',
            ];
        }
        foreach ($account->comments()->where('status', 'drafted')->limit(5)->get() as $comment) {
            $run = $this->decide($account, 'comment.send_reply', ['today' => $comment->account->repliesSentToday()]) === 'run';
            $out[] = [
                'kind' => 'comment.send_reply',
                'label' => 'Reply to @'.$comment->author.': “'.Str::limit((string) $comment->draft, 60).'”',
                'verdict' => $run ? 'Would send on its own' : 'Would wait for you',
            ];
        }
        foreach ($account->reposts()->where('status', 'adapted')->limit(5)->get() as $repost) {
            $run = $this->decide($account, 'repost.schedule') === 'run';
            $out[] = [
                'kind' => 'repost.schedule',
                'label' => 'Schedule the repost of @'.$repost->author,
                'verdict' => $run ? 'Would schedule on its own' : 'Would wait for you',
            ];
        }

        return $out;
    }
}

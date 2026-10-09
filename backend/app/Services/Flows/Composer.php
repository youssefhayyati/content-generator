<?php

namespace App\Services\Flows;

use App\Models\Account;
use App\Models\User;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * "Say it": the operator describes an automation in their own words and gets a flow back —
 * nodes, settings and lines — ready to look at on the canvas before anything is saved.
 *
 * The model answers in a flat, strict-schema-friendly shape (steps that each name the step
 * they follow and the port they leave it by, settings as key/value pairs); everything it says
 * then goes through the same normalisation as a hand-drawn graph, and an approval is put in
 * front of any post it would schedule.
 */
class Composer
{
    public function __construct(private readonly ModelRegistry $models, private readonly UsageMeter $usage) {}

    /**
     * @return array{name: string, description: string, graph: array}
     *
     * @throws GenerationFailed|ValidationException
     */
    public function compose(User $user, string $request): array
    {
        $accounts = $user->accounts()->get();
        $types = array_keys(Catalog::nodes());

        $agents = (string) config('ai.agents.model');
        [$generator, $model] = $this->models->text(($this->models->find($agents)['available'] ?? false) ? $agents : $this->models->defaultText());

        $answer = $this->usage->within($user, null, 'flow:compose', fn () => $generator->json(
            $model,
            $this->system(),
            $this->context($user, $accounts->all())."\n\n## What the operator wants\n".trim($request),
            [
                'type' => 'object',
                'properties' => [
                    'name' => ['type' => 'string', 'description' => 'A short name for the flow, 2-4 words.'],
                    'description' => ['type' => 'string', 'description' => 'One sentence: what the flow does.'],
                    'steps' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                        'id' => ['type' => 'string'],
                        'type' => ['type' => 'string', 'enum' => $types],
                        'after' => ['type' => 'string', 'description' => 'The id of the step this one follows; "" for the trigger.'],
                        'port' => ['type' => 'string', 'description' => 'How it leaves that step: next, yes, no, approved or rejected; "" for the trigger.'],
                        'settings' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                            'key' => ['type' => 'string'], 'value' => ['type' => 'string'],
                        ], 'required' => ['key', 'value'], 'additionalProperties' => false]],
                    ], 'required' => ['id', 'type', 'after', 'port', 'settings'], 'additionalProperties' => false]],
                ],
                'required' => ['name', 'description', 'steps'],
                'additionalProperties' => false,
            ],
            'medium',
        ));

        $graph = $this->build((array) ($answer['steps'] ?? []), $accounts->all());
        $graph = Graph::layout(Graph::guardApprovals(Graph::normalize($graph, $user)));

        return [
            'name' => Str::limit(trim((string) ($answer['name'] ?? '')) ?: 'New flow', 60, ''),
            'description' => Str::limit(trim((string) ($answer['description'] ?? '')), 280),
            'graph' => $graph,
        ];
    }

    /**
     * The model's steps → nodes and edges. Settings by key, accounts by handle, a trigger in
     * front if it forgot one.
     *
     * @param  list<Account>  $accounts
     */
    private function build(array $steps, array $accounts): array
    {
        $nodes = [];
        $edges = [];
        $ids = [];
        $alias = [];
        foreach (array_slice($steps, 0, Graph::MAX_NODES - 2) as $i => $step) {
            $type = (string) ($step['type'] ?? '');
            if (! Catalog::find($type)) {
                continue;
            }
            $id = Str::slug((string) ($step['id'] ?? ''), '_') ?: 'step_'.$i;
            while (isset($ids[$id])) {
                $id .= '_'.$i;
            }
            $ids[$id] = true;
            $raw = (string) ($step['id'] ?? $id);
            $alias[$raw] = $id;

            $config = [];
            foreach ((array) ($step['settings'] ?? []) as $pair) {
                $config[(string) ($pair['key'] ?? '')] = (string) ($pair['value'] ?? '');
            }
            if (isset($config['account_id']) || isset($config['account'])) {
                $config['account_id'] = $this->accountId((string) ($config['account_id'] ?? $config['account']), $accounts);
            }
            $nodes[] = ['id' => $id, 'type' => $type, 'x' => 0, 'y' => 0, 'config' => $config, '_after' => (string) ($step['after'] ?? ''), '_port' => (string) ($step['port'] ?? '')];
        }

        $triggers = array_values(array_filter($nodes, fn (array $n) => Catalog::isTrigger($n['type'])));
        if (! $triggers) {
            array_unshift($nodes, ['id' => 'start', 'type' => 'trigger.manual', 'x' => 0, 'y' => 0, 'config' => [], '_after' => '', '_port' => '']);
            $triggers = [$nodes[0]];
        }
        $trigger = $triggers[0]['id'];
        // One trigger only: any others become nothing.
        $nodes = array_values(array_filter($nodes, fn (array $n) => ! Catalog::isTrigger($n['type']) || $n['id'] === $trigger));

        $previous = $trigger;
        foreach ($nodes as $n) {
            if ($n['id'] === $trigger) {
                continue;
            }
            // A step that names nothing it follows hangs off the one before it.
            $from = $alias[$n['_after']] ?? (isset($ids[$n['_after']]) ? $n['_after'] : $previous);
            $edges[] = ['from' => $from, 'to' => $n['id'], 'port' => $n['_port'] ?: 'next'];
            $previous = $n['id'];
        }

        return [
            'nodes' => array_map(fn (array $n) => array_diff_key($n, ['_after' => 1, '_port' => 1]), $nodes),
            'edges' => $edges,
        ];
    }

    /** "@maisoncire", "maisoncire", "maisoncire on Instagram" or an id → the account's id. */
    private function accountId(string $value, array $accounts): ?int
    {
        $value = mb_strtolower(trim($value));
        foreach ($accounts as $account) {
            if ($value === (string) $account->id || str_contains($value, mb_strtolower($account->handle))) {
                return $account->id;
            }
        }
        foreach ($accounts as $account) {
            if (str_contains($value, $account->platform->value) || str_contains($value, mb_strtolower($account->platform->label()))) {
                return $account->id;
            }
        }

        return null;
    }

    private function system(): string
    {
        $lines = [];
        foreach (Catalog::nodes() as $type => $node) {
            $settings = collect($node['fields'])->map(function (array $f) {
                $kind = match ($f['kind']) {
                    'select' => implode('|', array_column($f['options'], 'value')),
                    'account' => 'account handle, e.g. @name',
                    'time' => 'HH:MM',
                    'voice' => 'a voice id such as af_heart or ff_siwis, or "" for the account’s voice',
                    default => $f['kind'],
                };

                return "{$f['key']} ({$kind})";
            })->implode(', ');
            $lines[] = "- {$type}: {$node['detail']}"
                .($settings ? " Settings: {$settings}." : '')
                .' Ports: '.implode(', ', $node['ports']).'.'
                .($node['produces'] ? ' Leaves: '.implode(', ', array_map(fn (string $v) => '{{'.$v.'}}', $node['produces'])).'.' : '');
        }

        $vars = collect(Catalog::VARIABLES)->map(fn (string $what, string $var) => "- {{{$var}}}: {$what}")->implode("\n");

        return <<<TXT
            You design automations ("flows") for a social media studio. A flow is one trigger followed by steps. You turn what the operator asks for into steps from the catalog below, nothing else.

            ## The catalog
            {$this->implode($lines)}

            ## Variables that aren't plain text
            {$vars}

            ## Rules
            - Exactly one step is a trigger (a type starting with "trigger."). It comes first, with after "" and port "".
            - Every other step names the step it follows in "after" and how it leaves that step in "port": "next" normally; "yes" or "no" after logic.if; "approved" or "rejected" after human.approve.
            - Branches: two steps can follow the same step (for example one on "yes" and one on "no").
            - Before any action.post there must be a human.approve, and action.post follows it on "approved". A person approves everything that gets scheduled.
            - logic.if compares: use gte or lte with a number for numeric variables (for an angry comment: {{comment.sentiment}} lte -25; for a good fit: {{score}} gte 70), and contains for words in text.
            - In text settings, use the variables earlier steps leave, written {{like.this}}. action.post and action.reply take {{draft}} unless the operator says otherwise.
            - Account settings take an account's handle from the list you are given. Leave them out to use the account the trigger is about.
            - Never invent URLs. Leave a webhook or feed url as "" unless the operator gave one; an empty webhook is skipped until they paste theirs.
            - Only the settings a step needs; leave the rest to their defaults. Values are always strings.
            - Keep it as short as the request allows: usually 3 to 7 steps. ids are short and unique, like "write" or "check_score".
            TXT;
    }

    /** @param  list<Account>  $accounts */
    private function context(User $user, array $accounts): string
    {
        $list = $accounts
            ? implode("\n", array_map(fn (Account $a) => "- @{$a->handle} on {$a->platform->label()}".($a->profile['topics'] ?? null ? " (topics: {$a->profile['topics']})" : ''), $accounts))
            : '- (no accounts yet)';

        return "## The operator's accounts\n{$list}\n\nTimezone: {$user->timezoneOrUtc()}. Today: ".CarbonImmutable::now($user->timezoneOrUtc())->format('l j F Y').'.';
    }

    private function implode(array $lines): string
    {
        return implode("\n", $lines);
    }
}

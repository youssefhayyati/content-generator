<?php

namespace App\Services\Flows;

use App\Models\User;
use Illuminate\Validation\ValidationException;

/**
 * A flow's graph: nodes and the edges between them. Everything that comes in — from the
 * canvas, a template or the compiler — goes through `normalize()`: known node types only,
 * one trigger, edges that leave through a real port, no loops, accounts that are the user's.
 *
 * @phpstan-type Node array{id: string, type: string, x: int, y: int, config: array<string, mixed>}
 * @phpstan-type Edge array{from: string, to: string, port: string}
 */
final class Graph
{
    public const MAX_NODES = 40;

    /**
     * @param  array<string, mixed>  $graph
     * @return array{nodes: list<Node>, edges: list<Edge>}
     *
     * @throws ValidationException
     */
    public static function normalize(array $graph, User $user): array
    {
        $accounts = $user->accounts()->pluck('id')->all();
        $nodes = [];
        foreach (array_slice((array) ($graph['nodes'] ?? []), 0, self::MAX_NODES) as $raw) {
            $id = substr(preg_replace('/[^A-Za-z0-9_-]/', '', (string) ($raw['id'] ?? '')), 0, 40);
            $type = (string) ($raw['type'] ?? '');
            if ($id === '' || isset($nodes[$id]) || ! Catalog::find($type)) {
                continue;
            }
            $config = Catalog::configure($type, (array) ($raw['config'] ?? []));
            if (array_key_exists('account_id', $config) && ! in_array($config['account_id'], $accounts, true)) {
                $config['account_id'] = null;
            }
            $nodes[$id] = [
                'id' => $id,
                'type' => $type,
                'x' => (int) max(-20000, min(20000, (float) ($raw['x'] ?? 0))),
                'y' => (int) max(-20000, min(20000, (float) ($raw['y'] ?? 0))),
                'config' => $config,
            ];
        }

        $triggers = array_filter($nodes, fn (array $n) => Catalog::isTrigger($n['type']));
        if (count($triggers) !== 1) {
            throw ValidationException::withMessages(['graph' => count($triggers) === 0
                ? 'A flow starts with a trigger: add a “When…” node.'
                : 'A flow starts from one trigger. Remove the extra “When…” nodes.']);
        }

        $edges = [];
        foreach ((array) ($graph['edges'] ?? []) as $raw) {
            $from = (string) ($raw['from'] ?? '');
            $to = (string) ($raw['to'] ?? '');
            if (! isset($nodes[$from], $nodes[$to]) || $from === $to || Catalog::isTrigger($nodes[$to]['type'])) {
                continue;
            }
            $ports = Catalog::find($nodes[$from]['type'])['ports'];
            $port = in_array($raw['port'] ?? null, $ports, true) ? $raw['port'] : $ports[0];
            $edges["{$from}>{$port}>{$to}"] = ['from' => $from, 'to' => $to, 'port' => $port];
        }
        $edges = array_values($edges);

        if (self::hasCycle(array_keys($nodes), $edges)) {
            throw ValidationException::withMessages(['graph' => 'A flow can’t loop back on itself. Remove the line that closes the loop.']);
        }

        return ['nodes' => array_values($nodes), 'edges' => $edges];
    }

    /** @return Node|null */
    public static function node(array $graph, string $id): ?array
    {
        foreach ($graph['nodes'] ?? [] as $node) {
            if ($node['id'] === $id) {
                return $node;
            }
        }

        return null;
    }

    /**
     * Where a node leads through one port, in the order the lines were drawn.
     *
     * @return list<string>
     */
    public static function next(array $graph, string $id, string $port): array
    {
        return array_values(array_map(fn (array $e) => $e['to'], array_filter($graph['edges'] ?? [], fn (array $e) => $e['from'] === $id && $e['port'] === $port)));
    }

    /**
     * Never schedule what nobody saw: put an "Ask me first" in front of every "Schedule a post"
     * that has no approval anywhere upstream. Used for compiled flows and templates; the engine
     * enforces the same rule at run time whatever the graph says.
     *
     * @return array{nodes: list<Node>, edges: list<Edge>}
     */
    public static function guardApprovals(array $graph): array
    {
        foreach ($graph['nodes'] as $node) {
            if ($node['type'] !== 'action.post' || self::approvedUpstream($graph, $node['id'])) {
                continue;
            }
            $gate = 'ask_'.$node['id'];
            $graph['nodes'][] = ['id' => $gate, 'type' => 'human.approve', 'x' => $node['x'], 'y' => $node['y'], 'config' => Catalog::configure('human.approve', [])];
            foreach ($graph['edges'] as $i => $edge) {
                if ($edge['to'] === $node['id']) {
                    $graph['edges'][$i]['to'] = $gate;
                }
            }
            $graph['edges'][] = ['from' => $gate, 'to' => $node['id'], 'port' => 'approved'];
        }

        return $graph;
    }

    /**
     * Tidy positions, top to bottom: rows by how far a node is from the trigger, columns so
     * branches spread out side by side and a node sits above the middle of what follows it.
     *
     * @return array{nodes: list<Node>, edges: list<Edge>}
     */
    public static function layout(array $graph): array
    {
        $byId = collect($graph['nodes'])->keyBy('id');
        $trigger = $byId->first(fn (array $n) => Catalog::isTrigger($n['type']));
        if (! $trigger) {
            return $graph;
        }
        $order = ['next' => 0, 'yes' => 0, 'approved' => 0, 'no' => 1, 'rejected' => 1];
        $children = fn (string $id) => collect($graph['edges'])->where('from', $id)->sortBy(fn (array $e) => $order[$e['port']] ?? 2)->pluck('to')->all();

        // Row: the longest path from the trigger.
        $depth = [$trigger['id'] => 0];
        $queue = [$trigger['id']];
        $guard = 0;
        while ($queue && $guard++ < 2000) {
            $id = array_shift($queue);
            foreach ($children($id) as $child) {
                if (($depth[$child] ?? -1) < $depth[$id] + 1) {
                    $depth[$child] = $depth[$id] + 1;
                    $queue[] = $child;
                }
            }
        }

        // Column: leaves take the next free column; a parent sits in the middle of its children.
        $row = [];
        $next = 0;
        $place = function (string $id) use (&$place, &$row, &$next, $children): float {
            if (isset($row[$id])) {
                return $row[$id];
            }
            $row[$id] = -1; // visiting
            $mine = array_values(array_filter(array_map(fn (string $c) => isset($row[$c]) ? null : $place($c), $children($id)), fn ($r) => $r !== null));

            return $row[$id] = $mine ? (min($mine) + max($mine)) / 2 : $next++;
        };
        $place($trigger['id']);

        $graph['nodes'] = array_map(function (array $n) use ($depth, &$row, &$next) {
            $r = $row[$n['id']] ?? $next++;

            return [...$n, 'x' => 40 + (int) round($r * 300), 'y' => 40 + ($depth[$n['id']] ?? 0) * 150];
        }, $graph['nodes']);

        return $graph;
    }

    private static function approvedUpstream(array $graph, string $id, array $seen = []): bool
    {
        foreach ($graph['edges'] as $edge) {
            if ($edge['to'] !== $id || in_array($edge['from'], $seen, true)) {
                continue;
            }
            $from = self::node($graph, $edge['from']);
            if ($from && $from['type'] === 'human.approve' && $edge['port'] === 'approved') {
                return true;
            }
            if (self::approvedUpstream($graph, $edge['from'], [...$seen, $id])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  list<string>  $ids
     * @param  list<Edge>  $edges
     */
    private static function hasCycle(array $ids, array $edges): bool
    {
        $out = [];
        foreach ($edges as $e) {
            $out[$e['from']][] = $e['to'];
        }
        $state = []; // 1 = on the path, 2 = done
        $visit = function (string $id) use (&$visit, &$state, $out): bool {
            $state[$id] = 1;
            foreach ($out[$id] ?? [] as $to) {
                if (($state[$to] ?? 0) === 1 || (($state[$to] ?? 0) === 0 && $visit($to))) {
                    return true;
                }
            }
            $state[$id] = 2;

            return false;
        };
        foreach ($ids as $id) {
            if (($state[$id] ?? 0) === 0 && $visit($id)) {
                return true;
            }
        }

        return false;
    }
}

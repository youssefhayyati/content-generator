<?php

namespace App\Services\Lab;

use App\Models\Generation;
use App\Services\Lab\Nodes\Write;
use Illuminate\Support\Str;
use InvalidArgumentException;

/**
 * A Creative Lab canvas (version 2): nodes joined port to port, and the operations that change it.
 *
 *   {version: 2, rev, nodes: [{id, type, x, y, params, pin?, branch?, label?}],
 *    edges: [{from, out, to, in, pick?}], view: {x, y, zoom}}
 *
 * Every change, from the page or from the assistant, is an operation applied to the newest canvas
 * (apply), so two people (or a person and the assistant) editing at once never undo each other.
 * An edge runs from an output port to an input port whose type accepts it; an input that takes one
 * thing keeps only its newest edge; nothing may loop back on itself. An edge from text written in
 * several pieces (versions, lines) can `pick` one of them: 1, 2…, or 0 for all of it.
 */
class Graph
{
    public const MAX_NODES = 300;

    /** Tidying: columns this far apart (a card is 268 wide), cards this far apart in a column. */
    private const COLUMN = 340;

    private const GAP = 56;

    /**
     * Any canvas as version 2. The first Creative Lab canvases (notes, texts, assets and generations
     * laid out by hand) become notes, texts and media nodes, so nothing made there is lost.
     *
     * @param  array<string, mixed>|null  $canvas
     * @return array<string, mixed>
     */
    public static function normalize(?array $canvas): array
    {
        $canvas ??= [];
        $view = $canvas['view'] ?? ['x' => 0, 'y' => 0, 'zoom' => 1];
        if (($canvas['version'] ?? 1) >= 2) {
            return [
                'version' => 2,
                'rev' => (int) ($canvas['rev'] ?? 0),
                'nodes' => array_values(array_filter($canvas['nodes'] ?? [], fn ($n) => isset($n['id'], $n['type']) && Catalog::node($n['type']))),
                'edges' => array_values($canvas['edges'] ?? []),
                'view' => $view,
                'auto' => (bool) ($canvas['auto'] ?? false),
            ];
        }

        $nodes = [];
        foreach ($canvas['nodes'] ?? [] as $old) {
            $base = ['id' => (string) $old['id'], 'x' => (float) ($old['x'] ?? 0), 'y' => (float) ($old['y'] ?? 0)];
            $node = match ($old['type'] ?? null) {
                'note' => [...$base, 'type' => 'util.note', 'params' => ['text' => (string) ($old['text'] ?? '')]],
                'text' => [...$base, 'type' => 'source.text', 'params' => ['text' => (string) ($old['text'] ?? '')]],
                'asset' => [...$base, 'type' => 'source.media', 'params' => ['assets' => array_filter([(int) ($old['ref'] ?? 0)])]],
                'generation' => self::fromGeneration($base, isset($old['ref']) ? Generation::find($old['ref']) : null),
                default => null,
            };
            if ($node) {
                $nodes[] = $node;
            }
        }

        return ['version' => 2, 'rev' => 0, 'nodes' => $nodes, 'edges' => [], 'view' => $view, 'auto' => false];
    }

    /**
     * @param  array<string, mixed>  $base
     * @return array<string, mixed>
     */
    private static function fromGeneration(array $base, ?Generation $g): array
    {
        if ($g && $g->output_asset_ids) {
            return [...$base, 'type' => 'source.media', 'params' => ['assets' => array_map('intval', $g->output_asset_ids)], 'label' => Str::limit($g->prompt, 40)];
        }

        return [...$base, 'type' => $g?->output_text ? 'source.text' : 'util.note', 'params' => ['text' => (string) ($g?->output_text ?: $g?->prompt ?: '')]];
    }

    /**
     * Apply operations to a canvas. Returns the new canvas and, per operation, what it did (the
     * ids of the nodes it added, for one).
     *
     * @param  array<string, mixed>  $canvas  normalized
     * @param  list<array<string, mixed>>  $ops
     * @return array{0: array<string, mixed>, 1: list<array<string, mixed>>}
     *
     * @throws InvalidArgumentException with a message for the person (or the assistant) who asked
     */
    public static function apply(array $canvas, array $ops): array
    {
        $results = [];
        foreach ($ops as $i => $op) {
            $what = is_scalar($op['op'] ?? null) ? (string) $op['op'] : '';
            try {
                [$canvas, $result] = match ($what) {
                    'add' => self::add($canvas, $op),
                    'move' => [self::change($canvas, (string) ($op['id'] ?? ''), fn ($n) => [...$n, 'x' => (float) ($op['x'] ?? $n['x']), 'y' => (float) ($op['y'] ?? $n['y'])]), []],
                    'set' => self::set($canvas, $op),
                    'label' => [self::change($canvas, (string) ($op['id'] ?? ''), fn ($n) => self::without([...$n, 'label' => Str::limit(trim((string) ($op['label'] ?? '')), 60, '')], 'label')), []],
                    'pin' => [self::change($canvas, (string) ($op['id'] ?? ''), function ($n) use ($op) {
                        unset($n['soft']);

                        return self::without([...$n, 'pin' => isset($op['run']) ? (int) $op['run'] : null], 'pin');
                    }), []],
                    'remove' => self::remove($canvas, (array) ($op['ids'] ?? [$op['id'] ?? null])),
                    'connect' => self::connect($canvas, $op),
                    'disconnect' => self::disconnect($canvas, $op),
                    'pick' => self::pick($canvas, $op),
                    'tidy' => self::tidy($canvas),
                    'branch' => self::branch($canvas, (string) ($op['id'] ?? '')),
                    'insert' => self::insert($canvas, (array) ($op['graph'] ?? []), (float) ($op['x'] ?? 0), (float) ($op['y'] ?? 0)),
                    'auto' => [[...$canvas, 'auto' => (bool) ($op['on'] ?? false)], []],
                    'view' => [[...$canvas, 'view' => ['x' => (float) ($op['x'] ?? 0), 'y' => (float) ($op['y'] ?? 0), 'zoom' => max(0.2, min(2.5, (float) ($op['zoom'] ?? 1)))]], []],
                    default => throw new InvalidArgumentException("Unknown operation “{$what}”."),
                };
            } catch (InvalidArgumentException $e) {
                throw new InvalidArgumentException('Operation '.($i + 1)." ({$what}): ".$e->getMessage());
            } catch (\ErrorException|\TypeError) {
                // A list where a name belongs (an id sent as ["a"], say): the caller's mistake, not a crash.
                throw new InvalidArgumentException('Operation '.($i + 1)." ({$what}): a field has the wrong type.");
            }
            $results[] = $result;
        }
        if (count($canvas['nodes']) > self::MAX_NODES) {
            throw new InvalidArgumentException('A project holds up to '.self::MAX_NODES.' nodes. Start another project for the rest.');
        }
        $canvas['rev'] = (int) ($canvas['rev'] ?? 0) + 1;

        return [$canvas, $results];
    }

    /* ------------------------------------------------------------------ */
    /* Reading */
    /* ------------------------------------------------------------------ */

    /**
     * @param  array<string, mixed>  $canvas
     * @return array<string, mixed>|null
     */
    public static function find(array $canvas, string $id): ?array
    {
        foreach ($canvas['nodes'] as $n) {
            if ($n['id'] === $id) {
                return $n;
            }
        }

        return null;
    }

    /**
     * The edges into a node's input, in the order they were drawn.
     *
     * @param  array<string, mixed>  $canvas
     * @return list<array<string, string>>
     */
    public static function into(array $canvas, string $id, ?string $port = null): array
    {
        return array_values(array_filter($canvas['edges'], fn ($e) => $e['to'] === $id && ($port === null || $e['in'] === $port)));
    }

    /**
     * The nodes fed by this one, directly.
     *
     * @param  array<string, mixed>  $canvas
     * @return list<string>
     */
    public static function next(array $canvas, string $id): array
    {
        return array_values(array_unique(array_map(fn ($e) => $e['to'], array_filter($canvas['edges'], fn ($e) => $e['from'] === $id))));
    }

    /**
     * The nodes feeding this one, directly.
     *
     * @param  array<string, mixed>  $canvas
     * @return list<string>
     */
    public static function previous(array $canvas, string $id): array
    {
        return array_values(array_unique(array_map(fn ($e) => $e['from'], self::into($canvas, $id))));
    }

    /**
     * Every node after this one, however far.
     *
     * @param  array<string, mixed>  $canvas
     * @return list<string>
     */
    public static function downstream(array $canvas, string $id): array
    {
        $seen = [];
        $queue = self::next($canvas, $id);
        while ($queue) {
            $n = array_shift($queue);
            if (isset($seen[$n]) || $n === $id) {
                continue;
            }
            $seen[$n] = true;
            array_push($queue, ...self::next($canvas, $n));
        }

        return array_keys($seen);
    }

    /**
     * Every node before this one, however far.
     *
     * @param  array<string, mixed>  $canvas
     * @return list<string>
     */
    public static function upstream(array $canvas, string $id): array
    {
        $seen = [];
        $queue = self::previous($canvas, $id);
        while ($queue) {
            $n = array_shift($queue);
            if (isset($seen[$n]) || $n === $id) {
                continue;
            }
            $seen[$n] = true;
            array_push($queue, ...self::previous($canvas, $n));
        }

        return array_keys($seen);
    }

    /**
     * Node ids in an order where every node comes after the ones feeding it.
     *
     * @param  array<string, mixed>  $canvas
     * @return list<string>
     */
    public static function order(array $canvas): array
    {
        $ids = array_map(fn ($n) => $n['id'], $canvas['nodes']);
        $in = array_fill_keys($ids, 0);
        foreach ($canvas['edges'] as $e) {
            if (isset($in[$e['to']])) {
                $in[$e['to']]++;
            }
        }
        $ready = array_values(array_filter($ids, fn ($id) => $in[$id] === 0));
        $out = [];
        while ($ready) {
            $id = array_shift($ready);
            $out[] = $id;
            foreach ($canvas['edges'] as $e) {
                if ($e['from'] === $id && isset($in[$e['to']]) && --$in[$e['to']] === 0) {
                    $ready[] = $e['to'];
                }
            }
        }

        return $out;
    }

    /* ------------------------------------------------------------------ */
    /* Operations */
    /* ------------------------------------------------------------------ */

    /**
     * @param  array<string, mixed>  $canvas
     * @param  array<string, mixed>  $op
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private static function add(array $canvas, array $op): array
    {
        $node = (array) ($op['node'] ?? $op);
        $type = (string) ($node['type'] ?? '');
        if (! Catalog::node($type)) {
            throw new InvalidArgumentException("There is no node “{$type}”.");
        }
        $id = self::cleanId($node['id'] ?? null) ?? self::newId($canvas, $type);
        if (self::find($canvas, $id)) {
            throw new InvalidArgumentException("There is already a node “{$id}”.");
        }
        [$x, $y] = isset($node['x'], $node['y']) ? [(float) $node['x'], self::clear($canvas, (float) $node['x'], (float) $node['y'])] : self::freeSpot($canvas);
        $new = array_filter([
            'id' => $id, 'type' => $type, 'x' => $x, 'y' => $y,
            'params' => self::cleanParams($type, (array) ($node['params'] ?? [])),
            'label' => isset($node['label']) ? Str::limit(trim((string) $node['label']), 60, '') : null,
            'branch' => $node['branch'] ?? null,
        ], fn ($v) => $v !== null);
        $canvas['nodes'][] = $new;

        return [$canvas, ['id' => $id]];
    }

    /**
     * @param  array<string, mixed>  $canvas
     * @param  array<string, mixed>  $op
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private static function set(array $canvas, array $op): array
    {
        $id = (string) ($op['id'] ?? '');
        $canvas = self::change($canvas, $id, function ($n) use ($op) {
            $params = [...$n['params'] ?? [], ...(array) ($op['params'] ?? [])];
            // New settings want new results: a pinned version lets go.
            unset($n['pin'], $n['soft']);

            return [...$n, 'params' => self::cleanParams($n['type'], array_filter($params, fn ($v) => $v !== null))];
        });

        return [self::autoPick($canvas, $id), []];
    }

    /**
     * @param  array<string, mixed>  $canvas
     * @param  list<mixed>  $ids
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private static function remove(array $canvas, array $ids): array
    {
        $ids = array_map('strval', array_filter($ids));
        $canvas['nodes'] = array_values(array_filter($canvas['nodes'], fn ($n) => ! in_array($n['id'], $ids, true)));
        $canvas['edges'] = array_values(array_filter($canvas['edges'], fn ($e) => ! in_array($e['from'], $ids, true) && ! in_array($e['to'], $ids, true)));

        return [$canvas, ['removed' => $ids]];
    }

    /**
     * @param  array<string, mixed>  $canvas
     * @param  array<string, mixed>  $op
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private static function connect(array $canvas, array $op): array
    {
        $from = self::find($canvas, (string) ($op['from'] ?? '')) ?? throw new InvalidArgumentException('There is no node “'.($op['from'] ?? '').'” to connect from.');
        $to = self::find($canvas, (string) ($op['to'] ?? '')) ?? throw new InvalidArgumentException('There is no node “'.($op['to'] ?? '').'” to connect to.');
        $outputs = Catalog::node($from['type'])['outputs'];
        $inputs = Catalog::node($to['type'])['inputs'];
        if (! $outputs) {
            throw new InvalidArgumentException(Catalog::node($from['type'])['label'].' has nothing to pass on.');
        }
        if (! $inputs) {
            throw new InvalidArgumentException(Catalog::node($to['type'])['label'].' takes nothing in.');
        }

        // Ports left out: the first pair whose types fit.
        $out = isset($op['out']) ? Catalog::output($from['type'], (string) $op['out']) : null;
        $in = isset($op['in']) ? Catalog::input($to['type'], (string) $op['in']) : null;
        if (isset($op['out']) && ! $out) {
            throw new InvalidArgumentException(Catalog::node($from['type'])['label']." has no output “{$op['out']}”.");
        }
        if (isset($op['in']) && ! $in) {
            throw new InvalidArgumentException(Catalog::node($to['type'])['label']." has no input “{$op['in']}”.");
        }
        if (! $out || ! $in) {
            foreach ($out ? [$out] : $outputs as $o) {
                foreach ($in ? [$in] : $inputs as $i) {
                    if (in_array($o['type'], $i['accepts'], true)) {
                        [$out, $in] = [$o, $i];
                        break 2;
                    }
                }
            }
        }
        if (! $out || ! $in || ! in_array($out['type'], $in['accepts'], true)) {
            $what = $out ? Catalog::PORT_TYPES[$out['type']] : 'what '.Catalog::node($from['type'])['label'].' makes';
            throw new InvalidArgumentException(Catalog::node($to['type'])['label'].($in ? "’s {$in['label']}" : '').' doesn’t take '.Str::lower($what).'.');
        }
        if ($from['id'] === $to['id'] || in_array($to['id'], self::upstream($canvas, $from['id']), true)) {
            throw new InvalidArgumentException('That would make a loop.');
        }

        $edge = ['from' => $from['id'], 'out' => $out['name'], 'to' => $to['id'], 'in' => $in['name']];
        $before = collect($canvas['edges'])->first(fn ($e) => self::same($e, $edge));
        $canvas['edges'] = array_values(array_filter($canvas['edges'], fn ($e) => ! self::same($e, $edge)
            && ! (empty($in['multi']) && $e['to'] === $to['id'] && $e['in'] === $in['name'])));
        // Drawn again, a line keeps the piece it picked unless told another.
        $pick = self::pickValue($op['pick'] ?? null) ?? (isset($before['pick']) ? (int) $before['pick'] : null);
        $canvas['edges'][] = $pick === null ? $edge : [...$edge, 'pick' => $pick];
        $canvas = self::autoPick($canvas, $from['id']);

        return [$canvas, collect($canvas['edges'])->first(fn ($e) => self::same($e, $edge))];
    }

    /**
     * Which piece a line takes, from text written in several (versions, lines): {"op":"pick", "from", "to",
     * "in", "pick": 2}. 0 takes all of it; null lets it be picked for it again.
     *
     * @param  array<string, mixed>  $canvas
     * @param  array<string, mixed>  $op
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private static function pick(array $canvas, array $op): array
    {
        $pick = self::pickValue($op['pick'] ?? null);
        $found = false;
        foreach ($canvas['edges'] as $i => $e) {
            if ($e['to'] === ($op['to'] ?? null) && (! isset($op['in']) || $e['in'] === $op['in'])
                && (! isset($op['from']) || $e['from'] === $op['from']) && (! isset($op['out']) || $e['out'] === $op['out'])) {
                $found = true;
                if ($pick === null) {
                    unset($canvas['edges'][$i]['pick']);
                } else {
                    $canvas['edges'][$i]['pick'] = $pick;
                }
            }
        }
        if (! $found) {
            throw new InvalidArgumentException('There is no such line.');
        }

        return [$canvas, []];
    }

    private static function pickValue(mixed $v): ?int
    {
        return is_numeric($v) ? max(0, min(10, (int) $v)) : null;
    }

    /**
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     */
    private static function same(array $a, array $b): bool
    {
        return $a['from'] === $b['from'] && $a['out'] === $b['out'] && $a['to'] === $b['to'] && $a['in'] === $b['in'];
    }

    /**
     * A Write node asked for several versions gives every line out of it its own (#1, #2…, round again
     * past the last), so three pictures fed by it get three prompts; asked for one, its lines take it all.
     * A piece picked by hand stays, as does "all of it" (0).
     *
     * @param  array<string, mixed>  $canvas
     * @return array<string, mixed>
     */
    private static function autoPick(array $canvas, string $id): array
    {
        $node = self::find($canvas, $id);
        if (! $node || $node['type'] !== 'text.write' || in_array($node['params']['task'] ?? 'caption', Write::LISTS, true)) {
            return $canvas;
        }
        $n = Write::variants($node['params'] ?? []);
        $kept = fn (array $e) => isset($e['pick']) && ($e['pick'] === 0 || $e['pick'] <= $n);
        $used = [];
        foreach ($canvas['edges'] as $i => $e) {
            if ($e['from'] !== $id) {
                continue;
            }
            if ($n <= 1) {
                unset($canvas['edges'][$i]['pick']);
            } elseif ($kept($e) && $e['pick'] > 0) {
                $used[] = $e['pick'];
            }
        }
        if ($n > 1) {
            foreach ($canvas['edges'] as $i => $e) {
                if ($e['from'] !== $id || $kept($e)) {
                    continue;
                }
                $free = array_values(array_diff(range(1, $n), $used));
                $canvas['edges'][$i]['pick'] = $used[] = $free[0] ?? count($used) % $n + 1;
            }
        }

        return $canvas;
    }

    /**
     * @param  array<string, mixed>  $canvas
     * @param  array<string, mixed>  $op
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private static function disconnect(array $canvas, array $op): array
    {
        $canvas['edges'] = array_values(array_filter($canvas['edges'], fn ($e) => ! (
            $e['to'] === ($op['to'] ?? null)
            && (! isset($op['in']) || $e['in'] === $op['in'])
            && (! isset($op['from']) || $e['from'] === $op['from'])
            && (! isset($op['out']) || $e['out'] === $op['out'])
        )));

        return [$canvas, []];
    }

    /**
     * A branch: a copy of a node and everything after it, below the original, fed the same way.
     * The copies show the originals' results (pinned) until they're changed and run again.
     *
     * @param  array<string, mixed>  $canvas
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private static function branch(array $canvas, string $id): array
    {
        $root = self::find($canvas, $id) ?? throw new InvalidArgumentException("There is no node “{$id}”.");
        $ids = [$id, ...self::downstream($canvas, $id)];
        $nodes = array_values(array_filter($canvas['nodes'], fn ($n) => in_array($n['id'], $ids, true)));
        $used = array_filter(array_map(fn ($n) => $n['branch'] ?? null, $canvas['nodes']));
        $letter = 'B';
        while (in_array($letter, $used, true)) {
            $letter++;
        }
        $top = min(array_map(fn ($n) => $n['y'], $nodes));
        $bottom = max(array_map(fn ($n) => $n['y'], $nodes));
        $shift = $bottom - $top + 260;

        $map = [];
        foreach ($nodes as $n) {
            $map[$n['id']] = self::newId($canvas, $n['type'], array_values($map));
        }
        foreach ($nodes as $n) {
            $copy = [...$n, 'id' => $map[$n['id']], 'y' => $n['y'] + $shift, 'branch' => $letter];
            unset($copy['pin'], $copy['soft']);
            // Shown until the copy runs again (a soft pin: anything that changes it lets go).
            if ($pin = $n['pin'] ?? $n['_current'] ?? null) {
                $copy['pin'] = $pin;
                $copy['soft'] = true;
            }
            unset($copy['_current']);
            $canvas['nodes'][] = $copy;
        }
        // The original side becomes branch A if it had no letter yet.
        $canvas['nodes'] = array_map(fn ($n) => in_array($n['id'], $ids, true) && empty($n['branch']) ? [...$n, 'branch' => 'A'] : $n, $canvas['nodes']);
        foreach ($canvas['edges'] as $e) {
            if (isset($map[$e['to']])) {
                $canvas['edges'][] = [...$e, 'from' => $map[$e['from']] ?? $e['from'], 'to' => $map[$e['to']]];
            }
        }
        $canvas['nodes'] = array_map(function ($n) {
            unset($n['_current']);

            return $n;
        }, $canvas['nodes']);

        return [$canvas, ['branch' => $letter, 'ids' => $map, 'root' => $map[$root['id']]]];
    }

    /**
     * A fragment (a template's nodes and edges) added with new ids, its top left at x, y. What the
     * canvas has already stands in for the fragment's own: its Brief (a template's empty one would be
     * a second brief, with nothing in it), and the campaign's photos for a photo node that asks for
     * them (`reuse`: the kinds of photo it takes, References::GROUPS, in order).
     *
     * @param  array<string, mixed>  $canvas
     * @param  array<string, mixed>  $fragment
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    public static function insert(array $canvas, array $fragment, float $x, float $y): array
    {
        $nodes = array_values(array_filter($fragment['nodes'] ?? [], fn ($n) => isset($n['type']) && Catalog::node((string) $n['type'])));
        if (! $nodes) {
            throw new InvalidArgumentException('There is nothing to add.');
        }
        $alias = self::reuse($canvas, $nodes);
        $added = array_values(array_filter($nodes, fn ($n) => ! isset($alias[(string) ($n['id'] ?? '')])));
        $left = $added ? min(array_map(fn ($n) => (float) ($n['x'] ?? 0), $added)) : 0;
        $top = $added ? min(array_map(fn ($n) => (float) ($n['y'] ?? 0), $added)) : 0;
        // Never on top of what's there: the whole fragment lower down until it's clear.
        for ($tries = 0; $tries < 40 && collect($added)->contains(fn ($n) => self::taken($canvas, $x + (float) ($n['x'] ?? 0) - $left, $y + (float) ($n['y'] ?? 0) - $top)); $tries++) {
            $y += 380;
        }
        $map = [];
        foreach ($added as $n) {
            $map[(string) ($n['id'] ?? Str::random(6))] = $id = self::newId($canvas, $n['type'], array_values($map));
            $canvas['nodes'][] = array_filter([
                'id' => $id, 'type' => $n['type'],
                'x' => $x + (float) ($n['x'] ?? 0) - $left, 'y' => $y + (float) ($n['y'] ?? 0) - $top,
                'params' => self::cleanParams($n['type'], (array) ($n['params'] ?? [])),
                'label' => $n['label'] ?? null,
            ], fn ($v) => $v !== null);
        }
        $resolve = fn (string $id) => isset($alias[$id]) ? ($alias[$id][0] === 'canvas' ? $alias[$id][1] : ($map[$alias[$id][1]] ?? null)) : ($map[$id] ?? null);
        foreach ($fragment['edges'] ?? [] as $e) {
            $from = $resolve((string) ($e['from'] ?? ''));
            $to = $resolve((string) ($e['to'] ?? ''));
            if ($from && $to) {
                [$canvas] = self::connect($canvas, ['from' => $from, 'out' => $e['out'] ?? null, 'to' => $to, 'in' => $e['in'] ?? null, 'pick' => $e['pick'] ?? null]);
            }
        }
        foreach ($alias as $id => [, $target]) {
            $map[$id] = $resolve($id) ?? $target;
        }

        return [$canvas, ['ids' => $map]];
    }

    /**
     * The fragment's nodes that something already there replaces: id => ['canvas', its id] or
     * ['fragment', the id of another node in the fragment].
     *
     * @param  array<string, mixed>  $canvas
     * @param  list<array<string, mixed>>  $nodes
     * @return array<string, array{0: string, 1: string}>
     */
    private static function reuse(array $canvas, array $nodes): array
    {
        // The brief with a campaign first: that's the one the interview made.
        $briefs = array_values(array_filter($canvas['nodes'], fn ($n) => $n['type'] === 'source.brief'));
        usort($briefs, fn ($a, $b) => (int) empty($a['params']['campaign_id']) <=> (int) empty($b['params']['campaign_id']));
        $photos = fn (array $list) => collect($list)
            ->filter(fn ($n) => ($n['type'] ?? null) === 'source.media' && isset($n['label']) && ! empty($n['params']['assets']))
            ->reverse()->mapWithKeys(fn ($n) => [$n['label'] => (string) $n['id']])->all(); // the first of a kind wins
        $onCanvas = $photos($canvas['nodes']);
        $inFragment = $photos($nodes);

        $alias = [];
        foreach ($nodes as $n) {
            $id = (string) ($n['id'] ?? '');
            if ($id === '') {
                continue;
            }
            if ($n['type'] === 'source.brief' && $briefs && ! array_filter((array) ($n['params'] ?? []), fn ($v) => $v !== null && $v !== '' && $v !== [])) {
                $alias[$id] = ['canvas', $briefs[0]['id']];
            } elseif ($n['type'] === 'source.media' && empty($n['params']['assets']) && ! empty($n['reuse'])) {
                foreach ((array) $n['reuse'] as $kind) {
                    $label = References::GROUPS[$kind] ?? null;
                    if ($label && isset($onCanvas[$label])) {
                        $alias[$id] = ['canvas', $onCanvas[$label]];
                        break;
                    }
                    if ($label && isset($inFragment[$label]) && $inFragment[$label] !== $id) {
                        $alias[$id] = ['fragment', $inFragment[$label]];
                        break;
                    }
                }
            }
        }

        return $alias;
    }

    /* ------------------------------------------------------------------ */

    /**
     * @param  array<string, mixed>  $canvas
     * @param  callable(array<string, mixed>): array<string, mixed>  $fn
     * @return array<string, mixed>
     */
    private static function change(array $canvas, string $id, callable $fn): array
    {
        foreach ($canvas['nodes'] as $i => $n) {
            if ($n['id'] === $id) {
                $canvas['nodes'][$i] = $fn($n);

                return $canvas;
            }
        }
        throw new InvalidArgumentException("There is no node “{$id}”.");
    }

    /**
     * @param  array<string, mixed>  $n
     * @return array<string, mixed>
     */
    private static function without(array $n, string $key): array
    {
        if ($n[$key] === null || $n[$key] === '') {
            unset($n[$key]);
        }

        return $n;
    }

    /**
     * Settings kept to the node's own fields, with plain values only.
     *
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    public static function cleanParams(string $type, array $params): array
    {
        $fields = collect(Catalog::node($type)['fields'] ?? [])->keyBy('key');
        $out = [];
        foreach ($params as $key => $value) {
            $field = $fields->get($key);
            if (! $field) {
                continue;
            }
            $out[$key] = match ($field['kind']) {
                'number', 'range' => $value === '' || $value === null ? null : (float) $value,
                'toggle' => (bool) $value,
                'assets', 'colors' => array_values(array_filter((array) $value, fn ($v) => $v !== null && $v !== '')),
                'texts' => array_values(array_map(fn ($t) => array_intersect_key((array) $t, array_flip(['slide', 'text', 'position', 'size', 'color', 'style', 'box_color', 'font'])), (array) $value)),
                'account', 'device', 'campaign' => $value === null || $value === '' ? null : (int) $value,
                default => is_scalar($value) || $value === null ? $value : null,
            };
            if (is_string($out[$key]) && mb_strlen($out[$key]) > 20000) {
                $out[$key] = mb_substr($out[$key], 0, 20000);
            }
        }

        return $out;
    }

    private static function cleanId(mixed $id): ?string
    {
        $id = is_scalar($id) ? preg_replace('/[^\w\-]/', '', (string) $id) : null;

        return $id ? mb_substr($id, 0, 40) : null;
    }

    /**
     * A short readable id: the node's kind and a number ("picture-3").
     *
     * @param  array<string, mixed>  $canvas
     * @param  list<string>  $taken
     */
    public static function newId(array $canvas, string $type, array $taken = []): string
    {
        $stem = Str::slug(Catalog::node($type)['label'] ?? 'node');
        $ids = [...array_map(fn ($n) => $n['id'], $canvas['nodes']), ...$taken];
        for ($n = 1; ; $n++) {
            if (! in_array("{$stem}-{$n}", $ids, true)) {
                return "{$stem}-{$n}";
            }
        }
    }

    /**
     * Tidy the canvas into columns, by how far along the work each node is: a node that feeds just one
     * sits right before it, one that feeds several (a brief, a writer for three pictures) as far left as
     * what feeds it allows. In each column, the order that keeps lines short, a few passes over: a chain
     * (a picture, its animation, its design) on one row, any other node pulled toward what it's joined
     * to (a brief, joined to everything, pulls little). Notes stay.
     *
     * @param  array<string, mixed>  $canvas
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private static function tidy(array $canvas): array
    {
        $nodes = array_column(array_filter($canvas['nodes'], fn ($n) => $n['type'] !== 'util.note'), null, 'id');
        if (count($nodes) < 2) {
            return [$canvas, ['moved' => 0]];
        }
        $parents = $children = array_fill_keys(array_keys($nodes), []);
        foreach ($canvas['edges'] as $e) {
            if (isset($nodes[$e['from']], $nodes[$e['to']])) {
                $parents[$e['to']][$e['from']] = true;
                $children[$e['from']][$e['to']] = true;
            }
        }
        $order = array_values(array_filter(self::order($canvas), fn ($id) => isset($nodes[$id])));
        $order = [...$order, ...array_diff(array_keys($nodes), $order)];
        $col = [];
        foreach ($order as $id) {
            $col[$id] = $parents[$id] ? max(array_map(fn ($p) => ($col[$p] ?? 0) + 1, array_keys($parents[$id]))) : 0;
        }
        foreach (array_reverse($order) as $id) {
            if (count($children[$id]) === 1) {
                $col[$id] = max($col[$id], $col[array_key_first($children[$id])] - 1);
            }
        }
        $columns = [];
        foreach ($order as $id) {
            $columns[$col[$id]][] = $id;
        }
        ksort($columns);

        $left = min(array_map(fn ($n) => (float) $n['x'], $nodes));
        $top = min(array_map(fn ($n) => (float) $n['y'], $nodes));
        $y = array_map(fn ($n) => (float) $n['y'], $nodes);
        $weight = fn (string $id) => 1 / max(1, count($children[$id]));
        for ($pass = 0; $pass < 4; $pass++) {
            foreach ($columns as $c => $list) {
                $want = [];
                foreach ($list as $id) {
                    // Fed by a node that feeds only it: the next step of a chain, on the same row.
                    $lead = collect(array_keys($parents[$id]))->first(fn ($p) => count($children[$p]) === 1);
                    if ($lead !== null) {
                        $want[$id] = $y[$lead];

                        continue;
                    }
                    [$sum, $w] = [0.0, 0.0];
                    foreach (array_keys($parents[$id]) as $p) {
                        [$sum, $w] = [$sum + $y[$p] * $weight($p), $w + $weight($p)];
                    }
                    foreach (array_keys($children[$id]) as $ch) {
                        [$sum, $w] = [$sum + $y[$ch] * $weight($id), $w + $weight($id)];
                    }
                    $want[$id] = $w > 0 ? $sum / $w : $y[$id];
                }
                usort($list, fn ($a, $b) => [$want[$a], $y[$a]] <=> [$want[$b], $y[$b]]);
                $columns[$c] = $list;
                $next = $top;
                foreach ($list as $id) {
                    $y[$id] = max($want[$id], $next);
                    $next = $y[$id] + self::height($nodes[$id]) + self::GAP;
                }
            }
        }

        // Pulled toward each other, they may have drifted down: back to where the graph started.
        $lift = min($y) - $top;
        $y = array_map(fn ($v) => $v - $lift, $y);
        $moved = 0;
        $canvas['nodes'] = array_map(function ($n) use ($nodes, $col, $y, $left, &$moved) {
            if (! isset($nodes[$n['id']])) {
                return $n;
            }
            [$x, $ny] = [$left + $col[$n['id']] * self::COLUMN, round($y[$n['id']])];
            $moved += (int) ($x != $n['x'] || $ny != $n['y']);

            return [...$n, 'x' => $x, 'y' => $ny];
        }, $canvas['nodes']);

        return [$canvas, ['moved' => $moved]];
    }

    /**
     * About how tall a node's card is: its header, its ports, and what it shows of what it made.
     *
     * @param  array<string, mixed>  $node
     */
    private static function height(array $node): float
    {
        $kind = Catalog::node($node['type']);
        $makes = array_column($kind['outputs'], 'type');
        $shows = match (true) {
            $node['type'] === 'source.media' => empty($node['params']['assets']) ? 0 : 260,
            in_array('post', $makes, true) => 200,
            in_array('image', $makes, true) || in_array('video', $makes, true) => 260,
            in_array('text', $makes, true) || in_array('moments', $makes, true) => 120,
            default => 80,
        };

        return 48 + max(count($kind['inputs']), count($kind['outputs'])) * 24 + $shows;
    }

    /**
     * The y where a node put at x, y lands clear of the others: lower down while it would sit on one.
     *
     * @param  array<string, mixed>  $canvas
     */
    private static function clear(array $canvas, float $x, float $y): float
    {
        for ($tries = 0; $tries < 40 && self::taken($canvas, $x, $y); $tries++) {
            $y += 380;
        }

        return $y;
    }

    /**
     * Whether a card at x, y would sit on another one's header.
     *
     * @param  array<string, mixed>  $canvas
     */
    private static function taken(array $canvas, float $x, float $y): bool
    {
        foreach ($canvas['nodes'] as $n) {
            if (abs((float) $n['x'] - $x) < 240 && abs((float) $n['y'] - $y) < 140) {
                return true;
            }
        }

        return false;
    }

    /**
     * Somewhere empty for a new node: right of everything, at the top.
     *
     * @param  array<string, mixed>  $canvas
     * @return array{0: float, 1: float}
     */
    private static function freeSpot(array $canvas): array
    {
        if (! $canvas['nodes']) {
            return [80.0, 80.0];
        }

        return [max(array_map(fn ($n) => (float) $n['x'], $canvas['nodes'])) + 340, min(array_map(fn ($n) => (float) $n['y'], $canvas['nodes']))];
    }
}

<?php

namespace App\Services\Lab;

use App\Models\Generation;
use Illuminate\Support\Str;
use InvalidArgumentException;

/**
 * A Creative Lab canvas (version 2): nodes joined port to port, and the operations that change it.
 *
 *   {version: 2, rev, nodes: [{id, type, x, y, params, pin?, branch?, label?}],
 *    edges: [{from, out, to, in}], view: {x, y, zoom}}
 *
 * Every change, from the page or from the assistant, is an operation applied to the newest canvas
 * (apply), so two people (or a person and the assistant) editing at once never undo each other.
 * An edge runs from an output port to an input port whose type accepts it; an input that takes one
 * thing keeps only its newest edge; nothing may loop back on itself.
 */
class Graph
{
    public const MAX_NODES = 300;

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
            $what = (string) ($op['op'] ?? '');
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
                    'branch' => self::branch($canvas, (string) ($op['id'] ?? '')),
                    'insert' => self::insert($canvas, (array) ($op['graph'] ?? []), (float) ($op['x'] ?? 0), (float) ($op['y'] ?? 0)),
                    'auto' => [[...$canvas, 'auto' => (bool) ($op['on'] ?? false)], []],
                    'view' => [[...$canvas, 'view' => ['x' => (float) ($op['x'] ?? 0), 'y' => (float) ($op['y'] ?? 0), 'zoom' => max(0.2, min(2.5, (float) ($op['zoom'] ?? 1)))]], []],
                    default => throw new InvalidArgumentException("Unknown operation “{$what}”."),
                };
            } catch (InvalidArgumentException $e) {
                throw new InvalidArgumentException('Operation '.($i + 1)." ({$what}): ".$e->getMessage());
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
        [$x, $y] = isset($node['x'], $node['y']) ? [(float) $node['x'], (float) $node['y']] : self::freeSpot($canvas);
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

        return [$canvas, []];
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
        $canvas['edges'] = array_values(array_filter($canvas['edges'], fn ($e) => ! ($e == $edge)
            && ! (empty($in['multi']) && $e['to'] === $to['id'] && $e['in'] === $in['name'])));
        $canvas['edges'][] = $edge;

        return [$canvas, $edge];
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
     * A fragment (a template's nodes and edges) added with new ids, its top left at x, y.
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
        $left = min(array_map(fn ($n) => (float) ($n['x'] ?? 0), $nodes));
        $top = min(array_map(fn ($n) => (float) ($n['y'] ?? 0), $nodes));
        $map = [];
        foreach ($nodes as $n) {
            $map[(string) ($n['id'] ?? Str::random(6))] = $id = self::newId($canvas, $n['type'], array_values($map));
            $canvas['nodes'][] = array_filter([
                'id' => $id, 'type' => $n['type'],
                'x' => $x + (float) ($n['x'] ?? 0) - $left, 'y' => $y + (float) ($n['y'] ?? 0) - $top,
                'params' => self::cleanParams($n['type'], (array) ($n['params'] ?? [])),
                'label' => $n['label'] ?? null,
            ], fn ($v) => $v !== null);
        }
        foreach ($fragment['edges'] ?? [] as $e) {
            if (isset($map[$e['from'] ?? ''], $map[$e['to'] ?? ''])) {
                [$canvas] = self::connect($canvas, ['from' => $map[$e['from']], 'out' => $e['out'] ?? null, 'to' => $map[$e['to']], 'in' => $e['in'] ?? null]);
            }
        }

        return [$canvas, ['ids' => $map]];
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

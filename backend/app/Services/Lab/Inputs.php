<?php

namespace App\Services\Lab;

use App\Models\Asset;
use App\Models\VideoSource;
use Illuminate\Support\Collection;

/**
 * What flows into a node, port by port: the values on the lines into it, in the order they were drawn.
 */
class Inputs
{
    /**
     * @param  array<string, list<array<string, mixed>>>  $ports  values per input port
     * @param  list<string>  $missing  why it can't run yet, for the person
     */
    public function __construct(public readonly array $ports, private readonly array $missing, private readonly int $userId) {}

    /**
     * @param  array<string, mixed>  $node
     */
    public static function resolve(Context $ctx, array $node): self
    {
        $kind = Catalog::node($node['type']);
        $ports = [];
        $missing = [];
        foreach ($kind['inputs'] as $port) {
            $values = [];
            foreach (Graph::into($ctx->canvas, $node['id'], $port['name']) as $edge) {
                $up = Graph::find($ctx->canvas, $edge['from']);
                if (! $up) {
                    continue;
                }
                $label = $up['label'] ?? Catalog::node($up['type'])['label'];
                $value = $ctx->outputs($edge['from'])[$edge['out']] ?? null;
                $runnable = $ctx->engine->policy($up) !== 'none';
                if ($runnable && ! $ctx->current($up)) {
                    $missing[] = "Waiting for {$label}.";

                    continue;
                }
                if (! $ctx->engine->filled($value)) {
                    if (! empty($port['required'])) {
                        $missing[] = $runnable ? "{$label} made no ".mb_strtolower(Catalog::PORT_TYPES[Catalog::output($up['type'], $edge['out'])['type'] ?? 'text'] ?? 'output').' for it.' : "{$label} is empty.";
                    }

                    continue;
                }
                $values[] = $value;
            }
            if (! empty($port['required']) && ! $values && ! Graph::into($ctx->canvas, $node['id'], $port['name'])) {
                $missing[] = "Connect {$port['label']}.";
            }
            $ports[$port['name']] = $values;
        }

        return new self($ports, array_values(array_unique($missing)), $ctx->project->user_id);
    }

    /**
     * @return list<string>
     */
    public function missing(): array
    {
        return $this->missing;
    }

    /**
     * The inputs reduced to what identifies them, for the node's hash.
     *
     * @return array<string, list<mixed>>
     */
    public function identity(): array
    {
        return array_map(fn ($values) => array_map(fn ($v) => match ($v['type'] ?? null) {
            'text' => ['text', (string) $v['text']],
            'brief' => ['brief', $v['brief']],
            'moments' => ['moments', $v['moments'], $v['source_id'] ?? null, $v['asset_id'] ?? null],
            'transcript' => ['transcript', $v['asset_id'] ?? null, $v['source_id'] ?? null, sha1((string) ($v['text'] ?? ''))],
            'source' => ['source', $v['source_id'] ?? null],
            'post' => ['post', $v['post_id'] ?? null],
            'channel' => ['channel', $v['account_id'] ?? null, $v['placement'] ?? null],
            default => [$v['type'] ?? '?', array_map('intval', $v['assets'] ?? [])],
        }, $values), $this->ports);
    }

    /**
     * What it ran with, kept on the run (texts trimmed).
     *
     * @return array<string, list<mixed>>
     */
    public function snapshot(): array
    {
        return array_map(fn ($values) => array_map(function ($v) {
            if (isset($v['text']) && is_string($v['text'])) {
                $v['text'] = mb_substr($v['text'], 0, 4000);
            }
            unset($v['words']);

            return $v;
        }, $values), $this->ports);
    }

    public function has(string $port): bool
    {
        return ! empty($this->ports[$port]);
    }

    /**
     * Asset ids on a port (every line), of these kinds when given.
     *
     * @param  list<string>  $kinds
     * @return list<int>
     */
    public function assetIds(string $port, array $kinds = []): array
    {
        $ids = [];
        foreach ($this->ports[$port] ?? [] as $v) {
            if ($kinds && ! in_array($v['type'] ?? null, $kinds, true)) {
                continue;
            }
            foreach ($v['assets'] ?? [] as $id) {
                $ids[] = (int) $id;
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * The assets on a port, in order, the user's own only.
     *
     * @param  list<string>  $kinds
     * @return Collection<int, Asset>
     */
    public function assets(string $port, array $kinds = []): Collection
    {
        $ids = $this->assetIds($port, $kinds);
        if (! $ids) {
            return collect();
        }

        return Asset::where('user_id', $this->userId)->whereIn('id', $ids)->get()->sortBy(fn (Asset $a) => array_search($a->id, $ids))->values();
    }

    public function asset(string $port, array $kinds = []): ?Asset
    {
        return $this->assets($port, $kinds)->first();
    }

    /** The texts on a port, joined. */
    public function text(string $port): string
    {
        return trim(collect($this->ports[$port] ?? [])->map(fn ($v) => match ($v['type'] ?? null) {
            'text', 'transcript' => (string) ($v['text'] ?? ''),
            'moments' => collect($v['moments'] ?? [])->map(fn ($m) => '- '.($m['title'] ?? '').': '.($m['quote'] ?? $m['hook'] ?? ''))->join("\n"),
            default => '',
        })->filter()->join("\n\n"));
    }

    /**
     * @return array<string, mixed>|null
     */
    public function brief(string $port = 'brief'): ?array
    {
        return $this->ports[$port][0]['brief'] ?? null;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function first(string $port): ?array
    {
        return $this->ports[$port][0] ?? null;
    }

    public function source(string $port): ?VideoSource
    {
        foreach ($this->ports[$port] ?? [] as $v) {
            if (($v['type'] ?? null) === 'source' && ! empty($v['source_id'])) {
                return VideoSource::where('user_id', $this->userId)->find($v['source_id']);
            }
        }

        return null;
    }
}

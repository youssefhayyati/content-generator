<?php

namespace App\Services\Lab;

use App\Models\Asset;
use App\Models\Project;

/**
 * The outputs of nodes with nothing to run: what they hold goes straight on.
 */
class Instant
{
    /**
     * @param  array<string, mixed>  $node
     * @return array<string, mixed>
     */
    public static function outputs(Project $project, array $node): array
    {
        $p = Catalog::withDefaults($node['type'], $node['params'] ?? []);

        return match ($node['type']) {
            'source.media' => self::media($project, array_map('intval', (array) $p['assets'])),
            'source.text' => ['text' => ['type' => 'text', 'text' => (string) $p['text']]],
            'source.brief' => ['brief' => ['type' => 'brief', 'brief' => Brief::compile($project, $p)]],
            default => [],
        };
    }

    /**
     * @param  list<int>  $ids
     * @return array<string, mixed>
     */
    private static function media(Project $project, array $ids): array
    {
        $kinds = Asset::where('user_id', $project->user_id)->whereIn('id', $ids)->pluck('kind', 'id');
        $out = [];
        foreach (['image', 'video', 'audio'] as $kind) {
            $out[$kind] = ['type' => $kind, 'assets' => array_values(array_filter($ids, fn ($id) => ($kinds[$id] ?? null) === $kind))];
        }

        return $out;
    }
}

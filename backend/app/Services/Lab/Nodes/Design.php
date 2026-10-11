<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Brief;
use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Design: words drawn on the slides (pictures or videos), sized for the platform and kept out of
 * the parts its buttons cover (the assistant's text drawing, assistant/backend/studio.py). A headline
 * connected, with no words set, goes on the first slide; the brief's font and colour are the defaults.
 */
class Design extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->model('engine/design');
        $p = $job->params;
        $brief = $this->brief($job);
        $media = $job->inputs->assetIds('media', ['image', 'video']);
        $texts = array_values(array_filter((array) ($p['texts'] ?? []), fn ($t) => trim((string) ($t['text'] ?? '')) !== ''));
        $headline = trim(strtok($job->inputs->text('headline'), "\n") ?: '');
        if (! $texts && $headline !== '') {
            $texts = [['slide' => 1, 'text' => $headline, 'position' => 'top', 'size' => 'large']];
        }
        $color = collect($brief['palette'] ?? [])->first();
        $texts = array_map(fn ($t) => array_filter([
            ...$t,
            'text' => Brief::fill((string) $t['text'], $brief),
            'font' => $t['font'] ?? $brief['font'] ?? null,
            'color' => $t['color'] ?? null,
        ], fn ($v) => $v !== null && $v !== ''), $texts);
        if (! $media && ! $texts) {
            throw new NodeFailed('Connect pictures or videos, or add words for a plain slide.');
        }
        $job->stage('Drawing the words');
        $job->generate('design', $model['id'], $headline ?: ($texts[0]['text'] ?? 'Design'), [
            'platform' => $p['platform'] ?? 'instagram',
            'placement' => $p['placement'] ?? 'feed',
            'texts' => $texts,
            'background' => $p['background'] ?? '#1c1c1c',
            'accent' => $color,
            'slides' => max(count($media), (int) collect($texts)->max('slide')),
        ], $media);

        return ['wait' => true];
    }
}

<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Brief;
use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Ad maker: Higgsfield Ads Studio. One brief, 1 to 8 finished ads (the headline and copy drawn in), with
 * the product photos as they are. What's left empty comes from the brief.
 */
class Ads extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->nodeModel($job);
        $p = $job->params;
        $brief = $this->brief($job);
        $prompt = $this->prompt($job, 'prompt', 'prompt', style: true);
        if ($prompt === '' && $brief) {
            $prompt = trim(implode('. ', array_filter([
                filled($brief['product'] ?? null) ? "Advertise {$brief['product']}" : null,
                $brief['offer'] ?? null,
                filled($brief['cta'] ?? null) ? "Call to action: {$brief['cta']}" : null,
                filled($brief['tone'] ?? null) ? "Tone: {$brief['tone']}" : null,
                ($words = Brief::styleWords($brief)) !== '' ? "Look: {$words}" : null,
            ])));
        }
        if ($prompt === '') {
            throw new NodeFailed('Say what the ads are for and what they say, or connect a brief.');
        }
        $photos = array_slice($job->inputs->assetIds('product', ['image']), 0, 10);
        $n = max(1, min(8, (int) ($p['count'] ?? 4)));
        $job->stage("Making {$n} ad".($n > 1 ? 's' : '').' with '.$model['label']);
        $job->generate('image', $model['id'], mb_substr($prompt, 0, 8000), array_filter([
            'aspect_ratio' => $p['aspect'] ?: '4:5',
            'batch_size' => $n,
            'niche' => trim((string) ($p['niche'] ?? '')) ?: ($brief['product'] ?? null),
            'target_audience' => trim((string) ($p['audience'] ?? '')) ?: ($brief['audience'] ?? null),
            'language' => trim((string) ($p['language'] ?? '')) ?: null,
        ], fn ($v) => $v !== null && $v !== ''), $photos);

        return ['wait' => true];
    }
}

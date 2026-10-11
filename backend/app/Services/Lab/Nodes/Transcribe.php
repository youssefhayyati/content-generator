<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\Listening;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;
use Illuminate\Support\Str;

/**
 * Transcript: every word and when it's said. An online video uses YouTube's own captions when it has
 * them, else its sound is heard; a file is heard once and the words kept with it.
 */
class Transcribe extends Executor
{
    public function __construct(private readonly Listening $listening) {}

    public function start(NodeJob $job): array
    {
        $language = trim((string) ($job->params['language'] ?? '')) ?: null;
        $progress = fn ($stage, $share) => $job->stage($stage, $share);

        if ($source = $job->inputs->source('media')) {
            if (empty($source->transcript['words'])) {
                $audio = $source->audio ?? throw new NodeFailed('Fetch the video first.');
                $heard = $this->listening->asset($audio, $language, $progress);
                $source->update(['transcript' => [...$heard, 'from' => 'whisper']]);
            }
            $t = $source->transcript;
            $ref = ['source_id' => $source->id];
        } else {
            $asset = $job->inputs->asset('media', ['audio', 'video']) ?? throw new NodeFailed('Connect a sound or a video.');
            $t = $this->listening->asset($asset, $language, $progress);
            $ref = ['asset_id' => $asset->id];
        }
        if (empty($t['words'])) {
            throw new NodeFailed('No words could be made out.');
        }
        $text = trim((string) ($t['text'] ?? '')) ?: implode(' ', array_column($t['words'], 'text'));

        return ['outputs' => [
            'transcript' => ['type' => 'transcript', ...$ref, 'text' => Str::limit($text, 600), 'language' => $t['language'] ?? null, 'words' => count($t['words']), 'duration' => $t['duration'] ?? end($t['words'])['end']],
            'text' => ['type' => 'text', 'text' => $text],
        ]];
    }
}

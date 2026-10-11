<?php

namespace App\Services\Ai\Media;

use App\Models\Asset;
use App\Models\Generation;
use App\Services\Ai\GenerationFailed;
use App\Services\Lab\EngineClient;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

/**
 * Generations made by the assistant service's engine: the GPU pod's models (pod/…) and the
 * assistant's own drawing (engine/…). The files go to the engine with the job; what it made comes
 * back from it when it's done.
 */
class EngineProvider implements MediaProvider
{
    public function __construct(private readonly EngineClient $engine) {}

    public function submit(array $model, Generation $generation, Collection $inputs): array
    {
        $p = $generation->params ?? [];
        $disk = Storage::disk('local');
        $file = fn (Asset $a) => [$disk->path($a->path), basename($a->path)];
        $name = $model['model'];

        [$task, $params, $files] = match (true) {
            $model['provider'] === 'pod' && in_array($generation->kind, ['image', 'video'], true) => ['comfy', [
                'workflow' => $name,
                'prompt' => $generation->prompt === '(no prompt)' ? '' : $generation->prompt,
                'aspect' => $p['aspect_ratio'] ?? null,
                'seconds' => $p['duration'] ?? null,
                'negative' => $p['negative_prompt'] ?? null,
                'seed' => $p['seed'] ?? null,
            ], ($image = $inputs->firstWhere('kind', 'image')) ? ['image' => $file($image)] : []],
            $generation->kind === 'song' => ['song', ['description' => $generation->prompt, 'seconds' => (float) ($p['seconds'] ?? 30), 'seed' => $p['seed'] ?? null], []],
            $generation->kind === 'dub' => ['dub', ['script' => $generation->prompt, 'voice' => $p['voice'] ?? null], ['video' => $file($inputs->firstWhere('kind', 'video') ?? throw new GenerationFailed('Connect the video to dub.'))]],
            $generation->kind === 'swap' => ['swap', ['every' => (bool) ($p['every'] ?? false)], [
                'face' => $file($inputs->first() ?? throw new GenerationFailed('Connect the face.')),
                'target' => $file($inputs->skip(1)->first() ?? throw new GenerationFailed('Connect what to put the face on.')),
            ]],
            $generation->kind === 'design' => ['design', $p, ['media' => $inputs->map($file)->values()->all()]],
            $generation->kind === 'slideshow' => ['slideshow', $p, array_filter([
                'images' => $inputs->where('kind', 'image')->map($file)->values()->all(),
                'music' => ($m = $inputs->firstWhere('kind', 'audio')) ? $file($m) : null,
            ])],
            $generation->kind === 'retouch' => ['retouch', ['mode' => $p['mode'] ?? 'change', 'prompt' => $generation->prompt === '(no prompt)' ? '' : $generation->prompt], [
                'image' => $file($inputs->first() ?? throw new GenerationFailed('Connect the picture.')),
                'mask' => $file($inputs->skip(1)->first() ?? throw new GenerationFailed('Paint over the part to change first.')),
            ]],
            default => throw new GenerationFailed('The engine doesn’t make that.'),
        };

        $id = $this->engine->submit($task, $params, $files);

        return ['external_id' => $id, 'status_url' => $this->engine->url()."/engine/jobs/{$id}"];
    }

    public function poll(Generation $generation): array
    {
        $s = $this->engine->status((string) $generation->external_id);
        // Where it has got shows on its node.
        if ($generation->node_run_id && ($run = $generation->nodeRun) && ! $run->isFinished() && filled($s['stage'] ?? null)) {
            $run->update(['stage' => mb_substr((string) $s['stage'], 0, 160), 'share' => isset($s['share']) ? (float) $s['share'] : null]);
        }

        return match ($s['status'] ?? 'running') {
            'done' => ['status' => 'succeeded', 'outputs' => collect($s['files'] ?? [])->map(fn ($f, $i) => [
                'url' => $this->engine->fileUrl((string) $generation->external_id, (int) ($f['index'] ?? $i)),
                'headers' => $this->engine->headers(),
                'mime' => (string) ($f['mime'] ?? 'application/octet-stream'),
                'meta' => (array) ($f['meta'] ?? []),
            ])->values()->all()],
            'failed', 'canceled' => ['status' => 'failed', 'error' => $s['error'] ?? 'The engine stopped.'],
            default => ['status' => 'running'],
        };
    }
}

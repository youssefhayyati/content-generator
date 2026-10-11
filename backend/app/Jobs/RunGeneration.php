<?php

namespace App\Jobs;

use App\Models\Generation;
use App\Services\Ai\Media\GenerationRunner;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/** Send an image or video generation to its provider. */
class RunGeneration implements ShouldQueue
{
    use Queueable;

    public int $timeout = 300;

    public function __construct(public int $generationId)
    {
        $this->onQueue('media');
    }

    public function handle(GenerationRunner $runner): void
    {
        $generation = Generation::find($this->generationId);
        if ($generation && $generation->status === 'queued') {
            $runner->start($generation);
        }
    }

    /** Killed or crashed: the generation (and a node or campaign waiting on it) hears so instead of waiting forever. */
    public function failed(?Throwable $e): void
    {
        $generation = Generation::find($this->generationId);
        if ($generation && ! $generation->isFinished()) {
            app(GenerationRunner::class)->fail($generation, 'It couldn’t be sent to the provider: it took too long or stopped unexpectedly. Try again.');
        }
    }
}

<?php

namespace App\Jobs;

use App\Models\NodeRun;
use App\Services\Lab\Engine;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/** Run one Creative Lab node (Engine::execute). */
class RunLabNode implements ShouldQueue
{
    use Queueable;

    public int $timeout = 900;

    public int $tries = 1;

    public function __construct(public int $runId)
    {
        $this->onQueue('media');
    }

    public function handle(Engine $engine): void
    {
        $run = NodeRun::find($this->runId);
        if ($run) {
            $engine->execute($run);
        }
    }

    public function failed(?Throwable $e): void
    {
        $run = NodeRun::find($this->runId);
        if ($run && ! $run->isFinished()) {
            app(Engine::class)->fail($run, 'It took too long or stopped unexpectedly. Try again.');
        }
    }
}

<?php

namespace App\Jobs;

use App\Models\FlowRun;
use App\Services\Flows\Engine;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Carry a flow run forward until it ends, waits for a timer, or waits for a person. */
class AdvanceFlow implements ShouldQueue
{
    use Queueable;

    public int $timeout = 600;

    public int $tries = 1;

    public function __construct(public int $runId)
    {
        $this->onQueue('agents');
    }

    public function handle(Engine $engine): void
    {
        $run = FlowRun::with(['flow', 'user'])->find($this->runId);
        if (! $run || $run->status !== 'running') {
            return;
        }
        $engine->advance($run);
    }
}

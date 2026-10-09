<?php

namespace App\Services\Flows;

use App\Jobs\AdvanceFlow;
use App\Models\ActionLog;
use App\Models\Flow;
use App\Models\FlowRun;
use App\Models\User;
use App\Services\Ai\GenerationFailed;
use Illuminate\Support\Str;
use Throwable;

/**
 * Walks a run through its flow. From the trigger, each node runs and says where to go next;
 * the run keeps a trail of every step (what it did, how long it took) so the canvas can replay
 * it. A Wait parks the run until its time; an "Ask me first" parks it in the Inbox until a
 * person decides. Branches run one after the other, depth first.
 */
class Engine
{
    /** A run that goes on longer than this is stopped: something is wrong with the flow. */
    private const MAX_STEPS = 60;

    public function __construct(private readonly Steps $steps) {}

    /**
     * Start a run from the trigger, with what the trigger knows (the post, the comment, the
     * feed item) as the run's first variables.
     */
    public function start(Flow $flow, array $context, string $cause): FlowRun
    {
        $trigger = $flow->triggerNode();
        $run = $flow->runs()->create([
            'user_id' => $flow->user_id,
            'cause' => Str::limit($cause, 195),
            'context' => $context,
            'pending' => Graph::next($flow->graph, $trigger['id'], 'next'),
            'trail' => [$this->entry($trigger, 'ok', 'next', $cause, 0)],
        ]);
        AdvanceFlow::dispatch($run->id);

        return $run;
    }

    /** Run nodes until the run ends, waits for a timer, or waits for a person. */
    public function advance(FlowRun $run): void
    {
        $run->loadMissing(['flow', 'user']);
        $graph = $run->flow->graph;
        $pending = $run->pending ?? [];

        while ($pending) {
            if (count($run->trail ?? []) >= self::MAX_STEPS) {
                $this->finish($run, 'failed', 'The run took more than '.self::MAX_STEPS.' steps and was stopped.');

                return;
            }
            $id = array_shift($pending);
            $node = Graph::node($graph, $id);
            if (! $node) {
                continue;
            }

            $started = microtime(true);
            try {
                $result = $this->steps->run($node, $run);
            } catch (GenerationFailed $e) {
                $result = ['status' => 'fail', 'summary' => $e->getMessage()];
            } catch (Throwable $e) {
                report($e);
                $result = ['status' => 'fail', 'summary' => 'This step broke: '.Str::limit($e->getMessage(), 160)];
            }
            $ms = (int) round((microtime(true) - $started) * 1000);
            $run->context = [...$run->context ?? [], ...$result['set'] ?? []];

            switch ($result['status']) {
                case 'fail':
                    $run->trail = [...$run->trail ?? [], $this->entry($node, 'failed', null, $result['summary'], $ms)];
                    $run->pending = [];
                    $this->finish($run, 'failed', $result['summary']);

                    return;

                case 'end':
                    // This branch is done (nothing to do); other branches carry on.
                    $run->trail = [...$run->trail ?? [], $this->entry($node, 'ended', null, $result['summary'], $ms)];
                    break;

                case 'wait':
                    $run->trail = [...$run->trail ?? [], $this->entry($node, 'waiting', 'next', $result['summary'], $ms)];
                    $run->fill([
                        'status' => 'waiting',
                        'waiting_on' => $id,
                        'resume_at' => $result['resume_at'],
                        'pending' => [...Graph::next($graph, $id, 'next'), ...$pending],
                    ])->save();

                    return;

                case 'approval':
                    $run->trail = [...$run->trail ?? [], $this->entry($node, 'approval', null, $result['summary'], $ms)];
                    $run->fill(['status' => 'approval', 'waiting_on' => $id, 'pending' => $pending])->save();

                    return;

                default:
                    $port = $result['port'] ?? 'next';
                    $run->trail = [...$run->trail ?? [], $this->entry($node, 'ok', $port, $result['summary'], $ms)];
                    $pending = [...Graph::next($graph, $id, $port), ...$pending];
            }

            // Save after every step, so the canvas can follow a live run.
            $run->pending = $pending;
            $run->save();
        }

        $this->finish($run, 'done');
    }

    /** A timer ran out: carry on from after the Wait. */
    public function resume(FlowRun $run): void
    {
        $taken = FlowRun::whereKey($run->id)->where('status', 'waiting')->update(['status' => 'running', 'resume_at' => null, 'waiting_on' => null]);
        if ($taken) {
            AdvanceFlow::dispatch($run->id);
        }
    }

    /**
     * A person decided on an "Ask me first": approved (perhaps with the draft edited) or rejected.
     * An approval is what lets a later "Schedule a post" put the draft on the calendar.
     */
    public function decide(FlowRun $run, bool $approve, ?string $draft, User $by): void
    {
        abort_unless($run->status === 'approval', 409, 'This run isn’t waiting for a decision.');
        $node = Graph::node($run->flow->graph, (string) $run->waiting_on);
        $taken = FlowRun::whereKey($run->id)->where('status', 'approval')->update(['status' => 'running']);
        abort_unless($taken && $node, 409, 'Someone already decided.');
        $run->refresh();

        $context = $run->context ?? [];
        unset($context['_approval']);
        if ($approve) {
            if (filled($draft)) {
                $context['draft'] = trim($draft);
            }
            $context['_approved_by'] = $by->id;
            $context['_approved_at'] = now()->toIso8601ZuluString();
        }
        $port = $approve ? 'approved' : 'rejected';
        $summary = $approve ? (filled($draft) ? 'Approved by you, with your edits.' : 'Approved by you.') : 'Rejected by you.';

        $run->fill([
            'context' => $context,
            'trail' => [...$run->trail ?? [], $this->entry($node, 'ok', $port, $summary, 0)],
            'pending' => [...Graph::next($run->flow->graph, $node['id'], $port), ...$run->pending ?? []],
            'waiting_on' => null,
        ])->save();
        ActionLog::record($by, 'you', $approve ? 'flow.approved' : 'flow.rejected', $run, "{$summary} ({$run->flow->name})", 'approved');

        AdvanceFlow::dispatch($run->id);
    }

    public function stop(FlowRun $run, User $by): void
    {
        abort_unless($run->isLive(), 409, 'This run already ended.');
        $this->finish($run, 'stopped', 'Stopped by you.');
        ActionLog::record($by, 'you', 'flow.stopped', $run, "Stopped a run of “{$run->flow->name}”.");
    }

    private function finish(FlowRun $run, string $status, ?string $error = null): void
    {
        $context = $run->context ?? [];
        unset($context['_approval']);
        $run->fill([
            'status' => $status,
            'context' => $context,
            'error' => $status === 'done' ? null : $error,
            'pending' => [],
            'waiting_on' => null,
            'resume_at' => null,
            'finished_at' => now(),
        ])->save();
    }

    /**
     * @return array{node: string, type: string, status: string, port: string|null, summary: string, ms: int, at: string}
     */
    private function entry(array $node, string $status, ?string $port, string $summary, int $ms): array
    {
        return [
            'node' => $node['id'],
            'type' => $node['type'],
            'status' => $status,
            'port' => $port,
            'summary' => Str::limit($summary, 400),
            'ms' => $ms,
            'at' => now()->toIso8601ZuluString(),
        ];
    }
}

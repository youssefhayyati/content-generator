<?php

namespace App\Http\Controllers;

use App\Models\FlowRun;
use App\Services\Flows\Engine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * One run of a flow: watched live on the canvas, decided on when it asks, stopped when it
 * shouldn't go on.
 */
class FlowRunController extends Controller
{
    public function show(Request $request, FlowRun $run): JsonResponse
    {
        $this->own($request, $run);

        return response()->json($this->out($run->load('flow')));
    }

    /** Approve (optionally with the draft edited) or reject what an "Ask me first" is holding. */
    public function decide(Request $request, FlowRun $run, Engine $engine): JsonResponse
    {
        $this->own($request, $run);
        $data = $request->validate([
            'approve' => ['required', 'boolean'],
            'draft' => ['nullable', 'string', 'max:5000'],
        ]);
        $engine->decide($run->load('flow'), $data['approve'], $data['draft'] ?? null, $request->user());

        return response()->json($this->out($run->fresh('flow')));
    }

    public function stop(Request $request, FlowRun $run, Engine $engine): JsonResponse
    {
        $this->own($request, $run);
        $engine->stop($run->load('flow'), $request->user());

        return response()->json($this->out($run->fresh('flow')));
    }

    /**
     * @return array<string, mixed>
     */
    public function out(FlowRun $r): array
    {
        // Variables for people to read; the run's own bookkeeping (_approved_by…) stays inside.
        $vars = collect($r->context ?? [])->reject(fn ($v, string $k) => str_starts_with($k, '_'))->all();

        return [
            'id' => $r->id,
            'flow_id' => $r->flow_id,
            'flow' => $r->flow?->name,
            'status' => $r->status,
            'cause' => $r->cause,
            'vars' => (object) $vars,
            'trail' => $r->trail ?? [],
            // The node working right now, so the canvas can show it thinking.
            'next' => $r->status === 'running' ? ($r->pending[0] ?? null) : null,
            'waiting_on' => $r->waiting_on,
            'resume_at' => $r->resume_at?->toIso8601ZuluString(),
            'approval' => $r->approval(),
            'error' => $r->error,
            'created_at' => $r->created_at?->toIso8601ZuluString(),
            'finished_at' => $r->finished_at?->toIso8601ZuluString(),
        ];
    }

    private function own(Request $request, FlowRun $run): void
    {
        abort_unless($run->user()->is($request->user()), 404);
    }
}

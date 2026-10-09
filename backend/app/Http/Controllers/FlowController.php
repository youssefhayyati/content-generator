<?php

namespace App\Http\Controllers;

use App\Models\ActionLog;
use App\Models\Flow;
use App\Models\FlowRun;
use App\Services\Ai\GenerationFailed;
use App\Services\Flows\Catalog;
use App\Services\Flows\Composer;
use App\Services\Flows\Engine;
use App\Services\Flows\Flows;
use App\Services\Flows\Graph;
use App\Services\Flows\Templates;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Flows: automations drawn on a canvas, started from a template, or described in plain words.
 * A flow is off until the operator switches it on; "Run now" tries it with real data.
 */
class FlowController extends Controller
{
    public function __construct(private readonly Flows $flows) {}

    /** Every flow, the latest runs across all of them, and the numbers for the header. */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $flows = $user->flows()->withCount('runs')->latest('updated_at')->get();
        $last = FlowRun::whereIn('id', FlowRun::selectRaw('max(id)')->whereIn('flow_id', $flows->pluck('id'))->groupBy('flow_id'))->get()->keyBy('flow_id');
        $runs = $user->flowRuns()->with('flow:id,name')->latest('id')->limit(14)->get();

        return response()->json([
            'flows' => $flows->map(fn (Flow $f) => $this->summary($f, $last->get($f->id))),
            'runs' => $runs->map(fn (FlowRun $r) => $this->runSummary($r)),
            'stats' => [
                'on' => $flows->where('enabled', true)->count(),
                'runs_today' => $user->flowRuns()->where('created_at', '>=', now()->startOfDay())->count(),
                'waiting_on_you' => $user->flowRuns()->where('status', 'approval')->count(),
            ],
        ]);
    }

    /** What the canvas needs: the node catalog and the ready-made flows, built for this user. */
    public function catalog(Request $request): JsonResponse
    {
        return response()->json([
            'groups' => Catalog::GROUPS,
            'nodes' => Catalog::nodes(),
            'templates' => Templates::all($request->user()),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:300'],
            'template' => ['nullable', 'string', Rule::in(Templates::KEYS)],
            'graph' => ['nullable', 'array'],
        ]);
        $user = $request->user();
        $template = isset($data['template']) ? Templates::make($data['template'], $user) : null;
        $graph = Graph::normalize($data['graph'] ?? $template['graph'] ?? [
            'nodes' => [['id' => 'start', 'type' => 'trigger.manual', 'x' => 40, 'y' => 40, 'config' => []]],
            'edges' => [],
        ], $user);

        $flow = $user->flows()->create([
            'name' => $data['name'] ?? $template['name'] ?? 'Untitled flow',
            'description' => $data['description'] ?? $template['tagline'] ?? null,
            'graph' => $graph,
            'trigger' => $this->triggerOf($graph),
            'template' => $data['template'] ?? null,
        ]);
        ActionLog::record($user, 'you', 'flow.created', $flow, "Created the flow “{$flow->name}”.");

        return response()->json($this->detail($flow), 201);
    }

    public function show(Request $request, Flow $flow): JsonResponse
    {
        $this->own($request, $flow);

        return response()->json($this->detail($flow));
    }

    public function update(Request $request, Flow $flow): JsonResponse
    {
        $this->own($request, $flow);
        $data = $request->validate([
            'name' => ['sometimes', 'string', 'min:1', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:300'],
            'graph' => ['sometimes', 'array'],
            'enabled' => ['sometimes', 'boolean'],
        ]);
        if (isset($data['graph'])) {
            $data['graph'] = Graph::normalize($data['graph'], $request->user());
            $data['trigger'] = $this->triggerOf($data['graph']);
            if ($data['trigger'] !== $flow->trigger) {
                $data['state'] = null; // a new trigger starts with a clean memory
                $data['polled_at'] = null;
            }
        }
        $wasOn = $flow->enabled;
        $flow->fill($data);

        if ($flow->enabled && $flow->trigger === 'trigger.rss' && blank($flow->triggerConfig()['url'] ?? null)) {
            throw ValidationException::withMessages(['enabled' => 'Give the feed trigger a URL before switching the flow on.']);
        }
        $flow->next_run_at = $this->flows->nextRunAt($flow);
        $flow->save();

        if ($wasOn !== $flow->enabled) {
            ActionLog::record($request->user(), 'you', $flow->enabled ? 'flow.enabled' : 'flow.disabled', $flow,
                ($flow->enabled ? 'Switched on' : 'Switched off')." the flow “{$flow->name}”.");
        }

        return response()->json($this->detail($flow->fresh()));
    }

    public function destroy(Request $request, Flow $flow): Response
    {
        $this->own($request, $flow);
        $flow->delete();

        return response()->noContent();
    }

    /** "Run now": the flow runs once, starting from a real example of what its trigger carries. */
    public function run(Request $request, Flow $flow, Engine $engine): JsonResponse
    {
        $this->own($request, $flow);
        abort_if($flow->runs()->whereIn('status', ['running'])->where('created_at', '>=', now()->subMinutes(10))->exists(), 409, 'This flow is already running. Watch it on the canvas.');
        [$context, $cause] = $this->flows->sample($flow);
        $run = $engine->start($flow, $context, $cause);

        return response()->json(app(FlowRunController::class)->out($run->fresh('flow')), 201);
    }

    /** "Say it": plain words in, a flow out — shown on the canvas, not saved until the operator says so. */
    public function compose(Request $request, Composer $composer): JsonResponse
    {
        $data = $request->validate(['prompt' => ['required', 'string', 'min:8', 'max:800']], [
            'prompt.min' => 'Say a little more: what should start it, and what should happen?',
        ]);
        try {
            return response()->json($composer->compose($request->user(), $data['prompt']));
        } catch (GenerationFailed $e) {
            abort(502, $e->getMessage());
        }
    }

    /* ------------------------------------------------------------------ */

    private function triggerOf(array $graph): string
    {
        return collect($graph['nodes'])->first(fn (array $n) => Catalog::isTrigger($n['type']))['type'];
    }

    private function own(Request $request, Flow $flow): void
    {
        abort_unless($flow->user()->is($request->user()), 404);
    }

    /**
     * @return array<string, mixed>
     */
    private function summary(Flow $f, ?FlowRun $last): array
    {
        $trigger = Catalog::find($f->trigger);

        return [
            'id' => $f->id,
            'name' => $f->name,
            'description' => $f->description,
            'enabled' => $f->enabled,
            'trigger' => $f->trigger,
            'trigger_label' => $f->trigger === 'trigger.schedule' ? Str::after($this->flows->scheduleLabel($f), 'Scheduled: ') : ($trigger['label'] ?? $f->trigger),
            'template' => $f->template,
            'graph' => $f->graph,
            'next_run_at' => $f->next_run_at?->toIso8601ZuluString(),
            'runs_count' => (int) ($f->runs_count ?? $f->runs()->count()),
            'last_run' => $last ? ['id' => $last->id, 'status' => $last->status, 'cause' => $last->cause, 'created_at' => $last->created_at?->toIso8601ZuluString()] : null,
            'problem' => $f->state['error'] ?? null,
            'updated_at' => $f->updated_at?->toIso8601ZuluString(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(Flow $f): array
    {
        $runs = $f->runs()->latest('id')->limit(25)->get();

        return [
            ...$this->summary($f, $runs->first()),
            'runs' => $runs->map(fn (FlowRun $r) => $this->runSummary($r)),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function runSummary(FlowRun $r): array
    {
        return [
            'id' => $r->id,
            'flow_id' => $r->flow_id,
            'flow' => $r->relationLoaded('flow') ? $r->flow?->name : null,
            'status' => $r->status,
            'cause' => $r->cause,
            'steps' => count($r->trail ?? []),
            'error' => $r->error,
            'created_at' => $r->created_at?->toIso8601ZuluString(),
            'finished_at' => $r->finished_at?->toIso8601ZuluString(),
        ];
    }
}

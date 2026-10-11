<?php

namespace App\Http\Controllers;

use App\Models\NodeRun;
use App\Models\Project;
use App\Services\Lab\Graph;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

/**
 * Creative Lab projects: a named canvas of nodes. The canvas itself changes through operations
 * (LabController::ops, App\Services\Lab\Graph), never by saving it whole, so the page and the
 * assistant editing at once never overwrite each other; here a project is listed, made, renamed or deleted.
 */
class ProjectController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $projects = $request->user()->projects()->withCount('generations')->latest('updated_at')->get();
        $active = NodeRun::whereIn('project_id', $projects->modelKeys())->whereIn('status', ['queued', 'running'])
            ->get(['project_id', 'status', 'state'])->groupBy('project_id');

        return response()->json($projects->map(fn (Project $p) => $this->summary($p, $active->get($p->id, collect()))));
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(['name' => ['required', 'string', 'max:80']]);
        $project = $request->user()->projects()->create($data + ['canvas' => Graph::normalize(['version' => 2])]);

        return response()->json($this->full($project), 201);
    }

    public function show(Project $project): JsonResponse
    {
        Gate::authorize('view', $project);

        return response()->json($this->full($project));
    }

    /** Rename it. */
    public function update(Request $request, Project $project): JsonResponse
    {
        Gate::authorize('update', $project);
        $project->update($request->validate(['name' => ['required', 'string', 'max:80']]));

        return response()->json($this->full($project));
    }

    public function destroy(Project $project): Response
    {
        Gate::authorize('delete', $project);
        $project->delete();

        return response()->noContent();
    }

    /**
     * @param  Collection<int, NodeRun>|null  $active  its queued and running runs, when the caller has them already
     */
    private function summary(Project $p, ?Collection $active = null): array
    {
        $active ??= $p->nodeRuns()->whereIn('status', ['queued', 'running'])->get(['status', 'state']);
        // Queued behind nodes before it that haven't finished: waiting. Running, or about to start: working.
        $waiting = $active->filter(fn (NodeRun $r) => $r->status === 'queued' && ! empty($r->state['after']))->count();

        return [
            'id' => $p->id,
            'name' => $p->name,
            'nodes' => count($p->canvas['nodes'] ?? []),
            'generations' => $p->generations_count ?? $p->generations()->count(),
            'updated_at' => $p->updated_at?->toIso8601ZuluString(),
            'working' => $active->count() - $waiting,
            'waiting' => $waiting,
        ];
    }

    private function full(Project $p): array
    {
        return $this->summary($p) + ['canvas' => Graph::normalize($p->canvas)];
    }
}

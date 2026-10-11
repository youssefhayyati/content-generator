<?php

namespace App\Http\Controllers;

use App\Models\Campaign;
use App\Models\CampaignPhoto;
use App\Models\LabTemplate;
use App\Models\NodeRun;
use App\Models\Post;
use App\Models\Project;
use App\Models\VideoSource;
use App\Services\Ai\GenerationFailed;
use App\Services\Intake\Brief;
use App\Services\Lab\Catalog;
use App\Services\Lab\Engine;
use App\Services\Lab\EngineClient;
use App\Services\Lab\Graph;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\References;
use App\Services\Lab\Templates;
use App\Services\Lab\VideoSources;
use App\Services\Sound\SoundClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use InvalidArgumentException;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Creative Lab: the node catalog, a project's graph and how each node stands, the operations that
 * change the graph (from the page and from the assistant alike), running and stopping nodes, YouTube
 * sources and their permission, and templates.
 */
class LabController extends Controller
{
    public function __construct(private readonly Engine $engine) {}

    /* ------------------------------------------------------------------ */
    /* Catalog */
    /* ------------------------------------------------------------------ */

    public function catalog(Request $request, EngineClient $engineClient): JsonResponse
    {
        $models = [];
        foreach (['text', 'image', 'image_edit', 'video_t2v', 'video_i2v'] as $which) {
            $models[$which] = array_map(fn ($m) => [
                'id' => $m['id'], 'label' => $m['label'], 'provider' => $m['provider'], 'reach' => $m['reach'], 'local' => $m['local'],
                'available' => $m['available'], 'reason' => $m['reason'], 'purpose' => $m['purpose'],
                'seconds' => $m['capabilities']->seconds ?? null, 'price' => $this->price($m['id']),
                'aspect_ratios' => $m['capabilities']->aspect_ratios ?? null, 'durations' => $m['capabilities']->durations ?? null,
            ], $this->engine->modelsFor($which));
        }
        $engine = $engineClient->catalog();
        $user = $request->user();

        return response()->json([
            'groups' => Catalog::GROUPS,
            'port_types' => Catalog::PORT_TYPES,
            'nodes' => Catalog::nodes(),
            'models' => $models,
            'templates' => [
                ...collect(Templates::all())->map(fn ($t, $key) => ['key' => $key, 'name' => $t['name'], 'tagline' => $t['tagline'], 'category' => $t['category'], 'nodes' => count($t['graph']['nodes']), 'mine' => false, 'graph' => $t['graph']])->values()->all(),
                ...$user->labTemplates()->latest('id')->get()->map(fn (LabTemplate $t) => ['key' => "mine-{$t->id}", 'id' => $t->id, 'name' => $t->name, 'tagline' => $t->description ?? '', 'category' => 'Yours', 'nodes' => count($t->graph['nodes'] ?? []), 'mine' => true, 'graph' => $t->graph])->all(),
            ],
            'engine' => [
                'up' => $engine !== null && ! isset($engine['error']),
                'error' => $engine['error'] ?? ($engine === null ? 'Not set up: set ENGINE_URL for the API.' : null),
                'services' => $engine['services'] ?? (object) [],
                'fonts' => $engine['fonts'] ?? [],
            ],
            'sound' => app(SoundClient::class)->configured() && app(SoundClient::class)->up(),
            'accounts' => $user->accounts()->with('device')->get()->map(fn ($a) => ['id' => $a->id, 'platform' => $a->platform->value, 'handle' => $a->handle, 'automation' => $a->automation, 'device_id' => $a->device_id, 'device' => $a->device?->name])->values(),
            'devices' => $user->devices()->get()->map(fn ($d) => ['id' => $d->id, 'name' => $d->name, 'driver' => $d->driver, 'ref' => $d->ref, 'status' => $d->status,
                'drives' => $d->driver === 'simulator' ? 'The simulator' : 'The phone agent or the publishing automation, whichever serves this phone'])->values(),
            'campaigns' => $user->campaigns()->latest('id')->limit(50)->get(['id', 'name', 'stage'])->values(),
        ]);
    }

    private function price(string $id): ?float
    {
        [$provider, $name] = explode('/', $id, 2) + [1 => ''];
        if (in_array($provider, Engine::FREE_PROVIDERS, true)) {
            return 0.0;
        }
        $price = (config("ai.providers.{$provider}.models") ?? [])[$name]['price'] ?? null;

        return $price === null ? null : (float) $price;
    }

    /** Voices the engine reads with (for Pictures to video and Dub), searched. */
    public function voices(Request $request, EngineClient $engineClient): JsonResponse
    {
        return response()->json(['voices' => $engineClient->voices((string) $request->query('q', ''))]);
    }

    /**
     * The voices to pick from, like the assistant's own voice picker: the ready ones (made, cloned
     * or set up from the catalog) and the catalog, searched by words and language.
     */
    public function voiceList(Request $request, EngineClient $engineClient): JsonResponse
    {
        try {
            return response()->json($engineClient->voiceList((string) $request->query('q', ''), (string) $request->query('lang', '')));
        } catch (GenerationFailed $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }
    }

    /** How a voice sounds, to hear it before picking it. */
    public function voiceSample(Request $request, EngineClient $engineClient): Response
    {
        $data = $request->validate(['id' => ['required', 'string', 'max:120'], 'catalog' => ['boolean']]);
        try {
            $wav = $engineClient->voiceSample($data['id'], $request->boolean('catalog'));
        } catch (GenerationFailed $e) {
            abort(502, $e->getMessage());
        }

        return response($wav, 200, ['Content-Type' => 'audio/wav', 'Cache-Control' => 'private, max-age=86400']);
    }

    /** A catalog voice picked: set up as a ready one (about three seconds the first time). */
    public function useVoice(Request $request, EngineClient $engineClient): JsonResponse
    {
        $data = $request->validate(['id' => ['required', 'string', 'max:120']]);
        try {
            return response()->json(['voice' => $engineClient->useVoice($data['id'])]);
        } catch (GenerationFailed $e) {
            return response()->json(['message' => $e->getMessage()], 502);
        }
    }

    /**
     * A voice cloned from a recording made on the page or a file (audio, or a video's sound), with the
     * person's agreement. It's one of the ready voices from then on, here and in the assistant.
     */
    public function cloneVoice(Request $request, EngineClient $engineClient): JsonResponse
    {
        $data = $request->validate([
            'recording' => ['required', 'file', 'max:51200', 'mimetypes:audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/wave,audio/webm,audio/ogg,audio/flac,video/mp4,video/quicktime,video/webm,application/octet-stream'],
            'name' => ['nullable', 'string', 'max:60'],
            'consent' => ['accepted'],
        ], ['consent.accepted' => 'Tick that it’s your voice, or that the person agreed.']);
        $file = $data['recording'];
        try {
            $voice = $engineClient->cloneVoice($file->getRealPath(), $file->getClientOriginalName() ?: 'recording.webm', trim($data['name'] ?? '') ?: 'My voice');
        } catch (GenerationFailed $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
        Cache::forget('voicestudio.voices');

        return response()->json(['voice' => $voice], 201);
    }

    /* ------------------------------------------------------------------ */
    /* A project's graph */
    /* ------------------------------------------------------------------ */

    public function show(Project $project): JsonResponse
    {
        Gate::authorize('view', $project);

        return response()->json($this->payload($project));
    }

    /**
     * Just the state, for polling while the page is open (the graph only when it changed).
     */
    public function state(Request $request, Project $project): JsonResponse
    {
        Gate::authorize('view', $project);
        $canvas = $this->engine->canvas($project);
        $since = (int) $request->query('rev', -1);

        return response()->json([
            'rev' => $canvas['rev'],
            'canvas' => $since === $canvas['rev'] ? null : $canvas,
            ...$this->enrich($this->engine->state($project), $project),
        ]);
    }

    public function ops(Request $request, Project $project): JsonResponse
    {
        Gate::authorize('update', $project);
        $data = $request->validate(['ops' => ['required', 'array', 'min:1', 'max:200'], 'ops.*' => ['array']]);
        try {
            [, $results] = $this->engine->apply($project, $data['ops'], $this->by($request));
        } catch (InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage(), ...$this->payload($project->fresh())], 422);
        }

        return response()->json(['results' => $results, ...$this->payload($project->fresh())]);
    }

    public function run(Request $request, Project $project, string $node): JsonResponse
    {
        Gate::authorize('update', $project);
        try {
            $run = $this->engine->run($project, $node, $this->by($request), $request->boolean('upstream', true));
        } catch (InvalidArgumentException|NodeFailed $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json(['run' => $this->engine->runSummary($run), ...$this->payload($project->fresh())], 201);
    }

    public function plan(Project $project, string $node): JsonResponse
    {
        Gate::authorize('view', $project);
        try {
            return response()->json($this->engine->plan($project, $node));
        } catch (InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    /**
     * Everything out of date (or never run), in order: what it takes, or (with `confirm`) running it.
     */
    public function runAll(Request $request, Project $project): JsonResponse
    {
        Gate::authorize('update', $project);
        $canvas = $this->engine->canvas($project);
        $ctx = $this->engine->context($project, $canvas);
        $todo = [];
        foreach (Graph::order($canvas) as $id) {
            $n = Graph::find($canvas, $id);
            $policy = $this->engine->policy($n);
            if (in_array($policy, ['none', 'post'], true)) {
                continue;
            }
            $s = $this->engine->nodeState($ctx, $n);
            if (in_array($s['status'], ['ready', 'stale', 'failed'], true) || ($s['status'] === 'missing' && ! array_filter($s['missing'], fn ($m) => ! str_starts_with($m, 'Waiting for')))) {
                $todo[] = ['id' => $id, 'type' => $n['type'], 'label' => $n['label'] ?? Catalog::node($n['type'])['label'], ...$this->engine->estimate($n)];
            }
        }
        if (! $request->boolean('confirm')) {
            $known = collect($todo)->every(fn ($t) => $t['cost'] !== null);

            return response()->json(['nodes' => $todo, 'seconds' => collect($todo)->sum('seconds'), 'cost' => $known ? round(collect($todo)->sum('cost'), 4) : null]);
        }
        $started = [];
        $errors = [];
        foreach ($todo as $t) {
            try {
                // A node already queued by one before it (as its upstream) is skipped.
                if ($project->nodeRuns()->where('node_id', $t['id'])->whereIn('status', ['queued', 'running'])->exists()) {
                    continue;
                }
                $this->engine->run($project->fresh(), $t['id'], $this->by($request), true);
                $started[] = $t['id'];
            } catch (InvalidArgumentException|NodeFailed $e) {
                $errors[$t['id']] = $e->getMessage();
            }
        }

        return response()->json(['started' => $started, 'errors' => (object) $errors, ...$this->payload($project->fresh())]);
    }

    public function stop(Project $project, string $node): JsonResponse
    {
        Gate::authorize('update', $project);
        $this->engine->stop($project, $node);

        return response()->json($this->payload($project->fresh()));
    }

    public function history(Project $project, string $node): JsonResponse
    {
        Gate::authorize('view', $project);
        $runs = $this->engine->history($project, $node);
        $ids = $runs->flatMap(fn (NodeRun $r) => $r->outputAssetIds())->unique();
        $assets = $project->user->assets()->whereIn('id', $ids)->get()->mapWithKeys(fn ($a) => [$a->id => $a->summary()]);

        return response()->json([
            'runs' => $runs->map(fn (NodeRun $r) => [...$this->engine->runSummary($r), 'outputs' => $r->outputs ?? (object) [], 'params' => $r->params, 'created_at' => $r->created_at?->toIso8601ZuluString()])->values(),
            'assets' => $assets,
        ]);
    }

    /* ------------------------------------------------------------------ */
    /* Projects to start from */
    /* ------------------------------------------------------------------ */

    /**
     * A new project: a blank canvas (or a template's nodes), guided by a campaign. The campaign is one
     * that exists (`campaign_id`, usually the interview the page just ran), one the assistant filled
     * in by asking the same questions (`interview`: depth and the brief's fields), or a short form
     * (`campaign`: goal, audience, message...). Its brief becomes the Brief node at the start, with the
     * brand's look (`brief`), and its photos (the logo, the product, the people) Media nodes under it.
     * `start` opens it on something already made: a prompt for a picture or a video, or a file from
     * the gallery to make a reel from or to transcribe.
     */
    public function create(Request $request, References $references): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['nullable', 'string', 'max:80'],
            'template' => ['nullable', 'string', 'max:60'],
            'campaign_id' => ['nullable', Rule::exists('campaigns', 'id')->where('user_id', $user->id)],
            'campaign' => ['nullable', 'array'],
            'campaign.goal' => ['required_with:campaign', 'string', 'max:300'],
            'campaign.audience' => ['required_with:campaign', 'string', 'max:500'],
            'campaign.message' => ['required_with:campaign', 'string', 'max:800'],
            'campaign.key_facts' => ['nullable', 'string', 'max:2000'],
            'campaign.deadline' => ['nullable', 'date'],
            'campaign.account_ids' => ['nullable', 'array', 'max:20'],
            'campaign.account_ids.*' => ['integer', Rule::exists('accounts', 'id')->where('user_id', $user->id)],
            'interview' => ['nullable', 'array'],
            'interview.depth' => ['nullable', Rule::in(['quick', 'full'])],
            'interview.fields' => ['required_with:interview', 'array'],
            'interview.fields.*' => ['nullable', 'string', 'max:500'],
            'photos' => ['nullable', 'array', 'max:'.Brief::MAX_PHOTOS],
            'photos.*.asset_id' => ['required', 'integer', Rule::exists('assets', 'id')->where('user_id', $user->id)->where('kind', 'image')],
            'photos.*.kind' => ['nullable', Rule::in(CampaignPhoto::KINDS)],
            'brief' => ['nullable', 'array'],
            'start' => ['nullable', 'array'],
            'start.make' => ['required_with:start', Rule::in(['picture', 'video', 'reel', 'transcript'])],
            'start.prompt' => ['nullable', 'string', 'max:2000'],
            'start.asset_id' => ['nullable', 'integer', Rule::exists('assets', 'id')->where('user_id', $user->id)],
        ], [
            'campaign.goal.required_with' => 'Say what the campaign is for.',
            'campaign.audience.required_with' => 'Say who it’s for.',
            'campaign.message.required_with' => 'Say what it has to get across.',
        ]);
        $campaign = ! empty($data['campaign_id']) ? $user->campaigns()->find($data['campaign_id']) : null;
        if (! empty($data['campaign'])) {
            $c = $data['campaign'];
            $campaign = $user->campaigns()->create([
                'name' => $data['name'] ?? null,
                'source' => 'form',
                'depth' => 'quick',
                'mode' => 'script',
                'fields' => Brief::blank(),
                'brief' => array_filter(['goal' => trim($c['goal']), 'audience' => trim($c['audience']), 'message' => trim($c['message']),
                    'key_facts' => isset($c['key_facts']) ? trim($c['key_facts']) : null, 'deadline' => $c['deadline'] ?? null]),
                'messages' => [],
                'asked' => 0,
                'completed_at' => now(),
                'account_ids' => array_values(array_map('intval', $c['account_ids'] ?? [])) ?: null,
                'period_start' => now()->toDateString(),
                'period_end' => $c['deadline'] ?? null,
            ]);
        } elseif (! empty($data['interview'])) {
            $fields = array_intersect_key(array_map(fn ($v) => trim((string) $v), $data['interview']['fields']), Brief::FIELDS);
            $campaign = $user->campaigns()->create([
                'name' => $data['name'] ?? null,
                'depth' => $data['interview']['depth'] ?? 'quick',
                'mode' => 'ai',
                'fields' => [...Brief::blank(), ...$fields],
                'messages' => [['who' => 'note', 'text' => 'Filled in with the assistant, in Creative Lab.']],
                'asked' => 0,
                'completed_at' => now(),
            ]);
        }
        if ($campaign && ! empty($data['photos'])) {
            foreach ($user->assets()->whereIn('id', array_column($data['photos'], 'asset_id'))->get() as $asset) {
                $kind = collect($data['photos'])->firstWhere('asset_id', $asset->id)['kind'] ?? 'other';
                $path = $campaign->directory().'/'.basename($asset->path);
                Storage::disk('local')->copy($asset->path, $path);
                $campaign->photos()->create(['path' => $path, 'mime' => $asset->mime, 'kind' => $kind, 'title' => $asset->name, 'asset_id' => $asset->id]);
            }
        }

        $briefParams = array_filter([
            ...Graph::cleanParams('source.brief', (array) ($data['brief'] ?? [])),
            'campaign_id' => $campaign?->id,
        ], fn ($v) => $v !== null && $v !== '' && $v !== []);
        if (! isset($briefParams['account_id']) && ($first = ($campaign?->account_ids ?? [])[0] ?? null)) {
            $briefParams['account_id'] = (int) $first;
        }

        $name = filled($data['name'] ?? null) ? $data['name'] : ($campaign?->title() ?? 'Untitled project');
        $project = $user->projects()->create(['name' => $name, 'canvas' => Graph::normalize(['version' => 2])]);
        $graph = $this->templateGraph($request, $data['template'] ?? null) ?? self::startGraph($data['start'] ?? null);
        $left = $graph['nodes'] ? min(array_map(fn ($n) => (float) ($n['x'] ?? 0), $graph['nodes'])) - 360 : 0;
        if ($briefParams) {
            // The brief goes first: into the template's Brief node, or a Brief node of its own at the start.
            if (collect($graph['nodes'])->contains('type', 'source.brief')) {
                $graph['nodes'] = array_map(fn ($n) => $n['type'] === 'source.brief' ? [...$n, 'params' => [...$n['params'] ?? [], ...$briefParams]] : $n, $graph['nodes']);
            } else {
                $graph['nodes'][] = ['id' => 'brief', 'type' => 'source.brief', 'x' => $left, 'y' => 0, 'params' => $briefParams];
            }
        }
        if ($campaign) {
            $graph['nodes'] = [...$graph['nodes'], ...References::nodes($references->assets($campaign), $left, 420)];
        }
        if ($graph['nodes']) {
            $this->engine->apply($project, [['op' => 'insert', 'graph' => $graph, 'x' => 80, 'y' => 80]], $this->by($request));
        }

        return response()->json(['campaign_id' => $campaign?->id, ...$this->payload($project->fresh())], 201);
    }

    /**
     * The nodes a project opened on something already made starts with.
     *
     * @param  array<string, mixed>|null  $start
     * @return array{nodes: list<array<string, mixed>>, edges: list<array<string, mixed>>}
     */
    private static function startGraph(?array $start): array
    {
        $prompt = trim((string) ($start['prompt'] ?? ''));
        $media = ! empty($start['asset_id']) ? [['id' => 'media', 'type' => 'source.media', 'x' => 0, 'y' => 0, 'params' => ['assets' => [(int) $start['asset_id']]]]] : [];

        return match ($start['make'] ?? null) {
            'picture' => ['nodes' => [['id' => 'picture', 'type' => 'image.generate', 'x' => 0, 'y' => 0, 'params' => ['prompt' => $prompt]]], 'edges' => []],
            'video' => ['nodes' => [['id' => 'video', 'type' => 'video.generate', 'x' => 0, 'y' => 0, 'params' => ['prompt' => $prompt]]], 'edges' => []],
            'reel' => ['nodes' => [...$media, ['id' => 'reel', 'type' => 'video.reel', 'x' => 360, 'y' => 0]], 'edges' => $media ? [['from' => 'media', 'out' => 'audio', 'to' => 'reel', 'in' => 'sound']] : []],
            'transcript' => ['nodes' => [...$media, ['id' => 'transcript', 'type' => 'audio.transcribe', 'x' => 360, 'y' => 0]], 'edges' => $media ? [['from' => 'media', 'to' => 'transcript', 'in' => 'media']] : []],
            default => ['nodes' => [], 'edges' => []],
        };
    }

    /** A campaign in Creative Lab: a blank canvas with its brief and its photos (or a template's nodes). */
    public function fromCampaign(Request $request, Campaign $campaign, References $references): JsonResponse
    {
        Gate::authorize('view', $campaign);
        $request->merge(['name' => $campaign->title() ?? 'Campaign', 'template' => $request->input('template'), 'campaign_id' => $campaign->id, 'campaign' => null]);

        return $this->create($request, $references);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function templateGraph(Request $request, ?string $key): ?array
    {
        if (! $key) {
            return null;
        }
        if (str_starts_with($key, 'mine-')) {
            return $request->user()->labTemplates()->find((int) substr($key, 5))?->graph ?? abort(404, 'There is no such template.');
        }

        return Templates::all()[$key]['graph'] ?? abort(404, 'There is no such template.');
    }

    /** The project, or some of its nodes, saved as a template of the person's own. */
    public function saveTemplate(Request $request, Project $project): JsonResponse
    {
        Gate::authorize('view', $project);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:80'],
            'description' => ['nullable', 'string', 'max:300'],
            'nodes' => ['nullable', 'array'],
            'nodes.*' => ['string'],
        ]);
        $canvas = $this->engine->canvas($project);
        $ids = $data['nodes'] ?? array_map(fn ($n) => $n['id'], $canvas['nodes']);
        $nodes = array_values(array_map(function ($n) {
            unset($n['pin'], $n['branch']);
            // A template is a starting point: no files, no YouTube video, no account.
            $n['params'] = array_diff_key($n['params'] ?? [], array_flip(['assets', 'source_id', 'url', 'mask', 'account_id', 'device_id', 'at']));

            return $n;
        }, array_filter($canvas['nodes'], fn ($n) => in_array($n['id'], $ids, true))));
        abort_if(! $nodes, 422, 'Pick the nodes to keep.');
        $edges = array_values(array_filter($canvas['edges'], fn ($e) => in_array($e['from'], $ids, true) && in_array($e['to'], $ids, true)));
        $template = $request->user()->labTemplates()->create(['name' => $data['name'], 'description' => $data['description'] ?? null, 'graph' => compact('nodes', 'edges')]);

        return response()->json(['key' => "mine-{$template->id}", 'id' => $template->id, 'name' => $template->name], 201);
    }

    public function deleteTemplate(Request $request, LabTemplate $template): Response
    {
        abort_unless($template->user_id === $request->user()->id, 404);
        $template->delete();

        return response()->noContent();
    }

    /* ------------------------------------------------------------------ */
    /* YouTube */
    /* ------------------------------------------------------------------ */

    public function inspect(Request $request, VideoSources $sources): JsonResponse
    {
        $data = $request->validate(['url' => ['required', 'string', 'max:500']]);
        try {
            return response()->json($sources->inspect($request->user(), $data['url'])->summary());
        } catch (NodeFailed $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    public function source(Request $request, VideoSource $source): JsonResponse
    {
        abort_unless($source->user_id === $request->user()->id, 404);

        return response()->json($source->summary());
    }

    public function permission(Request $request, VideoSource $source, VideoSources $sources): JsonResponse
    {
        abort_unless($source->user_id === $request->user()->id, 404);
        abort_if($this->by($request) !== 'you', 403, 'Permission to use a video is recorded by a person, on the node.');
        $data = $request->validate([
            'basis' => ['nullable', Rule::in(VideoSource::BASES)],
            'note' => ['nullable', 'string', 'max:500'],
            'credit' => ['nullable', 'string', 'max:300'],
            'deny' => ['sometimes', 'boolean'],
        ]);
        try {
            $sources->permission($source, (string) ($data['basis'] ?? ''), $data['note'] ?? null, $data['credit'] ?? null, $request->boolean('deny'));
        } catch (NodeFailed $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json($source->fresh()->summary());
    }

    /* ------------------------------------------------------------------ */

    /**
     * @return array<string, mixed>
     */
    private function payload(Project $project): array
    {
        $canvas = $this->engine->canvas($project);

        return [
            'project' => ['id' => $project->id, 'name' => $project->name, 'updated_at' => $project->updated_at?->toIso8601ZuluString()],
            'rev' => $canvas['rev'],
            'canvas' => $canvas,
            ...$this->enrich($this->engine->state($project), $project),
        ];
    }

    /**
     * Post nodes get their post (status, the run and its screenshot, the numbers); YouTube nodes
     * their video and its permission.
     *
     * @param  array{nodes: array<string, array<string, mixed>>, assets: array<int, mixed>}  $state
     * @return array{nodes: array<string, array<string, mixed>>, assets: array<int, mixed>}
     */
    private function enrich(array $state, Project $project): array
    {
        $postIds = collect($state['nodes'])->map(fn ($n) => ((array) ($n['outputs'] ?? []))['post']['post_id'] ?? null)->filter()->values();
        $posts = $postIds->isEmpty() ? collect() : Post::with(['account', 'device', 'latestRun'])->whereIn('id', $postIds)->where('user_id', $project->user_id)->get()->keyBy('id');
        $canvas = $this->engine->canvas($project);
        $sourceIds = collect($canvas['nodes'])->where('type', 'source.youtube')->map(fn ($n) => $n['params']['source_id'] ?? null)->filter();
        $sources = $sourceIds->isEmpty() ? collect() : VideoSource::where('user_id', $project->user_id)->whereIn('id', $sourceIds)->get()->keyBy('id');

        foreach ($state['nodes'] as $id => $n) {
            if (($pid = ((array) ($n['outputs'] ?? []))['post']['post_id'] ?? null) && ($post = $posts->get($pid))) {
                $run = $post->latestRun;
                $state['nodes'][$id]['post'] = [
                    'id' => $post->id, 'title' => $post->title, 'status' => $post->status->value,
                    'scheduled_at' => $post->scheduled_at?->toIso8601ZuluString(), 'published_at' => $post->published_at?->toIso8601ZuluString(),
                    'post_url' => $post->post_url, 'error' => $post->error,
                    'account' => $post->account ? ['handle' => $post->account->handle, 'platform' => $post->account->platform->value] : null,
                    'device' => $post->device?->name,
                    'run' => $run ? ['id' => $run->id, 'outcome' => $run->status, 'steps' => count($run->steps ?? []), 'attempt' => $run->attempt, 'note' => $run->evidence['note'] ?? $run->error,
                        'screenshot_url' => $run->screenshot_id ? "/api/assets/{$run->screenshot_id}/file" : null, 'ended_at' => $run->ended_at?->toIso8601ZuluString()] : null,
                    'metrics' => $post->metrics, 'metrics_at' => $post->metrics_at?->toIso8601ZuluString(),
                ];
            }
        }
        foreach ($canvas['nodes'] as $n) {
            if ($n['type'] === 'source.youtube' && ($sid = $n['params']['source_id'] ?? null) && ($s = $sources->get($sid))) {
                $state['nodes'][$n['id']]['source'] = $s->summary();
            }
        }

        return $state;
    }

    /** Who's asking: the assistant (its token), or the person. */
    private function by(Request $request): string
    {
        $token = $request->user()?->currentAccessToken();

        return $token instanceof PersonalAccessToken && $token->can(AssistantController::ABILITY) ? 'assistant' : 'you';
    }
}

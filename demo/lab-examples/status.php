<?php
$d = json_decode(file_get_contents(storage_path('app/showcase-runs.json')), true);
$e = app(App\Services\Lab\Engine::class);
$tally = [];
foreach ($d as $key => $x) {
    $p = App\Models\Project::find($x['project']);
    $runs = App\Models\NodeRun::where('project_id', $p->id)->get()->groupBy('node_id')->map(fn ($r) => $r->sortByDesc('id')->first());
    $line = [];
    foreach ($runs as $node => $r) {
        $tally[$r->status] = ($tally[$r->status] ?? 0) + 1;
        if ($r->status !== 'succeeded') $line[] = "{$node}={$r->status}".($r->error ? " (".mb_substr($r->error, 0, 140).")" : ($r->stage ? " [".mb_substr($r->stage,0,50)."]" : ''));
    }
    echo str_pad($key, 28).($line ? implode('; ', $line) : 'all done')."\n";
}
echo json_encode($tally)."\n";

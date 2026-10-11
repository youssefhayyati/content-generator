<?php

/*
 * Takes each showcase example's results out of its project into /tmp/lab-out/<template>/, made for the
 * web (webp pictures in two sizes, 720p H.264 clips with a poster, mp3 sound), and writes manifest.json
 * with each file's size, colour, length and the words the nodes wrote. Run again as more finish.
 */

use App\Models\Asset;
use App\Models\Project;
use App\Services\Lab\Engine;
use App\Services\Lab\Media;

$runs = json_decode(file_get_contents(storage_path('app/showcase-runs.json')), true);
$engine = app(Engine::class);
$outDir = '/tmp/lab-out';
@mkdir($outDir, 0777, true);
$manifestPath = "{$outDir}/manifest.json";
$manifest = is_file($manifestPath) ? json_decode(file_get_contents($manifestPath), true) : [];

// template => [name => [node, port, index]] for files; words => [label => [node, port, (item)]]
$files = [
    'picture-models' => ['model-a' => ['picture-a', 'image', 0]],
    'product-picture' => ['picture' => ['picture', 'image', 0], 'design' => ['design', 'image', 0]],
    'tips-carousel' => ['slide-1' => ['design', 'image', 0], 'slide-2' => ['design', 'image', 1], 'slide-3' => ['design', 'image', 2], 'slide-4' => ['design', 'image', 3]],
    'product-scene' => ['scene' => ['scene', 'image', 0]],
    'words-over-picture' => ['design' => ['text', 'image', 0]],
    'moving-pictures' => ['reel' => ['video', 'video', 0], 'frame' => ['pictures', 'image', 0]],
    'moving-pictures-translated' => ['reel' => ['video', 'video', 0]],
    'animated-picture' => ['still' => ['picture', 'image', 0], 'clip' => ['mix', 'video', 0]],
    'video-models' => ['wan' => ['video-a', 'video', 0]],
    'talking-portrait' => ['portrait' => ['portrait-made', 'image', 0], 'clip' => ['captions', 'video', 0], 'english' => ['dub', 'video', 0]],
    'voiceover-video' => ['reel' => ['reel', 'video', 0], 'picture' => ['picture', 'image', 0]],
    'hf-character' => ['her' => ['person', 'image', 0], 'scene-1' => ['scene-1', 'image', 0], 'scene-2' => ['scene-2', 'image', 0], 'scene-3' => ['scene-3', 'image', 0]],
    'hf-trend' => ['him' => ['runner', 'image', 0], 'clip' => ['words', 'video', 0]],
    'hf-ads' => ['ad-1' => ['layout', 'image', 0], 'ad-2' => ['layout', 'image', 1], 'ad-3' => ['layout', 'image', 2], 'ad-4' => ['layout', 'image', 3]],
    'hf-restyle' => ['clay' => ['clay', 'image', 0], 'clip' => ['text', 'video', 0]],
    'youtube-clips' => ['episode' => ['says', 'video', 0], 'clip' => ['captions', 'video', 0]],
    'recording-to-posts' => ['memo' => ['memo', 'audio', 0]],
    'thought' => ['picture' => ['picture', 'image', 0]],
    'campaign-pack' => ['picture' => ['design', 'image', 0], 'reel' => ['video', 'video', 0]],
    'dub-language' => ['clip' => ['captions', 'video', 0]],
    'face-swap' => ['face' => ['face-made', 'image', 0], 'clip' => ['captions', 'video', 0]],
];
$words = [
    'picture-models' => ['The caption' => ['caption', 'text']],
    'product-picture' => ['The headline' => ['headline', 'text'], 'The caption' => ['caption', 'text']],
    'tips-carousel' => ['The headline' => ['headline', 'text'], 'The caption' => ['caption', 'text']],
    'product-scene' => ['The caption' => ['caption', 'text']],
    'words-over-picture' => ['The caption' => ['caption', 'text']],
    'moving-pictures' => ['The lines the voice reads' => ['lines', 'text'], 'The caption' => ['caption', 'text']],
    'moving-pictures-translated' => ['The lines, in English' => ['lines', 'text'], 'Translated, read in French' => ['translate', 'text']],
    'animated-picture' => ['The caption' => ['caption', 'text']],
    'video-models' => ['The caption' => ['caption', 'text']],
    'talking-portrait' => ['What she says' => ['script', 'text']],
    'voiceover-video' => ['The script' => ['script', 'text']],
    'hf-character' => ['The caption' => ['caption', 'text']],
    'hf-trend' => ['The caption' => ['caption', 'text']],
    'hf-ads' => ['The caption' => ['caption', 'text']],
    'hf-restyle' => ['The hook over it' => ['hook', 'text'], 'The caption' => ['caption', 'text']],
    'youtube-clips' => ['The caption' => ['caption', 'text']],
    'recording-to-posts' => ['The post' => ['post-text', 'text']],
    'thought' => ['The post' => ['text', 'text']],
    'campaign-pack' => ['The headline' => ['headline', 'text'], 'The caption' => ['caption', 'text'], 'The lines the voice reads' => ['lines', 'text'], 'The short post' => ['short', 'text']],
    'dub-language' => ['What she said' => ['transcript', 'text'], 'What she says now' => ['translate', 'text']],
    'face-swap' => [],
];

$tone = function (string $path): string {
    $rgb = shell_exec('ffmpeg -loglevel error -i '.escapeshellarg($path).' -frames:v 1 -vf scale=1:1 -f rawvideo -pix_fmt rgb24 - 2>/dev/null');

    return $rgb && strlen($rgb) >= 3 ? sprintf('#%02x%02x%02x', ord($rgb[0]), ord($rgb[1]), ord($rgb[2])) : '#222222';
};
$fit = fn (int $max) => "scale='if(gt(iw,ih),min({$max},iw),-2)':'if(gt(iw,ih),-2,min({$max},ih))'";

$only = array_filter(explode(',', (string) getenv('ONLY')));
foreach ($files as $key => $list) {
    if (! isset($runs[$key]) || ($only && ! in_array($key, $only, true))) {
        continue;
    }
    $p = Project::find($runs[$key]['project']);
    $state = $engine->state($p)['nodes'];
    $ids = $runs[$key]['ids'];
    // A node added by make.php keeps its own id; a template's is looked up.
    $node = fn (string $n) => $state[$n] ?? $state[$ids[$n] ?? $n] ?? null;
    $dir = "{$outDir}/{$key}";
    @mkdir($dir, 0777, true);
    $entry = $manifest[$key] ?? ['media' => [], 'words' => []];
    foreach ($list as $name => [$n, $port, $i]) {
        $id = $node($n)['outputs'][$port]['assets'][$i] ?? null;
        if (! $id) {
            echo "{$key}.{$name}: not ready\n";

            continue;
        }
        $asset = Asset::find($id);
        $in = Media::path($asset);
        if ($asset->kind === 'image') {
            Media::ffmpeg(['-i', $in, '-vf', $fit(1280), '-c:v', 'libwebp', '-quality', '82', "{$dir}/{$name}.webp"], 'web picture');
            Media::ffmpeg(['-i', $in, '-vf', $fit(560), '-c:v', 'libwebp', '-quality', '74', "{$dir}/{$name}-sm.webp"], 'small picture');
            [$w, $h] = getimagesize("{$dir}/{$name}.webp") ?: [$asset->width, $asset->height];
            $entry['media'][$name] = ['kind' => 'image', 'src' => "/showcase/lab/{$key}/{$name}.webp", 'sm' => "/showcase/lab/{$key}/{$name}-sm.webp", 'w' => $w, 'h' => $h, 'tone' => $tone("{$dir}/{$name}-sm.webp")];
        } elseif ($asset->kind === 'video') {
            $info = Media::probe($in);
            Media::ffmpeg(['-i', $in, '-vf', $fit(720).',format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-profile:v', 'high', ...($info['audio'] ? ['-c:a', 'aac', '-b:a', '96k'] : ['-an']), '-movflags', '+faststart', "{$dir}/{$name}.mp4"], 'web clip');
            Media::ffmpeg(['-ss', '0.4', '-i', "{$dir}/{$name}.mp4", '-frames:v', '1', '-vf', $fit(560), '-c:v', 'libwebp', '-quality', '74', "{$dir}/{$name}-poster.webp"], 'poster');
            $out = Media::probe("{$dir}/{$name}.mp4");
            $entry['media'][$name] = ['kind' => 'video', 'src' => "/showcase/lab/{$key}/{$name}.mp4", 'poster' => "/showcase/lab/{$key}/{$name}-poster.webp", 'w' => $out['width'], 'h' => $out['height'], 'tone' => $tone("{$dir}/{$name}-poster.webp"), 'seconds' => round($out['duration'], 1), 'sound' => (bool) $info['audio']];
        } else {
            Media::ffmpeg(['-i', $in, '-c:a', 'libmp3lame', '-b:a', '96k', "{$dir}/{$name}.mp3"], 'web sound');
            $entry['media'][$name] = ['kind' => 'audio', 'src' => "/showcase/lab/{$key}/{$name}.mp3", 'w' => 0, 'h' => 0, 'tone' => '#222222', 'seconds' => round(Media::probe("{$dir}/{$name}.mp3")['duration'], 1), 'sound' => true];
        }
        echo "{$key}.{$name}: ok\n";
    }
    foreach ($words[$key] ?? [] as $label => [$n, $port]) {
        $v = $node($n)['outputs'][$port] ?? null;
        if ($v && ($v['text'] ?? '') !== '') {
            $entry['words'][$label] = $v['text'];
        }
    }
    if ($key === 'recording-to-posts' && ($m = $node('moments')['outputs']['moments']['moments'][1] ?? null)) {
        $entry['words']['The moment it found'] = $m['quote'] ?? $m['hook'];
    }
    $manifest[$key] = $entry;
}
file_put_contents($manifestPath, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
echo "manifest: ".count($manifest)." templates\n";

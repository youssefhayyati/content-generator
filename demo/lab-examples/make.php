<?php

/*
 * Makes the Creative Lab template examples with FlowAI itself (the pod's models, Ollama Cloud for words),
 * for a demo account, one project per template. Only the content nodes run: no Where it goes, no Post.
 * Usage: see demo/lab-examples/README.md.
 */

use App\Models\Project;
use App\Models\User;
use App\Services\Lab\Engine;
use App\Services\Lab\Graph;
use App\Services\Lab\Media;
use App\Services\Lab\Templates;
use Illuminate\Support\Str;

$user = User::firstOrCreate(['email' => 'showcase@flowai.local'], ['name' => 'FlowAI Showcase', 'password' => bcrypt(Str::random(40)), 'timezone' => 'Europe/Paris']);
$user->forceFill(['email_verified_at' => now()])->save();
$engine = app(Engine::class);
$media = app(Media::class);
$log = storage_path('app/showcase-runs.json');
$done = is_file($log) ? json_decode(file_get_contents($log), true) : [];

$asset = function (string $name) use ($user, $media) {
    static $cache = [];
    if (isset($cache[$name])) {
        return $cache[$name];
    }
    $jpg = '/tmp/showcase-src/'.pathinfo($name, PATHINFO_FILENAME).'.jpg';
    if (! is_file($jpg)) {
        Media::ffmpeg(['-i', '/tmp/showcase-src/'.$name, '-q:v', '2', $jpg], 'convert');
    }
    $tmp = tempnam(sys_get_temp_dir(), 'sc').'.jpg';
    copy($jpg, $tmp);

    return $cache[$name] = $media->keep($user, $tmp, 'image/jpeg', pathinfo($name, PATHINFO_FILENAME).'.jpg')->id;
};
// A finished node's video from another showcase project, as a file of this account.
$made = function (string $key, string $node, string $port = 'video') use ($done, $engine) {
    $p = Project::find($done[$key]['project']);
    $state = $engine->state($p)['nodes'][$done[$key]['ids'][$node] ?? $node] ?? null;

    return $state['outputs'][$port]['assets'][0] ?? throw new RuntimeException("{$key}.{$node} has no {$port} yet");
};

$KIMI = 'ollama_cloud/kimi-k3';
$V = ['upbeat' => '58b58aa3', 'documentarian' => '84c183d2', 'neighbor' => '7d676208', 'explainer' => 'f21eaa14', 'french' => '983f9be4'];

$B = [
    'maison' => ['product' => 'Ember & Fig, a hand-poured autumn candle (smoky fig, cedar, black pepper)', 'offer' => 'Ember & Fig is back for six weeks only', 'cta' => 'Order before it’s gone', 'tone' => 'quiet, sensory, unhurried', 'style' => 'warm editorial still life, walnut table, amber glass, low window light, muted autumn palette', 'palette' => ['#F3E7D3', '#B5651D'], 'font' => 'cormorant', 'avoid' => 'exclamation marks; the words cozy and vibe'],
    'lowtide' => ['product' => 'iced cold brew from Low Tide, a harbour-side coffee roaster', 'offer' => 'Cold brew season is open at Low Tide', 'cta' => 'Come by the harbour', 'tone' => 'dry, local, a little cheeky', 'style' => 'golden hour, 35mm film, weathered harbour stone, fishing boats softly out of focus', 'palette' => ['#F6E6C8', '#1F3A4A'], 'font' => 'bebas', 'avoid' => 'exclamation marks, vibes'],
    'kiln' => ['product' => 'handmade stoneware cups from Kiln & Co, a ceramics studio', 'offer' => 'Weekend wheel classes are open', 'cta' => 'Book a class', 'tone' => 'warm, proud of the craft, plain words', 'style' => 'warm studio light, raw clay and cream glaze tones, documentary photography', 'palette' => ['#EDE3D6', '#8A5A3B'], 'font' => 'fraunces', 'avoid' => 'magic, journey, exclamation marks'],
    'northline' => ['product' => 'Northline Run Club’s Saturday sunrise run over the river bridges', 'offer' => 'Every Saturday at 6:30, all paces, nobody left behind', 'cta' => 'Show up once', 'tone' => 'bold, short, rhythmic', 'style' => 'dawn light, misty river, cinematic', 'palette' => ['#FFFFFF', '#FF6A3D'], 'font' => 'anton', 'avoid' => 'beast mode, crush it, no excuses'],
    'osteria' => ['product' => 'fresh pappardelle with slow-cooked ragù at Osteria Nove', 'offer' => 'Tonight’s special: pappardelle al ragù', 'cta' => 'Book a table tonight', 'tone' => 'a warm Italian host, appetite first', 'style' => 'food photography, linen, warm candlelight, rustic trattoria', 'palette' => ['#FBF3E4', '#8C2F1B'], 'font' => 'playfair', 'avoid' => 'foodie, mouthwatering, exclamation marks'],
    'wildstem' => ['product' => 'seasonal bouquets from Wild Stem, a neighbourhood florist', 'offer' => 'Mother’s Day bouquets, order by Thursday', 'cta' => 'Order by Thursday', 'tone' => 'light, seasonal, specific', 'style' => 'soft daylight, pastel peonies and ranunculus, airy', 'palette' => ['#FFFFFF', '#E07A8B'], 'font' => 'dm-serif', 'avoid' => 'brighten your day, exclamation marks'],
    'dew' => ['product' => 'Dew Theory’s calming morning serum (4% niacinamide and green tea), a frosted glass dropper bottle', 'offer' => 'Calm skin by morning', 'cta' => 'Try the 7 ml sample', 'tone' => 'calm, precise, quietly confident', 'style' => 'soft green light, wet dark stone, luxury skincare photography', 'palette' => ['#F2F5EE', '#3E5A3A'], 'font' => 'montserrat', 'avoid' => 'miracle claims, before-and-after promises'],
    'ledgerly' => ['product' => 'Ledgerly, finance software that closes the books faster', 'offer' => 'Northwind’s month-end close went from 9 days to 3', 'cta' => 'Read how they did it', 'tone' => 'plain-spoken and specific, a finance lead talking to a peer', 'style' => 'clean, minimal, calm morning office light, muted blue', 'palette' => ['#FFFFFF', '#2F5BEA'], 'font' => 'semibold', 'avoid' => 'streamline, seamless, leverage, game-changer, emoji'],
    'margins' => ['product' => 'Margins Books, an independent bookshop', 'offer' => 'A new table of short novels, all under 200 pages', 'cta' => 'Come browse this weekend', 'tone' => 'wry, bookish, gently funny', 'style' => 'warm bookshop light, wooden shelves, stacks of paperbacks', 'palette' => ['#FFF8EC', '#7A2E2E'], 'font' => 'typewriter', 'avoid' => 'bookworm, reading slump, exclamation marks'],
];

$S = [
    'picture-models' => ['brief' => $B['lowtide'], 'set' => ['prompt' => ['text' => 'A tall glass of iced cold brew coffee standing on a weathered stone harbour wall at golden hour, condensation on the glass, fishing boats softly out of focus behind, warm 35mm film photograph. No text, no lettering, no logos.']], 'run' => ['picture-a', 'caption']],
    'product-picture' => ['brief' => $B['maison'], 'run' => ['design', 'caption']],
    'tips-carousel' => ['brief' => [...$B['kiln'], 'offer' => 'Five things to know before your first wheel class'], 'run' => ['design', 'caption']],
    'product-scene' => ['brief' => $B['dew'], 'media' => ['product' => ['dew-serum.webp']], 'set' => ['scene' => ['instruction' => 'Keep the serum bottle exactly as it is: its shape, its frosted glass, its dropper. Put it on a pale limestone bathroom shelf in soft morning light, a sprig of eucalyptus and a folded linen towel beside it.']], 'run' => ['scene', 'caption']],
    'words-over-picture' => ['brief' => $B['wildstem'], 'media' => ['photo' => ['friday-stems.webp']], 'set' => ['text' => ['texts' => [
        ['slide' => 1, 'text' => 'Mother’s Day bouquets', 'position' => 'top', 'size' => 'large', 'style' => 'shadow', 'color' => '#ffffff', 'font' => 'dm-serif'],
        ['slide' => 1, 'text' => 'Order by Thursday', 'position' => 'bottom', 'size' => 'small', 'style' => 'box', 'color' => '#ffffff', 'box_color' => '#E07A8B', 'font' => 'montserrat'],
    ]]], 'run' => ['text', 'caption']],
    'moving-pictures' => ['brief' => $B['osteria'], 'set' => ['video' => ['voice' => $V['documentarian'], 'song' => 'warm Italian trattoria instrumental, mandolin and acoustic guitar, 95 bpm']], 'run' => ['video', 'caption']],
    'moving-pictures-translated' => ['media' => ['photos' => ['clay-throw.webp', 'clay-glaze.webp', 'clay-shelf.webp']], 'set' => [
        'lines' => ['text' => "Every cup starts as a block of clay.\nWe throw it, trim it and glaze it by hand.\nWeekend wheel classes are open: come make your own."],
        'translate' => ['language' => 'French'], 'video' => ['voice' => $V['french'], 'song' => 'warm acoustic instrumental, soft piano and guitar, 90 bpm'],
    ], 'run' => ['video']],
    'animated-picture' => ['brief' => [...$B['lowtide'], 'product' => 'a steaming flat white in a ceramic cup on a weathered harbour wall at dawn', 'offer' => 'The harbour wakes up at seven, and so do we'], 'set' => ['animate' => ['prompt' => 'A slow push in, steam curling up from the cup, morning light moving across the harbour, boats gently rocking']], 'run' => ['mix', 'caption']],
    'video-models' => ['brief' => $B['northline'], 'set' => ['prompt' => ['text' => 'Low tracking shot alongside a small group of runners crossing a steel bridge over a river at dawn, city skyline in soft mist behind them, breath visible in the cold air, warm sunrise light, cinematic.'], 'video-a' => ['aspect' => '9:16', 'duration' => 5]], 'run' => ['video-a', 'caption']],
    'talking-portrait' => [
        'ops' => fn ($id) => [
            ['op' => 'add', 'node' => ['id' => 'portrait-made', 'type' => 'image.generate', 'x' => 80, 'y' => 460, 'label' => 'The portrait (AI-made, nobody real)', 'params' => ['aspect' => '9:16', 'prompt' => 'Portrait photo of a friendly young woman barista with short dark curly hair in a denim apron, standing behind a café counter, looking straight into the camera with a warm smile, head and shoulders, natural window light, shallow depth of field. No text.']]],
            ['op' => 'connect', 'from' => 'portrait-made', 'out' => 'image', 'to' => $id('animate'), 'in' => 'image'],
            ['op' => 'remove', 'id' => $id('portrait')],
        ],
        'set' => ['script' => ['text' => 'Morning! Cold brew season is open at Low Tide. Come by the harbour.'], 'animate' => ['prompt' => 'The woman looks at the camera and talks naturally, small head movements and a smile, steady camera'], 'dub' => ['consent' => true, 'voice' => $V['neighbor']]],
        'run' => ['captions'],
    ],
    'voiceover-video' => ['brief' => $B['margins'], 'set' => ['voice' => ['voice' => 'vs:'.$V['explainer']], 'picture' => ['prompt' => 'A wooden table of short paperback novels in a warm independent bookshop at dusk, lamps glowing, moody, vertical. No readable text.']], 'run' => ['reel']],
    'hf-character' => [
        'ops' => fn ($id) => [
            ['op' => 'remove', 'ids' => [$id('photos'), $id('character'), $id('scene-1'), $id('scene-2'), $id('scene-3')]],
            ['op' => 'add', 'node' => ['id' => 'person', 'type' => 'image.generate', 'x' => 80, 'y' => 80, 'label' => 'Her (AI-made, nobody real)', 'params' => ['aspect' => '4:5', 'prompt' => 'Portrait photo of a young woman potter with a short black bob, a few freckles and a rust linen apron, in a ceramics studio, looking at the camera, natural light. No text.']]],
            ...array_map(fn ($i, $scene) => ['op' => 'add', 'node' => ['id' => "scene-{$i}", 'type' => 'image.edit', 'x' => 440, 'y' => ($i - 1) * 380 + 80, 'label' => "Scene {$i}", 'params' => ['instruction' => "Keep her face, her short black bob, her freckles and her rust linen apron exactly as they are. {$scene}"]]], [1, 2, 3], [
                'She is now smiling at the potter’s wheel, wet clay in her hands, warm studio light.',
                'She is now walking through a sunny Saturday market, holding one of her speckled cups, candid street photography.',
                'She is now at home on a cosy sofa in the evening, drinking tea from a speckled stoneware cup, lamp light.',
            ]),
            ...array_map(fn ($i) => ['op' => 'connect', 'from' => 'person', 'out' => 'image', 'to' => "scene-{$i}", 'in' => 'image'], [1, 2, 3]),
        ],
        'brief' => $B['kiln'], 'run' => ['scene-1', 'scene-2', 'scene-3', 'caption'],
    ],
    'hf-trend' => [
        'ops' => fn ($id) => [
            ['op' => 'remove', 'ids' => [$id('who'), $id('moves'), $id('motion'), $id('captions')]],
            ['op' => 'add', 'node' => ['id' => 'runner', 'type' => 'image.generate', 'x' => 80, 'y' => 80, 'label' => 'Him (AI-made, nobody real)', 'params' => ['aspect' => '9:16', 'prompt' => 'Full-body photo of a young man in a bright orange running jacket and black shorts standing on a sunny city bridge, facing the camera, smiling, morning light. No text.']]],
            ['op' => 'add', 'node' => ['id' => 'dance', 'type' => 'video.animate', 'x' => 440, 'y' => 80, 'label' => 'The moves', 'params' => ['prompt' => 'He does a simple upbeat viral dance, arms swinging and feet stepping to the beat, full body in frame, steady camera', 'duration' => 5]]],
            ['op' => 'add', 'node' => ['id' => 'words', 'type' => 'finish.design', 'x' => 800, 'y' => 80, 'params' => ['placement' => 'reel', 'texts' => [['slide' => 1, 'text' => 'POV: your first 6:30 run', 'position' => 'top', 'size' => 'large', 'style' => 'outline', 'color' => '#ffffff', 'box_color' => '#000000', 'font' => 'anton']]]]],
            ['op' => 'connect', 'from' => 'runner', 'out' => 'image', 'to' => 'dance', 'in' => 'image'],
            ['op' => 'connect', 'from' => 'dance', 'out' => 'video', 'to' => 'words', 'in' => 'media'],
        ],
        'brief' => $B['northline'], 'run' => ['words', 'caption'],
    ],
    'hf-ads' => [
        'ops' => fn ($id) => [
            ['op' => 'remove', 'ids' => [$id('ads')]],
            ...array_map(fn ($i, $scene) => ['op' => 'add', 'node' => ['id' => "ad-{$i}", 'type' => 'image.edit', 'x' => 440, 'y' => ($i - 1) * 380 + 80, 'label' => "Ad {$i}", 'params' => ['instruction' => "Keep the serum bottle exactly as it is: its shape, its frosted glass, its dropper. {$scene} Calm empty space at the top for a headline. Luxury skincare advertising photography."]]], [1, 2, 3, 4], [
                'Put it on wet dark stone with morning dew, soft green light through leaves.',
                'Put it in a bowl of fresh green tea leaves, top-down, bright and airy.',
                'Put it on a pale bathroom shelf beside a folded towel, soft morning window light.',
                'Hold it in a hand with a single drop falling from the dropper, clean pale green background.',
            ]),
            ...array_map(fn ($i) => ['op' => 'connect', 'from' => $id('product'), 'out' => 'image', 'to' => "ad-{$i}", 'in' => 'image'], [1, 2, 3, 4]),
            ['op' => 'add', 'node' => ['id' => 'layout', 'type' => 'finish.design', 'x' => 800, 'y' => 80, 'label' => 'The ads', 'params' => ['texts' => array_merge(...array_map(fn ($i, $h) => [
                ['slide' => $i, 'text' => $h, 'position' => 'top', 'size' => 'large', 'style' => 'plain', 'color' => '#1f2b1d', 'font' => 'montserrat'],
                ['slide' => $i, 'text' => 'Try the 7 ml sample', 'position' => 'bottom', 'size' => 'small', 'style' => 'box', 'color' => '#ffffff', 'box_color' => '#3E5A3A', 'font' => 'montserrat'],
            ], [1, 2, 3, 4], ['Calm skin by morning.', 'Green tea. Niacinamide. Nothing else.', 'No sting. Just calm.', 'One drop. Every morning.']))]]],
            ...array_map(fn ($i) => ['op' => 'connect', 'from' => "ad-{$i}", 'out' => 'image', 'to' => 'layout', 'in' => 'media'], [1, 2, 3, 4]),
        ],
        'brief' => $B['dew'], 'media' => ['product' => ['dew-serum.webp']], 'run' => ['layout', 'caption'],
    ],
    'hf-restyle' => [
        'ops' => fn ($id) => [
            ['op' => 'remove', 'ids' => [$id('clip'), $id('restyle')]],
            ['op' => 'add', 'node' => ['id' => 'frame', 'type' => 'source.media', 'x' => 80, 'y' => 80, 'label' => 'The original clip’s first frame']],
            ['op' => 'add', 'node' => ['id' => 'clay', 'type' => 'image.edit', 'x' => 440, 'y' => 80, 'label' => 'In clay', 'params' => ['instruction' => 'Turn the whole picture into a handmade claymation scene: the glass, the coffee, the ice, the wall and the boats all made of modelling clay, visible fingerprints, same composition and colours.']]],
            ['op' => 'add', 'node' => ['id' => 'move', 'type' => 'video.animate', 'x' => 800, 'y' => 80, 'label' => 'Moving again', 'params' => ['prompt' => 'Clay coffee slowly poured over clay ice cubes, stop-motion animation feel, steady camera', 'duration' => 5]]],
            ['op' => 'connect', 'from' => 'frame', 'out' => 'image', 'to' => 'clay', 'in' => 'image'],
            ['op' => 'connect', 'from' => 'clay', 'out' => 'image', 'to' => 'move', 'in' => 'image'],
            ['op' => 'connect', 'from' => 'move', 'out' => 'video', 'to' => $id('text'), 'in' => 'media'],
        ],
        'brief' => $B['lowtide'], 'media' => ['frame' => ['the-pour.webp']], 'run' => ['text', 'caption'],
    ],
    'youtube-clips' => [
        'ops' => fn ($id) => [
            ['op' => 'remove', 'ids' => [$id('youtube'), $id('transcript'), $id('moments')]],
            ['op' => 'add', 'node' => ['id' => 'host', 'type' => 'image.generate', 'x' => 80, 'y' => 80, 'label' => 'The host (AI-made, nobody real)', 'params' => ['aspect' => '16:9', 'prompt' => 'Wide shot of a woman podcast host in her forties with grey-streaked hair talking into a large studio microphone at a wooden table, cosy studio with warm lamps and bookshelves behind, she sits right of centre, facing the camera. No text.']]],
            ['op' => 'add', 'node' => ['id' => 'talks', 'type' => 'video.animate', 'x' => 440, 'y' => 80, 'params' => ['prompt' => 'She talks naturally into the microphone, small head movements and hand gestures, steady camera', 'duration' => 5]]],
            ['op' => 'add', 'node' => ['id' => 'says', 'type' => 'people.dub', 'x' => 800, 'y' => 80, 'label' => 'The episode', 'params' => ['consent' => true, 'voice' => $V['neighbor'], 'script' => 'Most month-end pain is the same ten spreadsheets, copied by hand.']]],
            ['op' => 'connect', 'from' => 'host', 'out' => 'image', 'to' => 'talks', 'in' => 'image'],
            ['op' => 'connect', 'from' => 'talks', 'out' => 'video', 'to' => 'says', 'in' => 'video'],
            ['op' => 'connect', 'from' => 'says', 'out' => 'video', 'to' => $id('cut'), 'in' => 'video'],
            ['op' => 'set', 'id' => $id('cut'), 'params' => ['moment' => null, 'start' => 0, 'end' => 5, 'jumpcuts' => false]],
            ['op' => 'set', 'id' => $id('caption'), 'params' => ['instructions' => 'A caption for a clip from the Ledgerly podcast: most month-end pain is the same ten spreadsheets, copied by hand.']],
        ],
        'brief' => null, 'run' => ['captions', 'caption'],
    ],
    'recording-to-posts' => [
        'ops' => fn ($id) => [
            ['op' => 'add', 'node' => ['id' => 'memo-words', 'type' => 'source.text', 'x' => -280, 'y' => 80, 'label' => 'What the founder said', 'params' => ['text' => 'Quick memo before I forget. Northwind came to us closing the books in nine days. Nine. Most of it was the same ten spreadsheets, copied by hand, every month. We connected their bank feeds and let the reconciliation run overnight. Last month they closed in three days. Their controller told me the best part is not the speed, it is that nobody stays late on the last Friday anymore. That is the story I want us to tell.']]],
            ['op' => 'add', 'node' => ['id' => 'memo', 'type' => 'audio.voice', 'x' => 80, 'y' => 80, 'label' => 'The voice memo', 'params' => ['voice' => 'vs:'.$V['documentarian']]]],
            ['op' => 'connect', 'from' => 'memo-words', 'out' => 'text', 'to' => 'memo', 'in' => 'script'],
            ['op' => 'connect', 'from' => 'memo', 'out' => 'audio', 'to' => $id('transcript'), 'in' => 'media'],
            ['op' => 'remove', 'id' => $id('audio')],
            ['op' => 'set', 'id' => $id('moments'), 'params' => ['count' => 2, 'min' => 5, 'max' => 25, 'platform' => 'x']],
            ['op' => 'set', 'id' => $id('post-text'), 'params' => ['platform' => 'linkedin']],
        ],
        'brief' => $B['ledgerly'], 'run' => ['post-text'],
    ],
    'thought' => ['brief' => $B['ledgerly'], 'set' => ['text' => ['platform' => 'linkedin', 'instructions' => 'One sharp thought for finance leads: the close is slow because of copying, not because of accounting.'], 'picture' => ['prompt' => 'A calm minimal desk at dawn, a closed laptop and one cup of coffee, muted blue light, lots of empty space. No text.']], 'run' => ['text', 'picture']],
    'campaign-pack' => ['brief' => $B['wildstem'], 'set' => ['video' => ['voice' => $V['upbeat'], 'song' => 'light spring acoustic pop, ukulele and soft claps, 105 bpm']], 'run' => ['design', 'video', 'caption', 'short']],
];

// Phase two: made from another example's video, once it's done.
$S2 = [
    'dub-language' => ['media_made' => ['video' => ['talking-portrait', 'dub']], 'set' => ['dub' => ['consent' => true], 'captions' => ['style' => 'clean']], 'run' => ['captions']],
    'face-swap' => [
        'ops' => fn ($id) => [
            ['op' => 'add', 'node' => ['id' => 'face-made', 'type' => 'image.generate', 'x' => 80, 'y' => 460, 'label' => 'The face (AI-made, nobody real)', 'params' => ['aspect' => '4:5', 'prompt' => 'Portrait photo of a woman in her thirties with long straight auburn hair and freckles, looking at the camera with a calm smile, soft window light, plain background. No text.']]],
            ['op' => 'connect', 'from' => 'face-made', 'out' => 'image', 'to' => $id('swap'), 'in' => 'face'],
            ['op' => 'remove', 'id' => $id('face')],
        ],
        'media_made' => ['video' => ['talking-portrait', 'dub']], 'set' => ['swap' => ['consent' => true]], 'run' => ['captions'],
    ],
];

$only = array_filter(explode(',', (string) getenv('ONLY')));
$phase = getenv('PHASE') === '2' ? $S2 : $S;
foreach ($phase as $key => $s) {
    if ($only && ! in_array($key, $only, true)) {
        continue;
    }
    $t = Templates::all()[$key];
    $project = $user->projects()->create(['name' => 'Showcase · '.$t['name'], 'canvas' => Graph::normalize(['version' => 2])]);
    [, $res] = $engine->apply($project, [['op' => 'insert', 'graph' => $t['graph'], 'x' => 80, 'y' => 80]]);
    $ids = $res[0]['ids'];
    $id = fn (string $n) => $ids[$n] ?? $n;
    $ops = isset($s['ops']) ? ($s['ops'])($id) : [];
    if (! empty($s['brief']) && isset($ids['brief'])) {
        $ops[] = ['op' => 'set', 'id' => $ids['brief'], 'params' => $s['brief']];
    }
    foreach ($s['set'] ?? [] as $n => $params) {
        $ops[] = ['op' => 'set', 'id' => $id($n), 'params' => $params];
    }
    foreach ($s['media'] ?? [] as $n => $files) {
        $ops[] = ['op' => 'set', 'id' => $id($n), 'params' => ['assets' => array_map($asset, $files)]];
    }
    foreach ($s['media_made'] ?? [] as $n => [$from, $node]) {
        $ops[] = ['op' => 'set', 'id' => $id($n), 'params' => ['assets' => [$made($from, $node)]]];
    }
    $engine->apply($project, $ops);
    // Words by Kimi K3, as in the rest of the showcase.
    $engine->apply($project, collect($project->fresh()->canvas['nodes'])->filter(fn ($n) => in_array($n['type'], ['text.write', 'text.translate', 'clip.moments'], true))
        ->map(fn ($n) => ['op' => 'set', 'id' => $n['id'], 'params' => ['model' => $KIMI]])->values()->all());
    $engine->apply($project, [['op' => 'tidy']]);
    // A node added here keeps its own id; a template's is looked up.
    $id = fn (string $n) => Graph::find($project->fresh()->canvas, $n) ? $n : ($ids[$n] ?? $n);
    foreach ($s['run'] as $n) {
        try {
            $engine->run($project->fresh(), $id($n), 'you', true);
        } catch (Throwable $e) {
            echo "{$key}.{$n}: ".$e->getMessage()."\n";
        }
    }
    $done[$key] = ['project' => $project->id, 'ids' => $ids, 'run' => array_map($id, $s['run'])];
    file_put_contents($log, json_encode($done, JSON_PRETTY_PRINT));
    echo "{$key}: project {$project->id}\n";
}

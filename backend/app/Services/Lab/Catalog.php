<?php

namespace App\Services\Lab;

/**
 * Every kind of Creative Lab node: what it takes in (typed ports on its left), what it makes (typed
 * ports on its right), its settings, and how it runs.
 *
 * Port types: image, video, audio, text, brief, moments, transcript, source (a YouTube video before
 * it's downloaded), post. An input lists the types it accepts.
 *
 * `run` says when a node runs:
 *   none    it has nothing to run: what it holds is its output (media, text, a brief, a note)
 *   auto    fast and free: it runs again on its own whenever what it depends on changes
 *   manual  slow or paid: it waits for Run, and shows how long and what it costs first
 *   post    the Post node: saving or scheduling is a person's decision, never automatic
 * A node that runs auto with a model that's slow or paid turns manual (Engine::policy).
 */
class Catalog
{
    public const GROUPS = [
        'source' => 'Sources',
        'text' => 'Words',
        'image' => 'Pictures',
        'video' => 'Video',
        'audio' => 'Sound',
        'people' => 'People',
        'clip' => 'Clipping',
        'finish' => 'Finish',
        'util' => 'Notes',
    ];

    public const PORT_TYPES = [
        'image' => 'Picture',
        'video' => 'Video',
        'audio' => 'Sound',
        'text' => 'Text',
        'brief' => 'Brief',
        'moments' => 'Moments',
        'transcript' => 'Transcript',
        'source' => 'Online video',
        'channel' => 'Where it goes',
        'post' => 'Post',
    ];

    /** The platforms a node can be written or shaped for. */
    public const PLATFORMS = ['instagram' => 'Instagram', 'x' => 'X', 'tiktok' => 'TikTok', 'youtube' => 'YouTube', 'linkedin' => 'LinkedIn', 'facebook' => 'Facebook', 'pinterest' => 'Pinterest'];

    public const ASPECTS = ['original' => 'As it is', '9:16' => '9:16 (vertical)', '4:5' => '4:5 (portrait)', '1:1' => '1:1 (square)', '16:9' => '16:9 (wide)'];

    /**
     * @return array<string, array<string, mixed>>
     */
    public static function nodes(): array
    {
        static $nodes = null;
        if ($nodes !== null) {
            return $nodes;
        }
        $nodes = self::define();
        // Every node that takes a brief says what it takes from it.
        foreach ($nodes as $type => $n) {
            if (collect($n['inputs'])->contains('name', 'brief')) {
                $nodes[$type]['fields'][] = ['key' => 'brief_use', 'label' => 'From the brief, use', 'kind' => 'select', 'default' => 'both',
                    'options' => ['both' => 'The style and the facts', 'style' => 'The style only', 'facts' => 'The facts only'], 'connected' => 'brief'];
            }
        }

        return $nodes;
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private static function define(): array
    {
        $aspect = ['key' => 'aspect', 'label' => 'Shape', 'kind' => 'select', 'options' => ['9:16' => '9:16 (vertical)', '4:5' => '4:5 (portrait)', '1:1' => '1:1 (square)', '16:9' => '16:9 (wide)'], 'default' => '4:5'];
        $consent = ['key' => 'consent', 'label' => 'The person whose face or voice this is agreed to it', 'kind' => 'toggle', 'default' => false, 'help' => 'Only your own face or voice, or someone who agreed (a model, a teammate). Never a public figure, and never to pass off as real.'];

        return [
            /* ---------------------------------------------------------------- sources */
            'source.media' => [
                'group' => 'source', 'label' => 'Media', 'detail' => 'Pictures, videos or sound from your gallery, or uploaded.',
                'inputs' => [],
                'outputs' => [['name' => 'image', 'label' => 'Pictures', 'type' => 'image'], ['name' => 'video', 'label' => 'Videos', 'type' => 'video'], ['name' => 'audio', 'label' => 'Sound', 'type' => 'audio']],
                'fields' => [['key' => 'assets', 'label' => 'Files', 'kind' => 'assets', 'default' => []]],
                'run' => 'none',
            ],
            'source.text' => [
                'group' => 'source', 'label' => 'Text', 'detail' => 'Words you write: a prompt, a script, a caption.',
                'inputs' => [],
                'outputs' => [['name' => 'text', 'label' => 'Text', 'type' => 'text']],
                'fields' => [['key' => 'text', 'label' => 'Text', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'Write anything: a prompt, the lines a voice reads, a caption…']],
                'run' => 'none',
            ],
            'source.brief' => [
                'group' => 'source', 'label' => 'Brief', 'detail' => 'The campaign and brand: guides the style, and fills in prompts ({product}, {offer}, {cta}…).',
                'inputs' => [],
                'outputs' => [['name' => 'brief', 'label' => 'Brief', 'type' => 'brief']],
                'fields' => [
                    ['key' => 'campaign_id', 'label' => 'Campaign', 'kind' => 'campaign', 'default' => null, 'help' => 'Its brief, period and content kit come along. Everything below adds to it or overrides it.'],
                    ['key' => 'account_id', 'label' => 'Account voice', 'kind' => 'account', 'default' => null],
                    ['key' => 'product', 'label' => 'Product or subject', 'kind' => 'text', 'default' => ''],
                    ['key' => 'audience', 'label' => 'Audience', 'kind' => 'text', 'default' => ''],
                    ['key' => 'offer', 'label' => 'Offer or message', 'kind' => 'text', 'default' => ''],
                    ['key' => 'cta', 'label' => 'Call to action', 'kind' => 'text', 'default' => ''],
                    ['key' => 'tone', 'label' => 'Tone', 'kind' => 'text', 'default' => '', 'placeholder' => 'warm, playful, premium…'],
                    ['key' => 'style', 'label' => 'Visual style', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'soft morning light, linen and oak, muted greens…'],
                    ['key' => 'palette', 'label' => 'Brand colours', 'kind' => 'colors', 'default' => []],
                    ['key' => 'font', 'label' => 'Brand font', 'kind' => 'font', 'default' => null],
                    ['key' => 'avoid', 'label' => 'Never', 'kind' => 'text', 'default' => ''],
                    ['key' => 'notes', 'label' => 'Anything else', 'kind' => 'textarea', 'default' => ''],
                ],
                'run' => 'none',
            ],
            'source.youtube' => [
                'group' => 'source', 'label' => 'YouTube video', 'detail' => 'A video to clip, used with permission. Only its sound is downloaded at first.',
                'inputs' => [],
                'outputs' => [['name' => 'source', 'label' => 'Video', 'type' => 'source'], ['name' => 'audio', 'label' => 'Sound', 'type' => 'audio'], ['name' => 'video', 'label' => 'Whole video', 'type' => 'video']],
                'fields' => [
                    ['key' => 'url', 'label' => 'Link', 'kind' => 'url', 'default' => '', 'placeholder' => 'https://www.youtube.com/watch?v=…'],
                    ['key' => 'source_id', 'label' => 'Video', 'kind' => 'hidden', 'default' => null],
                ],
                'run' => 'manual', 'run_label' => 'Fetch', 'seconds' => 60,
            ],

            /* ---------------------------------------------------------------- words */
            'text.write' => [
                'group' => 'text', 'label' => 'Write', 'detail' => 'A caption, a hook, a script, lines for a video, a thread…',
                'inputs' => [
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                    ['name' => 'context', 'label' => 'From', 'accepts' => ['text', 'transcript', 'moments'], 'multi' => true],
                ],
                'outputs' => [['name' => 'text', 'label' => 'Text', 'type' => 'text']],
                'fields' => [
                    ['key' => 'task', 'label' => 'Write', 'kind' => 'select', 'default' => 'caption', 'options' => [
                        'caption' => 'A caption', 'hook' => 'A hook (one line)', 'headline' => 'A headline for the picture', 'script' => 'A voiceover script',
                        'lines' => 'Lines for a video (one per picture)', 'thread' => 'A thread', 'hashtags' => 'Hashtags', 'prompt' => 'A picture prompt', 'custom' => 'Something else',
                    ]],
                    ['key' => 'instructions', 'label' => 'What it should say', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'Announce the autumn menu; mention the pumpkin latte…'],
                    ['key' => 'platform', 'label' => 'For', 'kind' => 'select', 'default' => 'instagram', 'options' => self::PLATFORMS],
                    ['key' => 'count', 'label' => 'How many (lines, posts)', 'kind' => 'number', 'default' => 4, 'min' => 1, 'max' => 10, 'show' => ['task' => ['lines', 'thread']]],
                    ['key' => 'length', 'label' => 'Length', 'kind' => 'select', 'default' => 'medium', 'options' => ['short' => 'Short', 'medium' => 'Medium', 'long' => 'Long']],
                    ['key' => 'model', 'label' => 'Model', 'kind' => 'model', 'models' => 'text', 'default' => null],
                ],
                'run' => 'auto', 'seconds' => 8,
            ],
            'text.translate' => [
                'group' => 'text', 'label' => 'Translate', 'detail' => 'The same words in another language, said the way a native would.',
                'inputs' => [['name' => 'text', 'label' => 'Text', 'accepts' => ['text', 'transcript'], 'required' => true]],
                'outputs' => [['name' => 'text', 'label' => 'Text', 'type' => 'text']],
                'fields' => [
                    ['key' => 'language', 'label' => 'Into', 'kind' => 'text', 'default' => 'French'],
                    ['key' => 'model', 'label' => 'Model', 'kind' => 'model', 'models' => 'text', 'default' => null],
                ],
                'run' => 'auto', 'seconds' => 6,
            ],

            /* ---------------------------------------------------------------- pictures */
            'image.generate' => [
                'group' => 'image', 'label' => 'Picture', 'detail' => 'A new picture from a prompt, with references if you have them.',
                'inputs' => [
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                    ['name' => 'prompt', 'label' => 'Prompt', 'accepts' => ['text']],
                    ['name' => 'reference', 'label' => 'References', 'accepts' => ['image'], 'multi' => true],
                ],
                'outputs' => [['name' => 'image', 'label' => 'Pictures', 'type' => 'image']],
                'fields' => [
                    ['key' => 'prompt', 'label' => 'Prompt', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'A ceramic mug of pumpkin latte on an oak table, morning light, calm space at the top'],
                    ['key' => 'model', 'label' => 'Model', 'kind' => 'model', 'models' => 'image', 'default' => null],
                    $aspect,
                    ['key' => 'variations', 'label' => 'How many', 'kind' => 'number', 'default' => 1, 'min' => 1, 'max' => 4],
                    ['key' => 'avoid', 'label' => 'Keep out', 'kind' => 'text', 'default' => '', 'placeholder' => 'text, logos, people'],
                ],
                'run' => 'auto', 'seconds' => 15,
            ],
            'image.edit' => [
                'group' => 'image', 'label' => 'Edit picture', 'detail' => 'Change a picture by saying what to change; the rest stays.',
                'inputs' => [
                    ['name' => 'image', 'label' => 'Picture', 'accepts' => ['image'], 'required' => true],
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                    ['name' => 'instruction', 'label' => 'Instruction', 'accepts' => ['text']],
                ],
                'outputs' => [['name' => 'image', 'label' => 'Picture', 'type' => 'image']],
                'fields' => [
                    ['key' => 'instruction', 'label' => 'What to change', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'Put the mug on a marble counter; keep the mug exactly as it is'],
                    ['key' => 'model', 'label' => 'Model', 'kind' => 'model', 'models' => 'image_edit', 'default' => null],
                ],
                'run' => 'auto', 'seconds' => 10,
            ],
            'image.paint' => [
                'group' => 'image', 'label' => 'Paint to change', 'detail' => 'Paint over part of a picture, then remove, replace or change only that part.',
                'inputs' => [['name' => 'image', 'label' => 'Picture', 'accepts' => ['image'], 'required' => true]],
                'outputs' => [['name' => 'image', 'label' => 'Picture', 'type' => 'image']],
                'fields' => [
                    ['key' => 'mask', 'label' => 'Painted area', 'kind' => 'mask', 'default' => null],
                    ['key' => 'mode', 'label' => 'Do', 'kind' => 'select', 'default' => 'remove', 'options' => ['remove' => 'Remove it', 'replace' => 'Replace it with…', 'change' => 'Change it', 'improve' => 'Improve it']],
                    ['key' => 'prompt', 'label' => 'With', 'kind' => 'text', 'default' => '', 'show' => ['mode' => ['replace', 'change']]],
                ],
                'run' => 'auto', 'seconds' => 12, 'engine' => true,
            ],
            'image.frame' => [
                'group' => 'image', 'label' => 'Frame from video', 'detail' => 'A still from a video: for a cover, or to edit and animate.',
                'inputs' => [['name' => 'video', 'label' => 'Video', 'accepts' => ['video'], 'required' => true]],
                'outputs' => [['name' => 'image', 'label' => 'Picture', 'type' => 'image']],
                'fields' => [['key' => 'at', 'label' => 'At (seconds; empty: a third of the way in)', 'kind' => 'number', 'default' => null, 'min' => 0, 'step' => 0.1]],
                'run' => 'auto', 'seconds' => 3,
            ],

            /* ---------------------------------------------------------------- video */
            'video.generate' => [
                'group' => 'video', 'label' => 'Video', 'detail' => 'A new video clip from a prompt.',
                'inputs' => [
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                    ['name' => 'prompt', 'label' => 'Prompt', 'accepts' => ['text']],
                ],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    ['key' => 'prompt', 'label' => 'Prompt', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'Steam rises from a latte as morning light moves across the table'],
                    ['key' => 'model', 'label' => 'Model', 'kind' => 'model', 'models' => 'video_t2v', 'default' => null],
                    ['key' => 'aspect', 'label' => 'Shape', 'kind' => 'select', 'options' => ['9:16' => '9:16 (vertical)', '16:9' => '16:9 (wide)', '1:1' => '1:1 (square)'], 'default' => '9:16'],
                    ['key' => 'duration', 'label' => 'Seconds', 'kind' => 'number', 'default' => 5, 'min' => 2, 'max' => 15],
                ],
                'run' => 'manual', 'seconds' => 300,
            ],
            'video.animate' => [
                'group' => 'video', 'label' => 'Animate picture', 'detail' => 'Bring a still to life: a few seconds of motion that start from it.',
                'inputs' => [
                    ['name' => 'image', 'label' => 'Picture', 'accepts' => ['image'], 'required' => true],
                    ['name' => 'prompt', 'label' => 'Motion', 'accepts' => ['text']],
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                ],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    ['key' => 'prompt', 'label' => 'What moves', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'Slow push in; steam curls up from the cup'],
                    ['key' => 'model', 'label' => 'Model', 'kind' => 'model', 'models' => 'video_i2v', 'default' => null],
                    ['key' => 'duration', 'label' => 'Seconds', 'kind' => 'number', 'default' => 5, 'min' => 2, 'max' => 15],
                ],
                'run' => 'manual', 'seconds' => 300,
            ],
            'video.slideshow' => [
                'group' => 'video', 'label' => 'Moving pictures', 'detail' => 'Pictures that zoom and pan like a film, with a voice reading a line over each if you want, captions, music and an end card.',
                'inputs' => [
                    ['name' => 'images', 'label' => 'Pictures', 'accepts' => ['image'], 'multi' => true, 'required' => true],
                    ['name' => 'lines', 'label' => 'Lines', 'accepts' => ['text']],
                    ['name' => 'music', 'label' => 'Music', 'accepts' => ['audio']],
                ],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    ['key' => 'lines', 'label' => 'What the voice says, one line per picture (empty: music only)', 'kind' => 'textarea', 'default' => ''],
                    ['key' => 'voice', 'label' => 'Voice', 'kind' => 'voice', 'default' => null, 'engine' => true],
                    ['key' => 'music', 'label' => 'Music', 'kind' => 'select', 'default' => 'song', 'options' => ['none' => 'None', 'song' => 'A song written for it (ACE-Step, on the pod)', 'golden-hour' => 'Golden hour · warm lo-fi', 'linen' => 'Linen · airy ambient', 'atelier' => 'Atelier · bright acoustic', 'pulse' => 'Pulse · upbeat house', 'night-drive' => 'Night drive · synthwave', 'bloom' => 'Bloom · dreamy, cinematic']],
                    ['key' => 'song', 'label' => 'The song', 'kind' => 'text', 'default' => '', 'placeholder' => 'upbeat acoustic pop, ukulele, hand claps, 110 bpm', 'show' => ['music' => ['song']]],
                    ['key' => 'cta', 'label' => 'End card button', 'kind' => 'text', 'default' => '', 'placeholder' => 'Order now'],
                    ['key' => 'captions', 'label' => 'Captions', 'kind' => 'toggle', 'default' => true],
                    ['key' => 'motion', 'label' => 'Camera', 'kind' => 'select', 'default' => 'auto', 'options' => ['auto' => 'Varied', 'zoom-in' => 'Zoom in', 'zoom-out' => 'Zoom out', 'pan' => 'Pan', 'still' => 'Still']],
                    ['key' => 'platform', 'label' => 'For', 'kind' => 'select', 'default' => 'instagram', 'options' => ['instagram' => 'Instagram reel', 'x' => 'X', 'tiktok' => 'TikTok', 'youtube' => 'YouTube Short']],
                ],
                'run' => 'manual', 'seconds' => 60, 'engine' => true,
            ],
            'video.reel' => [
                'group' => 'video', 'label' => 'Reel look', 'detail' => 'A voice or a track over a picture, a video or a moving gradient: Bold, Editorial or Pulse.',
                'inputs' => [
                    ['name' => 'sound', 'label' => 'Voice or track', 'accepts' => ['audio'], 'required' => true],
                    ['name' => 'background', 'label' => 'Background', 'accepts' => ['image', 'video']],
                    ['name' => 'music', 'label' => 'Music under', 'accepts' => ['audio']],
                ],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    ['key' => 'style', 'label' => 'Look', 'kind' => 'select', 'default' => 'bold', 'options' => ['bold' => 'Bold · big words that light up', 'editorial' => 'Editorial · a magazine page', 'pulse' => 'Pulse · an audiogram']],
                    ['key' => 'title', 'label' => 'Title', 'kind' => 'text', 'default' => ''],
                    ['key' => 'accent', 'label' => 'Accent', 'kind' => 'color', 'default' => '#a5b4fc'],
                    ['key' => 'captions', 'label' => 'Captions', 'kind' => 'toggle', 'default' => true],
                    ['key' => 'music_volume', 'label' => 'Music volume', 'kind' => 'range', 'default' => 0.3, 'min' => 0, 'max' => 1, 'step' => 0.05],
                ],
                'run' => 'manual', 'seconds' => 40,
            ],
            'video.cut' => [
                'group' => 'video', 'label' => 'Cut & reframe', 'detail' => 'A part of a video, in the shape the platform wants: cropped, blurred behind, or following the speaker.',
                'inputs' => [
                    ['name' => 'video', 'label' => 'Video', 'accepts' => ['video', 'source'], 'required' => true],
                    ['name' => 'moments', 'label' => 'Moments', 'accepts' => ['moments']],
                ],
                'outputs' => [['name' => 'video', 'label' => 'Clip', 'type' => 'video']],
                'fields' => [
                    ['key' => 'moment', 'label' => 'Moment', 'kind' => 'moment', 'default' => 1, 'help' => 'Which of the found moments; its start and end fill in the times.'],
                    ['key' => 'start', 'label' => 'From (s)', 'kind' => 'number', 'default' => null, 'min' => 0, 'step' => 0.1],
                    ['key' => 'end', 'label' => 'To (s)', 'kind' => 'number', 'default' => null, 'min' => 0, 'step' => 0.1],
                    ['key' => 'aspect', 'label' => 'Shape', 'kind' => 'select', 'options' => self::ASPECTS, 'default' => '9:16'],
                    ['key' => 'fit', 'label' => 'Reframe by', 'kind' => 'select', 'default' => 'crop', 'options' => ['crop' => 'Cropping', 'speaker' => 'Following the speaker', 'blur' => 'Fitting it, blurred behind', 'fit' => 'Fitting it, plain bars']],
                    ['key' => 'focus', 'label' => 'Crop centre (left ← → right)', 'kind' => 'range', 'default' => 0.5, 'min' => 0, 'max' => 1, 'step' => 0.01, 'show' => ['fit' => ['crop']]],
                    ['key' => 'jumpcuts', 'label' => 'Cut out silences and “um”s', 'kind' => 'toggle', 'default' => false],
                ],
                'run' => 'auto', 'seconds' => 20,
            ],
            'video.captions' => [
                'group' => 'video', 'label' => 'Captions', 'detail' => 'The words burned on the video as they are said, one group at a time.',
                'inputs' => [['name' => 'video', 'label' => 'Video', 'accepts' => ['video'], 'required' => true]],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    ['key' => 'style', 'label' => 'Style', 'kind' => 'select', 'default' => 'bold', 'options' => ['bold' => 'Bold, the word said lit up', 'clean' => 'Clean, white with a shadow', 'boxed' => 'On a dark band']],
                    ['key' => 'position', 'label' => 'Where', 'kind' => 'select', 'default' => 'lower', 'options' => ['lower' => 'Lower third', 'middle' => 'Middle', 'top' => 'Top']],
                    ['key' => 'color', 'label' => 'Colour', 'kind' => 'color', 'default' => '#ffffff'],
                    ['key' => 'highlight', 'label' => 'Word being said', 'kind' => 'color', 'default' => '#facc15', 'show' => ['style' => ['bold']]],
                    ['key' => 'words', 'label' => 'Words at a time', 'kind' => 'number', 'default' => 3, 'min' => 1, 'max' => 8],
                    ['key' => 'upper', 'label' => 'Capitals', 'kind' => 'toggle', 'default' => true],
                    ['key' => 'font', 'label' => 'Font', 'kind' => 'font', 'default' => null],
                ],
                'run' => 'auto', 'seconds' => 25,
            ],
            'video.mix' => [
                'group' => 'video', 'label' => 'Add sound', 'detail' => 'Music under the speech, a voiceover, or a new soundtrack.',
                'inputs' => [
                    ['name' => 'video', 'label' => 'Video', 'accepts' => ['video'], 'required' => true],
                    ['name' => 'audio', 'label' => 'Sound', 'accepts' => ['audio'], 'multi' => true, 'required' => true],
                ],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    ['key' => 'mode', 'label' => 'How', 'kind' => 'select', 'default' => 'under', 'options' => ['under' => 'Under the video’s own sound (it steps aside when someone speaks)', 'replace' => 'Instead of the video’s sound', 'mix' => 'Together, as they are']],
                    ['key' => 'volume', 'label' => 'Volume of what’s added (empty: what suits the way it’s added)', 'kind' => 'range', 'default' => null, 'min' => 0, 'max' => 1.5, 'step' => 0.05],
                ],
                'run' => 'auto', 'seconds' => 15,
            ],
            'video.join' => [
                'group' => 'video', 'label' => 'Join', 'detail' => 'Videos one after the other, in the order of their lines.',
                'inputs' => [['name' => 'videos', 'label' => 'Videos', 'accepts' => ['video'], 'multi' => true, 'required' => true]],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [],
                'run' => 'auto', 'seconds' => 20,
            ],

            /* ---------------------------------------------------------------- sound */
            'audio.voice' => [
                'group' => 'audio', 'label' => 'Voiceover', 'detail' => 'Words read aloud, every word timed for captions: in a voice from the list, or one cloned from a recording.',
                'inputs' => [
                    ['name' => 'script', 'label' => 'Script', 'accepts' => ['text']],
                    ['name' => 'clone', 'label' => 'Voice to clone', 'accepts' => ['audio', 'video']],
                ],
                'outputs' => [['name' => 'audio', 'label' => 'Voice', 'type' => 'audio']],
                'fields' => [
                    ['key' => 'script', 'label' => 'Script', 'kind' => 'textarea', 'default' => ''],
                    ['key' => 'voice', 'label' => 'Voice', 'kind' => 'voice', 'default' => null, 'help' => 'Or connect a recording to Voice to clone (one person speaking, 5 to 20 seconds): it reads in that voice.'],
                    ['key' => 'speed', 'label' => 'Pace', 'kind' => 'range', 'default' => 1.0, 'min' => 0.7, 'max' => 1.3, 'step' => 0.05],
                    [...$consent, 'help' => 'Needed to clone a voice: your own, or someone who agreed. Never a public figure, and never to pass off as real.'],
                ],
                'run' => 'auto', 'seconds' => 10,
            ],
            'audio.music' => [
                'group' => 'audio', 'label' => 'Music', 'detail' => 'Original, licence-free music: one of six moods, or a song written to a description.',
                'inputs' => [
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                    ['name' => 'video', 'label' => 'As long as', 'accepts' => ['video']],
                ],
                'outputs' => [['name' => 'audio', 'label' => 'Track', 'type' => 'audio']],
                'fields' => [
                    ['key' => 'source', 'label' => 'Made by', 'kind' => 'select', 'default' => 'song', 'options' => ['song' => 'A song written to a description (ACE-Step, on the pod)', 'composer' => 'FlowAI Sound’s composer (a mood; needs the local sound service)']],
                    ['key' => 'mood', 'label' => 'Mood', 'kind' => 'select', 'default' => 'golden-hour', 'options' => ['golden-hour' => 'Golden hour · warm lo-fi', 'linen' => 'Linen · airy ambient', 'atelier' => 'Atelier · bright acoustic', 'pulse' => 'Pulse · upbeat house', 'night-drive' => 'Night drive · synthwave', 'bloom' => 'Bloom · dreamy, cinematic'], 'show' => ['source' => ['composer']]],
                    ['key' => 'description', 'label' => 'The song', 'kind' => 'text', 'default' => '', 'placeholder' => 'upbeat acoustic pop, ukulele, hand claps, 110 bpm', 'show' => ['source' => ['song']]],
                    ['key' => 'seconds', 'label' => 'Seconds (empty: as long as the video)', 'kind' => 'number', 'default' => 30, 'min' => 5, 'max' => 180],
                ],
                'run' => 'auto', 'seconds' => 20,
            ],
            'audio.transcribe' => [
                'group' => 'audio', 'label' => 'Transcript', 'detail' => 'Every word said, and when: for captions, finding moments, writing posts.',
                'inputs' => [['name' => 'media', 'label' => 'Sound or video', 'accepts' => ['audio', 'video', 'source'], 'required' => true]],
                'outputs' => [['name' => 'transcript', 'label' => 'Transcript', 'type' => 'transcript'], ['name' => 'text', 'label' => 'Text', 'type' => 'text']],
                'fields' => [['key' => 'language', 'label' => 'Language (empty: found by itself)', 'kind' => 'text', 'default' => '']],
                'run' => 'auto', 'seconds' => 60,
            ],

            /* ---------------------------------------------------------------- people */
            'people.swap' => [
                'group' => 'people', 'label' => 'Face swap', 'detail' => 'A face from one picture put on the person in a picture or a video.',
                'inputs' => [
                    ['name' => 'face', 'label' => 'Face', 'accepts' => ['image'], 'required' => true],
                    ['name' => 'target', 'label' => 'Onto', 'accepts' => ['image', 'video'], 'required' => true],
                ],
                'outputs' => [['name' => 'image', 'label' => 'Picture', 'type' => 'image'], ['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    $consent,
                    ['key' => 'every', 'label' => 'Every face, not only the largest', 'kind' => 'toggle', 'default' => false],
                ],
                'run' => 'manual', 'seconds' => 90, 'engine' => true,
            ],
            'people.dub' => [
                'group' => 'people', 'label' => 'Dub', 'detail' => 'The video says new words in the speaker’s own voice, lips redrawn to match.',
                'inputs' => [
                    ['name' => 'video', 'label' => 'Video', 'accepts' => ['video'], 'required' => true],
                    ['name' => 'script', 'label' => 'New words', 'accepts' => ['text']],
                ],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    $consent,
                    ['key' => 'script', 'label' => 'What they say now', 'kind' => 'textarea', 'default' => ''],
                    ['key' => 'voice', 'label' => 'Voice (empty: theirs, cloned from the video)', 'kind' => 'voice', 'default' => null, 'engine' => true],
                ],
                'run' => 'manual', 'seconds' => 240, 'engine' => true,
            ],

            /* ---------------------------------------------------------------- clipping */
            'clip.moments' => [
                'group' => 'clip', 'label' => 'Find moments', 'detail' => 'The parts worth clipping: a sharp idea, a story, a quotable line. Each with a hook and a score.',
                'inputs' => [
                    ['name' => 'transcript', 'label' => 'Transcript', 'accepts' => ['transcript'], 'required' => true],
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                ],
                'outputs' => [['name' => 'moments', 'label' => 'Moments', 'type' => 'moments'], ['name' => 'text', 'label' => 'Hooks', 'type' => 'text']],
                'fields' => [
                    ['key' => 'count', 'label' => 'How many', 'kind' => 'number', 'default' => 5, 'min' => 1, 'max' => 12],
                    ['key' => 'platform', 'label' => 'For', 'kind' => 'select', 'default' => 'instagram', 'options' => ['instagram' => 'Instagram reel (up to 90 s)', 'x' => 'X (up to 140 s)', 'youtube' => 'YouTube Short (up to 180 s)', 'tiktok' => 'TikTok (up to 3 min)']],
                    ['key' => 'min', 'label' => 'Shortest (s)', 'kind' => 'number', 'default' => 15, 'min' => 3, 'max' => 120],
                    ['key' => 'max', 'label' => 'Longest (s)', 'kind' => 'number', 'default' => 45, 'min' => 5, 'max' => 180],
                    ['key' => 'focus', 'label' => 'Look for', 'kind' => 'text', 'default' => '', 'placeholder' => 'practical tips, funny stories, anything about pricing…'],
                    ['key' => 'model', 'label' => 'Model', 'kind' => 'model', 'models' => 'text', 'default' => null],
                ],
                'run' => 'auto', 'seconds' => 25,
            ],

            /* ---------------------------------------------------------------- finish */
            'finish.design' => [
                'group' => 'finish', 'label' => 'Design', 'detail' => 'Words on the pictures or videos, sized for the post: fonts, colours, where they sit.',
                'inputs' => [
                    ['name' => 'media', 'label' => 'Slides', 'accepts' => ['image', 'video'], 'multi' => true],
                    ['name' => 'headline', 'label' => 'Headline', 'accepts' => ['text']],
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                ],
                'outputs' => [['name' => 'image', 'label' => 'Pictures', 'type' => 'image'], ['name' => 'video', 'label' => 'Videos', 'type' => 'video']],
                'fields' => [
                    ['key' => 'platform', 'label' => 'For', 'kind' => 'select', 'default' => 'instagram', 'options' => ['instagram' => 'Instagram', 'x' => 'X']],
                    ['key' => 'placement', 'label' => 'As', 'kind' => 'select', 'default' => 'feed', 'options' => ['feed' => 'Feed post', 'story' => 'Story', 'reel' => 'Reel', 'post' => 'Post (X)']],
                    ['key' => 'texts', 'label' => 'Words', 'kind' => 'texts', 'default' => []],
                    ['key' => 'background', 'label' => 'Plain slides', 'kind' => 'color', 'default' => '#1c1c1c'],
                ],
                'run' => 'auto', 'seconds' => 6, 'engine' => true,
            ],
            'finish.channel' => [
                'group' => 'finish', 'label' => 'Where it goes', 'detail' => 'The account and the kind of post (feed, reel, story, Short…): the media fitted to its shape and length, the caption to its rules.',
                'inputs' => [
                    ['name' => 'media', 'label' => 'Media', 'accepts' => ['image', 'video'], 'multi' => true],
                    ['name' => 'caption', 'label' => 'Caption', 'accepts' => ['text']],
                ],
                'outputs' => [
                    ['name' => 'channel', 'label' => 'Where', 'type' => 'channel'],
                    ['name' => 'image', 'label' => 'Pictures', 'type' => 'image'],
                    ['name' => 'video', 'label' => 'Video', 'type' => 'video'],
                    ['name' => 'caption', 'label' => 'Caption', 'type' => 'text'],
                ],
                'fields' => [
                    ['key' => 'account_id', 'label' => 'Account', 'kind' => 'account', 'default' => null],
                    ['key' => 'placement', 'label' => 'As', 'kind' => 'placement', 'default' => null],
                    ['key' => 'fit', 'label' => 'When the shape doesn’t fit', 'kind' => 'select', 'default' => 'crop', 'options' => ['crop' => 'Crop it', 'blur' => 'Fit it, blurred behind', 'fit' => 'Fit it, plain bars']],
                    ['key' => 'rewrite', 'label' => 'Rewrite the caption for this platform', 'kind' => 'toggle', 'default' => true],
                    ['key' => 'model', 'label' => 'Model', 'kind' => 'model', 'models' => 'text', 'default' => null, 'show' => ['rewrite' => ['true']]],
                ],
                'run' => 'auto', 'seconds' => 15,
            ],
            'finish.post' => [
                'group' => 'finish', 'label' => 'Post', 'detail' => 'Where it goes and when: saved as a draft, scheduled, or posted now from a phone. The proof comes back here.',
                'inputs' => [
                    ['name' => 'channel', 'label' => 'Where', 'accepts' => ['channel']],
                    ['name' => 'media', 'label' => 'Media', 'accepts' => ['image', 'video'], 'multi' => true],
                    ['name' => 'caption', 'label' => 'Caption', 'accepts' => ['text']],
                ],
                'outputs' => [['name' => 'post', 'label' => 'Post', 'type' => 'post']],
                'fields' => [
                    ['key' => 'account_id', 'label' => 'Account', 'kind' => 'account', 'default' => null, 'unconnected' => 'channel'],
                    ['key' => 'placement', 'label' => 'As', 'kind' => 'placement', 'default' => null, 'unconnected' => 'channel'],
                    ['key' => 'title', 'label' => 'Title (for you)', 'kind' => 'text', 'default' => ''],
                    ['key' => 'caption', 'label' => 'Caption', 'kind' => 'textarea', 'default' => '', 'help' => 'Used when no caption is connected.'],
                    ['key' => 'when', 'label' => 'When', 'kind' => 'select', 'default' => 'draft', 'options' => ['draft' => 'Keep as a draft', 'at' => 'At a date and time', 'queue' => 'Next free time in the queue', 'now' => 'Now']],
                    ['key' => 'at', 'label' => 'Date and time', 'kind' => 'datetime', 'default' => null, 'show' => ['when' => ['at']]],
                    ['key' => 'device_id', 'label' => 'Publish with', 'kind' => 'device', 'default' => null, 'help' => 'The phone that posts it. Each phone is driven by the phone agent (AI) or by the publishing automation.'],
                ],
                'run' => 'post', 'run_label' => 'Save', 'seconds' => 2,
            ],

            /* ---------------------------------------------------------------- notes */
            'util.note' => [
                'group' => 'util', 'label' => 'Note', 'detail' => 'A note on the canvas, for you and the team.',
                'inputs' => [], 'outputs' => [],
                'fields' => [['key' => 'text', 'label' => 'Note', 'kind' => 'textarea', 'default' => '']],
                'run' => 'none',
            ],
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function node(string $type): ?array
    {
        return self::nodes()[$type] ?? null;
    }

    /**
     * The input port of that name, or null.
     *
     * @return array<string, mixed>|null
     */
    public static function input(string $type, string $port): ?array
    {
        return collect(self::node($type)['inputs'] ?? [])->firstWhere('name', $port);
    }

    /**
     * @return array<string, mixed>|null
     */
    public static function output(string $type, string $port): ?array
    {
        return collect(self::node($type)['outputs'] ?? [])->firstWhere('name', $port);
    }

    /**
     * A node's settings with every default filled in.
     *
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     */
    public static function withDefaults(string $type, array $params): array
    {
        $defaults = collect(self::node($type)['fields'] ?? [])->mapWithKeys(fn ($f) => [$f['key'] => $f['default'] ?? null])->all();

        return [...$defaults, ...array_intersect_key($params, $defaults)];
    }
}

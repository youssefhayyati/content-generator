<?php

namespace App\Services\Lab;

/**
 * Every kind of Creative Lab node: what it takes in (typed ports on its left), what it makes (typed
 * ports on its right), its settings, and how it runs.
 *
 * Port types: image, video, audio, text, brief, moments, transcript, source (a YouTube video before
 * it's downloaded), channel, character (a Soul ID trained at Higgsfield), post. An input lists the types
 * it accepts.
 *
 * A field marked `advanced` is folded away under "More settings" until it's wanted. `model_id` names the
 * one model a node runs on when it has no model to pick (Higgsfield's tools), for its time and cost.
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
        'higgsfield' => 'Higgsfield',
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
        'character' => 'Character',
        'post' => 'Post',
    ];

    /** Cinema Studio's camera moves, the favourites first. */
    public const CAMERA_MOVES = [
        'dolly-in' => 'Dolly in', 'crush-zoom' => 'Crash zoom', 'bullet-time' => 'Bullet time', 'drone-orbit' => 'Drone orbit',
        'dolly-zoom' => 'Dolly zoom (vertigo)', 'whip-pan' => 'Whip pan', 'arc-left' => 'Arc left', 'arc-right' => 'Arc right',
        'slow-zoom-in' => 'Slow zoom in', 'handheld' => 'Handheld', 'tracking' => 'Tracking', 'aerial-pullback' => 'Aerial pull-back',
        'crane-up' => 'Crane up', 'crane-down' => 'Crane down', 'dolly-out' => 'Dolly out', 'slow-zoom-out' => 'Slow zoom out',
        'side-tracking' => 'Side tracking', 'helicopter-shot' => 'Helicopter', 'snorricam' => 'Snorricam', 'robot-arm' => 'Robot arm',
        'pov' => 'Point of view', 'rack-focus' => 'Rack focus', 'static-shot' => 'Locked off', 'pan-left' => 'Pan left',
        'pan-right' => 'Pan right', 'tilt-up' => 'Tilt up', 'tilt-down' => 'Tilt down', 'truck-left' => 'Truck left',
        'truck-right' => 'Truck right', 'slider-left' => 'Slider left', 'slider-right' => 'Slider right',
        'pedestal-up' => 'Pedestal up', 'pedestal-down' => 'Pedestal down',
    ];

    /** Cinema Studio's colour grades, by name. */
    public const GRADES = [
        'static-noon', 'twilight-fable', 'back-row-kissing-seats', 'on-the-other-side-of-the-porthole', 'the-emerald-ambush', 'highway-standoff',
        'the-faded-fresco', 'oil-ochre', 'the-mountain-convent', 'ghost-in-the-code', 'pink-velvet', 'two-days-to-the-horizon', 'industrial-fog',
        'stairs-go-up', 'field-post', 'home-is-the-next-gas-station', 'glossy-flesh', 'the-crimson-ballet', 'neon-rain-at-midnight',
        'the-morning-after-rain', 'the-iron-borough', 'the-ground', 'the-investigation', 'turquoise-mirage', 'a-dream-in-color',
        'breakfast-on-schedule', 'favela-gold', 'a-hotel-for-one', 'after-dark', 'crimson-vigi', 'the-neighbors-saw-everything', 'the-grey-channel',
        'mirage-at-noon', 'bubblegum-boulevard', 'yellow-room', 'the-earth-keeps-things-reluctantly', 'tropic-fever-dream', 'bioluminescent-night',
        'dont-turn-it-off-im-watching', 'the-silk-curtain-falls', 'the-butterfly', 'playtime', 'wallpaper-romance', 'overtime',
        'the-way-home-is-longer', 'everyone-speaks-in-whispers', 'runaway-summer', 'amber-wasteland', 'the-circus', 'gasoline-sunset',
    ];

    /**
     * Whether a node needs AI to run: yes, some (only with some settings, and which), or no. Shown on
     * every node, so it's plain what runs on a model and what is worked out here.
     */
    private const AI = [
        'source.media' => ['no', 'It holds your files.'],
        'source.text' => ['no', 'It holds your words.'],
        'source.brief' => ['no', 'It holds the campaign and the brand.'],
        'source.youtube' => ['no', 'It downloads the video, once you’ve said it’s yours to use.'],
        'text.write' => ['yes', 'A text model writes it.'],
        'text.translate' => ['yes', 'A text model translates it.'],
        'image.generate' => ['yes', 'An image model draws it.'],
        'image.edit' => ['yes', 'An image model changes it.'],
        'image.paint' => ['yes', 'An image model redraws the painted part.'],
        'image.frame' => ['no', 'It takes a still from the video.'],
        'video.generate' => ['yes', 'A video model films it.'],
        'video.animate' => ['yes', 'A video model animates it.'],
        'video.slideshow' => ['some', 'AI only for the voice reading the lines and a song written for it; the motion, captions and end card are drawn here.'],
        'video.reel' => ['no', 'Drawn here, from the voice or track you connect.'],
        'video.cut' => ['some', 'AI only to follow the speaker (finding faces) and to cut silences (Whisper hears them).'],
        'video.captions' => ['some', 'AI only when the video doesn’t carry its words’ timing already: Whisper hears them.'],
        'video.mix' => ['no', 'Mixed here.'],
        'video.join' => ['no', 'Joined here.'],
        'audio.voice' => ['yes', 'A voice model reads it.'],
        'audio.music' => ['yes', 'A music model writes it.'],
        'audio.transcribe' => ['yes', 'Whisper hears every word.'],
        'people.swap' => ['yes', 'A face model puts the face on.'],
        'people.dub' => ['yes', 'A voice model says the words, a lip-sync model moves the lips.'],
        'clip.moments' => ['yes', 'A text model reads the transcript for the best parts.'],
        'finish.design' => ['no', 'The words are drawn here, in your fonts and colours.'],
        'finish.channel' => ['some', 'AI only to rewrite the caption for the platform (Rewrite on); fitting the media is done here.'],
        'finish.post' => ['some', 'Saving or scheduling needs none; the phone agent that posts it uses AI.'],
        'util.note' => ['no', 'A note.'],
        'video.cinema' => ['yes', 'Higgsfield’s Cinema Studio films it.'],
        'people.character' => ['yes', 'Higgsfield’s Soul ID learns the face.'],
        'image.character' => ['yes', 'Higgsfield’s Soul draws them.'],
        'people.motion' => ['yes', 'Kling Motion Control, on Higgsfield, moves them.'],
        'image.ads' => ['yes', 'Higgsfield’s Ads Studio makes the ads.'],
        'video.restyle' => ['yes', 'Higgsfield’s Genjutsu restyles it.'],
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
        foreach ($nodes as $type => $n) {
            [$nodes[$type]['ai'], $nodes[$type]['ai_detail']] = self::AI[$type] ?? ['no', null];
            // Every node that takes a brief says what it takes from it.
            if (collect($n['inputs'])->contains('name', 'brief')) {
                $nodes[$type]['fields'][] = ['key' => 'brief_use', 'label' => 'From the brief, use', 'kind' => 'select', 'default' => 'both',
                    'options' => ['both' => 'The style and the facts', 'style' => 'The style only', 'facts' => 'The facts only'], 'connected' => 'brief', 'advanced' => true];
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

            /* ---------------------------------------------------------------- Higgsfield's tools */
            'video.cinema' => [
                'group' => 'higgsfield', 'label' => 'Cinematic shot', 'detail' => 'Higgsfield Cinema Studio: a shot with a real camera move (crash zoom, bullet time, drone orbit…), a genre, a lens and a grade, with sound.',
                'inputs' => [
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                    ['name' => 'prompt', 'label' => 'Prompt', 'accepts' => ['text']],
                    ['name' => 'reference', 'label' => 'In the shot', 'accepts' => ['image'], 'multi' => true],
                ],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    ['key' => 'prompt', 'label' => 'The shot', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'Our ceramic mug on a rainy café window sill, steam rising, the street blurred behind',
                        'help' => 'Pictures connected to In the shot are used as they are: name one in the prompt with <<<image_1>>>, <<<image_2>>>…'],
                    ['key' => 'camera', 'label' => 'Camera move', 'kind' => 'chips', 'default' => 'dolly-in', 'options' => ['' => 'Its choice', ...self::CAMERA_MOVES], 'top' => 12],
                    ['key' => 'genre', 'label' => 'Genre', 'kind' => 'chips', 'default' => '', 'options' => ['' => 'Its choice', 'drama' => 'Drama', 'epic' => 'Epic', 'action' => 'Action', 'comedy' => 'Comedy', 'noir' => 'Noir', 'horror' => 'Horror']],
                    ['key' => 'aspect', 'label' => 'Shape', 'kind' => 'select', 'default' => '9:16', 'options' => ['9:16' => '9:16 (vertical)', '3:4' => '3:4 (portrait)', '1:1' => '1:1 (square)', '16:9' => '16:9 (wide)', '21:9' => '21:9 (cinemascope)']],
                    ['key' => 'duration', 'label' => 'Seconds', 'kind' => 'number', 'default' => 6, 'min' => 4, 'max' => 30],
                    ['key' => 'sound', 'label' => 'Sound made with it', 'kind' => 'toggle', 'default' => true],
                    ['key' => 'grade', 'label' => 'Colour grade', 'kind' => 'select', 'default' => '', 'options' => ['' => 'Its choice', ...array_combine(self::GRADES, array_map(fn ($g) => ucfirst(str_replace('-', ' ', $g)), self::GRADES))], 'advanced' => true],
                    ['key' => 'lens', 'label' => 'Lens', 'kind' => 'select', 'default' => '', 'options' => ['' => 'Its choice', 'clean-sharp' => 'Clean and sharp', 'anamorphic' => 'Anamorphic', 'vintage-anamorphic' => 'Vintage anamorphic', 'warm-vintage' => 'Warm vintage', 'halation-vintage' => 'Vintage with halation'], 'advanced' => true],
                    ['key' => 'film', 'label' => 'Camera', 'kind' => 'select', 'default' => '', 'options' => ['' => 'Its choice', 'modern' => 'Modern digital', '35mm-film' => '35 mm film', '8mm-film' => '8 mm film', 'dv-camcorder' => 'DV camcorder'], 'advanced' => true],
                    ['key' => 'focus', 'label' => 'Depth of field', 'kind' => 'select', 'default' => '', 'options' => ['' => 'Its choice', 'f14-wide-open' => 'Shallow (f/1.4)', 'f4-moderate' => 'Moderate (f/4)', 'f11-deep-focus' => 'Deep (f/11)'], 'advanced' => true],
                    ['key' => 'light', 'label' => 'Light', 'kind' => 'select', 'default' => '', 'options' => ['' => 'Its choice', 'window' => 'Window light', 'soft-cross' => 'Soft cross light', 'practicals' => 'Practical lamps', 'contre-jour' => 'Against the light', 'silhouette' => 'Silhouette', 'overhead-fall' => 'Overhead'], 'advanced' => true],
                    ['key' => 'pacing', 'label' => 'Pacing', 'kind' => 'select', 'default' => '', 'options' => ['' => 'Its choice', 'calm' => 'Calm', 'dynamic' => 'Dynamic', 'chaotic' => 'Chaotic', 'single-shot' => 'One continuous shot'], 'advanced' => true],
                    ['key' => 'era', 'label' => 'Era', 'kind' => 'select', 'default' => '', 'options' => ['' => 'Today', '1960s' => '1960s', '1980s' => '1980s', '1990s' => '1990s', '2000s' => '2000s', '2020s' => '2020s'], 'advanced' => true],
                    ['key' => 'resolution', 'label' => 'Resolution', 'kind' => 'select', 'default' => '720p', 'options' => ['720p' => '720p', '480p' => '480p (draft, cheaper)'], 'advanced' => true],
                ],
                'run' => 'manual', 'seconds' => 240, 'model_id' => 'higgsfield/cinema-studio-4',
            ],
            'people.character' => [
                'group' => 'higgsfield', 'label' => 'Character', 'detail' => 'Higgsfield Soul ID: trained once from photos of one person, then the same face in every Character picture after it.',
                'inputs' => [['name' => 'photos', 'label' => 'Photos of them', 'accepts' => ['image'], 'multi' => true, 'required' => true]],
                'outputs' => [['name' => 'character', 'label' => 'Character', 'type' => 'character'], ['name' => 'image', 'label' => 'Their look', 'type' => 'image']],
                'fields' => [
                    ['key' => 'name', 'label' => 'Name', 'kind' => 'text', 'default' => '', 'placeholder' => 'Mia, our barista'],
                    ['key' => 'version', 'label' => 'For pictures like', 'kind' => 'select', 'default' => 'v2', 'options' => ['v2' => 'Social photography (Soul 2)', 'cinema' => 'Film stills (Soul Cinema)', 'v1' => 'Fashion portraits (Soul)']],
                ],
                'run' => 'manual', 'run_label' => 'Train', 'seconds' => 420, 'model_id' => 'higgsfield/soul-id',
            ],
            'image.character' => [
                'group' => 'higgsfield', 'label' => 'Character picture', 'detail' => 'The trained character in any scene, the face kept: one picture or four.',
                'inputs' => [
                    ['name' => 'character', 'label' => 'Character', 'accepts' => ['character'], 'required' => true],
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                    ['name' => 'prompt', 'label' => 'Prompt', 'accepts' => ['text']],
                ],
                'outputs' => [['name' => 'image', 'label' => 'Pictures', 'type' => 'image']],
                'fields' => [
                    ['key' => 'prompt', 'label' => 'The scene', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'Laughing at a café table, morning light, a pumpkin latte in her hands'],
                    ['key' => 'aspect', 'label' => 'Shape', 'kind' => 'select', 'default' => '3:4', 'options' => ['3:4' => '3:4 (portrait)', '9:16' => '9:16 (vertical)', '1:1' => '1:1 (square)', '2:3' => '2:3 (tall)', '16:9' => '16:9 (wide)']],
                    ['key' => 'variations', 'label' => 'How many', 'kind' => 'select', 'default' => '1', 'options' => ['1' => 'One', '4' => 'Four, to pick from']],
                    ['key' => 'likeness', 'label' => 'Likeness', 'kind' => 'range', 'default' => 1.0, 'min' => 0.5, 'max' => 1, 'step' => 0.05, 'help' => 'Lower lets the scene change them a little more.', 'advanced' => true],
                ],
                'run' => 'manual', 'seconds' => 40, 'model_id' => 'higgsfield/soul-v2',
            ],
            'people.motion' => [
                'group' => 'higgsfield', 'label' => 'Copy the moves', 'detail' => 'Kling Motion Control on Higgsfield: the person in your picture does the moves of a video (a dance, a trend, a gesture).',
                'inputs' => [
                    ['name' => 'image', 'label' => 'Who moves', 'accepts' => ['image'], 'required' => true],
                    ['name' => 'video', 'label' => 'The moves', 'accepts' => ['video'], 'required' => true],
                    ['name' => 'prompt', 'label' => 'Prompt', 'accepts' => ['text']],
                ],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    ['key' => 'follow', 'label' => 'Framing', 'kind' => 'select', 'default' => 'video', 'options' => ['video' => 'As in the video (moves up to 30 s)', 'image' => 'As in the picture (moves up to 10 s)']],
                    ['key' => 'sound', 'label' => 'Keep the video’s sound', 'kind' => 'toggle', 'default' => true],
                    ['key' => 'model', 'label' => 'Quality', 'kind' => 'model', 'models' => 'motion', 'default' => null],
                    ['key' => 'prompt', 'label' => 'Anything to add', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'Keep her red dress; a sunny street behind', 'advanced' => true],
                ],
                'run' => 'manual', 'seconds' => 300,
            ],
            'image.ads' => [
                'group' => 'higgsfield', 'label' => 'Ad maker', 'detail' => 'Higgsfield Ads Studio: finished ads (the picture, the headline and the copy drawn in) from your brief and product photos, several ideas at once.',
                'inputs' => [
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                    ['name' => 'product', 'label' => 'Product photos', 'accepts' => ['image'], 'multi' => true],
                    ['name' => 'prompt', 'label' => 'What to say', 'accepts' => ['text']],
                ],
                'outputs' => [['name' => 'image', 'label' => 'Ads', 'type' => 'image']],
                'fields' => [
                    ['key' => 'prompt', 'label' => 'What it advertises and says', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'Our pumpkin latte is back: two for one before ten. Cosy autumn café, warm light. Headline: Fall into flavour.',
                        'help' => 'Empty: written from the brief (the product, the offer, the call to action).'],
                    ['key' => 'aspect', 'label' => 'Shape', 'kind' => 'select', 'default' => '4:5', 'options' => ['4:5' => '4:5 (feed)', '9:16' => '9:16 (story, reel)', '1:1' => '1:1 (square)', '16:9' => '16:9 (wide)']],
                    ['key' => 'count', 'label' => 'Ideas', 'kind' => 'number', 'default' => 4, 'min' => 1, 'max' => 8],
                    ['key' => 'language', 'label' => 'Language of the words', 'kind' => 'text', 'default' => '', 'placeholder' => 'English', 'advanced' => true],
                    ['key' => 'niche', 'label' => 'Business', 'kind' => 'text', 'default' => '', 'placeholder' => 'Speciality coffee (empty: from the brief)', 'advanced' => true],
                    ['key' => 'audience', 'label' => 'For', 'kind' => 'text', 'default' => '', 'placeholder' => 'Commuters who want a treat (empty: from the brief)', 'advanced' => true],
                ],
                'run' => 'manual', 'seconds' => 120, 'model_id' => 'higgsfield/ads-studio',
            ],
            'video.restyle' => [
                'group' => 'higgsfield', 'label' => 'Restyle video', 'detail' => 'Higgsfield Genjutsu: your video in another look (anime, clay, comic, painting…), its motion and sound kept. Up to 30 seconds.',
                'inputs' => [
                    ['name' => 'video', 'label' => 'Video', 'accepts' => ['video'], 'required' => true],
                    ['name' => 'people', 'label' => 'How the people look', 'accepts' => ['image'], 'multi' => true],
                    ['name' => 'prompt', 'label' => 'Prompt', 'accepts' => ['text']],
                ],
                'outputs' => [['name' => 'video', 'label' => 'Video', 'type' => 'video']],
                'fields' => [
                    ['key' => 'style', 'label' => 'Look', 'kind' => 'preset', 'presets' => 'restyle', 'default' => null],
                    ['key' => 'prompt', 'label' => 'Anything to keep', 'kind' => 'textarea', 'default' => '', 'placeholder' => 'Keep the logo on the cup readable; keep her pink hair', 'advanced' => true],
                    ['key' => 'resolution', 'label' => 'Resolution', 'kind' => 'select', 'default' => '720p', 'options' => ['720p' => '720p', '1080p' => '1080p', '480p' => '480p (draft, cheaper)'], 'advanced' => true],
                ],
                'run' => 'manual', 'seconds' => 300, 'model_id' => 'higgsfield/genjutsu-restyle',
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
                    ['key' => 'variants', 'label' => 'How many versions', 'kind' => 'number', 'default' => 1, 'min' => 1, 'max' => 10, 'show' => ['task' => ['caption', 'hook', 'headline', 'script', 'hashtags', 'prompt', 'custom']],
                        'help' => 'Several, each one different: every line out of it takes its own (#1, #2…), so three pictures get three prompts. Click a line to change which it takes.'],
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
                    ['key' => 'keep', 'label' => 'Keep as it is', 'kind' => 'text', 'default' => '', 'placeholder' => 'Low Tide, Ember & Fig',
                        'help' => 'Names never to translate: the brand, its products, people. A transcript writes them small (“at low tide”), and they come back translated otherwise.'],
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
                    ['key' => 'avoid', 'label' => 'Keep out', 'kind' => 'text', 'default' => '', 'placeholder' => 'text, logos, people', 'advanced' => true],
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
                    ['key' => 'motion', 'label' => 'Camera', 'kind' => 'select', 'default' => 'auto', 'options' => ['auto' => 'Varied', 'zoom-in' => 'Zoom in', 'zoom-out' => 'Zoom out', 'pan' => 'Pan', 'still' => 'Still'], 'advanced' => true],
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
                    ['key' => 'color', 'label' => 'Colour', 'kind' => 'color', 'default' => '#ffffff', 'advanced' => true],
                    ['key' => 'highlight', 'label' => 'Word being said', 'kind' => 'color', 'default' => '#facc15', 'show' => ['style' => ['bold']], 'advanced' => true],
                    ['key' => 'words', 'label' => 'Words at a time', 'kind' => 'number', 'default' => 3, 'min' => 1, 'max' => 8, 'advanced' => true],
                    ['key' => 'upper', 'label' => 'Capitals', 'kind' => 'toggle', 'default' => true, 'advanced' => true],
                    ['key' => 'font', 'label' => 'Font', 'kind' => 'font', 'default' => null, 'advanced' => true],
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
                    ['key' => 'speed', 'label' => 'Pace', 'kind' => 'range', 'default' => 1.0, 'min' => 0.7, 'max' => 1.3, 'step' => 0.05, 'advanced' => true],
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
                    ['key' => 'source', 'label' => 'Made by', 'kind' => 'select', 'default' => 'song', 'options' => ['song' => 'A song written to a description (ACE-Step, on the pod)', 'composer' => 'One of six moods (ACE-Step on the pod, or the local composer when it runs)']],
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
                'group' => 'text', 'label' => 'Text over it', 'detail' => 'Words over your pictures or videos (an overlay): placed, sized and coloured in the assistant’s text editor, in your fonts. Videos keep their sound.',
                'inputs' => [
                    ['name' => 'media', 'label' => 'Pictures or videos', 'accepts' => ['image', 'video'], 'multi' => true],
                    ['name' => 'headline', 'label' => 'Headline', 'accepts' => ['text']],
                    ['name' => 'brief', 'label' => 'Brief', 'accepts' => ['brief']],
                ],
                'outputs' => [['name' => 'image', 'label' => 'Pictures', 'type' => 'image'], ['name' => 'video', 'label' => 'Videos', 'type' => 'video']],
                'fields' => [
                    ['key' => 'texts', 'label' => 'Text on it', 'kind' => 'texts', 'default' => []],
                    ['key' => 'platform', 'label' => 'For', 'kind' => 'select', 'default' => 'instagram', 'options' => ['instagram' => 'Instagram', 'x' => 'X'], 'help' => 'Its size, and the parts the app’s buttons cover, where no words go.', 'advanced' => true],
                    ['key' => 'placement', 'label' => 'As', 'kind' => 'select', 'default' => 'feed', 'options' => ['feed' => 'Feed post', 'story' => 'Story', 'reel' => 'Reel', 'post' => 'Post (X)'], 'advanced' => true],
                    ['key' => 'background', 'label' => 'Plain slides', 'kind' => 'color', 'default' => '#1c1c1c', 'advanced' => true],
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
                'group' => 'finish', 'label' => 'Post', 'detail' => 'Save it as a draft, schedule it, or post it now from the phone, by your agent or the phone’s. The proof comes back here.',
                'inputs' => [
                    ['name' => 'channel', 'label' => 'Where', 'accepts' => ['channel']],
                    ['name' => 'media', 'label' => 'Media', 'accepts' => ['image', 'video'], 'multi' => true],
                    ['name' => 'caption', 'label' => 'Caption', 'accepts' => ['text']],
                ],
                'outputs' => [['name' => 'post', 'label' => 'Post', 'type' => 'post']],
                'fields' => [
                    ['key' => 'account_id', 'label' => 'Account', 'kind' => 'account', 'default' => null, 'unconnected' => 'channel'],
                    ['key' => 'placement', 'label' => 'As', 'kind' => 'placement', 'default' => null, 'unconnected' => 'channel'],
                    ['key' => 'caption', 'label' => 'Caption', 'kind' => 'textarea', 'default' => '', 'unconnected' => 'caption'],
                    ['key' => 'when', 'label' => 'When', 'kind' => 'chips', 'default' => 'draft', 'options' => ['draft' => 'Draft', 'now' => 'Post now', 'at' => 'At a time', 'queue' => 'Next free slot']],
                    ['key' => 'at', 'label' => 'Date and time', 'kind' => 'datetime', 'default' => null, 'show' => ['when' => ['at']]],
                    ['key' => 'driver', 'label' => 'Posted by', 'kind' => 'chips', 'default' => 'auto', 'show' => ['when' => ['now', 'at', 'queue']],
                        'options' => ['direct' => 'My agent', 'agent' => 'The phone’s agent', 'auto' => 'The phone’s agent, mine if it fails'],
                        'help' => 'My agent: FlowAI’s own, working the phone’s screen with your model. The phone’s agent: the AI built into the phone.'],
                    ['key' => 'device_id', 'label' => 'Phone', 'kind' => 'device', 'default' => null, 'show' => ['when' => ['now', 'at', 'queue']], 'advanced' => true],
                    ['key' => 'title', 'label' => 'Title (for you)', 'kind' => 'text', 'default' => '', 'advanced' => true],
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

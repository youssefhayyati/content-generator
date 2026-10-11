<?php

namespace App\Services\Lab;

/**
 * Ready-made graphs to start from, one per kind of content (a product picture, a tips carousel, a talking
 * video, clips from a long video…), never per platform: where it goes is its own node at the end (Where it
 * goes: the account and the kind of post, the media and caption fitted to it), then Post. To post the
 * same content somewhere else, add another Where it goes and Post after it.
 *
 * Using a template copies its nodes into the project, to fill in and change. People's own templates
 * (Save as template) are LabTemplate rows; these are built in. A template's Brief becomes the project's
 * own when it has one, and a photo node that says what it takes (`reuse`: the product, the people…)
 * becomes the campaign's photos of that kind (Graph::insert).
 */
class Templates
{
    /**
     * @return array<string, array{name: string, tagline: string, category: string, graph: array<string, mixed>}>
     */
    public static function all(): array
    {
        $n = fn (string $id, string $type, int $c, int $r, array $params = [], ?string $label = null, ?array $reuse = null) => array_filter(['id' => $id, 'type' => $type, 'x' => $c * 360, 'y' => $r * 380, 'params' => $params, 'label' => $label, 'reuse' => $reuse], fn ($v) => $v !== null);
        $e = fn (string $from, string $out, string $to, string $in) => compact('from', 'out', 'to', 'in');
        // The end of every template: where it goes, then the post.
        $out = function (string $media, string $mediaPort, ?string $caption, int $c, int $r, string $suffix = '') use ($n, $e) {
            $where = 'where'.$suffix;
            $post = 'post'.$suffix;

            return [
                [$n($where, 'finish.channel', $c, $r), $n($post, 'finish.post', $c + 1, $r)],
                array_values(array_filter([
                    $e($media, $mediaPort, $where, 'media'),
                    $caption ? $e($caption, 'text', $where, 'caption') : null,
                    $e($where, 'channel', $post, 'channel'),
                    $e($where, 'image', $post, 'media'),
                    $e($where, 'video', $post, 'media'),
                    $e($where, 'caption', $post, 'caption'),
                ])),
            ];
        };
        $graph = function (array $nodes, array $edges, array ...$ends) {
            foreach ($ends as [$moreNodes, $moreEdges]) {
                $nodes = [...$nodes, ...$moreNodes];
                $edges = [...$edges, ...$moreEdges];
            }

            return ['nodes' => $nodes, 'edges' => $edges];
        };

        return [
            /* ------------------------------------------------------------ pictures */
            'picture-models' => [
                'name' => 'Picture from a prompt', 'category' => 'Pictures', 'tagline' => 'One prompt, two models side by side: keep the one you like and post it.',
                'graph' => $graph([
                    $n('brief', 'source.brief', 0, 1),
                    $n('prompt', 'source.text', 0, 0, ['text' => '{product}, hero shot, natural light, {style}'], 'The prompt'),
                    $n('picture-a', 'image.generate', 1, 0, ['aspect' => '4:5'], 'Model A (on the pod)'),
                    $n('picture-b', 'image.generate', 1, 1, ['aspect' => '4:5'], 'Model B (pick another)'),
                    $n('caption', 'text.write', 1, 2, ['task' => 'caption', 'instructions' => '{offer}. {cta}']),
                ], [
                    $e('prompt', 'text', 'picture-a', 'prompt'), $e('prompt', 'text', 'picture-b', 'prompt'),
                    $e('brief', 'brief', 'picture-a', 'brief'), $e('brief', 'brief', 'picture-b', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                ], $out('picture-a', 'image', 'caption', 2, 0)),
            ],
            'product-picture' => [
                'name' => 'Picture with words on it', 'category' => 'Pictures', 'tagline' => 'A picture with a headline drawn on it in your fonts and colours, and a caption in your voice.',
                'graph' => $graph([
                    $n('brief', 'source.brief', 0, 1),
                    $n('picture', 'image.generate', 1, 0, ['prompt' => '{product}, hero shot, calm empty space in the top third', 'aspect' => '4:5']),
                    $n('headline', 'text.write', 1, 1, ['task' => 'headline', 'instructions' => '{offer}']),
                    $n('caption', 'text.write', 1, 2, ['task' => 'caption', 'instructions' => '{offer}. {cta}']),
                    $n('design', 'finish.design', 2, 0),
                ], [
                    $e('brief', 'brief', 'picture', 'brief'), $e('brief', 'brief', 'headline', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                    $e('picture', 'image', 'design', 'media'), $e('headline', 'text', 'design', 'headline'), $e('brief', 'brief', 'design', 'brief'),
                ], $out('design', 'image', 'caption', 3, 1)),
            ],
            'tips-carousel' => [
                'name' => 'Carousel with words', 'category' => 'Pictures', 'tagline' => 'Several pictures in one look, a promise on the first, a caption that says save this.',
                'graph' => $graph([
                    $n('brief', 'source.brief', 0, 1),
                    $n('pictures', 'image.generate', 1, 0, ['prompt' => '{product}, the same soft light and palette in every shot, varied angles, calm empty space at the top', 'aspect' => '4:5', 'variations' => 4]),
                    $n('headline', 'text.write', 1, 1, ['task' => 'headline', 'instructions' => 'A promise that makes people swipe: {offer}']),
                    $n('caption', 'text.write', 1, 2, ['task' => 'caption', 'instructions' => 'What the slides give; end with “Save this for later”.']),
                    $n('design', 'finish.design', 2, 0),
                ], [
                    $e('brief', 'brief', 'pictures', 'brief'), $e('brief', 'brief', 'headline', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                    $e('pictures', 'image', 'design', 'media'), $e('headline', 'text', 'design', 'headline'),
                ], $out('design', 'image', 'caption', 3, 1)),
            ],
            'product-scene' => [
                'name' => 'Your photo, edited', 'category' => 'Pictures', 'tagline' => 'Your own photo changed by an instruction (a new scene, a new light), the subject kept as it is.',
                'graph' => $graph([
                    $n('product', 'source.media', 0, 0, [], 'Your photo', ['product', 'other']),
                    $n('brief', 'source.brief', 0, 1),
                    $n('scene', 'image.edit', 1, 0, ['instruction' => 'Keep the product exactly as it is. Put it in a new scene: {style}']),
                    $n('caption', 'text.write', 1, 1, ['task' => 'caption', 'instructions' => '{offer}. {cta}']),
                ], [
                    $e('product', 'image', 'scene', 'image'), $e('brief', 'brief', 'scene', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                ], $out('scene', 'image', 'caption', 2, 0)),
            ],
            'words-over-picture' => [
                'name' => 'Your photo with text over it', 'category' => 'Pictures', 'tagline' => 'Your own photo or video with a headline over it, placed and styled in the text editor, and a caption.',
                'graph' => $graph([
                    $n('photo', 'source.media', 0, 0, [], 'Your photo or video', ['product', 'place', 'person', 'other']),
                    $n('brief', 'source.brief', 0, 1),
                    $n('headline', 'text.write', 1, 1, ['task' => 'headline', 'instructions' => '{offer}']),
                    $n('caption', 'text.write', 1, 2, ['task' => 'caption', 'instructions' => '{offer}. {cta}']),
                    $n('text', 'finish.design', 1, 0),
                ], [
                    $e('photo', 'image', 'text', 'media'), $e('photo', 'video', 'text', 'media'), $e('headline', 'text', 'text', 'headline'),
                    $e('brief', 'brief', 'headline', 'brief'), $e('brief', 'brief', 'caption', 'brief'), $e('brief', 'brief', 'text', 'brief'),
                    $e('text', 'video', 'where', 'media'), // a video with text over it goes on too
                ], $out('text', 'image', 'caption', 2, 0)),
            ],

            /* ------------------------------------------------------------ moving pictures */
            'moving-pictures' => [
                'name' => 'Moving pictures', 'category' => 'Moving pictures', 'tagline' => 'Pictures that zoom and pan like a film, a voice reading a line over each (or music only), captions and an end card.',
                'graph' => $graph([
                    $n('brief', 'source.brief', 0, 1),
                    $n('pictures', 'image.generate', 1, 0, ['prompt' => '{product}, three moments of the same story, the same light and palette', 'aspect' => '9:16', 'variations' => 3]),
                    $n('lines', 'text.write', 1, 1, ['task' => 'lines', 'count' => 3, 'instructions' => 'From a hook to {cta}'], 'The voice’s lines (remove for music only)'),
                    $n('caption', 'text.write', 1, 2, ['task' => 'caption', 'instructions' => '{offer}']),
                    $n('video', 'video.slideshow', 2, 0, ['music' => 'song', 'song' => 'warm acoustic instrumental, gentle guitar, 95 bpm', 'cta' => '{cta}']),
                ], [
                    $e('brief', 'brief', 'pictures', 'brief'), $e('brief', 'brief', 'lines', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                    $e('pictures', 'image', 'video', 'images'), $e('lines', 'text', 'video', 'lines'),
                ], $out('video', 'video', 'caption', 3, 1)),
            ],
            'moving-pictures-translated' => [
                'name' => 'Moving pictures, in another language', 'category' => 'Moving pictures', 'tagline' => 'Your photos in motion with the voiceover translated and read in a voice for that language.',
                'graph' => $graph([
                    $n('photos', 'source.media', 0, 0, [], 'Your photos', ['product', 'place', 'other']),
                    $n('lines', 'source.text', 0, 1, ['text' => 'The first line, for the first photo
The second line
The third line'], 'The lines'),
                    $n('translate', 'text.translate', 1, 1, ['language' => 'Spanish']),
                    $n('video', 'video.slideshow', 2, 0, ['music' => 'song', 'song' => 'warm instrumental, soft piano, 90 bpm']),
                ], [
                    $e('photos', 'image', 'video', 'images'), $e('lines', 'text', 'translate', 'text'), $e('translate', 'text', 'video', 'lines'),
                ], $out('video', 'video', 'translate', 3, 0)),
            ],

            /* ------------------------------------------------------------ video */
            'animated-picture' => [
                'name' => 'Animated picture', 'category' => 'Video', 'tagline' => 'A picture from a prompt, then brought to life by a video model you choose (Wan on your pod, Kling, Seedance, Hailuo, Veo…).',
                'graph' => $graph([
                    $n('brief', 'source.brief', 0, 1),
                    $n('picture', 'image.generate', 1, 0, ['prompt' => '{product}, cinematic, {style}', 'aspect' => '9:16']),
                    $n('animate', 'video.animate', 2, 0, ['prompt' => 'A slow push in, soft light moving across the scene']),
                    $n('music', 'audio.music', 2, 1, ['source' => 'song', 'description' => 'cinematic ambient instrumental, soft pulse, 90 bpm']),
                    $n('mix', 'video.mix', 3, 0, ['mode' => 'under']),
                    $n('caption', 'text.write', 3, 1, ['task' => 'caption', 'instructions' => '{offer}']),
                ], [
                    $e('brief', 'brief', 'picture', 'brief'), $e('picture', 'image', 'animate', 'image'), $e('brief', 'brief', 'animate', 'brief'),
                    $e('animate', 'video', 'music', 'video'), $e('animate', 'video', 'mix', 'video'), $e('music', 'audio', 'mix', 'audio'), $e('brief', 'brief', 'caption', 'brief'),
                ], $out('mix', 'video', 'caption', 4, 0)),
            ],
            'video-models' => [
                'name' => 'Video from a prompt', 'category' => 'Video', 'tagline' => 'One prompt, two video models side by side: compare them, keep one.',
                'graph' => $graph([
                    $n('brief', 'source.brief', 0, 1),
                    $n('prompt', 'source.text', 0, 0, ['text' => '{product}, a slow cinematic shot, {style}'], 'The prompt'),
                    $n('video-a', 'video.generate', 1, 0, [], 'Model A (on the pod)'),
                    $n('video-b', 'video.generate', 1, 1, [], 'Model B (pick another)'),
                    $n('caption', 'text.write', 1, 2, ['task' => 'caption', 'instructions' => '{offer}']),
                ], [
                    $e('prompt', 'text', 'video-a', 'prompt'), $e('prompt', 'text', 'video-b', 'prompt'),
                    $e('brief', 'brief', 'video-a', 'brief'), $e('brief', 'brief', 'video-b', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                ], $out('video-a', 'video', 'caption', 2, 0)),
            ],

            /* ------------------------------------------------------------ voices and lips */
            'talking-portrait' => [
                'name' => 'Talking portrait (lip sync)', 'category' => 'Voices & lips', 'tagline' => 'A portrait animated, then made to say your script in a voice you pick, lips matching.',
                'graph' => $graph([
                    $n('portrait', 'source.media', 0, 0, [], 'A portrait', ['person']),
                    $n('script', 'source.text', 0, 1, ['text' => 'Hi! Our pumpkin latte is back, and before ten it’s two for one.'], 'What they say'),
                    $n('animate', 'video.animate', 1, 0, ['prompt' => 'The person looks at the camera and talks naturally, small head movements, steady camera', 'duration' => 5]),
                    $n('dub', 'people.dub', 2, 0),
                    $n('captions', 'video.captions', 3, 0),
                ], [
                    $e('portrait', 'image', 'animate', 'image'), $e('animate', 'video', 'dub', 'video'), $e('script', 'text', 'dub', 'script'), $e('dub', 'video', 'captions', 'video'),
                ], $out('captions', 'video', 'script', 4, 0)),
            ],
            'dub-language' => [
                'name' => 'Dub a video into another language', 'category' => 'Voices & lips', 'tagline' => 'Translated and said in the speaker’s own voice, lips matching, with captions.',
                'graph' => $graph([
                    $n('video', 'source.media', 0, 0, [], 'The video'),
                    $n('transcript', 'audio.transcribe', 1, 0),
                    $n('translate', 'text.translate', 2, 0, ['language' => 'French']),
                    $n('dub', 'people.dub', 3, 0),
                    $n('captions', 'video.captions', 4, 0, ['style' => 'clean']),
                ], [
                    $e('video', 'video', 'transcript', 'media'), $e('transcript', 'text', 'translate', 'text'), $e('video', 'video', 'dub', 'video'),
                    $e('translate', 'text', 'dub', 'script'), $e('dub', 'video', 'captions', 'video'),
                ], $out('captions', 'video', null, 5, 0)),
            ],
            'voiceover-video' => [
                'name' => 'Voiceover with words lighting up', 'category' => 'Voices & lips', 'tagline' => 'A script read aloud over a picture, the words lighting up as they’re said.',
                'graph' => $graph([
                    $n('brief', 'source.brief', 0, 0),
                    $n('script', 'text.write', 1, 0, ['task' => 'script', 'length' => 'short', 'instructions' => '{offer}. End with {cta}.']),
                    $n('picture', 'image.generate', 1, 1, ['prompt' => '{product}, moody, vertical', 'aspect' => '9:16']),
                    $n('voice', 'audio.voice', 2, 0),
                    $n('reel', 'video.reel', 3, 0, ['style' => 'bold']),
                ], [
                    $e('brief', 'brief', 'script', 'brief'), $e('brief', 'brief', 'picture', 'brief'), $e('script', 'text', 'voice', 'script'),
                    $e('voice', 'audio', 'reel', 'sound'), $e('picture', 'image', 'reel', 'background'),
                ], $out('reel', 'video', 'script', 4, 0)),
            ],
            'face-swap' => [
                'name' => 'A face on a video', 'category' => 'Voices & lips', 'tagline' => 'A person’s face on the video, then captions.',
                'graph' => $graph([
                    $n('face', 'source.media', 0, 0, [], 'The face', ['person']),
                    $n('video', 'source.media', 0, 1, [], 'The video'),
                    $n('swap', 'people.swap', 1, 0),
                    $n('captions', 'video.captions', 2, 0),
                ], [
                    $e('face', 'image', 'swap', 'face'), $e('video', 'video', 'swap', 'target'), $e('swap', 'video', 'captions', 'video'),
                ], $out('captions', 'video', null, 3, 0)),
            ],

            /* ------------------------------------------------------------ Higgsfield */
            'hf-cinematic-shot' => [
                'name' => 'Cinematic product shot', 'category' => 'Higgsfield', 'tagline' => 'Your product in a real camera move (a crash zoom, a drone orbit…) with Cinema Studio, its sound made with it, a caption in your voice.',
                'graph' => $graph([
                    $n('product', 'source.media', 0, 0, [], 'The product', ['product', 'other']),
                    $n('brief', 'source.brief', 0, 1),
                    $n('shot', 'video.cinema', 1, 0, ['prompt' => '<<<image_1>>> {product}, the hero of the shot, {style}', 'camera' => 'crush-zoom', 'genre' => 'drama', 'aspect' => '9:16', 'duration' => 6]),
                    $n('caption', 'text.write', 1, 1, ['task' => 'caption', 'instructions' => '{offer}. {cta}']),
                ], [
                    $e('product', 'image', 'shot', 'reference'), $e('brief', 'brief', 'shot', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                ], $out('shot', 'video', 'caption', 2, 0)),
            ],
            'hf-character' => [
                'name' => 'Your character, any scene', 'category' => 'Higgsfield', 'tagline' => 'Train a character once from photos (Soul ID), then picture them anywhere with the same face: a carousel in three scenes.',
                'graph' => $graph([
                    $n('photos', 'source.media', 0, 0, [], 'Photos of them', ['person']),
                    $n('brief', 'source.brief', 0, 2),
                    $n('character', 'people.character', 1, 0),
                    $n('scene-1', 'image.character', 2, 0, ['prompt' => 'Smiling with {product} in a sunny café, candid, {style}'], 'Scene 1'),
                    $n('scene-2', 'image.character', 2, 1, ['prompt' => 'Walking down a city street at golden hour, {product} in hand, {style}'], 'Scene 2'),
                    $n('scene-3', 'image.character', 2, 2, ['prompt' => 'At home on a cosy sofa, relaxed, {product} beside them, {style}'], 'Scene 3'),
                    $n('caption', 'text.write', 2, 3, ['task' => 'caption', 'instructions' => '{offer}. {cta}']),
                ], [
                    $e('photos', 'image', 'character', 'photos'),
                    $e('character', 'character', 'scene-1', 'character'), $e('character', 'character', 'scene-2', 'character'), $e('character', 'character', 'scene-3', 'character'),
                    $e('brief', 'brief', 'scene-1', 'brief'), $e('brief', 'brief', 'scene-2', 'brief'), $e('brief', 'brief', 'scene-3', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                ], [[$n('where', 'finish.channel', 3, 0), $n('post', 'finish.post', 4, 0)], [
                    $e('scene-1', 'image', 'where', 'media'), $e('scene-2', 'image', 'where', 'media'), $e('scene-3', 'image', 'where', 'media'), $e('caption', 'text', 'where', 'caption'),
                    $e('where', 'channel', 'post', 'channel'), $e('where', 'image', 'post', 'media'), $e('where', 'caption', 'post', 'caption'),
                ]]),
            ],
            'hf-trend' => [
                'name' => 'Ride a trend (copy the moves)', 'category' => 'Higgsfield', 'tagline' => 'The person in your photo does the moves of a trending video (Kling Motion Control), captioned, with a caption that rides the trend.',
                'graph' => $graph([
                    $n('who', 'source.media', 0, 0, [], 'Who moves', ['person']),
                    $n('moves', 'source.media', 0, 1, [], 'The moves (a video you may use)'),
                    $n('brief', 'source.brief', 0, 2),
                    $n('motion', 'people.motion', 1, 0),
                    $n('captions', 'video.captions', 2, 0, ['style' => 'bold']),
                    $n('caption', 'text.write', 1, 2, ['task' => 'caption', 'platform' => 'tiktok', 'length' => 'short', 'instructions' => 'Ride the trend, playful: {offer}']),
                ], [
                    $e('who', 'image', 'motion', 'image'), $e('moves', 'video', 'motion', 'video'), $e('motion', 'video', 'captions', 'video'), $e('brief', 'brief', 'caption', 'brief'),
                ], $out('motion', 'video', 'caption', 3, 0)),
            ],
            'hf-ads' => [
                'name' => 'Ads from a product photo', 'category' => 'Higgsfield', 'tagline' => 'Four finished ads from your brief and product photo (Ads Studio): pick the best, post it with a caption.',
                'graph' => $graph([
                    $n('product', 'source.media', 0, 0, [], 'The product', ['product', 'logo', 'other']),
                    $n('brief', 'source.brief', 0, 1),
                    $n('ads', 'image.ads', 1, 0, ['count' => 4, 'aspect' => '4:5']),
                    $n('caption', 'text.write', 1, 1, ['task' => 'caption', 'instructions' => '{offer}. {cta}']),
                ], [
                    $e('product', 'image', 'ads', 'product'), $e('brief', 'brief', 'ads', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                ], $out('ads', 'image', 'caption', 2, 0)),
            ],
            'hf-restyle' => [
                'name' => 'Restyle a clip', 'category' => 'Higgsfield', 'tagline' => 'Your video in another look (anime, clay, comic…) with Genjutsu, the motion and sound kept, a headline over it.',
                'graph' => $graph([
                    $n('clip', 'source.media', 0, 0, [], 'Your clip (4 to 30 s)'),
                    $n('brief', 'source.brief', 0, 1),
                    $n('restyle', 'video.restyle', 1, 0),
                    $n('hook', 'text.write', 1, 1, ['task' => 'hook', 'instructions' => '{offer}']),
                    $n('text', 'finish.design', 2, 0, ['placement' => 'reel']),
                    $n('caption', 'text.write', 2, 1, ['task' => 'caption', 'length' => 'short', 'instructions' => '{offer}. {cta}']),
                ], [
                    $e('clip', 'video', 'restyle', 'video'), $e('restyle', 'video', 'text', 'media'), $e('hook', 'text', 'text', 'headline'),
                    $e('brief', 'brief', 'hook', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                ], $out('text', 'video', 'caption', 3, 0)),
            ],

            /* ------------------------------------------------------------ repurpose */
            'youtube-clips' => [
                'name' => 'Clips from a long video', 'category' => 'Repurpose', 'tagline' => 'The best moments of a YouTube video, cut vertical around the speaker, captioned and credited.',
                'graph' => $graph([
                    $n('youtube', 'source.youtube', 0, 0),
                    $n('transcript', 'audio.transcribe', 1, 0),
                    $n('moments', 'clip.moments', 2, 0, ['count' => 5, 'min' => 20, 'max' => 50]),
                    $n('cut', 'video.cut', 3, 0, ['moment' => 1, 'aspect' => '9:16', 'fit' => 'speaker', 'jumpcuts' => true]),
                    $n('captions', 'video.captions', 4, 0, ['style' => 'bold']),
                    $n('caption', 'text.write', 3, 1, ['task' => 'caption', 'instructions' => 'A caption for the clip, from its hook.']),
                ], [
                    $e('youtube', 'source', 'transcript', 'media'), $e('transcript', 'transcript', 'moments', 'transcript'),
                    $e('youtube', 'source', 'cut', 'video'), $e('moments', 'moments', 'cut', 'moments'), $e('cut', 'video', 'captions', 'video'),
                    $e('moments', 'text', 'caption', 'context'),
                ], $out('captions', 'video', 'caption', 5, 0)),
            ],
            'recording-to-posts' => [
                'name' => 'A recording into posts', 'category' => 'Repurpose', 'tagline' => 'A podcast or a voice memo: the moments worth sharing, written as posts in your voice.',
                'graph' => $graph([
                    $n('audio', 'source.media', 0, 0, [], 'The recording'),
                    $n('brief', 'source.brief', 0, 1),
                    $n('transcript', 'audio.transcribe', 1, 0),
                    $n('moments', 'clip.moments', 2, 0, ['count' => 3]),
                    $n('post-text', 'text.write', 3, 0, ['task' => 'caption', 'instructions' => 'One post on the best moment.']),
                ], [
                    $e('audio', 'audio', 'transcript', 'media'), $e('transcript', 'transcript', 'moments', 'transcript'), $e('brief', 'brief', 'moments', 'brief'),
                    $e('moments', 'moments', 'post-text', 'context'), $e('brief', 'brief', 'post-text', 'brief'),
                ], [[$n('where', 'finish.channel', 4, 0), $n('post', 'finish.post', 5, 0)], [
                    $e('post-text', 'text', 'where', 'caption'), $e('where', 'channel', 'post', 'channel'), $e('where', 'caption', 'post', 'caption'),
                ]]),
            ],

            /* ------------------------------------------------------------ words */
            'thought' => [
                'name' => 'A sharp thought', 'category' => 'Words', 'tagline' => 'One idea, said well, with a picture only if it helps.',
                'graph' => $graph([
                    $n('brief', 'source.brief', 0, 0),
                    $n('text', 'text.write', 1, 0, ['task' => 'caption', 'length' => 'short', 'instructions' => '{offer}']),
                    $n('picture', 'image.generate', 1, 1, ['prompt' => '{product}, simple, striking', 'aspect' => '16:9']),
                ], [
                    $e('brief', 'brief', 'text', 'brief'), $e('brief', 'brief', 'picture', 'brief'),
                ], $out('picture', 'image', 'text', 2, 0)),
            ],

            /* ------------------------------------------------------------ campaigns */
            'campaign-pack' => [
                'name' => 'Campaign pack', 'category' => 'Campaigns', 'tagline' => 'From one brief: a picture with a headline, a talking slideshow, and a short post, each going where you choose.',
                'graph' => $graph([
                    $n('brief', 'source.brief', 0, 2),
                    $n('picture', 'image.generate', 1, 0, ['prompt' => '{product}, hero shot, calm space at the top', 'aspect' => '4:5']),
                    $n('headline', 'text.write', 1, 1, ['task' => 'headline', 'instructions' => '{offer}']),
                    $n('caption', 'text.write', 1, 2, ['task' => 'caption', 'instructions' => '{offer}. {cta}']),
                    $n('lines', 'text.write', 1, 3, ['task' => 'lines', 'count' => 3, 'instructions' => 'From a hook to {cta}']),
                    $n('short', 'text.write', 1, 4, ['task' => 'caption', 'length' => 'short', 'instructions' => '{offer}']),
                    $n('design', 'finish.design', 2, 0),
                    $n('frames', 'image.generate', 2, 3, ['prompt' => '{product}, three moments of the same story', 'aspect' => '9:16', 'variations' => 3]),
                    $n('video', 'video.slideshow', 3, 3, ['cta' => '{cta}', 'music' => 'song']),
                ], [
                    $e('brief', 'brief', 'picture', 'brief'), $e('brief', 'brief', 'headline', 'brief'), $e('brief', 'brief', 'caption', 'brief'),
                    $e('brief', 'brief', 'lines', 'brief'), $e('brief', 'brief', 'short', 'brief'), $e('brief', 'brief', 'frames', 'brief'),
                    $e('picture', 'image', 'design', 'media'), $e('headline', 'text', 'design', 'headline'),
                    $e('frames', 'image', 'video', 'images'), $e('lines', 'text', 'video', 'lines'),
                ], $out('design', 'image', 'caption', 4, 0, '-picture'), $out('video', 'video', 'caption', 4, 3, '-video'),
                    [[$n('where-short', 'finish.channel', 4, 4), $n('post-short', 'finish.post', 5, 4)], [
                        $e('short', 'text', 'where-short', 'caption'), $e('where-short', 'channel', 'post-short', 'channel'), $e('where-short', 'caption', 'post-short', 'caption'),
                    ]]),
            ],
        ];
    }
}

<?php

namespace App\Http\Controllers;

use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use App\Services\Social\Trends;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class TrendController extends Controller
{
    public function __construct(
        private readonly Trends $trends,
        private readonly ModelRegistry $models,
        private readonly UsageMeter $usage,
    ) {}

    /** What is doing well for one hashtag, newest search cached for everyone. */
    public function index(Request $request)
    {
        $data = $request->validate([
            'platform' => ['required', 'in:instagram,tiktok'],
            'hashtag' => ['required', 'string', 'max:60'],
        ]);

        abort_unless($this->trends->enabled(), 503, 'No trend source is connected. Add APIFY_TOKEN to backend/.env.');

        return response()->json($this->trends->search($data['platform'], $data['hashtag']));
    }

    /**
     * Read one trending post and write the brief for an original take on it.
     *
     * The model never sees the video, only what the platform published about
     * it, so the brief describes a new piece of content rather than a copy.
     */
    public function derivePrompt(Request $request)
    {
        $data = $request->validate([
            'caption' => ['required', 'string', 'max:4000'],
            'platform' => ['required', 'in:instagram,tiktok'],
            'kind' => ['nullable', 'in:image,video,carousel'],
            'author' => ['nullable', 'string', 'max:120'],
            'hashtags' => ['nullable', 'array', 'max:40'],
            'hashtags.*' => ['string', 'max:80'],
            'sound' => ['nullable', 'string', 'max:200'],
            'metrics' => ['nullable', 'array'],
            'product' => ['nullable', 'string', 'max:400'],
            'angle' => ['nullable', 'string', 'max:1000'],
        ]);

        [$generator, $name] = $this->models->text($this->models->textModelOr((string) config('ai.agents.model')));

        $brief = $this->usage->within($request->user(), null, 'inspire', fn () => $generator->json(
            $name,
            <<<'TXT'
            You are a creative director studying a post that is performing well, so your client can make their own original version.

            You are given only what the platform published about the post: its caption, hashtags, author, sound and engagement. You cannot watch the video or see the image, so never describe shots you cannot know. Infer the format and the appeal from the caption and the numbers, and say plainly when something is an inference.

            Write a brief for a NEW piece of content for the client's own product. Rules:
            - Never copy the original's wording, and never tell the client to reuse its footage, images or audio.
            - Take the structure and the reason it works, not the content.
            - beats: the shot-by-shot spine of the new piece, 3 to 6 shots. For a still image or carousel, each beat is a frame.
            - image_prompt: one paragraph a text-to-image model can render directly. Describe subject, setting, light, lens and mood. No brand names, no text overlays, no celebrity likeness.
            - caption: written for the client, in their voice, not a translation of the original.
            - hashtags: one line, each tag starting with # and separated by a space.
            TXT,
            $this->source($data),
            [
                'type' => 'object',
                'properties' => [
                    'why_it_works' => ['type' => 'string'],
                    'hook' => ['type' => 'string'],
                    'beats' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                        'shot' => ['type' => 'string'],
                        'note' => ['type' => 'string'],
                    ], 'required' => ['shot', 'note'], 'additionalProperties' => false]],
                    'visual_style' => ['type' => 'string'],
                    'caption' => ['type' => 'string'],
                    // A line of tags, not a list: small models are unreliable at arrays of bare strings.
                    'hashtags' => ['type' => 'string'],
                    'image_prompt' => ['type' => 'string'],
                ],
                'required' => ['why_it_works', 'hook', 'beats', 'visual_style', 'caption', 'hashtags', 'image_prompt'],
                'additionalProperties' => false,
            ],
            'medium',
        ));

        $brief['hashtags'] = $this->tags($brief['hashtags'] ?? '');

        return response()->json($brief + ['model' => $name]);
    }

    /** @return list<string> */
    private function tags(string $line): array
    {
        preg_match_all('/#?([\p{L}\p{N}_]+)/u', $line, $m);

        return array_values(array_slice(array_unique($m[1] ?? []), 0, 15));
    }

    /** Everything the model is allowed to know about the original. */
    private function source(array $data): string
    {
        $m = $data['metrics'] ?? [];
        $lines = [
            "Platform: {$data['platform']}",
            'Format: '.($data['kind'] ?? 'unknown'),
            'Author: @'.($data['author'] ?: 'unknown'),
            'Caption: '.Str::limit($data['caption'], 2000),
        ];
        if (filled($data['hashtags'] ?? [])) {
            $lines[] = 'Hashtags: #'.implode(' #', array_slice($data['hashtags'], 0, 25));
        }
        if (filled($data['sound'] ?? null)) {
            $lines[] = "Sound: {$data['sound']}";
        }
        if (filled($m)) {
            $lines[] = 'Engagement: '.collect($m)->filter()->map(fn ($v, $k) => "{$k} ".number_format((int) $v))->join(', ');
        }
        $lines[] = "\nThe client's product or brand: ".($data['product'] ?: 'not given — write the brief so it reads as a template they fill in');
        if (filled($data['angle'] ?? null)) {
            $lines[] = 'The client wants their version to: '.$data['angle'];
        }

        return implode("\n", $lines);
    }
}

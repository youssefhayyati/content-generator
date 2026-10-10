<?php

namespace App\Http\Controllers;

use App\Models\TrendSearch;
use App\Models\User;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use App\Services\Social\Trends;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
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

        $feed = $this->trends->search($data['platform'], $data['hashtag']);
        $this->remember($request->user(), $feed);

        return response()->json($feed);
    }

    /**
     * Everything the page can show before spending anything: the last search to
     * reopen, the hashtags already searched, and the tags those posts carried.
     */
    public function searches(Request $request)
    {
        $data = $request->validate(['platform' => ['required', 'in:instagram,tiktok']]);

        $rows = TrendSearch::query()
            ->where('user_id', $request->user()->id)
            ->where('platform', $data['platform'])
            ->latest('updated_at')
            ->limit(30)
            ->get();

        $searched = $rows->map(fn (TrendSearch $row) => mb_strtolower($row->hashtag))->all();
        $last = $rows->first();

        return response()->json([
            'last' => $last ? $this->feed($last) : null,
            'recent' => $rows->take(10)->map(fn (TrendSearch $row) => [
                'hashtag' => $row->hashtag,
                'results' => $row->results,
                'searched_at' => $row->updated_at->toIso8601String(),
            ])->values(),
            'tags' => $this->suggest($rows, $searched),
        ]);
    }

    /**
     * Read one trending post and write the prompt for an original video of your own.
     *
     * The model never sees the video, only what the platform published about it,
     * so it works from the structure and writes a new scene rather than a copy.
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
        ]);

        [$generator, $name] = $this->models->text($this->models->textModelOr((string) config('ai.agents.model')));

        $brief = $this->usage->within($request->user(), null, 'inspire', fn () => $generator->json(
            $name,
            <<<'TXT'
            You are a creative director studying a post that is performing well, so you can shoot an original video of your own in its spirit.

            You are given only what the platform published about the post: its caption, hashtags, author, sound and engagement. You cannot watch the video or see the image, so never describe shots you cannot know. Infer the format and the appeal from the caption and the numbers.

            Write the prompt for a NEW short social video. Rules:
            - Never copy the original's wording, and never reuse its footage, images or audio.
            - Take the structure and the reason it works, not the content.
            - why_it_works: one or two sentences on what earns the attention. Work this out first — the rest depends on it.
            - hook: what happens in the first second of the new video.
            - video_prompt: one paragraph a text-to-video model can render directly, as a single continuous shot. Name the subject, the setting, the light, the lens and the camera move, and open on the hook. Write a finished scene, never a template with blanks to fill in. No brand names, no logos, no on-screen text, no celebrity likeness, no dialogue.
            TXT,
            $this->source($data),
            [
                'type' => 'object',
                'properties' => [
                    'why_it_works' => ['type' => 'string'],
                    'hook' => ['type' => 'string'],
                    'video_prompt' => ['type' => 'string'],
                ],
                'required' => ['why_it_works', 'hook', 'video_prompt'],
                'additionalProperties' => false,
            ],
            'medium',
        ));

        return response()->json($brief + ['model' => $name]);
    }

    /** Keep the result, so reopening the page costs nothing and the hashtag joins the suggestions. */
    private function remember(User $user, array $feed): void
    {
        $row = TrendSearch::updateOrCreate(
            ['user_id' => $user->id, 'platform' => $feed['platform'], 'hashtag' => $feed['hashtag']],
            ['items' => $feed['items'], 'results' => count($feed['items']), 'cost' => $feed['cost']],
        );
        // A repeat search inside the cache window changes nothing, and an unchanged
        // model never writes, so stamp it by hand to keep "recent" in search order.
        $row->touch();
    }

    /** A saved search in the same shape the live endpoint returns. */
    private function feed(TrendSearch $row): array
    {
        return [
            'items' => $row->items,
            'platform' => $row->platform,
            'hashtag' => $row->hashtag,
            'checked_at' => $row->updated_at->toIso8601String(),
            'cost' => $row->cost,
        ];
    }

    /**
     * What to search next: the tags these posts carried most often, minus the
     * ones already searched. Free, and drawn from the posts actually doing well.
     *
     * @param  Collection<int, TrendSearch>  $rows
     * @param  list<string>  $searched
     */
    private function suggest(Collection $rows, array $searched): array
    {
        return $rows
            ->flatMap(fn (TrendSearch $row) => collect($row->items)->flatMap(fn (array $item) => $item['hashtags'] ?? []))
            ->map(fn (string $tag) => mb_strtolower($tag))
            ->reject(fn (string $tag) => mb_strlen($tag) < 3 || in_array($tag, $searched, true))
            ->countBy()
            ->sortDesc()
            ->take(12)
            // A numeric tag like "2024" comes back as an int array key, so cast it.
            ->map(fn (int $count, int|string $tag) => ['tag' => (string) $tag, 'count' => $count])
            ->values()
            ->all();
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

        return implode("\n", $lines);
    }
}

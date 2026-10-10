<?php

namespace App\Services\Clips;

use App\Models\LinkClip;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use Illuminate\Support\Str;

/** Pick a self-contained moment and write its social copy, with a deterministic local fallback. */
class ClipPlanner
{
    public function __construct(private readonly ModelRegistry $models, private readonly UsageMeter $usage) {}

    /**
     * @param  array{text: string, segments: list<array{start: float, end: float, text: string}>}  $heard
     * @return array{start: float, end: float, title: string, caption: string, reason: string, model: string}
     */
    public function video(LinkClip $clip, array $heard, float $sourceSeconds, int $wantedSeconds, string $sourceTitle): array
    {
        $fallback = $this->denseWindow($heard['segments'] ?? [], $sourceSeconds, $wantedSeconds, $sourceTitle);
        $modelId = $this->models->availableText((string) config('ai.agents.model'));
        if (! $modelId || ! filled($heard['text'] ?? null)) {
            return $fallback;
        }

        try {
            [$generator, $model] = $this->models->text($modelId);
            $timed = collect($heard['segments'] ?? [])->map(fn ($s) => sprintf('[%.1f–%.1f] %s', $s['start'], $s['end'], $s['text']))->implode("\n");
            $answer = $this->usage->within($clip->user, $clip, 'clips:select', fn () => $generator->json(
                $model,
                'You are a short-form video editor. Select one coherent, compelling moment from a transcript for a vertical Reel or TikTok. It must start on a complete thought, make sense without the rest of the video, contain no invented words, and fit the requested duration. Prefer a sharp hook, useful insight, surprising fact, or compact story. Return timestamps that exist in the transcript.',
                "Source title: {$sourceTitle}\nTarget duration: about {$wantedSeconds} seconds\nSource duration: {$sourceSeconds} seconds\n\nTimed transcript:\n".Str::limit($timed, 18_000, ''),
                ['type' => 'object', 'properties' => [
                    'start' => ['type' => 'number'],
                    'end' => ['type' => 'number'],
                    'title' => ['type' => 'string'],
                    'caption' => ['type' => 'string'],
                    'reason' => ['type' => 'string'],
                ], 'required' => ['start', 'end', 'title', 'caption', 'reason'], 'additionalProperties' => false],
                'medium',
            ));
            $start = max(0, min($sourceSeconds - 3, (float) ($answer['start'] ?? $fallback['start'])));
            $end = max($start + 3, min($sourceSeconds, (float) ($answer['end'] ?? $start + $wantedSeconds)));
            if ($end - $start > 90) {
                $end = $start + 90;
            }

            return [
                'start' => round($start, 2),
                'end' => round($end, 2),
                'title' => Str::limit(trim((string) ($answer['title'] ?? '')), 80, '') ?: $fallback['title'],
                'caption' => Str::limit(trim((string) ($answer['caption'] ?? '')), 1500, '') ?: $fallback['caption'],
                'reason' => Str::limit(trim((string) ($answer['reason'] ?? '')), 300, '') ?: $fallback['reason'],
                'model' => $modelId,
            ];
        } catch (GenerationFailed) {
            return $fallback;
        }
    }

    /** @return array{title: string, script: string, caption: string, reason: string, model: string} */
    public function article(LinkClip $clip, array $article, int $wantedSeconds): array
    {
        $plain = trim(($article['description'] ? $article['description']."\n\n" : '').$article['text']);
        $fallbackScript = $this->sentences($plain, max(35, min(150, (int) round($wantedSeconds * 2.7))));
        $fallback = [
            'title' => Str::limit($article['title'], 70, ''),
            'script' => $fallbackScript,
            'caption' => Str::limit($article['title']."\n\nRead the full article: ".$clip->source_url, 1500, ''),
            'reason' => 'Built from the article’s opening facts.',
            'model' => 'local/fallback',
        ];
        $modelId = $this->models->availableText((string) config('ai.agents.model'));
        if (! $modelId) {
            return $fallback;
        }

        try {
            [$generator, $model] = $this->models->text($modelId);
            $answer = $this->usage->within($clip->user, $clip, 'clips:article', fn () => $generator->json(
                $model,
                'Turn an article into a short spoken vertical-video script. Stay strictly inside the supplied facts. Open with a direct hook, use short natural sentences, explain one useful idea, and end without asking people to click a fake link. No stage directions, hashtags, or quotation marks around the script.',
                "Article title: {$article['title']}\nTarget spoken length: about {$wantedSeconds} seconds.\nArticle:\n".Str::limit($plain, 18_000, ''),
                ['type' => 'object', 'properties' => [
                    'title' => ['type' => 'string'],
                    'script' => ['type' => 'string'],
                    'caption' => ['type' => 'string'],
                    'reason' => ['type' => 'string'],
                ], 'required' => ['title', 'script', 'caption', 'reason'], 'additionalProperties' => false],
                'medium',
            ));

            return [
                'title' => Str::limit(trim((string) $answer['title']), 80, '') ?: $fallback['title'],
                'script' => Str::limit(trim((string) $answer['script']), 1800, '') ?: $fallback['script'],
                'caption' => Str::limit(trim((string) $answer['caption']), 1500, '') ?: $fallback['caption'],
                'reason' => Str::limit(trim((string) $answer['reason']), 300, '') ?: $fallback['reason'],
                'model' => $modelId,
            ];
        } catch (GenerationFailed) {
            return $fallback;
        }
    }

    private function denseWindow(array $segments, float $sourceSeconds, int $wantedSeconds, string $title): array
    {
        $wanted = min($wantedSeconds, max(3, (int) floor($sourceSeconds)));
        $best = ['start' => 0.0, 'score' => -1, 'text' => ''];
        foreach ($segments as $segment) {
            $start = max(0, (float) ($segment['start'] ?? 0) - 0.35);
            $end = min($sourceSeconds, $start + $wanted);
            $inside = collect($segments)->filter(fn ($s) => (float) ($s['start'] ?? 0) < $end && (float) ($s['end'] ?? 0) > $start);
            $text = $inside->pluck('text')->implode(' ');
            $score = mb_strlen($text) - ($start < 2 ? 80 : 0);
            if ($score > $best['score']) {
                $best = ['start' => $start, 'score' => $score, 'text' => $text];
            }
        }
        $start = round((float) $best['start'], 2);
        $end = round(min($sourceSeconds, $start + $wanted), 2);

        return [
            'start' => $start,
            'end' => $end,
            'title' => Str::limit($title, 70, ''),
            'caption' => Str::limit(trim((string) $best['text']), 1200, '') ?: Str::limit($title, 120, ''),
            'reason' => 'Selected the most information-dense spoken moment.',
            'model' => 'local/fallback',
        ];
    }

    private function sentences(string $text, int $words): string
    {
        $parts = preg_split('/(?<=[.!?])\s+/u', preg_replace('/\s+/u', ' ', trim($text)) ?? '') ?: [];
        $out = [];
        $count = 0;
        foreach ($parts as $sentence) {
            $out[] = $sentence;
            $count += str_word_count($sentence);
            if ($count >= $words) {
                break;
            }
        }

        return Str::limit(implode(' ', $out), 1700, '');
    }
}

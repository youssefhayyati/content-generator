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
        return $this->videos($clip, $heard, $sourceSeconds, $wantedSeconds, $sourceTitle, 1)[0];
    }

    /**
     * Select several distinct moments in one model call. The fallback ranks non-overlapping
     * transcript windows, so batching remains useful when no local model is installed.
     *
     * @return list<array{start: float, end: float, title: string, caption: string, reason: string, model: string}>
     */
    public function videos(LinkClip $clip, array $heard, float $sourceSeconds, int $wantedSeconds, string $sourceTitle, int $count): array
    {
        $count = max(1, min(10, $count));
        $fallbacks = $this->denseWindows($heard['segments'] ?? [], $sourceSeconds, $wantedSeconds, $sourceTitle, $count);
        $modelId = $this->models->availableText((string) config('ai.agents.model'));
        if (! $modelId || ! filled($heard['text'] ?? null)) {
            return $fallbacks;
        }

        try {
            [$generator, $model] = $this->models->text($modelId);
            $timed = collect($heard['segments'] ?? [])->map(fn ($s) => sprintf('[%.1f–%.1f] %s', $s['start'], $s['end'], $s['text']))->implode("\n");
            $answer = $this->usage->within($clip->user, $clip, 'clips:select', fn () => $generator->json(
                $model,
                'You are a short-form video editor. Select several distinct, non-overlapping moments from a transcript for vertical Reels or TikToks. Every clip must start on a complete thought, make sense alone, contain no invented words, and fit the requested duration. Spread the choices across the source and prefer sharp hooks, useful insights, surprising facts, or compact stories. Return timestamps that exist in the transcript.',
                "Source title: {$sourceTitle}\nNumber of clips: {$count}\nTarget duration each: about {$wantedSeconds} seconds\nSource duration: {$sourceSeconds} seconds\n\nTimed transcript:\n".Str::limit($timed, 18_000, ''),
                ['type' => 'object', 'properties' => [
                    'clips' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                        'start' => ['type' => 'number'],
                        'end' => ['type' => 'number'],
                        'title' => ['type' => 'string'],
                        'caption' => ['type' => 'string'],
                        'reason' => ['type' => 'string'],
                    ], 'required' => ['start', 'end', 'title', 'caption', 'reason'], 'additionalProperties' => false]],
                ], 'required' => ['clips'], 'additionalProperties' => false],
                'medium',
            ));
            $plans = [];
            foreach (($answer['clips'] ?? []) as $candidate) {
                $fallback = $fallbacks[count($plans)] ?? $fallbacks[0];
                $start = max(0, min($sourceSeconds - 3, (float) ($candidate['start'] ?? $fallback['start'])));
                $end = max($start + 3, min($sourceSeconds, (float) ($candidate['end'] ?? $start + $wantedSeconds)));
                $end = min($end, $start + 90);
                if ($this->overlaps($start, $end, $plans)) {
                    continue;
                }
                $plans[] = [
                    'start' => round($start, 2),
                    'end' => round($end, 2),
                    'title' => Str::limit(trim((string) ($candidate['title'] ?? '')), 80, '') ?: $fallback['title'],
                    'caption' => Str::limit(trim((string) ($candidate['caption'] ?? '')), 1500, '') ?: $fallback['caption'],
                    'reason' => Str::limit(trim((string) ($candidate['reason'] ?? '')), 300, '') ?: $fallback['reason'],
                    'model' => $modelId,
                ];
                if (count($plans) === $count) {
                    break;
                }
            }
            foreach ($fallbacks as $fallback) {
                if (count($plans) === $count) {
                    break;
                }
                if (! $this->overlaps($fallback['start'], $fallback['end'], $plans)) {
                    $plans[] = $fallback;
                }
            }

            return array_slice([...$plans, ...$fallbacks], 0, $count);
        } catch (GenerationFailed) {
            return $fallbacks;
        }
    }

    /** @return list<array{title: string, script: string, caption: string, reason: string, model: string}> */
    public function articles(LinkClip $clip, array $article, int $wantedSeconds, int $count): array
    {
        if ($count <= 1) {
            return [$this->article($clip, $article, $wantedSeconds)];
        }
        $plain = trim(($article['description'] ? $article['description']."\n\n" : '').$article['text']);
        $sentences = preg_split('/(?<=[.!?])\s+/u', preg_replace('/\s+/u', ' ', $plain) ?? '') ?: [];
        $targetWords = max(35, min(150, (int) round($wantedSeconds * 2.7)));
        $plans = [];
        foreach (range(0, $count - 1) as $index) {
            $offset = (int) floor(count($sentences) * $index / max(1, $count));
            $script = $this->sentences(implode(' ', array_slice($sentences, $offset)), $targetWords);
            if (! filled($script)) {
                $script = $this->sentences($plain, $targetWords);
            }
            $plans[] = [
                'title' => Str::limit($article['title'].' — '.($index + 1), 70, ''),
                'script' => $script,
                'caption' => Str::limit($article['title']."\n\nRead the full article: ".$clip->source_url, 1500, ''),
                'reason' => 'Built from a distinct section of the article.',
                'model' => 'local/fallback',
            ];
        }

        return $plans;
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

    private function denseWindows(array $segments, float $sourceSeconds, int $wantedSeconds, string $title, int $count): array
    {
        $wanted = min($wantedSeconds, max(3, (int) floor($sourceSeconds)));
        $candidates = [];
        foreach ($segments as $segment) {
            $start = max(0, (float) ($segment['start'] ?? 0) - 0.35);
            $end = min($sourceSeconds, $start + $wanted);
            $inside = collect($segments)->filter(fn ($s) => (float) ($s['start'] ?? 0) < $end && (float) ($s['end'] ?? 0) > $start);
            $text = $inside->pluck('text')->implode(' ');
            $score = mb_strlen($text) - ($start < 2 ? 80 : 0);
            $candidates[] = ['start' => $start, 'end' => $end, 'score' => $score, 'text' => $text];
        }
        usort($candidates, fn ($a, $b) => $b['score'] <=> $a['score']);
        $plans = [];
        foreach ($candidates as $candidate) {
            if ($this->overlaps($candidate['start'], $candidate['end'], $plans)) {
                continue;
            }
            $number = count($plans) + 1;
            $plans[] = [
                'start' => round((float) $candidate['start'], 2),
                'end' => round((float) $candidate['end'], 2),
                'title' => Str::limit($title.($count > 1 ? ' — '.$number : ''), 70, ''),
                'caption' => Str::limit(trim((string) $candidate['text']), 1200, '') ?: Str::limit($title, 120, ''),
                'reason' => 'Selected a distinct information-dense spoken moment.',
                'model' => 'local/fallback',
            ];
            if (count($plans) === $count) {
                break;
            }
        }
        for ($index = count($plans); $index < $count; $index++) {
            $start = max(0, min($sourceSeconds - $wanted, $sourceSeconds * $index / max(1, $count)));
            $end = min($sourceSeconds, $start + $wanted);
            $text = collect($segments)->filter(fn ($s) => (float) ($s['start'] ?? 0) < $end && (float) ($s['end'] ?? 0) > $start)->pluck('text')->implode(' ');
            $plans[] = [
                'start' => round($start, 2),
                'end' => round($end, 2),
                'title' => Str::limit($title.' — '.($index + 1), 70, ''),
                'caption' => Str::limit(trim($text), 1200, '') ?: Str::limit($title, 120, ''),
                'reason' => 'Selected from another part of the source.',
                'model' => 'local/fallback',
            ];
        }

        return $plans;
    }

    private function overlaps(float $start, float $end, array $plans): bool
    {
        foreach ($plans as $plan) {
            $intersection = max(0, min($end, (float) $plan['end']) - max($start, (float) $plan['start']));
            if ($intersection > min($end - $start, (float) $plan['end'] - (float) $plan['start']) * 0.2) {
                return true;
            }
        }

        return false;
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

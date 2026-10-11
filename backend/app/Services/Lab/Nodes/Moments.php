<?php

namespace App\Services\Lab\Nodes;

use App\Models\Asset;
use App\Models\VideoSource;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use App\Services\Lab\Brief;
use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;
use Illuminate\Support\Str;

/**
 * Find moments: the parts of a long recording worth clipping. A text model reads the transcript
 * (in parts, for a long one) and quotes where each moment starts and ends; the times come from
 * finding those words in the timed transcript, because models guess timestamps badly. Each moment
 * is then kept within the platform's lengths, on whole words.
 */
class Moments extends Executor
{
    private const WINDOW = 11000; // characters of transcript per read

    public function __construct(private readonly ModelRegistry $models, private readonly UsageMeter $usage) {}

    public function start(NodeJob $job): array
    {
        $p = $job->params;
        $t = $job->inputs->first('transcript') ?? throw new NodeFailed('Connect a transcript.');
        [$words, $ref] = $this->words($job, $t);
        if (count($words) < 20) {
            throw new NodeFailed('The transcript is too short to find moments in.');
        }
        $model = $this->nodeModel($job);
        [$generator, $name] = $this->models->text($model['id']);
        $count = max(1, min(12, (int) ($p['count'] ?? 5)));
        $min = max(3, (float) ($p['min'] ?? 15));
        $max = max($min + 2, min(['instagram' => 90, 'x' => 140, 'youtube' => 180, 'tiktok' => 180][$p['platform']] ?? 90, (float) ($p['max'] ?? 45)));
        $brief = $this->brief($job);
        $lines = $this->lines($words);
        $windows = $this->windows($lines);
        $each = (int) ceil($count * 1.5 / count($windows)) + 1;

        $system = 'You are a video editor who finds the moments in long recordings that make great short clips: a sharp idea, a story with a payoff, a surprising fact, a quotable line, a strong opinion. A good clip makes sense on its own, with no setup from before it, and ends on a complete thought. Never invent anything the transcript does not say.'
            .($brief && ($context = Brief::forWriter($brief, (string) ($p['brief_use'] ?? 'both'))) !== '' ? "\n\nThe brand and campaign the clips are for:\n".Str::limit($context, 4000) : '');
        $schema = ['type' => 'object', 'properties' => ['moments' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
            'title' => ['type' => 'string'], 'hook' => ['type' => 'string'], 'why' => ['type' => 'string'], 'score' => ['type' => 'integer'],
            'start_quote' => ['type' => 'string'], 'end_quote' => ['type' => 'string'], 'start' => ['type' => 'number'], 'end' => ['type' => 'number'],
        ], 'required' => ['title', 'hook', 'why', 'score', 'start_quote', 'end_quote'], 'additionalProperties' => false]]], 'required' => ['moments'], 'additionalProperties' => false];

        $found = [];
        foreach ($windows as $i => $window) {
            $job->stage(count($windows) > 1 ? 'Reading part '.($i + 1).' of '.count($windows) : 'Reading the transcript', $i / count($windows));
            $prompt = "Find up to {$each} moments for {$p['platform']} clips, each between ".round($min).' and '.round($max).' seconds long (about 2.5 words a second).'
                .(filled($p['focus'] ?? null) ? " Look especially for: {$p['focus']}." : '')
                ."\n\nThe transcript, each line starting with when it's said, in seconds:\n{$window}\n\n"
                .'For each moment: a short title; a hook (one line to open the clip with, under 12 words); why it works; a score from 0 to 100 for how well it would do as a clip; start_quote, the first 6 to 10 words of the moment exactly as in the transcript; end_quote, its last 6 to 10 words exactly as in the transcript; and start and end in seconds.';
            try {
                $answer = $this->usage->within($job->user(), $job->run, 'lab', fn () => $generator->json($name, $system, $prompt, $schema, 'medium'));
            } catch (\Throwable $e) {
                if ($i === 0 && count($windows) === 1) {
                    throw new NodeFailed('The model couldn’t read it: '.$e->getMessage());
                }
                report($e);

                continue;
            }
            foreach ($answer['moments'] ?? [] as $m) {
                if ($placed = $this->place($m, $words, $min, $max)) {
                    $found[] = $placed;
                }
            }
        }
        $found = $this->distinct($found);
        usort($found, fn ($a, $b) => $b['score'] <=> $a['score']);
        $found = array_slice($found, 0, $count);
        if (! $found) {
            throw new NodeFailed('No moments that fit those lengths were found. Try other lengths, or look for something else.');
        }
        // In the order they happen, numbered: "moment 2" stays moment 2.
        usort($found, fn ($a, $b) => $a['start'] <=> $b['start']);
        foreach ($found as $i => &$m) {
            $m['n'] = $i + 1;
        }

        return ['outputs' => [
            'moments' => ['type' => 'moments', ...$ref, 'moments' => $found],
            'text' => ['type' => 'text', 'text' => collect($found)->map(fn ($m) => "{$m['n']}. {$m['hook']}")->join("\n")],
        ]];
    }

    /**
     * @param  array<string, mixed>  $t
     * @return array{0: list<array{text: string, start: float, end: float}>, 1: array<string, int>}
     */
    private function words(NodeJob $job, array $t): array
    {
        if (! empty($t['source_id'])) {
            $s = VideoSource::where('user_id', $job->project->user_id)->find($t['source_id']);

            return [$s?->transcript['words'] ?? [], ['source_id' => (int) $t['source_id']]];
        }
        $a = ! empty($t['asset_id']) ? Asset::where('user_id', $job->project->user_id)->find($t['asset_id']) : null;

        return [$a?->meta['transcript']['words'] ?? [], ['asset_id' => (int) ($t['asset_id'] ?? 0)]];
    }

    /**
     * The transcript as lines of a sentence or so, each with its start time.
     *
     * @param  list<array{text: string, start: float, end: float}>  $words
     * @return list<string>
     */
    private function lines(array $words): array
    {
        $lines = [];
        $line = [];
        $start = null;
        foreach ($words as $i => $w) {
            $start ??= $w['start'];
            $line[] = $w['text'];
            $gap = isset($words[$i + 1]) ? $words[$i + 1]['start'] - $w['end'] : 0;
            if (preg_match('/[.!?]["”]?$/u', $w['text']) || count($line) >= 28 || $gap > 1.2) {
                $lines[] = '['.number_format($start, 1, '.', '').'] '.implode(' ', $line);
                $line = [];
                $start = null;
            }
        }
        if ($line) {
            $lines[] = '['.number_format($start, 1, '.', '').'] '.implode(' ', $line);
        }

        return $lines;
    }

    /**
     * @param  list<string>  $lines
     * @return list<string>
     */
    private function windows(array $lines): array
    {
        $windows = [];
        $current = '';
        foreach ($lines as $l) {
            if (mb_strlen($current) + mb_strlen($l) > self::WINDOW && $current !== '') {
                $windows[] = $current;
                $current = '';
            }
            $current .= $l."\n";
        }
        if ($current !== '') {
            $windows[] = $current;
        }

        return $windows;
    }

    /**
     * Where a moment really is: its quotes found in the words, kept within the lengths.
     *
     * @param  array<string, mixed>  $m
     * @param  list<array{text: string, start: float, end: float}>  $words
     * @return array<string, mixed>|null
     */
    private function place(array $m, array $words, float $min, float $max): ?array
    {
        $tokens = array_map(fn ($w) => self::norm($w['text']), $words);
        $from = self::locate($tokens, (string) $m['start_quote'], 0, isset($m['start']) ? $this->near($words, (float) $m['start']) : null);
        if ($from === null) {
            return null;
        }
        $to = self::locate($tokens, (string) $m['end_quote'], $from, isset($m['end']) ? $this->near($words, (float) $m['end']) : null, end: true);
        $quoted = $to !== null && $to > $from;
        if (! $quoted) {
            $to = $from;
            while (isset($words[$to + 1]) && $words[$to + 1]['end'] - $words[$from]['start'] <= ($min + $max) / 2) {
                $to++;
            }
        }
        // Too long: end on the last sentence that fits. Too short: carry on to the end of a sentence.
        while ($to > $from && $words[$to]['end'] - $words[$from]['start'] > $max) {
            $to--;
            for ($k = $to; $k > $from + 3; $k--) {
                if (preg_match('/[.!?]["”]?$/u', $words[$k]['text']) && $words[$k]['end'] - $words[$from]['start'] <= $max) {
                    $to = $k;
                    break;
                }
            }
        }
        while (isset($words[$to + 1]) && ($words[$to]['end'] - $words[$from]['start'] < $min || (! $quoted && ! preg_match('/[.!?]["”]?$/u', $words[$to]['text']) && $words[$to + 1]['end'] - $words[$from]['start'] <= $max))) {
            $to++;
        }
        $start = max(0, $words[$from]['start'] - 0.12);
        $end = $words[$to]['end'] + 0.3;
        if ($end - $start < $min * 0.8) {
            return null;
        }

        return [
            'title' => Str::limit(trim((string) $m['title']), 80, ''),
            'hook' => Str::limit(trim((string) $m['hook']), 120, ''),
            'why' => Str::limit(trim((string) $m['why']), 240, ''),
            'score' => max(0, min(100, (int) $m['score'])),
            'start' => round($start, 2),
            'end' => round($end, 2),
            'duration' => round($end - $start, 1),
            'quote' => Str::limit(implode(' ', array_column(array_slice($words, $from, $to - $from + 1), 'text')), 400),
        ];
    }

    /**
     * @param  list<array{text: string, start: float, end: float}>  $words
     */
    private function near(array $words, float $t): int
    {
        $best = 0;
        foreach ($words as $i => $w) {
            if ($w['start'] <= $t) {
                $best = $i;
            } else {
                break;
            }
        }

        return $best;
    }

    /**
     * The index where a quote starts (or ends, with `end`), searching after `$after`; the closest
     * match to `$hint` when it appears more than once. Null when it isn't there.
     *
     * @param  list<string>  $tokens
     */
    private static function locate(array $tokens, string $quote, int $after, ?int $hint, bool $end = false): ?int
    {
        $q = array_values(array_filter(array_map([self::class, 'norm'], preg_split('/\s+/', $quote) ?: [])));
        if (! $q) {
            return null;
        }
        $q = array_slice($q, 0, 10);
        $n = count($q);
        $best = null;
        $bestScore = 0;
        for ($i = $after; $i <= count($tokens) - 1; $i++) {
            $hits = 0;
            for ($k = 0; $k < $n && $i + $k < count($tokens); $k++) {
                if ($tokens[$i + $k] === $q[$k]) {
                    $hits++;
                }
            }
            $score = $hits / $n - ($hint !== null ? min(0.3, abs($i - $hint) / 4000) : 0);
            if ($score > $bestScore) {
                [$best, $bestScore] = [$i, $score];
            }
        }
        if ($best === null || $bestScore < 0.5) {
            return null;
        }

        return $end ? min(count($tokens) - 1, $best + $n - 1) : $best;
    }

    private static function norm(string $w): string
    {
        return mb_strtolower(preg_replace('/[^\pL\pN\']+/u', '', $w) ?? '');
    }

    /**
     * Moments that overlap by more than half: only the better one.
     *
     * @param  list<array<string, mixed>>  $found
     * @return list<array<string, mixed>>
     */
    private function distinct(array $found): array
    {
        usort($found, fn ($a, $b) => $b['score'] <=> $a['score']);
        $kept = [];
        foreach ($found as $m) {
            foreach ($kept as $k) {
                $overlap = min($m['end'], $k['end']) - max($m['start'], $k['start']);
                if ($overlap > 0.5 * min($m['end'] - $m['start'], $k['end'] - $k['start'])) {
                    continue 2;
                }
            }
            $kept[] = $m;
        }

        return $kept;
    }
}

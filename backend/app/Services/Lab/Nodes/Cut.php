<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\EngineClient;
use App\Services\Lab\Executor;
use App\Services\Lab\Listening;
use App\Services\Lab\Media;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;
use App\Services\Lab\YtDlp;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/**
 * Cut & reframe: a part of a video (its times set here, or a found moment's), in the platform's shape.
 * From an online video only that part is downloaded. Reframing crops (around a point, or the
 * speaker's face), fits it over a blurred copy of itself, or fits it with bars. Jump cuts drop the
 * silences and the "um"s. The clip keeps its words, timed to it, for captions.
 */
class Cut extends Executor
{
    private const FILLERS = ['um', 'uh', 'erm', 'uhm', 'hmm', 'mm', 'ah', 'er', 'euh'];

    public function __construct(private readonly YtDlp $ytdlp, private readonly Listening $listening, private readonly EngineClient $engine) {}

    public function start(NodeJob $job): array
    {
        $p = $job->params;
        $source = $job->inputs->source('video');
        $asset = $source ? null : $job->inputs->asset('video', ['video']);
        if (! $source && ! $asset) {
            throw new NodeFailed('Connect a video.');
        }
        [$start, $end, $title] = $this->times($job);

        $cleanup = [];
        $words = [];
        $meta = [];
        if ($asset) {
            $path = Media::path($asset);
            $words = $asset->meta['words'] ?? $asset->meta['transcript']['words'] ?? [];
            $meta = $this->inherit($asset);
        } else {
            $meta = ['video_source_id' => $source->id, 'credit' => $source->credit, 'source_url' => $source->url];
            $words = $source->transcript['words'] ?? [];
            if ($source->video) {
                $path = Media::path($source->video);
            } else {
                if ($start === null || $end === null) {
                    throw new NodeFailed('Pick the part to cut (connect Find moments, or set the times): only that part is downloaded.');
                }
                $job->stage('Downloading that part');
                $path = $cleanup[] = Media::tmp('mp4');
                $this->ytdlp->section($source->url, $start, $end, $path);
                // The download starts at the moment: its times are the clip's.
                $words = Listening::between($words, $start, $end);
                [$start, $end] = [0.0, $end - $start];
            }
        }

        try {
            $info = Media::probe($path);
            if (! $info['width']) {
                throw new NodeFailed('That file has no picture.');
            }
            $start = max(0, (float) ($start ?? 0));
            $end = min($info['duration'] ?: PHP_FLOAT_MAX, (float) ($end ?? $info['duration']));
            if ($end - $start < 0.5) {
                throw new NodeFailed('The part to cut is too short (or the times are past its end).');
            }
            $length = $end - $start;
            $clipWords = Listening::between($words, $start, $end);

            $aspect = (string) ($p['aspect'] ?? '9:16');
            [$W, $H] = Media::frame($aspect, $info['width'], $info['height']);
            $focus = (float) ($p['focus'] ?? 0.5);
            if (($p['fit'] ?? 'crop') === 'speaker' && $aspect !== 'original') {
                $job->stage('Finding the speaker');
                $focus = $this->speaker($path, $start, $end, $info) ?? $focus;
            }
            $fps = $info['fps'] > 31 ? 30 : max(24, round($info['fps']));

            // Jump cuts: keep the words, drop the gaps between them and the fillers.
            $keep = null;
            if (! empty($p['jumpcuts'])) {
                if (! $clipWords && $info['audio']) {
                    $job->stage('Listening for the silences');
                    $tmpWav = $cleanup[] = Media::tmp('wav');
                    Media::ffmpeg(['-ss', sprintf('%.3f', $start), '-t', sprintf('%.3f', $length), '-i', $path, '-vn', '-ac', '1', '-ar', '16000', $tmpWav], 'take the sound');
                    $clipWords = $this->listening->file($tmpWav, $length)['words'];
                }
                [$keep, $clipWords] = $this->jumpcuts($clipWords, $length);
            }

            $video = '[0:v]fps='.$fps.($keep ? ",select='".$this->between($keep)."',setpts=N/{$fps}/TB" : '').','.$this->reframe((string) ($p['fit'] ?? 'crop'), $aspect, $info['width'], $info['height'], $W, $H, $focus).',format=yuv420p[v]';
            $audio = $info['audio'] ? '[0:a]aresample=48000'.($keep ? ",aselect='".$this->between($keep)."',asetpts=N/SR/TB" : '').'[a]' : null;
            $out = Media::tmp('mp4');
            $job->stage('Cutting'.($aspect !== 'original' ? " to {$aspect}" : ''));
            Media::ffmpeg([
                '-ss', sprintf('%.3f', $start), '-t', sprintf('%.3f', $length), '-i', $path,
                '-filter_complex', $video.($audio ? ";{$audio}" : ''),
                '-map', '[v]', ...($audio ? ['-map', '[a]'] : []),
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', $out,
            ], 'cut the video');
        } finally {
            foreach ($cleanup as $f) {
                @unlink($f);
            }
        }

        $name = Str::limit($title ?: 'clip', 60, '').'-'.gmdate('i\ms\s', (int) $start).'.mp4';
        $clip = $this->media()->keep($job->user(), $out, 'video/mp4', $name, [...$meta, 'words' => $clipWords, 'cut' => ['start' => round($start, 2), 'end' => round($end, 2)]]);

        return ['outputs' => $this->assetOutputs($job, $clip)];
    }

    /**
     * The times: the node's own when set, else the chosen moment's.
     *
     * @return array{0: float|null, 1: float|null, 2: string|null}
     */
    private function times(NodeJob $job): array
    {
        $p = $job->params;
        $start = isset($p['start']) && $p['start'] !== '' ? (float) $p['start'] : null;
        $end = isset($p['end']) && $p['end'] !== '' ? (float) $p['end'] : null;
        $moments = $job->inputs->first('moments')['moments'] ?? [];
        if ($moments && $start === null && $end === null) {
            $n = max(1, (int) ($p['moment'] ?? 1));
            $m = collect($moments)->firstWhere('n', $n) ?? ($moments[$n - 1] ?? null) ?? throw new NodeFailed('There are only '.count($moments).' moments.');

            return [(float) $m['start'], (float) $m['end'], $m['title'] ?? null];
        }

        return [$start, $end, null];
    }

    /**
     * @param  list<array{text: string, start: float, end: float}>  $words
     * @return array{0: list<array{0: float, 1: float}>|null, 1: list<array{text: string, start: float, end: float}>}
     */
    private function jumpcuts(array $words, float $length): array
    {
        $kept = array_values(array_filter($words, fn ($w) => ! in_array(mb_strtolower(trim($w['text'], ' ,.!?…')), self::FILLERS, true)));
        if (count($kept) < 2) {
            return [null, $words];
        }
        $segments = [];
        $a = max(0, $kept[0]['start'] - 0.1);
        $b = $kept[0]['end'];
        foreach (array_slice($kept, 1) as $w) {
            if ($w['start'] - $b > 0.45) {
                $segments[] = [$a, min($length, $b + 0.12)];
                $a = max(0, $w['start'] - 0.1);
            }
            $b = $w['end'];
        }
        $segments[] = [$a, min($length, $b + 0.2)];
        $removed = $length - array_sum(array_map(fn ($s) => $s[1] - $s[0], $segments));
        if ($removed < 0.3) {
            return [null, $words];
        }
        // The words, moved to where they now are.
        $moved = [];
        $shift = 0.0;
        $prevEnd = 0.0;
        $si = 0;
        foreach ($segments as [$s, $e]) {
            $shift += $s - $prevEnd;
            foreach ($kept as $w) {
                if ($w['start'] >= $s - 0.001 && $w['start'] < $e) {
                    $moved[] = ['text' => $w['text'], 'start' => round($w['start'] - $shift, 3), 'end' => round(min($w['end'], $e) - $shift, 3)];
                }
            }
            $prevEnd = $e;
            $si++;
        }

        return [$segments, $moved];
    }

    /**
     * @param  list<array{0: float, 1: float}>  $segments
     */
    private function between(array $segments): string
    {
        return implode('+', array_map(fn ($s) => sprintf('between(t\\,%.3f\\,%.3f)', $s[0], $s[1]), $segments));
    }

    private function reframe(string $fit, string $aspect, int $w, int $h, int $W, int $H, float $focus): string
    {
        return $aspect === 'original' ? 'scale=trunc(iw/2)*2:trunc(ih/2)*2' : Media::reframe($fit === 'speaker' ? 'crop' : $fit, $w, $h, $W, $H, $focus);
    }

    /**
     * Where the speaker is, left to right (0..1): the middle of the largest face in a few frames, from
     * the pod's face detector. Null when it can't tell.
     *
     * @param  array{width: int, height: int, duration: float}  $info
     */
    private function speaker(string $path, float $start, float $end, array $info): ?float
    {
        $frames = [];
        try {
            for ($i = 0; $i < 8; $i++) {
                $t = $start + ($end - $start) * ($i + 0.5) / 8;
                $f = Media::tmp('jpg');
                Media::ffmpeg(['-ss', sprintf('%.3f', $t), '-i', $path, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', $f], 'take a frame');
                $frames[] = $f;
            }
            $request = Http::timeout(60)->withHeaders($this->engine->headers())->acceptJson();
            foreach ($frames as $i => $f) {
                $request = $request->attach('frames', file_get_contents($f), "frame{$i}.jpg");
            }
            $r = $request->post($this->engine->url().'/engine/faces');
            if (! $r->successful()) {
                return null;
            }
            $centres = collect($r->json('frames', []))->map(function ($faces) {
                $big = collect($faces)->sortByDesc(fn ($b) => ($b['w'] ?? 0) * ($b['h'] ?? 0))->first();

                return $big ? ($big['x'] + $big['w'] / 2) : null;
            })->filter(fn ($c) => $c !== null)->sort()->values();
            if ($centres->isEmpty()) {
                return null;
            }

            return (float) $centres[(int) floor(($centres->count() - 1) / 2)];
        } catch (\Throwable $e) {
            report($e);

            return null;
        } finally {
            foreach ($frames as $f) {
                @unlink($f);
            }
        }
    }
}

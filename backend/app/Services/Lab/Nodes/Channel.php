<?php

namespace App\Services\Lab\Nodes;

use App\Models\Asset;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use App\Services\Lab\Executor;
use App\Services\Lab\Media;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;
use App\Services\Publishing\PlatformSpecs;
use Illuminate\Support\Str;

/**
 * Where it goes: one account and one kind of post (an Instagram reel, a story, a post on X, a Short…).
 * The content before it is made once; this node fits it to the place: the media it takes (pictures,
 * a video, how many), in the shape it wants (cropped, or fitted over a blur), no longer than it allows,
 * and the caption within its limits, rewritten for the platform when asked. The Post node after it
 * posts it there.
 */
class Channel extends Executor
{
    public function __construct(private readonly PlatformSpecs $specs, private readonly ModelRegistry $models, private readonly UsageMeter $usage) {}

    public function start(NodeJob $job): array
    {
        $p = $job->params;
        $account = ! empty($p['account_id']) ? $job->user()->accounts()->find($p['account_id']) : null;
        if (! $account) {
            throw new NodeFailed('Pick the account it goes to.');
        }
        $platform = $account->platform;
        $assets = $job->inputs->assets('media', ['image', 'video']);
        $placement = $p['placement'] ?: $this->specs->defaultPlacement($platform, $assets);
        $spec = $this->specs->spec($platform, $placement) ?? throw new NodeFailed("{$platform->label()} has no “{$placement}”.");
        $label = $platform->label().' '.mb_strtolower($spec['label']);

        // The media it takes, as many as it takes.
        $usable = $assets->filter(fn (Asset $a) => in_array($a->kind, $spec['media'], true))->values();
        if ($usable->isEmpty() && $spec['items'][0] > 0) {
            throw new NodeFailed("{$label} takes ".implode(' or ', array_map(fn ($k) => $k === 'image' ? 'a picture' : 'a video', $spec['media'])).': connect one.');
        }
        $usable = $usable->take($spec['items'][1]);

        // Its shape: the size it's made at, and the ratios it takes.
        [$W, $H] = $this->size($spec);
        [$lo, $hi] = $spec['ratio'];
        $fitted = [];
        foreach ($usable as $i => $a) {
            $job->stage("Fitting {$label}", $i / max(1, $usable->count()));
            $fitted[] = $this->fit($job, $a, $W, $H, $lo, $hi, $spec['duration'][1] ?? null, (string) ($p['fit'] ?? 'crop'));
        }

        $caption = $job->inputs->text('caption');
        if ($caption !== '' && ! empty($p['rewrite'])) {
            $job->stage("Writing the caption for {$platform->label()}");
            $caption = $this->rewrite($job, $caption, $label, (int) $spec['caption'], (int) ($spec['hashtags'] ?? 30));
        }
        $caption = $this->limit($caption, (int) $spec['caption'], (int) ($spec['hashtags'] ?? 30));

        $images = array_values(array_filter($fitted, fn (Asset $a) => $a->kind === 'image'));
        $videos = array_values(array_filter($fitted, fn (Asset $a) => $a->kind === 'video'));

        return ['outputs' => [
            'channel' => ['type' => 'channel', 'account_id' => $account->id, 'platform' => $platform->value, 'placement' => $placement, 'handle' => $account->handle, 'label' => $label],
            'image' => ['type' => 'image', 'assets' => array_map(fn (Asset $a) => $a->id, $images)],
            'video' => ['type' => 'video', 'assets' => array_map(fn (Asset $a) => $a->id, $videos)],
            'caption' => ['type' => 'text', 'text' => $caption],
        ]];
    }

    /**
     * The size the placement is made at, from its hint ("1080 × 1920 (9:16)").
     *
     * @param  array<string, mixed>  $spec
     * @return array{0: int, 1: int}
     */
    private function size(array $spec): array
    {
        if (preg_match('/(\d{3,4})\s*[×x]\s*(\d{3,4})/u', (string) ($spec['ratio_hint'] ?? ''), $m)) {
            return [(int) $m[1], (int) $m[2]];
        }
        $r = ($spec['ratio'][0] + $spec['ratio'][1]) / 2;

        return $r < 1 ? [1080, (int) round(1080 / $r / 2) * 2] : [(int) round(1080 * $r / 2) * 2, 1080];
    }

    /** The asset as it is when it fits; else a copy in the placement's shape (and length). */
    private function fit(NodeJob $job, Asset $a, int $W, int $H, float $lo, float $hi, ?float $maxSeconds, string $fit): Asset
    {
        $path = Media::path($a);
        if ($a->kind === 'image') {
            [$w, $h] = @getimagesize($path) ?: [$a->width ?? $W, $a->height ?? $H];
            if ($w && $h && $w / $h >= $lo - 0.01 && $w / $h <= $hi + 0.01) {
                return $a;
            }
            $out = Media::tmp('jpg');
            Media::ffmpeg(['-i', $path, '-vf', Media::reframe($fit, (int) $w, (int) $h, $W, $H), '-q:v', '2', $out], 'fit the picture');

            return $this->media()->keep($job->user(), $out, 'image/jpeg', 'fitted-'.Str::limit((string) $a->name, 60, ''), $this->inherit($a));
        }
        $info = Media::probe($path);
        $ratio = $info['height'] ? $info['width'] / $info['height'] : 1;
        $long = $maxSeconds && $info['duration'] > $maxSeconds + 0.05;
        if ($ratio >= $lo - 0.01 && $ratio <= $hi + 0.01 && ! $long) {
            return $a;
        }
        $out = Media::tmp('mp4');
        $vf = $ratio >= $lo - 0.01 && $ratio <= $hi + 0.01 ? 'scale=trunc(iw/2)*2:trunc(ih/2)*2' : Media::reframe($fit, $info['width'], $info['height'], $W, $H);
        Media::ffmpeg([
            '-i', $path, ...($long ? ['-t', sprintf('%.3f', $maxSeconds)] : []),
            '-filter_complex', "[0:v]{$vf},format=yuv420p[v]", '-map', '[v]', ...($info['audio'] ? ['-map', '0:a'] : []),
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', $out,
        ], 'fit the video');
        $words = $a->meta['words'] ?? null;
        if ($words && $long) {
            $words = array_values(array_filter($words, fn ($w) => $w['start'] < $maxSeconds));
        }

        return $this->media()->keep($job->user(), $out, 'video/mp4', 'fitted-'.Str::limit((string) $a->name, 60, ''), array_filter([...$this->inherit($a), 'words' => $words]));
    }

    private function rewrite(NodeJob $job, string $caption, string $label, int $limit, int $hashtags): string
    {
        $model = $job->engine->modelFor($job->node);
        if (! $model || ! $model['available']) {
            return $caption; // nothing can write now: the caption as it is, kept within the limits
        }
        [$generator, $name] = $this->models->text($model['id']);
        $rules = match (true) {
            str_starts_with($label, 'X') => 'Under 280 characters including spaces: one idea, the strongest sentence first, at most one or two hashtags inside a sentence, no hashtag block.',
            str_contains($label, 'LinkedIn') => 'A first line that earns the click on "see more", short paragraphs, a clear takeaway, three hashtags at most at the end.',
            str_contains($label, 'story') => 'One short line: a story has almost no caption.',
            default => "The first line is the hook (about 125 characters), then short paragraphs, one call to action, and at most {$hashtags} specific hashtags on the last line (three to five is best).",
        };
        $out = $this->usage->within($job->user(), $job->run, 'lab', function () use ($generator, $name, $caption, $label, $limit, $rules) {
            $text = '';
            foreach ($generator->stream($name, 'You adapt social media captions to a platform. Keep the meaning, the facts, the voice and any credit line exactly. Never invent anything. Reply with the caption only, plain text, no preamble.', "Rewrite this caption for {$label}, under {$limit} characters. {$rules}\n\nThe caption:\n{$caption}") as $chunk) {
                $text .= $chunk;
            }

            return trim($text);
        });

        return $out !== '' ? $out : $caption;
    }

    /** Within the platform's limits: no more hashtags than it takes, no longer than it takes. */
    private function limit(string $caption, int $limit, int $hashtags): string
    {
        $seen = 0;
        $caption = preg_replace_callback('/(^|\s)#[\p{L}\p{N}_]+/u', function ($m) use (&$seen, $hashtags) {
            return ++$seen > $hashtags ? '' : $m[0];
        }, $caption) ?? $caption;

        return mb_strlen($caption) > $limit ? rtrim(mb_substr($caption, 0, $limit - 1)).'…' : trim($caption);
    }
}

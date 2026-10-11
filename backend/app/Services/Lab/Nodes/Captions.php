<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\Listening;
use App\Services\Lab\Media;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/**
 * Captions: the words burned on the video as they're said, a few at a time (an ASS subtitle file
 * that ffmpeg draws with libass). The words come with the clip (Cut keeps them), else it's heard.
 */
class Captions extends Executor
{
    /** Font names on the node → the family libass finds in resources/fonts/lab. */
    public const FONTS = [
        'montserrat' => 'Montserrat ExtraBold', 'bold' => 'Geist ExtraBold', 'anton' => 'Anton', 'bebas' => 'Bebas Neue',
        'poppins' => 'Poppins SemiBold', 'archivo' => 'Archivo Black', 'fraunces' => 'Fraunces SemiBold', 'playfair' => 'Playfair Display',
    ];

    public function __construct(private readonly Listening $listening) {}

    public function start(NodeJob $job): array
    {
        $video = $job->inputs->asset('video', ['video']) ?? throw new NodeFailed('Connect the video.');
        $path = Media::path($video);
        $info = Media::probe($path);
        $words = $video->meta['words'] ?? $video->meta['transcript']['words'] ?? null;
        if (! $words) {
            if (! $info['audio']) {
                throw new NodeFailed('The video has no sound, so there are no words to caption.');
            }
            $words = $this->listening->asset($video, null, fn ($stage, $share) => $job->stage($stage, $share))['words'];
        }
        if (! $words) {
            throw new NodeFailed('No words could be made out.');
        }
        $ass = Media::tmp('ass');
        file_put_contents($ass, self::ass($words, $info['width'], $info['height'], $job->params));
        $out = Media::tmp('mp4');
        $job->stage('Drawing the captions');
        try {
            Media::ffmpeg([
                '-i', $path, '-vf', "subtitles=filename='".str_replace(['\\', "'", ':'], ['\\\\', "\\'", '\\:'], $ass)."':fontsdir='".resource_path('fonts/lab')."'",
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', $out,
            ], 'draw the captions');
        } finally {
            @unlink($ass);
        }
        $asset = $this->media()->keep($job->user(), $out, 'video/mp4', 'captioned-'.($video->name ?: 'video.mp4'), [...$this->inherit($video), 'words' => $words, 'captions' => true]);

        return ['outputs' => $this->assetOutputs($job, $asset)];
    }

    /**
     * @param  list<array{text: string, start: float, end: float}>  $words
     * @param  array<string, mixed>  $p
     */
    public static function ass(array $words, int $W, int $H, array $p): string
    {
        $style = (string) ($p['style'] ?? 'bold');
        $short = min($W, $H);
        $size = (int) round($short * (['bold' => 0.078, 'clean' => 0.06, 'boxed' => 0.056][$style] ?? 0.07));
        $font = self::FONTS[$p['font'] ?? ''] ?? ($style === 'clean' ? 'Geist ExtraBold' : 'Montserrat ExtraBold');
        $color = self::color((string) ($p['color'] ?? '#ffffff'));
        $highlight = self::color((string) ($p['highlight'] ?? '#facc15'));
        [$align, $marginV] = match ($p['position'] ?? 'lower') {
            'top' => [8, (int) round($H * 0.12)],
            'middle' => [5, 0],
            default => [2, (int) round($H * ($H > $W ? 0.2 : 0.1))],
        };
        [$border, $outline, $shadow, $outlineColour, $back] = match ($style) {
            'clean' => [1, 0, max(2, (int) round($size * 0.06)), '&H00000000', '&H96000000'],
            'boxed' => [3, max(8, (int) round($size * 0.28)), 0, '&H5A000000', '&H5A000000'],
            default => [1, max(3, (int) round($size * 0.09)), 0, '&H00000000', '&H00000000'],
        };
        $margin = (int) round($W * 0.08);
        $head = "[Script Info]\nScriptType: v4.00+\nPlayResX: {$W}\nPlayResY: {$H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
            ."[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            ."Style: Cap,{$font},{$size},{$color},{$color},{$outlineColour},{$back},0,0,0,0,100,100,0,0,{$border},{$outline},{$shadow},{$align},{$margin},{$margin},{$marginV},1\n\n"
            ."[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";

        $upper = ! empty($p['upper']) || ! isset($p['upper']);
        $per = max(1, min(8, (int) ($p['words'] ?? 3)));
        $groups = self::groups($words, $per);
        $lines = [];
        foreach ($groups as $g => $group) {
            $groupEnd = min(end($group)['end'] + 0.25, isset($groups[$g + 1]) ? $groups[$g + 1][0]['start'] : PHP_FLOAT_MAX);
            $texts = array_map(fn ($w) => self::clean($upper ? mb_strtoupper($w['text']) : $w['text']), $group);
            if ($style === 'bold') {
                foreach ($group as $k => $w) {
                    $from = $k === 0 ? $w['start'] : $w['start'];
                    $to = isset($group[$k + 1]) ? $group[$k + 1]['start'] : $groupEnd;
                    $shown = $texts;
                    $shown[$k] = '{\\c'.$highlight.'\\fscx106\\fscy106}'.$texts[$k].'{\\c'.$color.'\\fscx100\\fscy100}';
                    $lines[] = 'Dialogue: 0,'.self::time($from).','.self::time(max($to, $from + 0.05)).',Cap,,0,0,0,,'.implode(' ', $shown);
                }
            } else {
                $lines[] = 'Dialogue: 0,'.self::time($group[0]['start']).','.self::time($groupEnd).',Cap,,0,0,0,,'.implode(' ', $texts);
            }
        }

        return $head.implode("\n", $lines)."\n";
    }

    /**
     * A few words at a time, breaking after a sentence and at a pause.
     *
     * @param  list<array{text: string, start: float, end: float}>  $words
     * @return list<list<array{text: string, start: float, end: float}>>
     */
    private static function groups(array $words, int $per): array
    {
        $groups = [];
        $current = [];
        foreach ($words as $i => $w) {
            if (trim($w['text']) === '') {
                continue;
            }
            $current[] = $w;
            $gap = isset($words[$i + 1]) ? $words[$i + 1]['start'] - $w['end'] : 0;
            if (count($current) >= $per || preg_match('/[.!?,;:]["”]?$/u', $w['text']) || $gap > 0.6) {
                $groups[] = $current;
                $current = [];
            }
        }
        if ($current) {
            $groups[] = $current;
        }

        return $groups;
    }

    private static function clean(string $text): string
    {
        return str_replace(['{', '}', '\\'], ['(', ')', ''], trim($text));
    }

    private static function time(float $t): string
    {
        $t = max(0, $t);
        $h = (int) floor($t / 3600);
        $m = (int) floor(($t - $h * 3600) / 60);
        $s = $t - $h * 3600 - $m * 60;

        return sprintf('%d:%02d:%05.2f', $h, $m, $s);
    }

    /** #rrggbb → &H00bbggrr */
    public static function color(string $hex): string
    {
        $hex = ltrim($hex, '#');
        if (! preg_match('/^[0-9a-fA-F]{6}$/', $hex)) {
            $hex = 'ffffff';
        }

        return '&H00'.strtoupper(substr($hex, 4, 2).substr($hex, 2, 2).substr($hex, 0, 2));
    }
}

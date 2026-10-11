<?php

namespace App\Services\Sound;

/**
 * Word-by-word captions for a reel, as an ASS subtitle file that ffmpeg burns in.
 *
 *   bold       a few big words at a time; the word being said lights up in the accent colour
 *   editorial  a page of serif text you read along with: said words in ink, the rest faint
 *   pulse      one clean line at the bottom, under the visualiser
 *
 * Every word arrives with its own start and end (from the voice, or from a transcript), so the
 * captions follow the speech exactly.
 */
final class Captions
{
    public const W = 1080;

    public const H = 1920;

    /**
     * @param  list<array{text: string, start: float, end: float}>  $words
     * The bold style also takes the highlight editor's choices: font, size, color, highlight
     * (null: no highlighted word), outline, backdrop (outline, box, shadow, none), uppercase and
     * max_words.
     *
     * @param  array{accent: string, ink?: string, title?: string|null, title_seconds?: float, text_y?: int, layout?: string, font?: string, title_font?: string, italic?: bool, size?: int, color?: string, highlight?: string|null, outline?: string, backdrop?: string, uppercase?: bool, max_words?: int}  $look
     */
    public static function ass(array $words, string $style, array $look, float $duration): string
    {
        // The word being said takes a lighter tint of the accent, so it lifts off any background,
        // including a gradient made from the accent itself. A chosen highlight is used as it is.
        $accent = array_key_exists('highlight', $look)
            ? ($look['highlight'] ? self::tag(self::color($look['highlight'])) : '')
            : self::tag(self::color(self::lighten($look['accent'], 0.3)));
        $ink = self::color($look['ink'] ?? '#121212');
        $titleFont = $look['title_font'] ?? 'Geist ExtraBold';
        $styles = [
            // Name, Font, Size, Primary, Secondary, Outline, Back, Bold, Italic, Underline, Strike, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
            'Bold' => self::boldStyle($look),
            'Line' => 'Geist SemiBold,62,&H00FFFFFF,&H00FFFFFF,&H9A000000,&H00000000,0,0,0,0,100,100,0,0,1,5,0,5,90,90,0',
            'Page' => "Instrument Serif,96,{$ink},{$ink},&H00000000,&H00000000,0,1,0,0,100,100,0,0,1,0,0,5,90,90,0",
            'Title' => "{$titleFont},64,&H00FFFFFF,&H00FFFFFF,&H9A000000,&H00000000,0,0,0,0,100,100,0,0,1,6,0,8,90,90,0",
            'Kicker' => "Geist Mono Medium,34,{$ink},{$ink},&H00000000,&H00000000,0,0,0,0,100,100,2,0,1,0,0,7,90,90,0",
        ];
        $out = "[Script Info]\nScriptType: v4.00+\nPlayResX: ".self::W."\nPlayResY: ".self::H."\nWrapStyle: 0\nScaledBorderAndShadow: yes\nYCbCr Matrix: TV.709\n\n";
        $out .= "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n";
        foreach ($styles as $name => $def) {
            $out .= "Style: {$name},{$def},1\n";
        }
        $out .= "\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";

        $lines = match ($style) {
            'editorial' => self::pages($words, $ink, $look),
            'pulse' => self::phrases($words, 4, 26, 'Line', $accent, 1665, false, dim: true),
            default => self::phrases(
                ($look['uppercase'] ?? false) ? array_map(fn ($w) => [...$w, 'text' => mb_strtoupper((string) $w['text'])], $words) : $words,
                $maxWords = max(1, (int) ($look['max_words'] ?? 3)),
                $maxChars = self::lineChars($maxWords, (int) ($look['size'] ?? 94)),
                'Bold', $accent, (int) ($look['text_y'] ?? 1130), true,
                wrap: (int) ($look['wrap_chars'] ?? $maxChars * 2),
            ),
        };

        if (filled($look['title'] ?? null)) {
            $until = min($duration, (float) ($look['title_seconds'] ?? 3.2));
            if ($style === 'editorial') {
                [$text, $rtl] = self::runs(mb_strtoupper((string) $look['title']), 34);
                $lines[] = self::event(0, $until, 'Kicker', '{\fad(200,300)'.($rtl ? '\q2' : '').'\pos(90,'.((int) ($look['kicker_y'] ?? 1180)).')}'.$text, 2);
            } else {
                [$text, $rtl] = self::runs((string) $look['title'], (int) ($look['title_wrap_chars'] ?? 24));
                $lines[] = self::event(0, $until, 'Title', '{\fad(250,350)'.($rtl ? '\q2' : '').'\pos(540,250)}'.$text, 2);
            }
        }

        return $out.implode("\n", $lines)."\n";
    }

    /** The bold style's line: Geist ExtraBold, white, a soft dark outline, unless the look says otherwise. */
    private static function boldStyle(array $look): string
    {
        $font = str_replace(',', ' ', (string) ($look['font'] ?? 'Geist ExtraBold'));
        $size = max(20, (int) ($look['size'] ?? 94));
        $fill = self::color($look['color'] ?? '#ffffff');
        // An outline or a shadow is a little see-through. A box is solid: libass boxes each run
        // (each word, see run()), and see-through boxes would show where they overlap.
        $edge = substr(self::color($look['outline'] ?? '#000000'), 4);
        [$outline, $back, $border, $width, $shadow] = match ($look['backdrop'] ?? 'outline') {
            'box' => ["&H00{$edge}", "&H00{$edge}", 3, (int) round($size * 0.16), 0],
            'shadow' => ['&H00000000', "&H60{$edge}", 1, 0, (int) max(3, round($size * 0.06))],
            'none' => ['&H00000000', '&H00000000', 1, 0, 0],
            default => ["&H9A{$edge}", '&H00000000', 1, (int) max(2, round($size * 0.075)), 0],
        };
        $italic = ($look['italic'] ?? false) ? -1 : 0;
        $spacing = $font === 'Geist ExtraBold' ? -1 : 0;

        return "{$font},{$size},{$fill},{$fill},{$outline},{$back},0,{$italic},0,0,100,100,{$spacing},0,{$border},{$width},{$shadow},5,90,90,0";
    }

    /**
     * Each word its own run of styled text: the fill's alpha alternates between 0 and 1 (of 255),
     * which nobody can see. The libass ffmpeg uses here draws a run of several Arabic words with
     * some letters as boxes, and it doesn't put the words of a right-to-left line in order at all
     * (see order()); a word on its own it shapes right.
     */
    private static function run(int $i): string
    {
        return '{\1a'.($i % 2 ? '&H01&' : '&H00&').'}';
    }

    /**
     * A plain line (a title), each word its own run, in drawing order.
     *
     * @return array{0: string, 1: bool} the text, and whether it reads right to left
     */
    private static function runs(string $text, int $budget): array
    {
        $words = preg_split('/\s+/u', trim($text)) ?: [];

        return self::order(array_map(fn (string $w, int $i) => self::run($i).self::escape($w), $words, array_keys($words)), $words, $budget);
    }

    /**
     * Words in the order libass should draw them. It lays words out left to right in the order
     * they come, even Arabic, so a right-to-left line is written back to front. It's broken into
     * lines by hand first (the event gets \q2, no automatic wrapping), so the words that are read
     * first stay on the top line.
     *
     * @param  list<string>  $parts  the words with their tags, in reading order
     * @param  list<string>  $plain  the same words without tags
     * @return array{0: string, 1: bool} the text, and whether it reads right to left
     */
    private static function order(array $parts, array $plain, int $budget): array
    {
        if (! self::rtl(implode(' ', $plain))) {
            return [implode(' ', $parts), false];
        }
        $lines = [];
        $line = [];
        $chars = 0;
        foreach ($parts as $k => $part) {
            $length = mb_strlen($plain[$k]) + 1;
            if ($line && $chars + $length > $budget + 1) {
                $lines[] = $line;
                $line = [];
                $chars = 0;
            }
            $line[] = $part;
            $chars += $length;
        }
        if ($line) {
            $lines[] = $line;
        }

        return [implode('\N', array_map(fn (array $l) => implode(' ', array_reverse($l)), $lines)), true];
    }

    /** Mostly Arabic or Hebrew letters: the line reads right to left. */
    public static function rtl(string $text): bool
    {
        $letters = preg_match_all('/\p{L}/u', $text);
        $rtl = preg_match_all('/[\p{Arabic}\p{Hebrew}]/u', $text);

        return $letters > 0 && $rtl * 2 >= $letters;
    }

    /** How many characters a line of the bold style holds before it breaks: fewer for bigger text. */
    public static function lineChars(int $maxWords, int $size): int
    {
        return (int) max(4, round(max(16, $maxWords * 5) * 94 / max(20, $size)));
    }

    /**
     * Big words, a few at a time. Each word gets its own event: the phrase stays, the word
     * being said pops a little and takes the accent colour.
     *
     * @return list<string>
     */
    private static function phrases(array $words, int $maxWords, int $maxChars, string $styleName, string $accent, int $y, bool $pop, bool $dim = false, ?int $wrap = null): array
    {
        // How many characters fit across the frame, for breaking right-to-left lines by hand.
        $wrap ??= $maxChars * 2;
        $events = [];
        foreach (self::group($words, $maxWords, $maxChars) as $phrase) {
            $count = count($phrase['words']);
            foreach ($phrase['words'] as $i => $w) {
                $start = $i === 0 ? $phrase['start'] : $w['start'];
                $end = $i + 1 < $count ? $phrase['words'][$i + 1]['start'] : $phrase['end'];
                $parts = [];
                foreach ($phrase['words'] as $j => $other) {
                    $text = self::escape(self::clean($other['text']));
                    if ($j === $i) {
                        $grow = $pop ? '\t(0,90,\fscx116\fscy116)\t(90,190,\fscx108\fscy108)' : '';
                        // Dimmed lines read along in white; the others light the word in the accent.
                        $colour = $dim || $accent === '' ? '' : "\\1c{$accent}";
                        $parts[] = "{{$colour}{$grow}}{$text}{\\r}";
                    } else {
                        $parts[] = $dim ? "{\\1a&H70&}{$text}{\\r}" : self::run($j).$text;
                    }
                }
                [$text, $rtl] = self::order($parts, array_column($phrase['words'], 'text'), $wrap);
                $intro = ($i === 0 ? '\fad(70,0)' : '').($rtl ? '\q2' : '');
                $events[] = self::event($start, $end, $styleName, "{{$intro}\\pos(540,{$y})}".$text, 1);
            }
        }

        return $events;
    }

    /**
     * Editorial: a page of serif text you read along with. Words already said are in ink, the
     * rest wait faintly; a new page starts at the end of a sentence.
     *
     * @return list<string>
     */
    private static function pages(array $words, string $ink, array $look): array
    {
        $events = [];
        $y = (int) ($look['text_y'] ?? 1480);
        foreach (self::group($words, 14, 90, sentences: true) as $page) {
            $count = count($page['words']);
            // Break the page into lines of about 20 characters.
            $breaks = [];
            $line = 0;
            foreach ($page['words'] as $j => $w) {
                $len = mb_strlen($w['text']) + 1;
                if ($line > 0 && $line + $len > 21) {
                    $breaks[$j] = true;
                    $line = 0;
                }
                $line += $len;
            }
            foreach ($page['words'] as $i => $w) {
                $start = $i === 0 ? $page['start'] : $w['start'];
                $end = $i + 1 < $count ? $page['words'][$i + 1]['start'] : $page['end'];
                $rows = [[]];
                foreach ($page['words'] as $j => $other) {
                    if (isset($breaks[$j])) {
                        $rows[] = [];
                    }
                    // Alternating by one step keeps each word its own run (see run()).
                    $alpha = $j <= $i ? ($j % 2 ? '&H01&' : '&H00&') : ($j % 2 ? '&HC5&' : '&HC4&');
                    $rows[array_key_last($rows)][] = "{\\1a{$alpha}}".self::escape($other['text']);
                }
                // A right-to-left page is written back to front, line by line (see order()).
                $rtl = self::rtl(implode(' ', array_column($page['words'], 'text')));
                $text = implode('\N', array_map(fn (array $row) => implode(' ', $rtl ? array_reverse($row) : $row), $rows));
                $intro = ($i === 0 ? '\fad(160,0)' : '').($rtl ? '\q2' : '');
                $events[] = self::event($start, $end, 'Page', "{{$intro}\\an5\\pos(540,{$y})}{$text}", 1);
            }
        }

        return $events;
    }

    /**
     * Words into phrases: a few at a time, breaking at punctuation and at pauses.
     *
     * @return list<array{words: list<array>, start: float, end: float}>
     */
    private static function group(array $words, int $maxWords, int $maxChars, bool $sentences = false): array
    {
        $groups = [];
        $current = [];
        $chars = 0;
        foreach ($words as $k => $w) {
            $text = trim((string) $w['text']);
            if ($text === '') {
                continue;
            }
            $current[] = ['text' => $text, 'start' => (float) $w['start'], 'end' => (float) $w['end']];
            $chars += mb_strlen($text) + 1;
            $next = $words[$k + 1] ?? null;
            $pause = $next ? (float) $next['start'] - (float) $w['end'] : 1.0;
            $stop = $sentences ? preg_match('/[.!?…]["”»)]*$/u', $text) : preg_match('/[.,!?;:…]["”»)]*$/u', $text);
            $full = count($current) >= $maxWords || ($chars >= $maxChars && count($current) >= 2);
            if ($full || ($stop && (! $sentences || count($current) >= 6)) || $pause > 0.55) {
                $groups[] = $current;
                $current = [];
                $chars = 0;
            }
        }
        if ($current) {
            $groups[] = $current;
        }

        // Each phrase stays up until the next one starts, if that's soon: no flicker between them.
        $out = [];
        foreach ($groups as $i => $g) {
            $end = end($g)['end'];
            $nextStart = isset($groups[$i + 1]) ? $groups[$i + 1][0]['start'] : null;
            if ($nextStart !== null && $nextStart - $end < 0.6) {
                $end = $nextStart;
            } else {
                $end += 0.25;
            }
            $out[] = ['words' => $g, 'start' => $g[0]['start'], 'end' => $end];
        }

        return $out;
    }

    /** Captions drop commas and full stops; questions and exclamations keep theirs. */
    private static function clean(string $word): string
    {
        return preg_replace('/[.,;:…]+(["”»)]*)$/u', '$1', $word) ?: $word;
    }

    private static function event(float $start, float $end, string $style, string $text, int $layer): string
    {
        return "Dialogue: {$layer},".self::time($start).','.self::time(max($end, $start + 0.05)).",{$style},,0,0,0,,{$text}";
    }

    private static function time(float $s): string
    {
        $cs = (int) round($s * 100);

        return sprintf('%d:%02d:%02d.%02d', intdiv($cs, 360000), intdiv($cs, 6000) % 60, intdiv($cs, 100) % 60, $cs % 100);
    }

    /** #RRGGBB → &H00BBGGRR, the way an ASS style writes colours. */
    public static function color(string $hex): string
    {
        $hex = ltrim($hex, '#');
        if (! preg_match('/^[0-9a-fA-F]{6}$/', $hex)) {
            $hex = 'FFFFFF';
        }

        return '&H00'.strtoupper(substr($hex, 4, 2).substr($hex, 2, 2).substr($hex, 0, 2));
    }

    private static function lighten(string $hex, float $t): string
    {
        $hex = ltrim($hex, '#');
        if (! preg_match('/^[0-9a-fA-F]{6}$/', $hex)) {
            return '#ffffff';
        }
        [$r, $g, $b] = array_map('hexdec', str_split($hex, 2));

        return sprintf('#%02x%02x%02x', (int) round($r + (255 - $r) * $t), (int) round($g + (255 - $g) * $t), (int) round($b + (255 - $b) * $t));
    }

    /** The same colour for an inline \1c tag: &HBBGGRR&. */
    private static function tag(string $styleColor): string
    {
        return '&H'.substr($styleColor, 4).'&';
    }

    private static function escape(string $text): string
    {
        // Braces open override blocks and a backslash starts a tag: neither may come from a word.
        return str_replace(['\\', '{', '}'], ['/', '(', ')'], $text);
    }
}

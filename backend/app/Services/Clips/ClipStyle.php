<?php

namespace App\Services\Clips;

use App\Services\Sound\Captions;
use Illuminate\Validation\Rule;

/**
 * How a highlight's subtitles look, and the music under it: what the editor saves in a clip's
 * settings, with defaults that match a fresh render.
 */
final class ClipStyle
{
    public const BACKDROPS = ['outline', 'box', 'shadow', 'none'];

    /** @return array<string, mixed> */
    public static function defaults(string $accent = '#a5b4fc', string $sourceType = 'youtube', bool $arabic = false): array
    {
        return [
            'captions' => true,
            'font' => $arabic ? ClipFonts::ARABIC_DEFAULT : 'bold',
            'size' => 94,
            'color' => '#ffffff',
            'highlight' => self::lighten($accent, 0.3),
            'outline' => '#000000',
            'backdrop' => 'outline',
            'uppercase' => false,
            'words' => 3,
            // Where the middle of the subtitles sits, from the top (0) to the bottom (1).
            'y' => $sourceType === 'youtube' ? 0.724 : 0.589,
            'title' => true,
            'title_text' => null,
        ];
    }

    /** @return array<string, mixed> */
    public static function musicDefaults(): array
    {
        return ['asset_id' => null, 'volume' => 0.25, 'original' => 1.0];
    }

    /** @return array<string, list<mixed>> */
    public static function rules(): array
    {
        $hex = 'regex:/^#[0-9a-fA-F]{6}$/';

        return [
            'style' => ['sometimes', 'array'],
            'style.captions' => ['sometimes', 'boolean'],
            'style.font' => ['sometimes', Rule::in(array_keys(ClipFonts::FONTS))],
            'style.size' => ['sometimes', 'integer', 'min:40', 'max:180'],
            'style.color' => ['sometimes', $hex],
            'style.highlight' => ['sometimes', 'nullable', $hex],
            'style.outline' => ['sometimes', $hex],
            'style.backdrop' => ['sometimes', Rule::in(self::BACKDROPS)],
            'style.uppercase' => ['sometimes', 'boolean'],
            'style.words' => ['sometimes', 'integer', 'min:1', 'max:6'],
            'style.y' => ['sometimes', 'numeric', 'min:0.06', 'max:0.94'],
            'style.title' => ['sometimes', 'boolean'],
            'style.title_text' => ['sometimes', 'nullable', 'string', 'max:80'],
            'music' => ['sometimes', 'array'],
            'music.asset_id' => ['sometimes', 'nullable', 'integer'],
            'music.volume' => ['sometimes', 'numeric', 'min:0', 'max:1'],
            'music.original' => ['sometimes', 'numeric', 'min:0', 'max:1.5'],
            'words' => ['sometimes', 'array', 'max:3000'],
            // A word emptied in the editor is dropped, not refused.
            'words.*.text' => ['present', 'nullable', 'string', 'max:60'],
            'words.*.start' => ['required', 'numeric', 'min:0', 'max:600'],
            'words.*.end' => ['required', 'numeric', 'min:0', 'max:600'],
        ];
    }

    /**
     * A saved style over the defaults, keeping only known keys.
     *
     * @return array<string, mixed>
     */
    public static function resolve(?array $saved, string $accent, string $sourceType, bool $arabic = false): array
    {
        $defaults = self::defaults($accent, $sourceType, $arabic);

        return [...$defaults, ...array_intersect_key($saved ?? [], $defaults)];
    }

    /** Mostly Arabic words: they get a font that has Arabic letters. */
    public static function arabic(array $words): bool
    {
        $count = count($words);
        $arabic = count(array_filter($words, fn ($w) => preg_match('/\p{Arabic}/u', (string) ($w['text'] ?? ''))));

        return $count > 0 && $arabic * 2 >= $count;
    }

    /** @return array<string, mixed> */
    public static function resolveMusic(?array $saved): array
    {
        $defaults = self::musicDefaults();

        return [...$defaults, ...array_intersect_key($saved ?? [], $defaults)];
    }

    /**
     * The style as Captions::ass reads it.
     *
     * @return array<string, mixed>
     */
    public static function look(array $style, ?string $fallbackTitle, float $seconds): array
    {
        $font = (string) $style['font'];
        $title = $style['title'] ? (trim((string) ($style['title_text'] ?? '')) ?: $fallbackTitle) : null;
        $size = (int) round((int) $style['size'] * ClipFonts::scale($font));
        // About how many characters fit in the 900 px between the margins: a character is about
        // half an em wide, and the em is the size times the font's em factor (see ClipFonts::em).
        $fits = fn (int $px) => (int) max(6, floor(900 / max(1, $px * ClipFonts::em($font) * 0.5)));

        return [
            'accent' => $style['highlight'] ?: '#ffffff',
            'font' => ClipFonts::family($font),
            'italic' => $font === 'serif',
            'size' => $size,
            'wrap_chars' => $fits($size),
            'title_wrap_chars' => $fits(64),
            'color' => $style['color'],
            'highlight' => $style['highlight'] ?: null,
            'outline' => $style['outline'],
            'backdrop' => $style['backdrop'],
            'uppercase' => (bool) $style['uppercase'],
            'max_words' => (int) $style['words'],
            'text_y' => (int) round((float) $style['y'] * Captions::H),
            'title' => $title ? mb_substr($title, 0, 60) : null,
            'title_font' => ClipFonts::family($font),
            'title_seconds' => min(3.2, $seconds),
        ];
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
}

<?php

namespace App\Services\Clips;

/**
 * The fonts a highlight's subtitles can use: the assistant's font library (assistant/fonts),
 * copied into resources/fonts so ffmpeg's subtitle burner finds them. The editor previews each
 * one from the same file it's burned with.
 */
final class ClipFonts
{
    /** key => [file, family as libass knows it, label, style, scale] */
    public const FONTS = [
        'bold' => ['Geist-ExtraBold.ttf', 'Geist ExtraBold', 'Geist Bold', 'modern', 1.0],
        'semibold' => ['Geist-SemiBold.ttf', 'Geist SemiBold', 'Geist Semi', 'modern', 1.0],
        'montserrat' => ['Montserrat-ExtraBold.ttf', 'Montserrat ExtraBold', 'Montserrat', 'modern', 1.0],
        'poppins' => ['Poppins-SemiBold.ttf', 'Poppins SemiBold', 'Poppins', 'modern', 1.0],
        'syne' => ['Syne-Bold.ttf', 'Syne', 'Syne', 'modern', 1.0],
        'anton' => ['Anton-Regular.ttf', 'Anton', 'Anton', 'poster', 0.95],
        'bebas' => ['BebasNeue-Regular.ttf', 'Bebas Neue', 'Bebas Neue', 'poster', 1.05],
        'archivo' => ['ArchivoBlack-Regular.ttf', 'Archivo Black', 'Archivo Black', 'poster', 1.0],
        'serif' => ['InstrumentSerif-Italic.ttf', 'Instrument Serif', 'Instrument Serif', 'elegant', 1.1],
        'playfair' => ['PlayfairDisplay-Bold.ttf', 'Playfair Display', 'Playfair Display', 'elegant', 1.0],
        'dm-serif' => ['DMSerifDisplay-Regular.ttf', 'DM Serif Display', 'DM Serif', 'elegant', 1.05],
        'cormorant' => ['CormorantGaramond-SemiBold.ttf', 'Cormorant Garamond SemiBold', 'Cormorant', 'elegant', 1.2],
        'fraunces' => ['Fraunces-SemiBold.ttf', 'Fraunces SemiBold', 'Fraunces', 'elegant', 1.0],
        'caveat' => ['Caveat-Bold.ttf', 'Caveat', 'Caveat', 'handwritten', 1.15],
        'pacifico' => ['Pacifico-Regular.ttf', 'Pacifico', 'Pacifico', 'handwritten', 0.95],
        'dancing' => ['DancingScript-Bold.ttf', 'Dancing Script', 'Dancing Script', 'handwritten', 1.15],
        'great-vibes' => ['GreatVibes-Regular.ttf', 'Great Vibes', 'Great Vibes', 'handwritten', 1.25],
        'fredoka' => ['Fredoka-SemiBold.ttf', 'Fredoka SemiBold', 'Fredoka', 'playful', 1.0],
        'lilita' => ['LilitaOne-Regular.ttf', 'Lilita One', 'Lilita One', 'playful', 1.0],
        'righteous' => ['Righteous-Regular.ttf', 'Righteous', 'Righteous', 'retro', 1.0],
        'abril' => ['AbrilFatface-Regular.ttf', 'Abril Fatface', 'Abril Fatface', 'retro', 1.0],
        'typewriter' => ['SpecialElite-Regular.ttf', 'Special Elite', 'Special Elite', 'retro', 1.0],
        'mono' => ['GeistMono-Medium.ttf', 'Geist Mono Medium', 'Geist Mono', 'mono', 1.0],
        'space-mono' => ['SpaceMono-Bold.ttf', 'Space Mono', 'Space Mono', 'mono', 1.0],
        // Arabic and Latin both (Noto and Amiri, OFL). The fonts above have no Arabic letters, so
        // Arabic words in them fall back to a plain system font. Only fonts the server's libass
        // draws whole are here: IBM Plex Sans Arabic, Tajawal, Almarai, Cairo, Changa, Lalezar and
        // Rakkas put a box in some letters (لا, a final س), and Harmattan, Jomhuria and Aref Ruqaa
        // draw nothing at all.
        // Their tall line metrics make them small at a given size, hence the larger scales.
        'noto-arabic' => ['NotoSansArabic-ExtraBold.ttf', 'Noto Sans Arabic ExtraBold', 'Noto Sans Arabic', 'arabic', 1.45],
        'kufi' => ['NotoKufiArabic-Bold.ttf', 'Noto Kufi Arabic', 'Noto Kufi', 'arabic', 1.4],
        'naskh' => ['NotoNaskhArabic-Bold.ttf', 'Noto Naskh Arabic', 'Noto Naskh', 'arabic', 1.45],
        'amiri' => ['Amiri-Bold.ttf', 'Amiri', 'Amiri', 'arabic', 1.9],
    ];

    /** The font for transcripts in Arabic. */
    public const ARABIC_DEFAULT = 'noto-arabic';

    public static function has(string $key): bool
    {
        return isset(self::FONTS[$key]);
    }

    public static function family(string $key): string
    {
        return (self::FONTS[$key] ?? self::FONTS['bold'])[1];
    }

    /** Fonts drawn bigger or smaller, so every font looks about the same size at the same setting. */
    public static function scale(string $key): float
    {
        return (self::FONTS[$key] ?? self::FONTS['bold'])[4];
    }

    public static function path(string $key): ?string
    {
        return isset(self::FONTS[$key]) ? resource_path('fonts/'.self::FONTS[$key][0]) : null;
    }

    /** @return list<array{key: string, label: string, style: string, scale: float, em: float, url: string}> */
    public static function catalog(): array
    {
        return collect(self::FONTS)->map(fn (array $f, string $key) => [
            'key' => $key,
            'label' => $f[2],
            'style' => $f[3],
            'scale' => $f[4],
            'em' => self::em($key),
            'url' => "/api/clips/fonts/{$key}",
        ])->values()->all();
    }

    /**
     * How big the font's em is for each pixel of subtitle size. libass (like VSFilter) makes the
     * font's Windows ascent + descent equal the size, where a browser makes the em equal it, so
     * the preview draws size × em to match the burned video.
     */
    public static function em(string $key): float
    {
        static $cache = [];

        return $cache[$key] ??= (function () use ($key) {
            $data = @file_get_contents((string) self::path($key));
            if (! $data || strlen($data) < 12) {
                return 1.0;
            }
            $tables = [];
            $count = unpack('n', $data, 4)[1];
            for ($i = 0; $i < $count; $i++) {
                $record = unpack('a4tag/Nsum/Noffset/Nlength', $data, 12 + 16 * $i);
                $tables[$record['tag']] = $record['offset'];
            }
            if (! isset($tables['head'], $tables['OS/2'])) {
                return 1.0;
            }
            $upm = unpack('n', $data, $tables['head'] + 18)[1];
            [, $ascent, $descent] = unpack('n2', $data, $tables['OS/2'] + 74);

            return $upm > 0 && $ascent + $descent > 0 ? round($upm / ($ascent + $descent), 4) : 1.0;
        })();
    }
}

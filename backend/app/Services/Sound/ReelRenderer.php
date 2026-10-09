<?php

namespace App\Services\Sound;

use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Renders a vertical reel (1080 × 1920, 30 fps) with ffmpeg: a background, the voice, music that
 * ducks under the voice, a waveform, and captions that follow every word.
 *
 *   bold       full-bleed photo or video (or a living gradient), big words that light up
 *   editorial  a magazine page: the photo on top, serif text you read along with below
 *   pulse      an audiogram: gradient, the photo as a cover, a large waveform, one caption line
 */
class ReelRenderer
{
    public const STYLES = ['bold', 'editorial', 'pulse'];

    public const MAX_SECONDS = 90;

    private const W = 1080;

    private const H = 1920;

    /**
     * @param  array{voice?: string|null, words?: list<array{text: string, start: float, end: float}>, music?: string|null, music_volume?: float, background?: string|null, background_kind?: string|null, style?: string, accent?: string, title?: string|null, handle?: string|null, seconds?: float|null, captions?: bool}  $o
     * @return string the rendered MP4's path; the caller removes it
     */
    public function render(array $o, AudioTools $tools): string
    {
        $style = in_array($o['style'] ?? null, self::STYLES, true) ? $o['style'] : 'bold';
        $accent = preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($o['accent'] ?? '')) ? $o['accent'] : '#a5b4fc';
        $voice = $o['voice'] ?? null;
        $music = $o['music'] ?? null;
        if (! $voice && ! $music) {
            throw new RuntimeException('A reel needs a voice or music.');
        }

        $length = $voice ? ($tools->duration($voice) ?? 0) + 0.7 : (float) ($o['seconds'] ?? min(30, ($tools->duration($music) ?? 30)));
        $length = round(max(3, min(self::MAX_SECONDS, $length)), 2);
        $dir = sys_get_temp_dir().'/reel-'.Str::random(12);
        File::ensureDirectoryExists($dir);

        try {
            $words = ($o['captions'] ?? true) ? ($o['words'] ?? []) : [];
            $photo = ($o['background_kind'] ?? null) === 'image' ? ($o['background'] ?? null) : null;
            $film = ($o['background_kind'] ?? null) === 'video' ? ($o['background'] ?? null) : null;
            $look = [
                'accent' => $accent,
                'title' => $o['title'] ?? null,
                'title_seconds' => $voice ? 3.2 : $length,
                'text_y' => match ($style) {
                    'editorial' => $photo || $film ? 1500 : 980,
                    default => 1130,
                },
                'kicker_y' => $photo || $film ? 1215 : 560,
            ];
            file_put_contents("{$dir}/captions.ass", Captions::ass($words, $style, $look, $length));
            if ($style === 'bold') {
                $this->shade("{$dir}/shade.png");
            }
            // Everything that doesn't move is made once, here, not on every frame.
            $stills = $this->stills($style, $photo, $dir, $accent);

            [$inputs, $graph] = $this->graph($style, $length, $accent, $stills, $film, $voice, $music, (float) ($o['music_volume'] ?? 0.32), $dir, $o['handle'] ?? null);
            $out = "{$dir}/reel.mp4";
            $run = Process::timeout(900)->run([
                'ffmpeg', '-y', '-v', 'error', ...$inputs,
                '-filter_complex', $graph, '-map', '[v]', '-map', '[a]',
                '-t', (string) $length, '-r', '30',
                // A short lookahead keeps the encoder's memory small on a shared box.
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-x264-params', 'rc-lookahead=12:ref=2', '-threads', '2',
                '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', $out,
            ]);
            if (! $run->successful() || ! is_file($out)) {
                throw new RuntimeException('The reel didn’t render: '.Str::limit(trim($run->errorOutput()), 400));
            }
            $final = tempnam(sys_get_temp_dir(), 'reel').'.mp4';
            rename($out, $final);

            return $final;
        } finally {
            File::deleteDirectory($dir);
        }
    }

    /**
     * The inputs and the filter graph for a style.
     *
     * @return array{0: list<string>, 1: string}
     */
    private function graph(string $style, float $d, string $accent, array $stills, ?string $film, ?string $voice, ?string $music, float $musicVolume, string $dir, ?string $handle): array
    {
        $inputs = [];
        $n = 0;
        $add = function (array $args) use (&$inputs, &$n): int {
            array_push($inputs, ...$args);

            return $n++;
        };
        $loop = fn (string $png) => $add(['-loop', '1', '-framerate', '30', '-t', (string) $d, '-i', $png]);
        $fonts = resource_path('fonts');
        $glow = $this->mix($accent, '#ffffff', 0.25);
        $photo = $stills['photo'] ?? null;
        $background = 'bg';
        $f = [];

        // ---------------------------------------------------------------- background
        if ($style === 'editorial') {
            $paper = $loop($stills['paper']);
            $f[] = "[{$paper}:v]format=yuv420p[paper]";
            if ($photo) {
                $media = $loop($photo);
                $f[] = "[{$media}:v]".$this->drift(1000, 1000, $d).'[photo]';
                $f[] = '[paper][photo]overlay=40:150[bg]';
            } elseif ($film) {
                $media = $add(['-stream_loop', '-1', '-t', (string) $d, '-i', $film]);
                $f[] = "[{$media}:v]scale=1000:1000:force_original_aspect_ratio=increase,crop=1000:1000,fps=30,setsar=1[photo]";
                $f[] = '[paper][photo]overlay=40:150[bg]';
            } else {
                $f[] = '[paper]null[bg]';
            }
        } elseif ($style === 'pulse' && $photo) {
            $blur = $loop($stills['blur']);
            $cover = $loop($photo);
            $f[] = "[{$blur}:v]format=yuv420p[blur]";
            $f[] = "[{$cover}:v]pad=772:772:6:6:color=0x{$this->hex($glow)}[cover]";
            $f[] = '[blur][cover]overlay=154:330[bg]';
        } elseif ($photo) {
            $media = $loop($photo);
            $f[] = "[{$media}:v]".$this->drift(self::W, self::H, $d).',format=yuv420p[bg]';
        } elseif ($film) {
            $media = $add(['-stream_loop', '-1', '-t', (string) $d, '-i', $film]);
            $f[] = "[{$media}:v]scale=".self::W.':'.self::H.':force_original_aspect_ratio=increase,crop='.self::W.':'.self::H.',fps=30,eq=brightness=-0.05:saturation=1.08,setsar=1,format=yuv420p[bg]';
            if ($style === 'bold') {
                $shade = $loop("{$dir}/shade.png");
                $f[] = "[{$shade}:v]format=rgba[shade]";
                $f[] = '[bg][shade]overlay=0:0[bgs]';
                $background = 'bgs';
            }
        } else {
            // A living gradient, made small and scaled up: it's smooth, so nobody can tell. Each
            // reel turns its own way.
            $seed = crc32($dir) % 100000;
            $c0 = $this->mix($accent, '#040406', 0.9);
            $c1 = $this->mix($accent, '#040406', 0.72);
            $c2 = $this->mix($accent, '#040406', 0.56);
            $grad = $add(['-f', 'lavfi', '-t', (string) $d, '-i', "gradients=s=270x480:r=30:n=3:c0=0x{$this->hex($c0)}:c1=0x{$this->hex($c1)}:c2=0x{$this->hex($c2)}:x0=0:y0=0:x1=270:y1=480:speed=0.005:seed={$seed}"]);
            $f[] = "[{$grad}:v]scale=".self::W.':'.self::H.':flags=bicubic,format=yuv420p[bg]';
        }
        $last = $background;

        // ---------------------------------------------------------------- sound
        $v = $voice ? $add(['-i', $voice]) : null;
        $m = $music ? $add(['-stream_loop', '-1', '-i', $music]) : null;
        $fadeOut = max(0, $d - 1.6);
        if ($v !== null && $m !== null) {
            $f[] = "[{$v}:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={$d},asplit=3[vx][vside][vwave]";
            $f[] = "[{$m}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{$d},asetpts=N/SR/TB,volume={$musicVolume},afade=t=in:d=0.4,afade=t=out:st={$fadeOut}:d=1.6[mx]";
            // The music steps aside whenever the voice speaks, then comes back up.
            $f[] = '[mx][vside]sidechaincompress=threshold=0.015:ratio=9:attack=12:release=380:makeup=1[duck]';
            $f[] = '[vx][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]';
            $wave = 'vwave';
        } elseif ($v !== null) {
            $f[] = "[{$v}:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur={$d},asplit=2[vx][vwave]";
            $f[] = '[vx]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]';
            $wave = 'vwave';
        } else {
            $f[] = "[{$m}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{$d},asetpts=N/SR/TB,afade=t=in:d=0.3,afade=t=out:st={$fadeOut}:d=1.6,asplit=2[mx][mwave]";
            $f[] = '[mx]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]';
            $wave = 'mwave';
        }

        // ---------------------------------------------------------------- waveform
        [$ws, $wx, $wy, $wc, $wmode] = match ($style) {
            'editorial' => ['900x70', 90, $photo || $film ? 1765 : 1640, $this->hex($accent).'@0.95', 'line'],
            'pulse' => ['960x280', 60, $photo ? 1215 : 820, 'ffffff@0.92', 'cline'],
            default => ['860x110', 110, 1590, 'ffffff@0.55', 'cline'],
        };
        $f[] = "[{$wave}]showwaves=s={$ws}:mode={$wmode}:rate=30:colors=0x{$wc}:scale=sqrt:draw=full,format=rgba[wave]";
        $f[] = "[{$last}][wave]overlay={$wx}:{$wy}:shortest=1[waved]";
        $last = 'waved';

        // ---------------------------------------------------------------- accent mark, handle, captions
        if ($style === 'editorial') {
            $markY = $photo || $film ? 1180 : 520;
            $f[] = "[{$last}]drawbox=x=90:y={$markY}:w=72:h=6:color=0x{$this->hex($accent)}:t=fill[marked]";
            $last = 'marked';
        }
        if (filled($handle) && preg_match('/^@?[\w.\-]{1,60}$/u', (string) $handle)) {
            $text = '@'.ltrim((string) $handle, '@');
            $ink = $style === 'editorial' ? '0x121212@0.72' : 'white@0.82';
            $pos = $style === 'editorial' ? 'x=90:y=h-110' : 'x=(w-text_w)/2:y=h-128';
            $f[] = "[{$last}]drawtext=fontfile={$fonts}/GeistMono-Medium.ttf:text='{$text}':fontsize=32:fontcolor={$ink}:{$pos}[handled]";
            $last = 'handled';
        }
        $f[] = "[{$last}]subtitles=filename={$dir}/captions.ass:fontsdir={$fonts},fade=t=in:st=0:d=0.35,fade=t=out:st=".max(0, $d - 0.45).':d=0.45,setsar=1[v]';

        return [$inputs, implode(';', $f)];
    }

    /**
     * A slow drift across a prepared still: a crop that moves, which costs almost nothing per
     * frame (the still is made 10% larger than the box beforehand).
     */
    private function drift(int $w, int $h, float $d): string
    {
        return "crop={$w}:{$h}:x='(iw-{$w})/2+(iw-{$w})/2*sin(2*PI*t/".max(8, $d * 1.7).")':y='(ih-{$h})*t/{$d}',setsar=1";
    }

    /**
     * The stills a style needs, made once: the photo at the size it drifts across (with the
     * caption shade baked in for bold), a blurred backdrop for pulse, paper for editorial.
     *
     * @return array{photo?: string, blur?: string, paper?: string}
     */
    private function stills(string $style, ?string $photo, string $dir, string $accent): array
    {
        $out = [];
        $once = function (array $args, string $file) use ($dir): string {
            $run = Process::timeout(120)->run(['ffmpeg', '-y', '-v', 'error', ...$args, '-frames:v', '1', "{$dir}/{$file}"]);
            if (! $run->successful()) {
                throw new RuntimeException('Couldn’t prepare the background: '.Str::limit(trim($run->errorOutput()), 300));
            }

            return "{$dir}/{$file}";
        };
        if ($style === 'editorial') {
            $out['paper'] = $once(['-f', 'lavfi', '-i', 'color=c=0xECEBE6:s='.self::W.'x'.self::H, '-vf', 'noise=alls=6:allf=u'], 'paper.png');
        }
        if (! $photo) {
            return $out;
        }
        $out['photo'] = match ($style) {
            'editorial' => $once(['-i', $photo, '-vf', 'scale=1100:1100:force_original_aspect_ratio=increase,crop=1100:1100,eq=saturation=0.92'], 'photo.png'),
            'pulse' => $once(['-i', $photo, '-vf', 'scale=760:760:force_original_aspect_ratio=increase,crop=760:760'], 'photo.png'),
            default => $once(['-i', $photo, '-i', "{$dir}/shade.png", '-filter_complex', '[0:v]scale=1188:2112:force_original_aspect_ratio=increase,crop=1188:2112,eq=brightness=-0.04:saturation=1.08[p];[1:v]scale=1188:2112[s];[p][s]overlay=0:0'], 'photo.png'),
        };
        if ($style === 'pulse') {
            $out['blur'] = $once(['-i', $photo, '-vf', 'scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=12,scale='.self::W.':'.self::H.':flags=bicubic,eq=brightness=-0.24:saturation=1.25'], 'blur.png');
        }

        return $out;
    }

    /** A gradient that darkens the lower half of the frame, so white captions read on any photo. */
    private function shade(string $png): void
    {
        $img = imagecreatetruecolor(self::W, self::H);
        imagesavealpha($img, true);
        imagealphablending($img, false);
        for ($y = 0; $y < self::H; $y++) {
            $t = $y / self::H;
            $opacity = $t < 0.35 ? 0.18 * (1 - $t / 0.35) : min(0.78, ($t - 0.35) / 0.65 * 0.78);
            $alpha = (int) round(127 * (1 - $opacity));
            imageline($img, 0, $y, self::W - 1, $y, imagecolorallocatealpha($img, 0, 0, 0, $alpha));
        }
        imagepng($img, $png);
        imagedestroy($img);
    }

    private function mix(string $a, string $b, float $t): string
    {
        [$r1, $g1, $b1] = sscanf(ltrim($a, '#'), '%02x%02x%02x');
        [$r2, $g2, $b2] = sscanf(ltrim($b, '#'), '%02x%02x%02x');

        return sprintf('#%02x%02x%02x', (int) round($r1 + ($r2 - $r1) * $t), (int) round($g1 + ($g2 - $g1) * $t), (int) round($b1 + ($b2 - $b1) * $t));
    }

    private function hex(string $color): string
    {
        return ltrim($color, '#');
    }
}

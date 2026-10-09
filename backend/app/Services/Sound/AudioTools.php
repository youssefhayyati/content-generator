<?php

namespace App\Services\Sound;

use Illuminate\Support\Facades\Process;
use RuntimeException;

/**
 * The small ffmpeg jobs audio needs: store as MP3, hand Whisper 16 kHz mono, measure how long
 * something is, and draw a waveform for the library.
 */
class AudioTools
{
    /** Encode WAV (or anything ffmpeg reads) as MP3. */
    public function toMp3(string $contents, int $kbps = 192): string
    {
        return $this->convert($contents, ['-vn', '-c:a', 'libmp3lame', '-b:a', "{$kbps}k", '-ar', '44100'], 'mp3');
    }

    /** Any audio or video → 16 kHz mono WAV, what the listener wants. Long files are cut at $maxSeconds. */
    public function toListenWav(string $path, int $maxSeconds = 1800): string
    {
        $out = tempnam(sys_get_temp_dir(), 'listen').'.wav';
        $run = Process::timeout(600)->run(['ffmpeg', '-y', '-v', 'error', '-i', $path, '-t', (string) $maxSeconds, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', $out]);
        if (! $run->successful() || ! is_file($out)) {
            @unlink($out);
            throw new RuntimeException('Couldn’t read the audio: '.trim($run->errorOutput()));
        }
        $wav = (string) file_get_contents($out);
        @unlink($out);

        return $wav;
    }

    public function duration(string $path): ?float
    {
        $run = Process::timeout(30)->run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', $path]);

        return $run->successful() && is_numeric(trim($run->output())) ? round((float) trim($run->output()), 3) : null;
    }

    /**
     * The waveform as bars, for players that shouldn't download the whole file to draw it.
     *
     * @return list<float> $count values from 0 to 1
     */
    public function peaks(string $path, int $count = 96): array
    {
        $run = Process::timeout(120)->run(['ffmpeg', '-v', 'error', '-i', $path, '-ac', '1', '-ar', '2000', '-f', 's16le', '-acodec', 'pcm_s16le', '-']);
        $raw = $run->successful() ? $run->output() : '';
        $n = intdiv(strlen($raw), 2);
        if ($n < $count) {
            return array_fill(0, $count, 0.0);
        }
        $samples = unpack('s*', $raw);
        $per = intdiv($n, $count);
        $peaks = [];
        for ($i = 0; $i < $count; $i++) {
            $sum = 0;
            for ($j = 1 + $i * $per, $end = $j + $per; $j < $end; $j++) {
                $sum += $samples[$j] * $samples[$j];
            }
            $peaks[] = sqrt($sum / $per) / 32768;
        }
        $top = max($peaks) ?: 1;

        return array_map(fn (float $p) => round(min(1, ($p / $top) ** 0.7), 3), $peaks);
    }

    /** A waveform picture, for library thumbnails of audio. */
    public function waveform(string $path, string $png, string $color = '#a5b4fc'): bool
    {
        $color = '0x'.ltrim($color, '#');
        $run = Process::timeout(120)->run([
            'ffmpeg', '-y', '-v', 'error', '-i', $path, '-filter_complex',
            "color=c=0x0f0f11:s=720x720[bg];[0:a]aformat=channel_layouts=mono,showwavespic=s=600x260:colors={$color}:scale=sqrt:draw=full[w];[bg][w]overlay=60:230",
            '-frames:v', '1', $png,
        ]);

        return $run->successful() && is_file($png);
    }

    /**
     * @param  list<string>  $args
     */
    private function convert(string $contents, array $args, string $ext): string
    {
        $in = tempnam(sys_get_temp_dir(), 'snd');
        $out = $in.'.'.$ext;
        file_put_contents($in, $contents);
        $run = Process::timeout(300)->run(['ffmpeg', '-y', '-v', 'error', '-i', $in, ...$args, $out]);
        @unlink($in);
        if (! $run->successful() || ! is_file($out)) {
            @unlink($out);
            throw new RuntimeException('Couldn’t encode the audio: '.trim($run->errorOutput()));
        }
        $data = (string) file_get_contents($out);
        @unlink($out);

        return $data;
    }
}

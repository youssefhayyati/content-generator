<?php

namespace App\Services\Publishing;

use InvalidArgumentException;
use RuntimeException;

/**
 * The Android phones plugged into the machine: find them, watch their screen, drive them by
 * hand. It talks adb's own wire protocol to the adb server on the host (port 5037), so the
 * container needs no adb binary: Docker Desktop forwards host.docker.internal to the host's
 * localhost.
 */
class Adb
{
    /** The hardware keys the dashboard offers, as Android key codes. */
    public const KEYS = [
        'back' => 4, 'home' => 3, 'recents' => 187, 'power' => 26, 'wake' => 224,
        'volume_up' => 24, 'volume_down' => 25, 'enter' => 66, 'delete' => 67,
    ];

    public function __construct(
        private string $host = '',
        private int $port = 0,
    ) {
        $this->host = $host ?: config('publishing.adb.host');
        $this->port = $port ?: config('publishing.adb.port');
    }

    /**
     * Every phone the adb server sees. `state` is device (ready), unauthorized (the USB
     * debugging prompt is still waiting on the phone) or offline.
     *
     * @return list<array{serial: string, state: string, model: ?string, manufacturer: ?string, android: ?string}>
     *
     * @throws RuntimeException when the adb server can't be reached
     */
    public function devices(): array
    {
        $phones = [];
        foreach (preg_split('/\R/', trim($this->host('host:devices-l'))) as $line) {
            if (! preg_match('/^(\S+)\s+(\S+)(.*)$/', $line, $m)) {
                continue;
            }
            preg_match('/\bmodel:(\S+)/', $m[3], $model);
            $phone = ['serial' => $m[1], 'state' => $m[2], 'model' => isset($model[1]) ? str_replace('_', ' ', $model[1]) : null, 'manufacturer' => null, 'android' => null];

            if ($phone['state'] === 'device') {
                // Best effort: a phone that won't answer a getprop still gets listed.
                try {
                    [$maker, $android] = array_pad(preg_split('/\R/', trim($this->shell($m[1], 'getprop ro.product.manufacturer; getprop ro.build.version.release'))), 2, '');
                    $phone['manufacturer'] = $maker !== '' ? ucfirst($maker) : null;
                    $phone['android'] = $android !== '' ? $android : null;
                } catch (RuntimeException) {
                }
            }
            $phones[] = $phone;
        }

        return $phones;
    }

    /**
     * The phone's screen as a PNG, at most $maxWidth wide (full-size frames are megabytes).
     *
     * @return array{png: string, width: int, height: int} width/height are the phone's own pixels, the space taps are in
     */
    public function screenshot(string $serial, int $maxWidth = 540): array
    {
        // exec: (not shell:) keeps the bytes binary-clean: no terminal turning \n into \r\n.
        $png = $this->exec($serial, 'exec:screencap -p');
        $image = @imagecreatefromstring($png);
        if ($image === false) {
            throw new RuntimeException('The phone sent no screen. Is it unlocked and awake?');
        }

        $width = imagesx($image);
        $height = imagesy($image);
        if ($width > $maxWidth) {
            $small = imagescale($image, $maxWidth, (int) round($height * $maxWidth / $width));
            ob_start();
            imagepng($small, null, 6);
            $png = (string) ob_get_clean();
        }

        return ['png' => $png, 'width' => $width, 'height' => $height];
    }

    public function tap(string $serial, int $x, int $y): void
    {
        $this->shell($serial, "input tap {$x} {$y}");
    }

    /** A drag from one point to another; the same point held long is a long-press. */
    public function swipe(string $serial, int $x1, int $y1, int $x2, int $y2, int $ms): void
    {
        $this->shell($serial, "input swipe {$x1} {$y1} {$x2} {$y2} {$ms}");
    }

    public function key(string $serial, string $key): void
    {
        $code = self::KEYS[$key] ?? throw new InvalidArgumentException("Unknown key “{$key}”.");
        $this->shell($serial, "input keyevent {$code}");
    }

    /** Types into the focused field. `input text` only knows ASCII (see DECISIONS.md). */
    public function type(string $serial, string $text): void
    {
        if (! preg_match('/^[\x20-\x7E]*$/', $text)) {
            throw new InvalidArgumentException('Only plain ASCII text can be typed into the phone.');
        }
        // input text reads %s as a space; the single quotes keep the phone's shell out of it.
        $arg = "'".str_replace([' ', "'"], ['%s', "'\\''"], $text)."'";
        $this->shell($serial, "input text {$arg}");
    }

    /** A host service: one request, one length-prefixed reply. */
    private function host(string $service): string
    {
        $socket = $this->connect();
        try {
            $this->request($socket, $service);
            $length = hexdec($this->read($socket, 4));

            return $length > 0 ? $this->read($socket, $length) : '';
        } finally {
            fclose($socket);
        }
    }

    private function shell(string $serial, string $command): string
    {
        return $this->exec($serial, "shell:{$command}");
    }

    /** Switch the connection to one phone, run a service on it, read until it hangs up. */
    private function exec(string $serial, string $service): string
    {
        $socket = $this->connect();
        try {
            $this->request($socket, "host:transport:{$serial}");
            $this->request($socket, $service);

            return (string) stream_get_contents($socket);
        } finally {
            fclose($socket);
        }
    }

    /** @return resource */
    private function connect()
    {
        $socket = @fsockopen($this->host, $this->port, $code, $message, 2);
        if (! $socket) {
            throw new RuntimeException("No adb server at {$this->host}:{$this->port} ({$message}). Start it on the machine the phone is plugged into: adb start-server.");
        }
        stream_set_timeout($socket, 10);

        return $socket;
    }

    /** @param resource $socket */
    private function request($socket, string $service): void
    {
        fwrite($socket, sprintf('%04x', strlen($service)).$service);
        $status = $this->read($socket, 4);
        if ($status !== 'OKAY') {
            $length = hexdec($this->read($socket, 4));
            throw new RuntimeException(self::explain($length > 0 ? $this->read($socket, $length) : $status));
        }
    }

    /** adb's refusals, in words a person can act on. */
    public static function explain(string $error): string
    {
        return match (true) {
            (bool) preg_match("/device '.*' not found|no devices/", $error) => self::NOT_CONNECTED,
            str_contains($error, 'unauthorized') => 'The phone is asking to allow USB debugging. Tap Allow on its screen.',
            str_contains($error, 'offline') => 'The phone is connected but not answering. Unplug it and plug it back in.',
            default => "adb: {$error}",
        };
    }

    public const NOT_CONNECTED = 'This phone isn’t connected to this computer. Plug it in by USB (or reconnect it over Wi-Fi).';

    /** @param resource $socket */
    private function read($socket, int $bytes): string
    {
        $data = '';
        while (strlen($data) < $bytes && ! feof($socket)) {
            $chunk = fread($socket, $bytes - strlen($data));
            if ($chunk === false || ($chunk === '' && stream_get_meta_data($socket)['timed_out'])) {
                break;
            }
            $data .= $chunk;
        }
        if (strlen($data) < $bytes) {
            throw new RuntimeException('adb: the server hung up mid-reply.');
        }

        return $data;
    }
}

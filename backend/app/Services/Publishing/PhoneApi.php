<?php

namespace App\Services\Publishing;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use RuntimeException;

/**
 * The team's phone on the hackathon Phone API (PHONE_API_URL, the team key in PHONE_API_KEY):
 * its screen and its direct controls, for the Phones page's live view. The API drives the
 * phone through an input board of its own, so swipes go by direction and typing is ASCII only.
 * A phone is this one when its device ID is the API's (heracles-phone).
 */
class PhoneApi
{
    /** The dashboard's buttons the input board has. */
    public const KEYS = ['back' => 'back', 'home' => 'home', 'enter' => 'enter'];

    public function configured(): bool
    {
        return filled(config('publishing.phone_api.url')) && filled(config('publishing.phone_api.key'));
    }

    /** Whether this device ID is the API's phone. Never raises: an API that doesn't answer owns nothing. */
    public function owns(?string $ref): bool
    {
        if (! $ref || ! $this->configured()) {
            return false;
        }

        // Asked once a while: the page lists phones often, the phone's name never changes.
        $id = Cache::remember('phone-api.device', now()->addMinutes(10), function () {
            try {
                return (string) ($this->status(fresh: true)['device_id'] ?? '');
            } catch (RuntimeException) {
                return null; // not cached: asked again next time
            }
        });

        return $id !== null && $id !== '' && $id === $ref;
    }

    /**
     * online, ble_linked (its input board), busy (a task on it, or null), screen {w, h}.
     *
     * @return array<string, mixed>
     *
     * @throws RuntimeException when the API can't be reached or says no
     */
    public function status(bool $fresh = false): array
    {
        if ($fresh) {
            return (array) $this->data($this->call('get', '/phone/status', [], 6));
        }

        // Every live frame asks; the phone needn't hear it more than every few seconds.
        return Cache::remember('phone-api.status', now()->addSeconds(3), fn () => $this->status(fresh: true));
    }

    /**
     * The screen as a JPEG, scaled to `maxWidth`, with the phone's own size (taps are in its pixels).
     *
     * @return array{jpeg: string, width: int, height: int}
     */
    public function screenshot(int $maxWidth = 720): array
    {
        $r = $this->call('get', '/phone/screenshot', ['format' => 'jpeg', 'max_width' => $maxWidth], 15);
        if (! $r->successful() || ! str_starts_with((string) $r->header('Content-Type'), 'image/')) {
            $this->data($r); // says why
            throw new RuntimeException('The team phone sent no screen.');
        }
        $size = $this->size();

        return ['jpeg' => $r->body(), 'width' => $size['w'], 'height' => $size['h']];
    }

    public function tap(int $x, int $y): void
    {
        $this->input('/phone/tap', ['x' => $x, 'y' => $y]);
    }

    public function longPress(int $x, int $y, int $ms): void
    {
        $this->input('/phone/long-press', ['x' => $x, 'y' => $y, 'ms' => $ms]);
    }

    /** A drag from one point to another, as the API's swipe: its main direction, and how far. */
    public function swipe(int $x, int $y, int $x2, int $y2): void
    {
        $size = $this->size();
        [$dx, $dy] = [$x2 - $x, $y2 - $y];
        [$direction, $share] = abs($dy) >= abs($dx)
            ? [$dy < 0 ? 'up' : 'down', abs($dy) / max(1, $size['h'])]
            : [$dx < 0 ? 'left' : 'right', abs($dx) / max(1, $size['w'])];

        $this->input('/phone/swipe', ['direction' => $direction, 'distance' => $share < 0.2 ? 'short' : ($share < 0.45 ? 'medium' : 'long')]);
    }

    public function key(string $key): void
    {
        if (! isset(self::KEYS[$key])) {
            throw new InvalidArgumentException('The team phone has no “'.str_replace('_', ' ', $key).'” button: its input board has Back, Home and Enter.');
        }
        $this->input('/phone/key', ['key' => self::KEYS[$key]]);
    }

    public function type(string $text): void
    {
        if (preg_match('/[^\x20-\x7E]/', $text)) {
            throw new InvalidArgumentException('The team phone types plain ASCII only: no emoji, accents or line breaks.');
        }
        $this->input('/phone/type', ['text' => $text]);
    }

    /** @return array{w: int, h: int} */
    private function size(): array
    {
        return Cache::remember('phone-api.geometry', now()->addMinutes(10), function () {
            $g = (array) $this->data($this->call('get', '/phone/geometry', [], 6));

            return ['w' => (int) ($g['w'] ?? 1080), 'h' => (int) ($g['h'] ?? 2400)];
        });
    }

    /** @param array<string, mixed> $body */
    private function input(string $path, array $body): void
    {
        $busy = $this->status(fresh: true)['busy'] ?? null;
        if ($busy) {
            throw new RuntimeException('The team phone is busy with a task (the assistant posting, or another teammate). Wait for it to finish.', 409);
        }
        $this->data($this->call('post', $path, $body, 15));
    }

    /** @param array<string, mixed> $data the query (get) or JSON body (post) */
    private function call(string $method, string $path, array $data, int $timeout): Response
    {
        if (! $this->configured()) {
            throw new RuntimeException('The team phone isn’t set up: PHONE_API_URL and PHONE_API_KEY are empty.');
        }

        try {
            return Http::baseUrl(rtrim((string) config('publishing.phone_api.url'), '/'))
                ->withToken((string) config('publishing.phone_api.key'))
                ->withOptions(['verify' => (bool) config('publishing.phone_api.verify')])
                ->connectTimeout(5)
                ->timeout($timeout)
                ->acceptJson()
                ->{$method}($path, $data);
        } catch (ConnectionException) {
            throw new RuntimeException('The team phone’s API can’t be reached ('.config('publishing.phone_api.url').').');
        }
    }

    /** The API's {ok, data} answer, or its error as a RuntimeException. */
    private function data(Response $r): mixed
    {
        $body = $r->json();
        if (is_array($body) && ($body['ok'] ?? false)) {
            return $body['data'] ?? null;
        }
        $error = is_array($body) ? ($body['error'] ?? null) : null;

        throw new RuntimeException(is_array($error)
            ? 'The team phone: '.($error['message'] ?? $error['code'] ?? 'it said no').'.'
            : 'The team phone’s API answered '.$r->status().'.');
    }
}

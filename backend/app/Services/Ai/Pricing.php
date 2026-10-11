<?php

namespace App\Services\Ai;

/**
 * What a model costs, in one place, charged one of four ways:
 *  - billed: a provider charges for it, per token, per picture or per second of video (config/ai.php);
 *  - estimated: it runs on your GPU pod, which is paid by the hour, so a job costs its share of that
 *    (how long it ran × the pod's hourly rate);
 *  - free: it runs on this server, or on a free tier (not Ollama Cloud: its plans draw on credits);
 *  - unpriced: a paid model with no price in config/ai.php yet. Never counted as free.
 */
class Pricing
{
    public const BILLED = 'billed';

    public const ESTIMATED = 'estimated';

    public const FREE = 'free';

    public const UNPRICED = 'unpriced';

    /** Providers on the GPU pod: VoiceStudio (voices, Whisper) lives there too. */
    public const POD = ['pod', 'voicestudio'];

    /** Providers on this server or the assistant's: nothing to pay per use. */
    public const HERE = ['engine', 'sound', 'studio', 'ollama'];

    /** A typical text call, for what one costs before it's made: a prompt in, a post or two out. */
    public const TYPICAL_TOKENS = [2_000, 1_000];

    /**
     * How a model is charged, in words for the Spending page: "$5 in · $25 out per 1M tokens".
     *
     * @return array{billing: string, rate: string}
     */
    public static function rate(string $provider, string $model): array
    {
        $name = self::name($provider, $model);
        if (in_array($provider, self::POD, true)) {
            return ['billing' => self::ESTIMATED, 'rate' => '≈ '.self::money(self::podHourly()).' an hour of pod time'];
        }
        if (self::free($provider, $name)) {
            return ['billing' => self::FREE, 'rate' => in_array($provider, self::HERE, true) ? 'Free: runs on this server' : 'Free tier'];
        }
        if ($tokens = self::tokenPrice($name)) {
            return ['billing' => self::BILLED, 'rate' => self::money($tokens[0]).' in · '.self::money($tokens[1]).' out per 1M tokens'];
        }
        $m = self::media($provider, $name);
        if (isset($m['price_per_second'])) {
            return ['billing' => self::BILLED, 'rate' => self::money($m['price_per_second']).' a second of video'];
        }
        if (isset($m['price'])) {
            return ['billing' => self::BILLED, 'rate' => self::money($m['price']).' '.(['image' => 'a picture', 'video' => 'a clip'][$m['kind'] ?? ''] ?? 'a run')];
        }

        return ['billing' => self::UNPRICED, 'rate' => 'No price set'];
    }

    /**
     * A text call, from the tokens the provider reported.
     *
     * @return array{cost: float, billing: string}
     */
    public static function tokens(string $provider, string $model, int $inputTokens, int $outputTokens): array
    {
        $billing = self::rate($provider, $model)['billing'];
        if ($billing !== self::BILLED) {
            return ['cost' => 0.0, 'billing' => $billing];
        }
        [$in, $out] = self::tokenPrice(self::name($provider, $model));

        return ['cost' => round(($inputTokens * $in + $outputTokens * $out) / 1_000_000, 6), 'billing' => $billing];
    }

    /**
     * A finished run: what it made (outputs, and seconds of video among them) and how long it took.
     * The pod's runs are priced by the time they took; the rest by what they made.
     *
     * @return array{cost: float, billing: string}
     */
    public static function run(string $provider, string $model, int $outputs, float $videoSeconds, float $ranSeconds): array
    {
        $billing = self::rate($provider, $model)['billing'];
        if ($billing === self::ESTIMATED) {
            return ['cost' => round(max(0, $ranSeconds) / 3600 * self::podHourly(), 6), 'billing' => $billing];
        }

        return ['cost' => $billing === self::BILLED ? round(self::perOutput($provider, $model, $videoSeconds) * $outputs, 6) : 0.0, 'billing' => $billing];
    }

    /**
     * What one output should cost before anything runs: 0 when free or on the pod (its hourly rate is
     * paid either way), a typical call for text, null when nobody has said.
     */
    public static function perOutput(string $provider, string $model, float $videoSeconds = 0): ?float
    {
        $name = self::name($provider, $model);
        if (in_array($provider, self::POD, true) || self::free($provider, $name)) {
            return 0.0;
        }
        if ($tokens = self::tokenPrice($name)) {
            return round((self::TYPICAL_TOKENS[0] * $tokens[0] + self::TYPICAL_TOKENS[1] * $tokens[1]) / 1_000_000, 6);
        }
        $m = self::media($provider, $name);
        if (isset($m['price_per_second'])) {
            // Not told how long: the shortest it makes.
            $seconds = $videoSeconds > 0 ? $videoSeconds : (float) ($m['capabilities']['durations'][0] ?? 5);

            return round($m['price_per_second'] * $seconds, 6);
        }

        return isset($m['price']) ? (float) $m['price'] : null;
    }

    /** A pod job's share of the pod's hourly rate, before it runs: for the Lab's "about 20 s" line. */
    public static function podTime(float $seconds): float
    {
        return round($seconds / 3600 * self::podHourly(), 6);
    }

    public static function podHourly(): float
    {
        return (float) config('ai.providers.pod.hourly', 0);
    }

    /** "$5", "$0.50", "$1.40", "$0.0032": whole dollars bare, else two decimals, or up to four when it needs them. */
    public static function money(float $dollars): string
    {
        if ($dollars == floor($dollars)) {
            return '$'.number_format($dollars, 0, '.', '');
        }
        $s = rtrim(number_format($dollars, 4, '.', ''), '0');

        return '$'.(strlen(substr($s, strpos($s, '.') + 1)) < 2 ? number_format($dollars, 2, '.', '') : $s);
    }

    /** Usage rows hold "claude-opus-5" for text and "higgsfield/kling-3-pro" for media: the model's own name. */
    public static function name(string $provider, string $model): string
    {
        return str_starts_with($model, "{$provider}/") ? substr($model, strlen($provider) + 1) : $model;
    }

    /**
     * Dollars per million tokens, [in, out]. Looked up by key, not config()'s dotted path: model names
     * have dots in them (glm-5.3-flash).
     *
     * @return array{0: float, 1: float}|null
     */
    private static function tokenPrice(string $name): ?array
    {
        return config('ai.prices', [])[$name] ?? null;
    }

    private static function free(string $provider, string $name): bool
    {
        return match (true) {
            in_array($provider, self::HERE, true) => true,
            // Gateways list the models they serve from their own hardware or a free tier.
            in_array($name, (array) config("ai.providers.{$provider}.local_models", []), true) => true,
            $provider === 'openrouter' => str_ends_with($name, ':free'),
            default => false,
        };
    }

    /**
     * @return array<string, mixed>
     */
    private static function media(string $provider, string $name): array
    {
        return (array) ((config("ai.providers.{$provider}.models") ?? [])[$name] ?? []);
    }
}

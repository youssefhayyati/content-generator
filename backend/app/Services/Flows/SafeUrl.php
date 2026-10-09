<?php

namespace App\Services\Flows;

/**
 * Flows call out to URLs the operator typed (webhooks, feeds). Only public http(s) hosts:
 * never the studio's own network, where the database, the models and the phones live.
 */
final class SafeUrl
{
    /** Why the URL can't be used, or null when it can. */
    public static function problem(string $url): ?string
    {
        $parts = parse_url($url);
        if (! $parts || ! in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true) || empty($parts['host'])) {
            return 'That isn’t a web address. It should start with https://';
        }
        $host = strtolower(trim($parts['host'], '[]'));
        if ($host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.internal') || ! str_contains($host, '.') && ! filter_var($host, FILTER_VALIDATE_IP)) {
            return 'That address points inside the studio’s own network. Use a public URL.';
        }
        $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
        foreach ($ips as $ip) {
            if (! filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                return 'That address points inside the studio’s own network. Use a public URL.';
            }
        }

        return null;
    }
}

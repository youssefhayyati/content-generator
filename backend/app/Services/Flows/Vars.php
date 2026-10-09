<?php

namespace App\Services\Flows;

/**
 * {{variables}} in a node's text settings, filled in from the run: {{post.body}}, {{draft}},
 * {{item.title}}. Unknown ones become empty rather than leaking braces into a post.
 */
final class Vars
{
    public static function fill(string $text, array $context): string
    {
        return preg_replace_callback('/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/', function (array $m) use ($context) {
            $value = data_get($context, $m[1]);

            return match (true) {
                $value === null => '',
                is_bool($value) => $value ? 'yes' : 'no',
                is_scalar($value) => (string) $value,
                default => json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            };
        }, $text) ?? $text;
    }
}

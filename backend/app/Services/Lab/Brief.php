<?php

namespace App\Services\Lab;

use App\Models\Account;
use App\Models\Campaign;
use App\Models\Project;
use App\Services\Campaigns\CampaignBrief;
use App\Services\Campaigns\Voice;
use App\Services\Intake\Brief as IntakeBrief;

/**
 * The Brief node: the campaign and the brand, for the nodes after it. It does two things:
 *
 *   style  the look (visual style, colours, font, tone) goes into picture and video prompts, the
 *          Design node's colours and font, and how words are written
 *   facts  the product, audience, offer and call to action fill in {product}, {audience}, {offer},
 *          {cta}, {brand}, {tone} and {style} anywhere a prompt or a text uses them, and writers read
 *          the whole brief (with the campaign's and the account's voice)
 *
 * Each node it's connected to says whether it takes both, the style only, or the facts only.
 */
class Brief
{
    public const VARIABLES = ['product', 'audience', 'offer', 'cta', 'tone', 'style', 'brand', 'avoid'];

    /**
     * The brief a Brief node passes on.
     *
     * @param  array<string, mixed>  $p  the node's settings
     * @return array<string, mixed>
     */
    public static function compile(Project $project, array $p): array
    {
        $user = $project->user;
        $campaign = ! empty($p['campaign_id']) ? $user->campaigns()->find($p['campaign_id']) : null;
        $account = ! empty($p['account_id']) ? $user->accounts()->find($p['account_id']) : null;
        $fields = $campaign?->brief ?? [];
        // An interview's answers (its suggestions too, without the marker) stand in for the form's.
        $said = $campaign?->source === 'intake'
            ? array_map(fn ($v) => trim(str_replace(IntakeBrief::SUGGESTED, '', (string) $v)) ?: null, $campaign->fields ?? [])
            : [];

        $brief = array_filter([
            'brand' => $campaign?->name ?: ($said['business'] ?? null),
            'product' => self::pick($p['product'] ?? null, $said['offer'] ?? $fields['message'] ?? null, isset($said['offer'])),
            'audience' => self::pick($p['audience'] ?? null, $said['audience'] ?? $fields['audience'] ?? null),
            'offer' => self::pick($p['offer'] ?? null, $said['offer'] ?? $fields['message'] ?? null),
            'cta' => self::pick($p['cta'] ?? null, $said['cta'] ?? null),
            'tone' => self::pick($p['tone'] ?? null, $said['tone'] ?? $account?->profile['tone'] ?? null),
            'style' => self::pick($p['style'] ?? null, $said['look'] ?? $account?->profile['style'] ?? null),
            'palette' => array_values(array_filter((array) ($p['palette'] ?? []))) ?: null,
            'font' => $p['font'] ?? null,
            'avoid' => self::pick($p['avoid'] ?? null, $account?->profile['avoid'] ?? null),
            'notes' => $p['notes'] ?? null,
            'goal' => $fields['goal'] ?? $said['goal'] ?? null,
            'key_facts' => $fields['key_facts'] ?? null,
        ], fn ($v) => $v !== null && $v !== '' && $v !== []);

        $context = [];
        if ($campaign) {
            $context[] = app(CampaignBrief::class)->text($campaign, withVoices: ! $account);
            if (filled($campaign->kit)) {
                $context[] = "## Content kit\n".mb_substr((string) $campaign->kit, 0, 6000);
            }
        }
        if ($account) {
            $context[] = "## The account\n".app(Voice::class)->context($account);
        }
        $own = collect(['product' => 'Product or subject', 'audience' => 'Audience', 'offer' => 'Offer or message', 'cta' => 'Call to action', 'tone' => 'Tone', 'style' => 'Visual style', 'avoid' => 'Never', 'notes' => 'Notes'])
            ->filter(fn ($label, $key) => filled($p[$key] ?? null))
            ->map(fn ($label, $key) => "- **{$label}:** {$p[$key]}")->join("\n");
        if ($own !== '') {
            $context[] = "## Brief\n{$own}";
        }
        if (! empty($brief['palette'])) {
            $context[] = '## Brand colours'."\n".implode(', ', $brief['palette']);
        }

        return [
            ...$brief,
            'campaign' => $campaign ? ['id' => $campaign->id, 'name' => $campaign->name] : null,
            'account' => $account ? ['id' => $account->id, 'handle' => $account->handle, 'platform' => $account->platform->value] : null,
            'context' => trim(implode("\n\n", $context)),
        ];
    }

    private static function pick(?string $own, ?string $fallback, bool $useFallback = true): ?string
    {
        return filled($own) ? $own : ($useFallback && filled($fallback) ? $fallback : null);
    }

    /**
     * {product}, {offer}... filled in from the brief; unknown names are left as they are.
     *
     * @param  array<string, mixed>|null  $brief
     */
    public static function fill(string $text, ?array $brief): string
    {
        if (! $brief || ! str_contains($text, '{')) {
            return $text;
        }

        return preg_replace_callback('/\{(\w+)\}/', fn ($m) => in_array($m[1], self::VARIABLES, true) && filled($brief[$m[1]] ?? null) ? (string) $brief[$m[1]] : $m[0], $text);
    }

    /**
     * The look, as words to add to a picture or video prompt. What the brief says never to do isn't
     * among them: a picture model doesn't read "avoid", it draws the words it's given ("avoid the
     * words cozy and vibe" came back as a picture with COZY VIBE across it). That goes to the
     * negative prompt instead (avoidWords).
     *
     * @param  array<string, mixed>|null  $brief
     */
    public static function styleWords(?array $brief): string
    {
        if (! $brief) {
            return '';
        }
        $parts = array_filter([
            $brief['style'] ?? null,
            ! empty($brief['palette']) ? 'colour palette '.implode(', ', array_unique(array_map(self::colourName(...), $brief['palette']))) : null,
        ]);

        return implode('; ', $parts);
    }

    /** Colours a picture model knows by name, for the brand's hex codes. */
    private const COLOURS = [
        'white' => [250, 250, 248], 'cream' => [243, 231, 211], 'beige' => [222, 205, 180], 'sand' => [210, 185, 145], 'camel' => [193, 154, 107],
        'caramel' => [175, 111, 50], 'terracotta' => [190, 95, 65], 'rust' => [160, 70, 35], 'brown' => [120, 80, 50], 'chocolate' => [75, 45, 30],
        'black' => [15, 15, 15], 'charcoal' => [55, 58, 62], 'grey' => [128, 128, 128], 'silver' => [192, 192, 196], 'navy' => [25, 40, 80],
        'blue' => [45, 90, 220], 'sky blue' => [135, 190, 235], 'teal' => [20, 120, 125], 'turquoise' => [64, 200, 200], 'mint' => [170, 230, 200],
        'sage green' => [150, 170, 130], 'olive' => [110, 115, 50], 'forest green' => [40, 85, 50], 'green' => [60, 160, 80], 'yellow' => [245, 215, 60],
        'mustard' => [205, 160, 40], 'gold' => [212, 175, 55], 'orange' => [245, 130, 40], 'coral' => [245, 120, 100], 'peach' => [250, 200, 170],
        'blush pink' => [240, 190, 195], 'pink' => [225, 120, 150], 'magenta' => [200, 40, 140], 'burgundy' => [120, 25, 45], 'red' => [205, 40, 40],
        'lavender' => [190, 175, 225], 'purple' => [110, 60, 160], 'plum' => [95, 45, 80],
    ];

    /**
     * A brand colour as a word: a picture model given "#EDE3D6" letters it onto the picture; given
     * "cream", it paints with it.
     */
    public static function colourName(string $hex): string
    {
        if (! preg_match('/^#?([0-9a-f]{6})$/i', trim($hex), $m)) {
            return trim($hex);
        }
        [$r, $g, $b] = array_map('hexdec', str_split($m[1], 2));
        $best = 'grey';
        $near = PHP_INT_MAX;
        foreach (self::COLOURS as $name => [$cr, $cg, $cb]) {
            // Weighted toward how the eye sees it: green counts most, blue least.
            $d = 2 * ($r - $cr) ** 2 + 4 * ($g - $cg) ** 2 + 3 * ($b - $cb) ** 2;
            if ($d < $near) {
                [$best, $near] = [$name, $d];
            }
        }

        return $best;
    }

    /**
     * What the brief says never to do, for a model's negative prompt.
     *
     * @param  array<string, mixed>|null  $brief
     */
    public static function avoidWords(?array $brief): string
    {
        return trim((string) ($brief['avoid'] ?? ''));
    }

    /**
     * What a writer should know, by what the node takes from the brief.
     *
     * @param  array<string, mixed>|null  $brief
     */
    public static function forWriter(?array $brief, string $use = 'both'): string
    {
        if (! $brief) {
            return '';
        }
        if ($use === 'style') {
            return trim(implode("\n", array_filter([
                filled($brief['tone'] ?? null) ? "Tone: {$brief['tone']}" : null,
                filled($brief['style'] ?? null) ? "Style: {$brief['style']}" : null,
                filled($brief['avoid'] ?? null) ? "Never: {$brief['avoid']}" : null,
            ])));
        }

        return (string) ($brief['context'] ?? '');
    }

    /**
     * The brief as a node uses it: its own setting (both, style, facts) applied.
     *
     * @param  array<string, mixed>|null  $brief
     * @return array<string, mixed>|null
     */
    public static function using(?array $brief, string $use): ?array
    {
        if (! $brief || $use === 'both') {
            return $brief;
        }
        $style = array_intersect_key($brief, array_flip(['tone', 'style', 'palette', 'font', 'avoid']));

        return $use === 'style' ? [...$style, 'context' => self::forWriter($brief, 'style')] : array_diff_key($brief, $style);
    }

    public static function account(?array $brief): ?Account
    {
        return ! empty($brief['account']['id']) ? Account::find($brief['account']['id']) : null;
    }

    public static function campaign(?array $brief): ?Campaign
    {
        return ! empty($brief['campaign']['id']) ? Campaign::find($brief['campaign']['id']) : null;
    }
}

<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Inspire: trending posts
    |--------------------------------------------------------------------------
    |
    | Neither Instagram nor TikTok publishes a trending feed, so Inspire reads
    | them through Apify actors. Both actors bill per dataset item, so a fetch
    | is capped and cached: one search costs `limit` items, and nothing is
    | charged again until the cache entry expires.
    |
    */

    'apify' => [
        'token' => env('APIFY_TOKEN'),
        'url' => env('APIFY_URL', 'https://api.apify.com/v2'),

        // How long the caller waits for an actor run before giving up.
        'timeout' => (int) env('APIFY_TIMEOUT', 120),
    ],

    'platforms' => [
        'instagram' => ['actor' => 'apify~instagram-hashtag-scraper', 'cost_per_item' => 0.0023],
        'tiktok' => ['actor' => 'clockworks~free-tiktok-scraper', 'cost_per_item' => 0.004],
    ],

    // Items per search. Every one of these is billed, so raise it deliberately.
    'limit' => (int) env('TRENDS_LIMIT', 12),

    // Seconds a search is reused before it costs money again.
    'ttl' => (int) env('TRENDS_TTL', 1800),

];

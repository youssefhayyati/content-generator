<?php

/*
|--------------------------------------------------------------------------
| Reposts
|--------------------------------------------------------------------------
|
| Reading a public post from X or Instagram, so it can be adapted for the
| other network. X posts come from the FxTwitter API (no key); Instagram
| captions and photos from the page's link-preview tags, and Instagram videos
| through yt-dlp. Media is only downloaded from the networks' own CDNs.
|
*/

return [
    'fxtwitter_url' => env('REPOSTS_FXTWITTER_URL', 'https://api.fxtwitter.com'),

    // Instagram serves a post's caption and photo to link-preview crawlers, not to browsers.
    'preview_agent' => env('REPOSTS_PREVIEW_AGENT', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'),

    'timeout' => (int) env('REPOSTS_TIMEOUT', 20),

    'max_items' => 4, // X takes at most 4; Instagram up to 10
    'image_mb' => 8,
    'video_mb' => 200,
    'video_seconds' => 180,

    'media_hosts' => ['twimg.com', 'cdninstagram.com', 'fbcdn.net'],
];

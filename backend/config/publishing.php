<?php

/*
|--------------------------------------------------------------------------
| Automated publishing
|--------------------------------------------------------------------------
|
| The guardrails for every run, and how each platform's app is driven. The
| automation service (the Python agent) reads the same targets when it picks
| up a job: taps go through named targets, never raw coordinates.
|
*/

return [

    // R3: don't burn the account. A failed post waits this long before the next
    // attempt, per attempt number, and after the last one it goes to a person.
    'max_attempts' => 3,
    'backoff_minutes' => [5, 15, 30],

    // R7: every run has a hard timeout and a step budget.
    'step_budget' => 40,
    'hard_timeout_seconds' => 240,

    // An agent-driven run that reports nothing for this long is swept: the phone
    // is released and the run ends honestly (uncertain if it reached "publish").
    'stale_minutes' => 10,

    // The app the phone opens per platform, and the named targets in it. The
    // provided apps are calibrated server-side; these names are the contract.
    'apps' => [
        'instagram' => ['package' => 'com.instagram.android', 'targets' => ['compose-button', 'media-picker', 'caption-field', 'post-button']],
        'tiktok' => ['package' => 'com.zhiliaoapp.musically', 'targets' => ['compose-button', 'media-picker', 'caption-field', 'post-button']],
        'x' => ['package' => 'com.twitter.android', 'targets' => ['compose-button', 'media-picker', 'caption-field', 'post-button']],
        'linkedin' => ['package' => 'com.linkedin.android', 'targets' => ['compose-button', 'media-picker', 'caption-field', 'post-button']],
        'facebook' => ['package' => 'com.facebook.katana', 'targets' => ['compose-button', 'media-picker', 'caption-field', 'post-button']],
        'youtube' => ['package' => 'com.google.android.youtube', 'targets' => ['compose-button', 'media-picker', 'caption-field', 'post-button']],
        'pinterest' => ['package' => 'com.pinterest', 'targets' => ['compose-button', 'media-picker', 'caption-field', 'post-button']],
    ],

    // The built-in simulator, so the whole loop runs without a phone. The flaky
    // profile rolls a die; tests rig it with SimulatorPhone::rig().
    'simulator' => ['flaky_failure_rate' => 0.5],

    // "Scan for phones" asks the adb server on the machine the phones are plugged
    // into. From inside Docker Desktop that machine is host.docker.internal.
    'adb' => [
        'host' => env('ADB_SERVER_HOST', 'host.docker.internal'),
        'port' => (int) env('ADB_SERVER_PORT', 5037),
    ],

];

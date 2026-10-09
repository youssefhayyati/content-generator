<?php

use App\Services\Flows\Flows;
use App\Services\Publishing\Publisher;
use Illuminate\Support\Facades\Schedule;

// When a post's time comes, its publishing run starts on its own.
Schedule::call(fn () => app(Publisher::class)->dispatchDue())->name('publishing:dispatch-due')->everyMinute()->withoutOverlapping();

// Runs that report nothing end honestly (uncertain or failed) and release the phone.
Schedule::call(fn () => app(Publisher::class)->sweepStale())->name('publishing:sweep-stale')->everyFiveMinutes()->withoutOverlapping();

// Flows: start the scheduled ones, wake runs whose Wait is over, read the feeds being watched.
Schedule::call(fn () => app(Flows::class)->tick())->name('flows:tick')->everyMinute()->withoutOverlapping();

<?php

namespace App\Jobs;

use App\Models\LinkClip;
use App\Services\Clips\LinkClipper;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Str;
use Throwable;

/** Render an edited highlight again: new subtitles, look or music over its master. */
class RestyleLinkClip implements ShouldQueue
{
    use Queueable;

    public int $timeout = 1800;

    public int $tries = 1;

    public function __construct(public int $clipId)
    {
        $this->onQueue('media');
    }

    public function handle(LinkClipper $clipper): void
    {
        $clip = LinkClip::with(['user', 'asset', 'post'])->find($this->clipId);
        if (! $clip) {
            return;
        }
        try {
            $clipper->restyle($clip);
        } catch (Throwable $e) {
            report($e);
            // The highlight it had is still there: keep it, and say why the edit didn't land.
            $clip->update([
                'status' => $clip->asset_id ? 'ready' : 'failed',
                'error' => Str::limit('Your edit could not be rendered: '.($e->getMessage() ?: 'unknown error.'), 500),
            ]);
        }
    }
}

<?php

namespace App\Jobs;

use App\Models\LinkClip;
use App\Services\Clips\LinkClipper;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Str;
use Throwable;

class CreateLinkClip implements ShouldQueue
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
        $clip = LinkClip::with('user')->find($this->clipId);
        if (! $clip) {
            return;
        }
        try {
            $clipper->run($clip);
        } catch (Throwable $e) {
            report($e);
            $clip->update([
                'status' => 'failed',
                'error' => Str::limit($e->getMessage() ?: 'The clip could not be made.', 500),
            ]);
        }
    }
}

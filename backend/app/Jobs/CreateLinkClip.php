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
            $message = Str::limit($e->getMessage() ?: 'The clip could not be made.', 500);
            $query = $clip->batch_id
                ? LinkClip::query()->where('user_id', $clip->user_id)->where('batch_id', $clip->batch_id)
                : LinkClip::query()->whereKey($clip->id);
            $query->whereIn('status', ['queued', 'downloading', 'reading', 'analyzing', 'writing', 'rendering'])->update([
                'status' => 'failed',
                'error' => $message,
            ]);
        }
    }
}

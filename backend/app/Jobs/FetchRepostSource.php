<?php

namespace App\Jobs;

use App\Models\Repost;
use App\Services\Community\RepostSource;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Str;
use Throwable;

/** Read the post a repost came from — text, author, photos or video — off the request. */
class FetchRepostSource implements ShouldQueue
{
    use Queueable;

    public int $timeout = 600;

    public int $tries = 1;

    public function __construct(public int $repostId)
    {
        $this->onQueue('media');
    }

    public function handle(RepostSource $source): void
    {
        $repost = Repost::with('user')->find($this->repostId);
        if (! $repost || $repost->status !== 'fetching') {
            return;
        }
        try {
            $source->capture($repost);
        } catch (Throwable $e) {
            report($e);
            $repost->update(['status' => 'failed', 'error' => Str::limit($e->getMessage() ?: 'The post could not be read.', 500)]);

            return;
        }
        if ($repost->placement) {
            $repost->update(['status' => 'adapting']);
            AdaptRepost::dispatch($repost->id);
        }
    }
}

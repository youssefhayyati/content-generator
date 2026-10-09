<?php

namespace App\Jobs;

use App\Models\Asset;
use App\Services\Sound\Listener;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Str;
use Throwable;

/** Listen to an audio or video in the library and keep its words, timed, on the asset. */
class TranscribeAsset implements ShouldQueue
{
    use Queueable;

    public int $timeout = 1500;

    public int $tries = 1;

    public function __construct(public int $assetId, public ?string $language = null)
    {
        $this->onQueue('media');
    }

    public function handle(Listener $listener): void
    {
        $asset = Asset::find($this->assetId);
        if (! $asset) {
            return;
        }
        try {
            $heard = $listener->asset($asset, $this->language);
            $asset->update(['meta' => [...$asset->meta ?? [], 'transcript' => $heard, 'transcript_status' => 'done', 'transcript_error' => null]]);
        } catch (Throwable $e) {
            report($e);
            $asset->update(['meta' => [...$asset->fresh()->meta ?? [], 'transcript_status' => 'failed', 'transcript_error' => Str::limit($e->getMessage(), 200)]]);
        }
    }
}

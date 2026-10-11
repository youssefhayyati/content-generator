<?php

namespace App\Services\Lab;

use App\Models\User;
use App\Models\VideoSource;
use Illuminate\Support\Str;

/**
 * Videos from YouTube (or another site yt-dlp reads): their details first, then the permission a
 * person records, then the downloads. Nothing is downloaded before permission is allowed.
 */
class VideoSources
{
    public function __construct(private readonly YtDlp $ytdlp, private readonly Media $media) {}

    /**
     * The video's details, read once and kept (the same link again gives the same source).
     *
     * @throws NodeFailed
     */
    public function inspect(User $user, string $url): VideoSource
    {
        $url = trim($url);
        if (! preg_match('#^https?://#i', $url)) {
            throw new NodeFailed('Paste the video’s link (https://…).');
        }
        $id = self::youtubeId($url);
        $existing = $id ? $user->videoSources()->where('external_id', $id)->latest('id')->first() : $user->videoSources()->where('url', $url)->latest('id')->first();
        if ($existing && $existing->title) {
            return $existing;
        }
        $info = $this->ytdlp->info($url);
        if (($info['_type'] ?? 'video') === 'playlist') {
            throw new NodeFailed('That’s a playlist. Paste the link of one video.');
        }
        if (! empty($info['is_live'])) {
            throw new NodeFailed('That’s a live stream. Use it once it has ended.');
        }
        $cc = str_contains(strtolower((string) ($info['license'] ?? '')), 'creative commons');

        return $user->videoSources()->updateOrCreate(['id' => $existing?->id], [
            'url' => (string) ($info['webpage_url'] ?? $url),
            'site' => Str::lower((string) ($info['extractor_key'] ?? 'youtube')),
            'external_id' => (string) ($info['id'] ?? $id),
            'title' => Str::limit((string) ($info['title'] ?? ''), 290, ''),
            'channel' => Str::limit((string) ($info['channel'] ?? $info['uploader'] ?? ''), 190, ''),
            'channel_url' => $info['channel_url'] ?? $info['uploader_url'] ?? null,
            'duration' => isset($info['duration']) ? (float) $info['duration'] : null,
            'license' => $info['license'] ?? null,
            'thumbnail' => $info['thumbnail'] ?? null,
            'status' => 'new',
            'permission' => $existing?->permission ?? 'pending',
            'meta' => [
                'chapters' => array_map(fn ($c) => ['title' => $c['title'] ?? '', 'start' => (float) ($c['start_time'] ?? 0), 'end' => (float) ($c['end_time'] ?? 0)], $info['chapters'] ?? []),
                'heatmap' => array_slice($info['heatmap'] ?? [], 0, 200),
                'creative_commons' => $cc,
                'language' => $info['language'] ?? null,
                'captions' => array_values(array_unique([...array_keys($info['subtitles'] ?? []), ...array_slice(array_keys($info['automatic_captions'] ?? []), 0, 5)])),
            ],
        ]);
    }

    /**
     * A person says whose video it is and why it may be used. "own" and "permission" need nothing more
     * (a note for permission); "creative_commons" needs the video to say so. Denied stops it for good.
     *
     * @throws NodeFailed
     */
    public function permission(VideoSource $source, string $basis, ?string $note, ?string $credit, bool $deny = false): VideoSource
    {
        if ($deny) {
            $source->update(['permission' => 'denied', 'basis' => null, 'permission_note' => $note, 'permission_at' => now()]);

            return $source;
        }
        if (! in_array($basis, VideoSource::BASES, true)) {
            throw new NodeFailed('Say whose video it is: yours, used with permission, or Creative Commons.');
        }
        if ($basis === 'permission' && blank($note)) {
            throw new NodeFailed('Note who gave permission and how (an email, a DM, a contract).');
        }
        // YouTube often doesn't say a video's licence any more: then the note says where it's stated.
        if ($basis === 'creative_commons' && empty($source->meta['creative_commons'])) {
            if (filled($source->license)) {
                throw new NodeFailed("YouTube lists this video’s licence as “{$source->license}”, not Creative Commons. Ask the creator for permission instead.");
            }
            if (blank($note)) {
                throw new NodeFailed('YouTube doesn’t say this video’s licence. Note where it’s stated as Creative Commons (a link to the licence).');
            }
        }
        $credit = trim((string) $credit) ?: match ($basis) {
            'own' => null,
            'creative_commons' => "🎬 From “{$source->title}” by {$source->channel} (CC BY), {$source->url}",
            default => "🎬 From “{$source->title}” by {$source->channel}, used with permission",
        };
        $source->update(['permission' => 'allowed', 'basis' => $basis, 'permission_note' => $note ? Str::limit($note, 490, '') : null, 'credit' => $credit ? Str::limit($credit, 290, '') : null, 'permission_at' => now()]);

        return $source;
    }

    /**
     * The sound (always), the whole video when it's short, and YouTube's own captions when it has
     * them. Returns the source, ready.
     *
     * @throws NodeFailed
     */
    public function fetch(VideoSource $source, ?callable $progress = null, int $wholeUnder = 600): VideoSource
    {
        if (! $source->allowed()) {
            throw new NodeFailed('Record whose video this is, and why it may be used, before anything is downloaded.');
        }
        $user = $source->user;
        $meta = ['video_source_id' => $source->id, 'credit' => $source->credit, 'source_url' => $source->url];
        $source->update(['status' => 'fetching', 'error' => null]);
        try {
            if (! $source->audio) {
                $progress && $progress('Downloading the sound', 0.1);
                $out = Media::tmp('m4a');
                $this->ytdlp->audio($source->url, $out);
                $audio = $this->media->keep($user, $out, 'audio/mp4', Str::limit($source->title ?: 'video', 80, '').' (sound).m4a', $meta);
                $source->update(['audio_asset_id' => $audio->id]);
            }
            if (! $source->video_asset_id && $source->duration && $source->duration <= $wholeUnder) {
                $progress && $progress('Downloading the video', 0.4);
                $out = Media::tmp('mp4');
                $this->ytdlp->video($source->url, $out);
                $video = $this->media->keep($user, $out, 'video/mp4', Str::limit($source->title ?: 'video', 80, '').'.mp4', $meta);
                $source->update(['video_asset_id' => $video->id]);
            }
            if (empty($source->transcript['words'])) {
                $progress && $progress('Reading YouTube’s captions', 0.85);
                $words = rescue(fn () => $this->ytdlp->captions($source->url, ['language' => $source->meta['language'] ?? null, 'subtitles' => array_flip($source->meta['captions'] ?? []), 'automatic_captions' => array_flip($source->meta['captions'] ?? [])]), [], report: false);
                if ($words) {
                    $source->update(['transcript' => ['words' => $words, 'text' => implode(' ', array_column($words, 'text')), 'language' => $source->meta['language'] ?? null, 'from' => 'youtube']]);
                }
            }
        } catch (NodeFailed $e) {
            $source->update(['status' => 'failed', 'error' => $e->getMessage()]);
            throw $e;
        }
        $source->update(['status' => 'ready']);

        return $source->refresh();
    }

    public static function youtubeId(string $url): ?string
    {
        return preg_match('~(?:youtu\.be/|youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/))([\w-]{11})~', $url, $m) ? $m[1] : null;
    }
}

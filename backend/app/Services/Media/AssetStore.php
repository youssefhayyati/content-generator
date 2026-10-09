<?php

namespace App\Services\Media;

use App\Models\Asset;
use App\Models\User;
use App\Services\Sound\AudioTools;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Puts media in the library: uploads, generated images, videos and sound, phone screenshots.
 * Everything lands under assets/{user}/ on the private disk, measured on the way in.
 */
class AssetStore
{
    public const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    public const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

    public const AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/webm', 'audio/ogg', 'audio/flac', 'audio/x-flac'];

    public function __construct(private readonly MediaInspector $inspector) {}

    public function fromUpload(User $user, UploadedFile $file, string $source = 'upload'): Asset
    {
        $mime = (string) $file->getMimeType();
        $path = $file->storeAs($this->directory($user), Str::random(32).'.'.$this->extension($mime, $file->getClientOriginalExtension()), 'local');

        return $this->finish($user, $path, $mime, $file->getClientOriginalName(), $source);
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    public function fromContents(User $user, string $contents, string $mime, string $name, string $source, array $meta = []): Asset
    {
        $path = $this->directory($user).'/'.Str::random(32).'.'.$this->extension($mime);
        Storage::disk('local')->put($path, $contents);

        return $this->finish($user, $path, $mime, $name, $source, $meta);
    }

    public static function kindOf(string $mime): ?string
    {
        return match (true) {
            in_array($mime, self::IMAGE_TYPES, true) => 'image',
            in_array($mime, self::VIDEO_TYPES, true) => 'video',
            in_array($mime, self::AUDIO_TYPES, true) || str_starts_with($mime, 'audio/') => 'audio',
            default => null,
        };
    }

    /**
     * @param  array<string, mixed>  $meta
     */
    private function finish(User $user, string $path, string $mime, string $name, string $source, array $meta = []): Asset
    {
        $disk = Storage::disk('local');
        $absolute = $disk->path($path);
        $kind = self::kindOf($mime) ?? 'image';
        $measured = $this->inspector->inspect($absolute, $mime);
        // Browsers file recordings as video/webm or video/mp4 even when there's no picture.
        if ($kind === 'video' && $measured['width'] === null && $this->inspector->canReadVideo()) {
            $kind = 'audio';
            $mime = str_replace('video/', 'audio/', $mime);
            $measured = $this->inspector->inspect($absolute, $mime);
        }

        $poster = null;
        $candidate = preg_replace('/\.\w+$/', '.poster.jpg', $path);
        if ($kind === 'video') {
            $poster = $this->inspector->poster($absolute, $disk->path($candidate)) ? $candidate : null;
        } elseif ($kind === 'audio' && $this->inspector->canReadVideo()) {
            // Audio gets its waveform as a thumbnail, and as bars a player can draw at once.
            $tools = app(AudioTools::class);
            $poster = $tools->waveform($absolute, $disk->path($candidate)) ? $candidate : null;
            $meta = [...$meta, 'peaks' => $tools->peaks($absolute)];
        }

        return $user->assets()->create([
            'kind' => $kind,
            'source' => $source,
            'name' => Str::limit($name, 120, ''),
            'path' => $path,
            'poster_path' => $poster,
            'mime' => $mime,
            'size' => $disk->size($path),
            ...$measured,
            'meta' => $meta ?: null,
        ]);
    }

    private function directory(User $user): string
    {
        return "assets/{$user->id}/".now()->format('Y-m');
    }

    private function extension(string $mime, string $fallback = 'bin'): string
    {
        return [
            'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif',
            'video/mp4' => 'mp4', 'video/quicktime' => 'mov', 'video/webm' => 'webm', 'image/svg+xml' => 'svg',
            'audio/mpeg' => 'mp3', 'audio/mp3' => 'mp3', 'audio/mp4' => 'm4a', 'audio/x-m4a' => 'm4a', 'audio/aac' => 'aac',
            'audio/wav' => 'wav', 'audio/x-wav' => 'wav', 'audio/wave' => 'wav', 'audio/webm' => 'webm', 'audio/ogg' => 'ogg',
            'audio/flac' => 'flac', 'audio/x-flac' => 'flac',
        ][$mime] ?? (strtolower($fallback) ?: 'bin');
    }
}

<?php

namespace App\Services\Sound;

/**
 * Which provider reads a voice: VoiceStudio voice ids carry the "vs:" prefix everywhere they
 * flow (an account's sound, a generation's params, the sample route), so the prefix alone
 * decides whether VoiceStudio or the local FlowAI Sound speaks. Anything without the prefix
 * stays with Kokoro, exactly as before.
 */
class VoiceRouter
{
    public const PREFIX = 'vs:';

    public const MODEL = 'voicestudio/voices';

    public const LOCAL_MODEL = 'sound/kokoro';

    public static function isVoiceStudio(mixed $voice): bool
    {
        return is_string($voice) && str_starts_with($voice, self::PREFIX);
    }

    /** The registry model that speaks this voice. */
    public static function modelFor(mixed $voice): string
    {
        return self::isVoiceStudio($voice) ? self::MODEL : self::LOCAL_MODEL;
    }

    /** The id VoiceStudio itself knows the voice by. */
    public static function strip(string $voice): string
    {
        return self::isVoiceStudio($voice) ? substr($voice, strlen(self::PREFIX)) : $voice;
    }
}

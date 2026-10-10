<?php

namespace App\Http\Controllers;

use App\Http\Requests\WritePostRequest;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * The welcome a new account gets: its first post, written in the voice it just described.
 */
class OnboardingController extends Controller
{
    /** The first post, and one "try another". */
    public const FIRST_POST_TRIES = 2;

    /**
     * Writes the first post at the end of onboarding. Unlike the composer it doesn't wait for a
     * confirmed email (this is the account's first minute), so it only works while onboarding
     * is open, and only twice. A try counts once writing actually starts.
     */
    public function firstPost(WritePostRequest $request, ModelRegistry $models, UsageMeter $usage, WritingController $writing): StreamedResponse|JsonResponse
    {
        $user = $request->user();
        $preferences = $user->preferences ?? [];
        $tries = (int) ($preferences['first_post_tries'] ?? 0);

        if (($preferences['onboarding'] ?? 'done') !== 'pending' || $tries >= self::FIRST_POST_TRIES) {
            return response()->json(['message' => 'Your first post is written. The composer takes it from here.'], 403);
        }

        $response = $writing->write($request, $models, $usage);

        if ($response instanceof StreamedResponse) {
            $user->forceFill(['preferences' => [...$preferences, 'first_post_tries' => $tries + 1]])->save();
        }

        return $response;
    }
}

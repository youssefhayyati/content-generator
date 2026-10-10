<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * The voice assistant (assistant/) is a service of its own. The Assistant page asks here for a
 * token and hands it to the assistant over its WebSocket, so the assistant works as the person
 * who opened it: with their accounts, posts and gallery, saving drafts only (SavePostRequest)
 * and reaching only what its tools need (LimitAssistantToken). Scheduling stays with the person.
 */
class AssistantController extends Controller
{
    public const ABILITY = 'assistant';

    public function session(Request $request): JsonResponse
    {
        // Only the person, signed in on the page, hands out access: a token can't mint another.
        abort_if($request->user()->currentAccessToken() instanceof PersonalAccessToken, 403, 'Open the Assistant page to start a session.');

        $user = $request->user();
        $user->tokens()->where('name', self::ABILITY)->where('expires_at', '<', now())->delete();
        $expires = now()->addHours(12);

        return response()->json([
            'token' => $user->createToken(self::ABILITY, [self::ABILITY], $expires)->plainTextToken,
            'expires_at' => $expires->toIso8601String(),
        ]);
    }
}

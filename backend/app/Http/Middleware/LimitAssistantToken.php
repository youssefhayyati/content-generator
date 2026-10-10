<?php

namespace App\Http\Middleware;

use App\Http\Controllers\AssistantController;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * The voice assistant's token (AssistantController) reaches what its tools use
 * (assistant/backend/flowai.py) and nothing else: no settings, no deleting posts, no publishing,
 * and no approving at a campaign's gates. Requests signed in the usual way pass straight through.
 */
class LimitAssistantToken
{
    private const ROUTES = [
        'GET api/user',
        'GET api/accounts',
        'GET api/accounts/{account}/voice',
        'GET api/posts',
        'POST api/posts',
        'GET api/posts/{post}',
        'PUT api/posts/{post}',
        'PATCH api/posts/{post}',
        'GET api/assets',
        'POST api/assets',
        'GET api/assets/{asset}/file',
        'GET api/assets/{asset}/poster',
        'DELETE api/assets/{asset}',
        'GET api/queue-slots',
        // Campaigns, to change their posts: a changed version goes back to gate 6B for a person.
        'GET api/campaigns',
        'GET api/campaigns/{campaign}',
        'GET api/campaigns/{campaign}/items',
        'PATCH api/campaigns/{campaign}/items/{item}',
        'PUT api/campaigns/{campaign}/items/{item}/media',
        'PATCH api/campaigns/{campaign}/variants/{variant}',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        // Runs with the api group, before the routes' own auth: ask Sanctum directly.
        $token = $request->user('sanctum')?->currentAccessToken();
        if ($token instanceof PersonalAccessToken && $token->can(AssistantController::ABILITY)) {
            $route = $request->method().' '.$request->route()?->uri();
            abort_unless(in_array($route, self::ROUTES, true), 403, 'The assistant can’t do that. Do it in FlowAI yourself.');
        }

        return $next($request);
    }
}

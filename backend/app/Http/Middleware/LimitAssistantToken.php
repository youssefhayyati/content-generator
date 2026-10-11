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
 * It does record a run: what the team's phone already posted when the person told it to, with the
 * screenshot proving it (phone-run); that publishes nothing itself.
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
        // What the phone posted at the person's word, with its proof: the run on FlowAI's record.
        'POST api/posts/{post}/phone-run',
        // Campaigns, to change their posts: a changed version goes back to gate 6B for a person.
        'GET api/campaigns',
        'GET api/campaigns/{campaign}',
        'GET api/campaigns/{campaign}/items',
        'PATCH api/campaigns/{campaign}/items/{item}',
        'PUT api/campaigns/{campaign}/items/{item}/media',
        'PATCH api/campaigns/{campaign}/variants/{variant}',
        // Creative Lab: the assistant builds and runs graphs like the person does. A Post node it runs
        // only ever saves a draft, and recording permission to use a video stays the person's.
        'GET api/lab/catalog',
        'GET api/lab/voices',
        'GET api/projects',
        'GET api/projects/{project}',
        'POST api/lab/projects',
        'GET api/projects/{project}/lab',
        'GET api/projects/{project}/lab/state',
        'POST api/projects/{project}/lab/ops',
        'GET api/projects/{project}/lab/nodes/{node}/plan',
        'GET api/projects/{project}/lab/nodes/{node}/history',
        'POST api/projects/{project}/lab/nodes/{node}/run',
        'POST api/projects/{project}/lab/nodes/{node}/stop',
        'POST api/projects/{project}/lab/run-all',
        'POST api/lab/youtube/inspect',
        'GET api/lab/youtube/{source}',
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

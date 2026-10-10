<?php

use App\Http\Middleware\EnsureAgentToken;
use App\Http\Middleware\LimitAssistantToken;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // The React app signs in with a session cookie (Sanctum SPA auth), so API
        // requests from it get sessions and CSRF protection.
        $middleware->statefulApi();

        // The automation service signs its calls with the studio's agent token instead.
        $middleware->alias(['agent' => EnsureAgentToken::class]);

        // The voice assistant works with a token of the person who opened it: only what its tools need.
        $middleware->api(append: [LimitAssistantToken::class]);

        // There are no Laravel login pages; send stray browsers to the React one.
        $middleware->redirectGuestsTo(fn () => config('app.frontend_url').'/login');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();

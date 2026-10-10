<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\AssistantController;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Resources\UserResource;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;

class AuthenticatedSessionController extends Controller
{
    public function store(LoginRequest $request): UserResource
    {
        $request->authenticate();
        $request->session()->regenerate();

        return UserResource::make($request->user());
    }

    public function destroy(Request $request): Response
    {
        // Signing out ends the assistant's sessions too.
        $request->user()?->tokens()->where('name', AssistantController::ABILITY)->delete();
        Auth::guard('web')->logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }
}

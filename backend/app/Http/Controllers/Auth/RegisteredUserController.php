<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

class RegisteredUserController extends Controller
{
    /**
     * Create the account, send the confirmation email, and sign the new user in.
     */
    public function __invoke(RegisterRequest $request): JsonResponse
    {
        $user = User::create([
            'name' => $request->string('name')->trim()->value(),
            'email' => $request->input('email'),
            'password' => $request->input('password'),
            'timezone' => $request->input('timezone'),
            'preferences' => [
                'platforms' => $request->input('platforms', []),
                'formats' => $request->input('formats', []),
                // Accounts made before onboarding existed have no key, and count as done.
                'onboarding' => 'pending',
            ],
        ]);

        event(new Registered($user));

        Auth::login($user);
        $request->session()->regenerate();

        return UserResource::make($user)->response()->setStatusCode(201);
    }
}

<?php

namespace App\Http\Controllers;

use App\Enums\Platform;
use App\Enums\PostFormat;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

class ProfileController extends Controller
{
    public function show(Request $request): UserResource
    {
        return UserResource::make($request->user());
    }

    public function update(Request $request): UserResource
    {
        /** @var User $user */
        $user = $request->user();

        if ($request->has('email')) {
            $request->merge(['email' => mb_strtolower(trim((string) $request->input('email')))]);
        }

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:80'],
            'email' => ['sometimes', 'required', 'email', 'max:255', Rule::unique(User::class)->ignore($user->id)],
            'timezone' => ['sometimes', 'nullable', 'timezone:all'],
            // Only these keys: the rest of preferences (how many first posts were written) is the server's.
            'preferences' => ['sometimes', 'array:platforms,formats,onboarding,studio'],
            'preferences.platforms' => ['sometimes', 'array'],
            'preferences.platforms.*' => ['distinct', Rule::enum(Platform::class)],
            'preferences.formats' => ['sometimes', 'array'],
            'preferences.formats.*' => ['distinct', Rule::enum(PostFormat::class)],
            // Onboarding can be finished (or skipped), never reopened.
            'preferences.onboarding' => ['sometimes', Rule::in(['done'])],
            'preferences.studio' => ['sometimes', 'nullable', 'string', 'max:60'],
        ]);

        if (isset($data['preferences'])) {
            $data['preferences'] = array_merge($user->preferences ?? [], $data['preferences']);
        }

        $user->fill($data);

        // A new address has to be confirmed again.
        $emailChanged = $user->isDirty('email');
        if ($emailChanged) {
            $user->email_verified_at = null;
        }

        $user->save();

        if ($emailChanged) {
            $user->sendEmailVerificationNotification();
        }

        return UserResource::make($user);
    }

    public function destroy(Request $request): Response
    {
        /** @var User $user */
        $user = $request->user();

        if ($user->hasPassword()) {
            $request->validate(['password' => ['required', 'current_password']]);
        }

        Auth::guard('web')->logout();
        $user->delete();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }
}

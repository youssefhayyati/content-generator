<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Models\SocialAccount;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Socialite\Contracts\User as ProviderUser;
use Laravel\Socialite\Facades\Socialite;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirect;
use Throwable;

class SocialiteController extends Controller
{
    public const PROVIDERS = ['google', 'github'];

    /**
     * Which providers have credentials, so the app can say so instead of failing at the provider.
     */
    public function providers(): JsonResponse
    {
        return response()->json(collect(self::PROVIDERS)->mapWithKeys(
            fn (string $p) => [$p => $this->configured($p)]
        ));
    }

    public function redirect(string $provider): RedirectResponse|SymfonyRedirect
    {
        if (! $this->configured($provider)) {
            return $this->toFrontend('/login', ['error' => 'oauth_unconfigured', 'provider' => $provider]);
        }

        return Socialite::driver($provider)->redirect();
    }

    public function callback(Request $request, string $provider): RedirectResponse
    {
        if (! $this->configured($provider)) {
            return $this->toFrontend('/login', ['error' => 'oauth_unconfigured', 'provider' => $provider]);
        }

        try {
            $profile = Socialite::driver($provider)->user();
        } catch (Throwable) {
            return $this->toFrontend('/login', ['error' => 'oauth_failed', 'provider' => $provider]);
        }

        // Already signed in: this is "Connect" from Settings.
        if ($current = $request->user()) {
            return $this->link($current, $provider, $profile);
        }

        $account = SocialAccount::where('provider', $provider)
            ->where('provider_id', (string) $profile->getId())
            ->first();

        $user = $account?->user ?? $this->findOrCreateUser($provider, $profile);

        if (! $user) {
            return $this->toFrontend('/login', ['error' => 'oauth_no_email', 'provider' => $provider]);
        }

        Auth::login($user, remember: true);
        $request->session()->regenerate();

        return $this->toFrontend('/dashboard');
    }

    private function findOrCreateUser(string $provider, ProviderUser $profile): ?User
    {
        $email = Str::lower((string) $profile->getEmail());

        if ($email === '') {
            return null;
        }

        return DB::transaction(function () use ($provider, $profile, $email) {
            $user = User::firstWhere('email', $email);

            if (! $user) {
                $user = User::create([
                    'name' => $profile->getName() ?: $profile->getNickname() ?: Str::before($email, '@'),
                    'email' => $email,
                    'avatar_url' => $profile->getAvatar(),
                    'preferences' => ['onboarding' => 'pending'],
                ]);
                $user->markEmailAsVerified();
            } elseif (! $user->hasVerifiedEmail()) {
                // Someone registered this address but never proved they own it; the provider
                // just did. Drop their password and sessions so a squatter can't keep access.
                $user->forceFill(['password' => null, 'remember_token' => null])->save();
                $user->markEmailAsVerified();
                DB::table('sessions')->where('user_id', $user->id)->delete();
            }

            $user->socialAccounts()->create([
                'provider' => $provider,
                'provider_id' => (string) $profile->getId(),
            ]);

            return $user;
        });
    }

    private function link(User $user, string $provider, ProviderUser $profile): RedirectResponse
    {
        $existing = SocialAccount::where('provider', $provider)
            ->where('provider_id', (string) $profile->getId())
            ->first();

        if ($existing && $existing->user_id !== $user->id) {
            return $this->toFrontend('/dashboard/settings', ['error' => 'oauth_taken', 'provider' => $provider]);
        }

        $user->socialAccounts()->updateOrCreate(
            ['provider' => $provider],
            ['provider_id' => (string) $profile->getId()],
        );

        if (! $user->avatar_url && $profile->getAvatar()) {
            $user->update(['avatar_url' => $profile->getAvatar()]);
        }

        return $this->toFrontend('/dashboard/settings', ['linked' => $provider]);
    }

    private function configured(string $provider): bool
    {
        return filled(config("services.{$provider}.client_id")) && filled(config("services.{$provider}.client_secret"));
    }

    /**
     * @param  array<string, string>  $query
     */
    private function toFrontend(string $path, array $query = []): RedirectResponse
    {
        $url = config('app.frontend_url').$path.($query ? '?'.http_build_query($query) : '');

        return redirect()->away($url);
    }
}

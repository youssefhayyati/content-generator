<?php

namespace App\Providers;

use App\Models\User;
use App\Services\Ai\ClaudeTextGenerator;
use App\Services\Ai\TextGenerator;
use App\Services\Ai\UsageMeter;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(UsageMeter::class);
        $this->app->bind(TextGenerator::class, fn ($app) => new ClaudeTextGenerator(config('services.anthropic.key'), $app->make(UsageMeter::class)));
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        JsonResource::withoutWrapping();

        // Sign-up, password reset and the like. Login has its own per-email limit on top.
        RateLimiter::for('auth', fn (Request $request) => Limit::perMinute(10)->by($request->ip()));

        // AI writing, per person: enough to iterate on a post, not enough to run up a bill.
        RateLimiter::for('ai', fn (Request $request) => [
            Limit::perMinute(10)->by('minute:'.$request->user()->id),
            Limit::perDay(200)->by('day:'.$request->user()->id),
        ]);

        // The campaign intake: one request per answer, so faster than writing, but still capped per day.
        // Creative Lab runs, per person: a graph runs many nodes at once, so it's roomier than writing.
        RateLimiter::for('lab', fn (Request $request) => [
            Limit::perMinute(60)->by('lab-minute:'.$request->user()->id),
            Limit::perDay(2000)->by('lab-day:'.$request->user()->id),
        ]);

        RateLimiter::for('intake', fn (Request $request) => [
            Limit::perMinute(20)->by('intake-minute:'.$request->user()->id),
            Limit::perDay(300)->by('intake-day:'.$request->user()->id),
        ]);

        // The reset form is a page in the React app, not a Laravel view.
        ResetPassword::toMailUsing(fn (User $user, string $token) => (new MailMessage)
            ->subject('Reset your FlowAI password')
            ->greeting('Locked out?')
            ->line('Someone asked to reset the password for your FlowAI account. If that was you, set a new one below.')
            ->action('Set a new password', self::resetUrl($user, $token))
            ->line('The link expires in '.config('auth.passwords.users.expire').' minutes. If you didn’t ask for it, ignore this email and your password stays as it is.'));

        VerifyEmail::toMailUsing(fn (User $user, string $url) => (new MailMessage)
            ->subject('Confirm your email for FlowAI')
            ->greeting('One last thing, '.strtok($user->name, ' ').'.')
            ->line('Confirm this is your address and your workspace is ready to publish.')
            ->action('Confirm email', $url)
            ->line('If you didn’t create a FlowAI account, you can ignore this email.'));
    }

    public static function resetUrl(User $user, string $token): string
    {
        return config('app.frontend_url').'/reset-password?'.http_build_query([
            'token' => $token,
            'email' => $user->getEmailForPasswordReset(),
        ]);
    }
}

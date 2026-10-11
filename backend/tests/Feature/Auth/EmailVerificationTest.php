<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Auth\Events\Verified;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\URL;
use Tests\TestCase;

class EmailVerificationTest extends TestCase
{
    use RefreshDatabase;

    private function link(User $user, ?string $hash = null): string
    {
        return URL::temporarySignedRoute('verification.verify', now()->addHour(), [
            'id' => $user->id,
            'hash' => $hash ?? sha1($user->email),
        ]);
    }

    public function test_the_emailed_link_verifies_without_being_signed_in(): void
    {
        Event::fake([Verified::class]);
        $user = User::factory()->unverified()->create();

        $this->get($this->link($user))->assertRedirect('http://localhost:5173/dashboard?verified=1');

        $this->assertTrue($user->fresh()->hasVerifiedEmail());
        Event::assertDispatched(Verified::class);
    }

    public function test_with_verification_switched_off_every_account_counts_as_confirmed(): void
    {
        Notification::fake();
        config(['auth.verify_email' => false]);
        $user = User::factory()->unverified()->create();

        $this->assertTrue($user->hasVerifiedEmail());
        $user->sendEmailVerificationNotification();
        Notification::assertNothingSent();
        $this->actingAs($user)->spa()->getJson('/api/user')->assertJsonPath('email_verified', true);
    }

    public function test_a_link_for_another_address_does_nothing(): void
    {
        $user = User::factory()->unverified()->create();

        $this->get($this->link($user, sha1('someone@else.com')))
            ->assertRedirect('http://localhost:5173/login?error=verification_invalid');

        $this->assertFalse($user->fresh()->hasVerifiedEmail());
    }

    public function test_tampered_links_are_refused(): void
    {
        $user = User::factory()->unverified()->create();

        $this->get($this->link($user).'x')->assertForbidden();
        $this->assertFalse($user->fresh()->hasVerifiedEmail());
    }

    public function test_the_confirmation_email_can_be_sent_again(): void
    {
        Notification::fake();
        $user = User::factory()->unverified()->create();

        $this->actingAs($user)->spa()->postJson('/api/auth/email/verification-notification')->assertAccepted();

        Notification::assertSentTo($user, VerifyEmail::class);
    }
}

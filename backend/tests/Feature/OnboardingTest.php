<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\TextGenerator;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OnboardingTest extends TestCase
{
    use RefreshDatabase;

    /** Stands in for the writing model, and keeps the prompts it was given. */
    private function fakeGenerator(bool $enabled = true): TextGenerator
    {
        $fake = new class($enabled) implements TextGenerator
        {
            /** @var list<string> */
            public array $prompts = [];

            public function __construct(private bool $on) {}

            public function enabled(): bool
            {
                return $this->on;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                $this->prompts[] = $prompt;
                yield 'Hello from ';
                yield 'Maison Cire.';
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                throw new GenerationFailed('Onboarding never asks for JSON.');
            }
        };

        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    private function newcomer(array $preferences = []): User
    {
        return User::factory()->unverified()->create(['preferences' => ['onboarding' => 'pending', ...$preferences]]);
    }

    private function firstPost(array $overrides = []): array
    {
        return array_merge([
            'brief' => 'Introduce Maison Cire: hand-poured candles for slow evenings.',
            'format' => 'text',
            'platforms' => ['instagram'],
            'tone' => 'friendly',
        ], $overrides);
    }

    public function test_a_new_account_starts_onboarding(): void
    {
        $this->spa()->postJson('/api/auth/register', [
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'correct horse battery staple',
            'platforms' => ['instagram'],
            'terms' => true,
        ])->assertCreated()->assertJsonPath('preferences.onboarding', 'pending');
    }

    public function test_accounts_from_before_onboarding_are_not_sent_through_it(): void
    {
        $this->actingAs(User::factory()->create(['preferences' => ['platforms' => ['x']]]))
            ->spa()->getJson('/api/user')
            ->assertJsonPath('preferences.onboarding', 'done')
            ->assertJsonPath('preferences.studio', null);
    }

    public function test_finishing_names_the_studio_and_keeps_the_rest(): void
    {
        $user = $this->newcomer(['platforms' => ['instagram']]);

        $this->actingAs($user)->spa()->patchJson('/api/user', ['preferences' => ['onboarding' => 'done', 'studio' => 'Maison Cire']])
            ->assertOk()
            ->assertJsonPath('preferences.onboarding', 'done')
            ->assertJsonPath('preferences.studio', 'Maison Cire')
            ->assertJsonPath('preferences.platforms', ['instagram']);
    }

    public function test_onboarding_cannot_be_reopened_and_the_server_keeps_its_own_keys(): void
    {
        $this->actingAs($this->newcomer(['first_post_tries' => 2]))->spa();

        $this->patchJson('/api/user', ['preferences' => ['onboarding' => 'pending']])->assertJsonValidationErrors('preferences.onboarding');
        $this->patchJson('/api/user', ['preferences' => ['first_post_tries' => 0]])->assertJsonValidationErrors('preferences');
    }

    public function test_the_first_post_is_written_before_the_email_is_confirmed_in_the_accounts_voice(): void
    {
        $fake = $this->fakeGenerator();
        $user = $this->newcomer();
        $account = $user->accounts()->create(['platform' => 'instagram', 'handle' => 'maisoncire', 'name' => 'Maison Cire', 'profile' => ['tone' => 'warm, unhurried']]);

        $response = $this->actingAs($user)->spa()->postJson('/api/onboarding/first-post', $this->firstPost(['account_id' => $account->id]));

        $response->assertOk();
        $this->assertStringContainsString('Maison Cire.', $response->streamedContent());
        $this->assertStringContainsString('@maisoncire', $fake->prompts[0]);
        $this->assertStringContainsString('warm, unhurried', $fake->prompts[0]);
        $this->assertSame(1, $user->fresh()->preferences['first_post_tries']);
    }

    public function test_there_are_two_tries_and_only_while_onboarding(): void
    {
        $this->fakeGenerator();

        $this->actingAs($this->newcomer(['first_post_tries' => 2]))->spa()->postJson('/api/onboarding/first-post', $this->firstPost())->assertForbidden();
        $this->actingAs(User::factory()->unverified()->create())->spa()->postJson('/api/onboarding/first-post', $this->firstPost())->assertForbidden();
    }

    public function test_ai_being_off_does_not_use_up_a_try(): void
    {
        $this->fakeGenerator(enabled: false);
        $user = $this->newcomer();

        $this->actingAs($user)->spa()->postJson('/api/onboarding/first-post', $this->firstPost())->assertStatus(503);
        $this->assertArrayNotHasKey('first_post_tries', $user->fresh()->preferences);
    }
}

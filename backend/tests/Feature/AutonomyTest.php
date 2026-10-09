<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\User;
use App\Services\Ai\TextGenerator;
use App\Services\Studio\Autonomy;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AutonomyTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Account $account;

    protected function setUp(): void
    {
        parent::setUp();
        $this->user = User::factory()->create();
        $this->account = Account::factory()->for($this->user)->create(['autonomy' => 'approve_all']);
    }

    /** Claude, played by a fake that proposes one tone change. */
    private function fakeAi(): void
    {
        $this->app->instance(TextGenerator::class, new class implements TextGenerator
        {
            public function enabled(): bool
            {
                return true;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                yield 'x';
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                return ['changes' => [['field' => 'tone', 'to' => 'Quietly confident', 'reason' => 'The liked posts read calm.']]];
            }
        });
    }

    public function test_the_matrix_shows_every_action_and_mode_a_always_asks(): void
    {
        $out = $this->spa()->actingAs($this->user)->getJson("/api/accounts/{$this->account->id}/autonomy")->assertOk()->json();

        $this->assertSame('approve_all', $out['mode']);
        $this->assertCount(5, $out['matrix']);
        foreach ($out['matrix'] as $row) {
            $this->assertSame('asks', $row['now']);
        }
        $this->assertSame(['publish.approved_post', 'profile.apply_ai_change', 'comment.send_reply', 'repost.schedule', 'flow.schedule_post'], array_column($out['matrix'], 'action'));

        // Not another studio's account.
        $this->spa()->actingAs(User::factory()->create())->getJson("/api/accounts/{$this->account->id}/autonomy")->assertForbidden();
    }

    public function test_rules_are_added_listed_and_removed_with_validation(): void
    {
        $this->account->update(['autonomy' => 'rules']);

        $this->spa()->actingAs($this->user)->postJson("/api/accounts/{$this->account->id}/autonomy/rules", ['action' => 'nonsense'])
            ->assertUnprocessable();

        $rule = $this->spa()->actingAs($this->user)->postJson("/api/accounts/{$this->account->id}/autonomy/rules", ['action' => 'profile.apply_ai_change'])
            ->assertCreated()->json();
        $this->assertSame('profile.apply_ai_change', $rule['action']);
        $this->assertTrue($rule['allow']);

        $out = $this->spa()->actingAs($this->user)->getJson("/api/accounts/{$this->account->id}/autonomy")->json();
        $this->assertCount(1, $out['rules']);
        $row = collect($out['matrix'])->firstWhere('action', 'profile.apply_ai_change');
        $this->assertSame('runs', $row['now']);
        $this->assertSame($rule['id'], $row['rule_id']);

        $this->spa()->actingAs($this->user)->deleteJson("/api/accounts/{$this->account->id}/autonomy/rules/{$rule['id']}")->assertNoContent();
        $out = $this->spa()->actingAs($this->user)->getJson("/api/accounts/{$this->account->id}/autonomy")->json();
        $this->assertSame('asks', collect($out['matrix'])->firstWhere('action', 'profile.apply_ai_change')['now']);
    }

    public function test_a_deny_rule_carves_out_an_exception_and_limits_narrow_an_allow(): void
    {
        $this->account->update(['autonomy' => 'rules']);
        $autonomy = app(Autonomy::class);

        $this->account->rules()->create(['action' => 'comment.send_reply', 'allow' => true, 'created_by' => $this->user->id]);
        $this->assertSame('run', $autonomy->decide($this->account, 'comment.send_reply'));

        // A deny rule for the same kind wins over the allow.
        $this->account->rules()->create(['action' => 'comment.send_reply', 'allow' => false, 'conditions' => ['platform' => 'instagram'], 'created_by' => $this->user->id]);
        $this->assertSame('ask', $autonomy->decide($this->account, 'comment.send_reply', ['platform' => 'instagram']));
        $this->assertSame('run', $autonomy->decide($this->account, 'comment.send_reply', ['platform' => 'tiktok']));

        // max_per_day narrows the allow: at the cap it asks again.
        $this->account->rules()->where('allow', false)->delete();
        $this->account->rules()->delete();
        $this->account->rules()->create(['action' => 'comment.send_reply', 'allow' => true, 'conditions' => ['max_per_day' => 3], 'created_by' => $this->user->id]);
        $this->assertSame('run', $autonomy->decide($this->account, 'comment.send_reply', ['today' => 2]));
        $this->assertSame('ask', $autonomy->decide($this->account, 'comment.send_reply', ['today' => 3]));

        // Mode A ignores rules entirely.
        $this->account->update(['autonomy' => 'approve_all']);
        $this->assertSame('ask', $autonomy->decide($this->account, 'comment.send_reply', ['today' => 0]));
    }

    public function test_the_preview_says_what_would_happen_to_what_is_waiting(): void
    {
        $this->account->update(['autonomy' => 'rules']);
        $this->account->profileChanges()->create([
            'field' => 'tone', 'to' => 'Quietly confident', 'reason' => 'x', 'source' => 'ai', 'status' => 'pending',
        ]);

        $before = $this->spa()->actingAs($this->user)->getJson("/api/accounts/{$this->account->id}/autonomy/preview")->assertOk()->json('items');
        $this->assertSame('Would wait for you', $before[0]['verdict']);

        $this->account->rules()->create(['action' => 'profile.apply_ai_change', 'allow' => true, 'created_by' => $this->user->id]);
        $after = $this->spa()->actingAs($this->user)->getJson("/api/accounts/{$this->account->id}/autonomy/preview")->json('items');
        $this->assertSame('Would apply on its own', $after[0]['verdict']);
        $this->assertSame('profile.apply_ai_change', $after[0]['kind']);
    }

    public function test_mode_b_applies_ai_profile_suggestions_on_their_own(): void
    {
        $this->fakeAi();
        // Something to learn from: a liked post.
        $this->account->memories()->create(['kind' => 'example', 'content' => 'A calm post about the atelier.', 'source' => 'operator']);

        // Mode A: the suggestion waits for approval.
        $this->spa()->actingAs($this->user)->postJson("/api/accounts/{$this->account->id}/profile/suggest")->assertCreated();
        $change = $this->account->profileChanges()->sole();
        $this->assertSame('pending', $change->status);
        $this->assertArrayNotHasKey('tone', $this->account->fresh()->profile ?? []);

        // Mode B with a covering rule: it applies itself and says so on the record.
        $this->account->update(['autonomy' => 'rules']);
        $this->account->rules()->create(['action' => 'profile.apply_ai_change', 'allow' => true, 'created_by' => $this->user->id]);
        $this->spa()->actingAs($this->user)->postJson("/api/accounts/{$this->account->id}/profile/suggest")->assertCreated();
        $change = $this->account->profileChanges()->latest('id')->first();
        $this->assertSame('approved', $change->status);
        $this->assertSame('Quietly confident', $this->account->fresh()->profile['tone']);
    }
}

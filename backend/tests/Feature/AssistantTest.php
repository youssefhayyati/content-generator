<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\ItemVariant;
use App\Models\Post;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AssistantTest extends TestCase
{
    use RefreshDatabase;

    private function draft(array $overrides = []): array
    {
        return array_merge([
            'title' => 'Fig & Cedar',
            'body' => 'Our new candle lands Friday.',
            'format' => 'text',
            'platforms' => ['x'],
            'status' => 'draft',
        ], $overrides);
    }

    /** What the Assistant page does: ask for a token with the person's own session. */
    private function token(User $user): string
    {
        return $this->actingAs($user)->spa()->postJson('/api/assistant/session')
            ->assertOk()
            ->assertJsonStructure(['token', 'expires_at'])
            ->json('token');
    }

    /** The assistant's requests: the token, no session. */
    private function assistant(string $token): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withHeaders(['Authorization' => "Bearer {$token}", 'Accept' => 'application/json']);
    }

    public function test_the_assistant_works_as_the_person_who_opened_it(): void
    {
        $user = User::factory()->create();
        Post::factory()->for($user)->create();
        Post::factory()->create();
        $token = $this->token($user);

        $this->assistant($token)->getJson('/api/user')->assertOk()->assertJsonPath('email', $user->email);
        $this->assistant($token)->getJson('/api/posts')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_it_saves_drafts_but_only_a_person_schedules(): void
    {
        $user = User::factory()->create();
        $token = $this->token($user);

        $id = $this->assistant($token)->postJson('/api/posts', $this->draft())->assertCreated()->json('id');
        $this->assistant($token)->patchJson("/api/posts/{$id}", $this->draft(['body' => 'Friday, 9am.']))
            ->assertOk()->assertJsonPath('body', 'Friday, 9am.');

        $later = now()->addDay()->toIso8601String();
        $this->assistant($token)->patchJson("/api/posts/{$id}", $this->draft(['status' => 'scheduled', 'scheduled_at' => $later]))
            ->assertUnprocessable()->assertJsonValidationErrors(['status', 'scheduled_at']);
        $this->assistant($token)->patchJson("/api/posts/{$id}", $this->draft(['queue' => true]))
            ->assertUnprocessable()->assertJsonValidationErrors('queue');
        $this->assertNull(Post::find($id)->approved_at);

        // The person approves on the page, with their own session.
        $this->app['auth']->forgetGuards();
        $this->actingAs($user)->spa()->patchJson("/api/posts/{$id}", $this->draft(['status' => 'scheduled', 'scheduled_at' => $later]))
            ->assertOk()->assertJsonPath('status', 'scheduled');
        $this->assertSame($user->id, Post::find($id)->approved_by);
    }

    public function test_it_reaches_only_what_its_tools_use(): void
    {
        $user = User::factory()->create();
        $id = Post::factory()->for($user)->create()->id;
        $token = $this->token($user);

        $this->assistant($token)->deleteJson("/api/posts/{$id}")->assertForbidden();
        $this->assistant($token)->patchJson('/api/user', ['name' => 'Someone else'])->assertForbidden();
        $this->assistant($token)->getJson('/api/overview')->assertForbidden();
        $this->assistant($token)->postJson('/api/assistant/session')->assertForbidden();
        $this->assertDatabaseHas('posts', ['id' => $id]);
    }

    public function test_signing_out_ends_its_sessions(): void
    {
        $user = User::factory()->create();
        $token = $this->token($user);

        $this->actingAs($user)->spa()->postJson('/api/auth/logout')->assertNoContent();
        $this->assistant($token)->getJson('/api/user')->assertUnauthorized();
    }

    /** A campaign at gate 6B: one post, its Instagram version approved and booked for tomorrow. */
    private function campaign(User $user): ItemVariant
    {
        $account = Account::factory()->for($user)->create();
        $photo = Asset::factory()->for($user)->create();
        $campaign = $user->campaigns()->create(['name' => 'Autumn launch', 'source' => 'form', 'depth' => 'quick', 'mode' => 'script', 'fields' => [], 'messages' => [], 'stage' => 'scheduled', 'account_ids' => [$account->id]]);
        $item = $campaign->items()->create(['position' => 0, 'title' => 'Fig & Cedar', 'format' => 'image', 'caption' => 'Warm fig, soft cedar.', 'asset_ids' => [$photo->id], 'account_ids' => [$account->id], 'status' => 'ready']);
        $variant = $item->variants()->create(['account_id' => $account->id, 'caption' => 'Warm fig, soft cedar.', 'placement' => 'feed', 'checks' => ['ok' => true], 'qa' => ['status' => 'pass'], 'status' => 'approved', 'approved_at' => now(), 'approved_by' => $user->id]);
        $post = $user->posts()->create(['account_id' => $account->id, 'campaign_id' => $campaign->id, 'variant_id' => $variant->id, 'title' => 'Fig & Cedar', 'body' => 'Warm fig, soft cedar.', 'format' => 'image', 'placement' => 'feed', 'platforms' => ['instagram'], 'status' => 'scheduled', 'scheduled_at' => now()->addDay(), 'approved_at' => now(), 'approved_by' => $user->id]);
        $post->syncAssets([$photo->id]);

        return $variant;
    }

    public function test_it_changes_a_campaign_post_and_a_person_approves_it_again(): void
    {
        $user = User::factory()->create();
        $variant = $this->campaign($user);
        $campaign = $variant->item->campaign;
        $token = $this->token($user);

        $this->assistant($token)->getJson('/api/campaigns')->assertOk()->assertJsonPath('0.title', 'Autumn launch');
        $this->assistant($token)->getJson("/api/campaigns/{$campaign->id}")->assertOk();
        $this->assistant($token)->getJson("/api/campaigns/{$campaign->id}/items")->assertOk()
            ->assertJsonPath('0.variants.0.assets', null)
            ->assertJsonPath('0.variants.0.posts.0.status', 'scheduled');

        // Its own slides for this account, and a new caption: back to gate 6B.
        $slide = Asset::factory()->for($user)->create();
        $this->assistant($token)->patchJson("/api/campaigns/{$campaign->id}/variants/{$variant->id}", ['caption' => 'Fig & Cedar is here.', 'asset_ids' => [$slide->id]])
            ->assertOk()
            ->assertJsonPath('variants.0.status', 'draft')
            ->assertJsonPath('variants.0.assets.0.id', $slide->id);
        $someoneElses = Asset::factory()->create();
        $this->assistant($token)->patchJson("/api/campaigns/{$campaign->id}/variants/{$variant->id}", ['caption' => 'x', 'asset_ids' => [$someoneElses->id]])
            ->assertJsonValidationErrors('asset_ids.0');

        // Approving is the person's: the booked time then carries the new version.
        $this->assistant($token)->postJson("/api/campaigns/{$campaign->id}/variants/{$variant->id}/approve")->assertForbidden();
        $post = Post::where('variant_id', $variant->id)->first();
        $this->assertSame('Warm fig, soft cedar.', $post->body);

        $this->app['auth']->forgetGuards();
        $this->actingAs($user)->spa()->postJson("/api/campaigns/{$campaign->id}/variants/{$variant->id}/approve")->assertOk();
        $post->refresh();
        $this->assertSame('Fig & Cedar is here.', $post->body);
        $this->assertSame([$slide->id], $post->assets->pluck('id')->all());
        $this->assertSame('scheduled', $post->status->value);
    }

    public function test_before_its_versions_exist_it_changes_the_post_itself(): void
    {
        $user = User::factory()->create();
        $item = $this->campaign($user)->item;
        $campaign = $item->campaign;
        $token = $this->token($user);

        $this->assistant($token)->patchJson("/api/campaigns/{$campaign->id}/items/{$item->id}", ['title' => 'Fig & Cedar, Friday', 'caption' => 'Out Friday.'])
            ->assertOk()->assertJsonPath('caption', 'Out Friday.');
        $slide = Asset::factory()->for($user)->create();
        $this->assistant($token)->putJson("/api/campaigns/{$campaign->id}/items/{$item->id}/media", ['asset_ids' => [$slide->id]])
            ->assertOk()->assertJsonPath('assets.0.id', $slide->id);
        // Planning, approving the plan and booking stay the person's.
        $this->assistant($token)->postJson("/api/campaigns/{$campaign->id}/approve-plan")->assertForbidden();
        $this->assistant($token)->postJson("/api/campaigns/{$campaign->id}/schedule", ['from' => now()->toDateString(), 'to' => now()->addWeek()->toDateString()])->assertForbidden();
        $this->assistant($token)->deleteJson("/api/campaigns/{$campaign->id}")->assertForbidden();
    }

    public function test_unconfirmed_accounts_get_the_assistant(): void
    {
        $this->actingAs(User::factory()->unverified()->create())->spa()->postJson('/api/assistant/session')->assertOk();
    }
}

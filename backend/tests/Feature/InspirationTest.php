<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class InspirationTest extends TestCase
{
    use RefreshDatabase;

    public function test_boards_are_private_and_saving_the_same_link_updates_it(): void
    {
        $this->actingAs(User::factory()->create());
        $body = ['url' => 'https://www.youtube.com/shorts/gduYQKmz05M', 'title' => 'A hook', 'board' => 'Ideas'];
        $id = $this->spa()->postJson('/api/inspirations', $body)->assertCreated()->json('id');
        $this->spa()->postJson('/api/inspirations', array_merge($body, ['notes' => 'New angle']))->assertCreated();
        $this->spa()->getJson('/api/inspirations')->assertJsonCount(1)->assertJsonPath('0.notes', 'New angle');
        $this->actingAs(User::factory()->create());
        $this->spa()->getJson('/api/inspirations')->assertExactJson([]);
        $this->spa()->deleteJson("/api/inspirations/{$id}")->assertNotFound();
        $this->spa()->postJson('/api/inspirations', array_merge($body, ['url' => 'https://localhost/internal']))->assertStatus(422);
    }

    public function test_discovery_parses_a_feed_and_does_not_fetch_user_urls(): void
    {
        Http::preventStrayRequests();
        Http::fake(['www.youtube.com/feeds/*' => Http::response('<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>gduYQKmz05M</yt:videoId><title>Example short</title><link href="https://www.youtube.com/shorts/gduYQKmz05M"/><published>2026-10-07T21:30:06+00:00</published><author><name>TED</name></author></entry></feed>')]);
        $this->actingAs(User::factory()->create())->spa()->getJson('/api/inspirations/discover?channel=UCaaaaaaaaaaaaaaaaaaaaaa')
            ->assertOk()->assertJsonPath('items.0.short', true)->assertJsonPath('items.0.creator', 'TED');
        $this->spa()->getJson('/api/inspirations/discover?channel=https://localhost')->assertUnprocessable();
    }
}

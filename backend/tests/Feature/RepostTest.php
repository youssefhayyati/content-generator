<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Post;
use App\Models\Repost;
use App\Models\User;
use App\Services\Ai\TextGenerator;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Reposts both ways: paste an X or Instagram link, the post is read (text, author, media),
 * permission is recorded, it's adapted for the other network and scheduled as a post with
 * the source's media, crediting the author within the target's limits.
 */
class RepostTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Account $ig;

    private Account $x;

    public static string $caption = 'One small step, poured into a post for X.';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->user = User::factory()->create();
        $this->ig = Account::factory()->for($this->user)->create(['platform' => 'instagram', 'handle' => 'maisoncire']);
        $this->x = Account::factory()->for($this->user)->create(['platform' => 'x', 'handle' => 'maisoncire']);
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
                return ['caption' => RepostTest::$caption, 'hashtags' => ['#space', 'moon', 'apollo', 'nasa']];
            }
        });
    }

    private function png(): string
    {
        return UploadedFile::fake()->image('p.png', 1080, 1080)->get();
    }

    private function fakeInstagram(): void
    {
        $html = '<html><head>'
            .'<meta name="twitter:title" content="NASA (&#064;nasa) &#x2022; Instagram photo" />'
            .'<meta name="description" content="792K likes, 7,334 comments - nasa on July 20, 2024: &quot;&#x201c;One small step for [a] man.&#x201d; #Apollo11&quot;. " />'
            .'<meta property="og:image" content="https://scontent.cdninstagram.com/v/t51/photo.jpg?x=1&amp;y=2" />'
            .'</head></html>';
        Http::fake([
            'www.instagram.com/p/C9paqbwppEM/' => Http::response($html),
            'scontent.cdninstagram.com/*' => Http::response($this->png(), 200, ['Content-Type' => 'image/png']),
        ]);
    }

    private function allowAndAdapt(int $id): array
    {
        $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$id}/permission", ['decision' => 'allowed', 'note' => 'Public domain: NASA media.'])->assertOk();

        return $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$id}/adapt")->assertOk()->json();
    }

    public function test_an_instagram_post_is_read_adapted_and_scheduled_on_x_with_its_photo(): void
    {
        $this->fakeInstagram();
        $picked = $this->spa()->actingAs($this->user)->postJson('/api/reposts', [
            'account_id' => $this->x->id, 'source_url' => 'https://www.instagram.com/p/C9paqbwppEM/?igsh=abc',
        ])->assertCreated()->json();
        $this->assertSame('instagram', $picked['source_platform']);

        $read = $this->spa()->actingAs($this->user)->getJson('/api/reposts')->json(0);
        $this->assertSame('captured', $read['status']); // the queue is sync in tests
        $this->assertSame('nasa', $read['author']);
        $this->assertSame('“One small step for [a] man.” #Apollo11', $read['source_text']);
        $this->assertCount(1, $read['media']);
        $this->assertSame('image', $read['media'][0]['kind']);

        $adapted = $this->allowAndAdapt($read['id']);
        $this->assertCount(2, $adapted['hashtags']); // X: two at most

        $done = $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$read['id']}/schedule")->assertCreated()->json();
        $post = Post::findOrFail($done['post_id']);
        $this->assertSame(['x'], $post->platforms);
        $this->assertSame('image', $post->format->value);
        $this->assertSame([$read['media'][0]['id']], $post->assets()->pluck('assets.id')->all());
        $this->assertStringContainsString('Credit: @nasa on Instagram', $post->body);
        $this->assertLessThanOrEqual(280, mb_strlen($post->body));
        $this->assertTrue($post->isApproved());
    }

    public function test_a_long_adaptation_is_shortened_for_x_but_keeps_the_credit(): void
    {
        $this->fakeInstagram();
        self::$caption = str_repeat('Words that go on and on. ', 30);
        $id = $this->spa()->actingAs($this->user)->postJson('/api/reposts', [
            'account_id' => $this->x->id, 'source_url' => 'https://www.instagram.com/p/C9paqbwppEM/',
        ])->json('id');
        $this->allowAndAdapt($id);
        $post = Post::findOrFail($this->spa()->actingAs($this->user)->postJson("/api/reposts/{$id}/schedule")->json('post_id'));

        $this->assertLessThanOrEqual(280, mb_strlen($post->body));
        $this->assertStringContainsString('Credit: @nasa on Instagram', $post->body);
        $this->assertStringContainsString('…', $post->body);
        self::$caption = 'One small step, poured into a post for X.';
    }

    public function test_an_x_post_is_read_with_its_photo_and_goes_to_instagram(): void
    {
        Http::fake([
            'api.fxtwitter.com/status/123' => Http::response(['code' => 200, 'tweet' => [
                'text' => 'We pour forty candles at a time.',
                'author' => ['screen_name' => 'slowmade'],
                'media' => ['all' => [['type' => 'photo', 'url' => 'https://pbs.twimg.com/media/abc.jpg']]],
            ]]),
            'pbs.twimg.com/*' => Http::response($this->png(), 200, ['Content-Type' => 'image/png']),
        ]);
        $id = $this->spa()->actingAs($this->user)->postJson('/api/reposts', [
            'account_id' => $this->ig->id, 'source_url' => 'https://x.com/slowmade/status/123',
        ])->assertCreated()->json('id');
        $repost = Repost::findOrFail($id);
        $this->assertSame('slowmade', $repost->author);
        $this->assertCount(1, $repost->asset_ids);

        $this->allowAndAdapt($id);
        $post = Post::findOrFail($this->spa()->actingAs($this->user)->postJson("/api/reposts/{$id}/schedule")->assertCreated()->json('post_id'));
        $this->assertSame(['instagram'], $post->platforms);
        $this->assertSame('feed', $post->placement);
        $this->assertSame(1, $post->assets()->count());
        $this->assertStringContainsString('Credit: @slowmade on X', $post->body);
    }

    public function test_instagram_needs_media_and_takes_an_upload_when_the_source_had_none(): void
    {
        Http::fake(['api.fxtwitter.com/*' => Http::response(['code' => 200, 'tweet' => ['text' => 'Just words.', 'author' => ['screen_name' => 'slowmade']]])]);
        $id = $this->spa()->actingAs($this->user)->postJson('/api/reposts', [
            'account_id' => $this->ig->id, 'source_url' => 'https://twitter.com/slowmade/status/9',
        ])->json('id');
        $this->allowAndAdapt($id);

        $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$id}/schedule")->assertUnprocessable()->assertJsonValidationErrors('asset_ids');

        $asset = $this->spa()->actingAs($this->user)->post('/api/assets', ['files' => [UploadedFile::fake()->image('cover.png', 1080, 1080)]])->json(0);
        $post = Post::findOrFail($this->spa()->actingAs($this->user)->postJson("/api/reposts/{$id}/schedule", ['asset_ids' => [$asset['id']]])->assertCreated()->json('post_id'));
        $this->assertSame([$asset['id']], $post->assets()->pluck('assets.id')->all());
    }

    public function test_a_post_that_cannot_be_read_fails_and_can_be_read_again(): void
    {
        Http::fakeSequence('api.fxtwitter.com/*')
            ->push(['code' => 404, 'message' => 'NOT_FOUND'], 404)
            ->push(['code' => 200, 'tweet' => ['text' => 'Back now.', 'author' => ['screen_name' => 'slowmade']]]);
        $id = $this->spa()->actingAs($this->user)->postJson('/api/reposts', [
            'account_id' => $this->ig->id, 'source_url' => 'https://x.com/slowmade/status/1',
        ])->json('id');
        $this->assertSame('failed', Repost::find($id)->status);
        $this->assertStringContainsString('private or deleted', Repost::find($id)->error);

        $this->spa()->actingAs($this->user)->postJson("/api/reposts/{$id}/fetch")->assertOk();
        $this->assertSame('captured', Repost::find($id)->status);
        $this->assertSame('Back now.', Repost::find($id)->source_text);
    }

    public function test_links_and_targets_are_checked(): void
    {
        Http::fake();
        $this->spa()->actingAs($this->user)->postJson('/api/reposts', [
            'account_id' => $this->x->id, 'source_url' => 'https://example.com/post/1',
        ])->assertUnprocessable()->assertJsonValidationErrors('source_url');
        // Same network both ends isn't a repost.
        $this->spa()->actingAs($this->user)->postJson('/api/reposts', [
            'account_id' => $this->x->id, 'source_url' => 'https://x.com/a/status/1',
        ])->assertUnprocessable()->assertJsonValidationErrors('account_id');
        $this->assertSame(0, Repost::count());
        Http::assertNothingSent();
    }
}

<?php

namespace Tests\Feature;

use App\Models\Campaign;
use App\Models\User;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\TextGenerator;
use App\Services\Intake\Brief;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\TestCase;

class CampaignTest extends TestCase
{
    use RefreshDatabase;

    /** A 1×1 PNG: real enough for the image rules, without needing GD. */
    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    /**
     * Stands in for Claude: answers JSON requests from a queue (a GenerationFailed in the queue is
     * thrown instead), streams fixed chunks, and keeps every request.
     */
    private function fakeClaude(array $replies = [], array $chunks = ['## Brand ', 'snapshot'], bool $enabled = true): TextGenerator
    {
        $fake = new class($replies, $chunks, $enabled) implements TextGenerator
        {
            /** @var list<array<string, mixed>> */
            public array $calls = [];

            public function __construct(private array $replies, private array $chunks, private bool $on) {}

            public function enabled(): bool
            {
                return $this->on;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                $this->calls[] = ['kind' => 'stream'] + compact('model', 'system', 'prompt', 'effort');
                yield from $this->chunks;
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                $this->calls[] = ['kind' => 'json'] + compact('model', 'system', 'content', 'schema', 'effort');
                $next = array_shift($this->replies) ?? throw new LogicException('Claude was asked more than the test expected.');
                if ($next instanceof GenerationFailed) {
                    throw $next;
                }

                return $next;
            }
        };

        $this->app->instance(TextGenerator::class, $fake);
        // The interview and the kit run on whatever ai.intake.model names, resolved through the
        // registry. Pin it at the fake's provider so these tests assert the configured model is
        // honoured, instead of depending on which model the catalog happens to list first.
        config(['ai.intake.model' => 'anthropic/claude-opus-5-5']);

        return $fake;
    }

    /** Claude's reply to an interview turn: the brief with these fields filled, and the next question. */
    private function turn(array $fields = [], string $question = 'What do you sell, exactly?', array $extra = []): array
    {
        return [
            'fields' => array_merge(Brief::blank(), $fields),
            'question' => $question,
            'options' => ['Candles', 'Soap'],
            'topic' => 'offer',
            'photo_request' => false,
            'done' => false,
            ...$extra,
        ];
    }

    private function start(User $user, string $depth = 'quick'): Campaign
    {
        $id = $this->actingAs($user)->spa()->postJson('/api/campaigns', ['depth' => $depth])->assertCreated()->json('id');

        return Campaign::findOrFail($id);
    }

    private function png(string $name = 'photo.png'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, base64_decode(self::PNG));
    }

    /**
     * @return list<array{event: string, data: mixed}>
     */
    private function events(TestResponse $response): array
    {
        preg_match_all('/^event: (\w+)\ndata: (.*)$/m', $response->streamedContent(), $matches, PREG_SET_ORDER);

        return array_map(fn (array $m) => ['event' => $m[1], 'data' => json_decode($m[2], true)], $matches);
    }

    public function test_guests_cannot_reach_campaigns(): void
    {
        $this->spa()->getJson('/api/campaigns')->assertUnauthorized();
        $this->spa()->postJson('/api/campaigns', ['depth' => 'quick'])->assertUnauthorized();
    }

    public function test_an_interview_starts_on_the_first_question(): void
    {
        $this->fakeClaude();

        $response = $this->actingAs(User::factory()->create())->spa()->postJson('/api/campaigns', ['depth' => 'quick']);

        $response->assertCreated()
            ->assertJsonPath('mode', 'ai')
            ->assertJsonPath('ai_available', true)
            ->assertJsonPath('complete', false)
            ->assertJsonPath('filled', 0)
            ->assertJsonPath('total', 25)
            ->assertJsonPath('pending', 'focus')
            ->assertJsonPath('messages.1', ['who' => 'client', 'text' => 'Quick'])
            ->assertJsonPath('messages.2.text', 'Quick it is. Are we promoting you as a person, a product, or your business?')
            ->assertJsonPath('prompt.options.0', 'Me (personal brand)')
            ->assertJsonPath('brief.0.label', 'Basics')
            ->assertJsonPath('brief.0.fields.0', ['key' => 'focus', 'label' => 'What we’re promoting', 'value' => '', 'suggested' => false]);

        $this->spa()->postJson('/api/campaigns', ['depth' => 'forever'])->assertJsonValidationErrors('depth');
    }

    public function test_without_ai_the_standard_questions_run_the_interview(): void
    {
        $fake = $this->fakeClaude(enabled: false);
        $campaign = $this->start(User::factory()->create());
        $this->assertSame('script', $campaign->mode);

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'A product'])
            ->assertOk()
            ->assertJsonPath('brief.0.fields.0.value', 'A product')
            ->assertJsonPath('pending', 'business')
            ->assertJsonPath('messages.4.text', 'Tell me about your business or what you do.');

        // A quick interview only covers the quick fields, then wraps up.
        foreach (array_slice(Brief::QUICK, 1) as $key) {
            $response = $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => "Answer for {$key}"])->assertOk();
        }
        $response->assertJsonPath('complete', true)
            ->assertJsonPath('filled', count(Brief::QUICK))
            ->assertJsonPath('messages.'.(count($response->json('messages')) - 1).'.text', 'Your brief is complete. Copy it or download the package to share it.');

        $this->assertSame([], $fake->calls);

        // An unconfirmed account gets the standard questions too, even with AI switched on.
        $this->fakeClaude();
        $this->assertSame('script', $this->start(User::factory()->unverified()->create())->mode);
    }

    public function test_claude_fills_the_brief_and_asks_the_next_question(): void
    {
        $fake = $this->fakeClaude([
            $this->turn(['focus' => 'A product', 'business' => 'Hand-poured candles from Lyon']),
        ]);
        $campaign = $this->start(User::factory()->create());

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'A product: my candles, poured by hand in Lyon'])
            ->assertOk()
            ->assertJsonPath('title', 'Hand-poured candles from Lyon')
            ->assertJsonPath('filled', 2)
            ->assertJsonPath('asked', 2)
            ->assertJsonPath('pending', 'offer')
            ->assertJsonPath('messages.4', ['who' => 'agency', 'text' => 'What do you sell, exactly?'])
            ->assertJsonPath('prompt', ['options' => ['Candles', 'Soap'], 'photos' => false])
            ->assertJsonPath('brief.0.fields.1.value', 'Hand-poured candles from Lyon');

        $call = $fake->calls[0];
        $this->assertSame(['json', 'claude-opus-5-5', 'low'], [$call['kind'], $call['model'], $call['effort']]);
        $this->assertStringContainsString('- usp: What makes it different', $call['system']);
        $this->assertStringContainsString('QUICK MODE', $call['content']);
        $this->assertStringContainsString('Client: A product: my candles, poured by hand in Lyon', $call['content']);
        $this->assertStringContainsString('Questions asked so far: 1.', $call['content']);
        $this->assertSame(Brief::keys(), $call['schema']['properties']['fields']['required']);
    }

    public function test_claude_cannot_blank_a_field_and_its_options_are_kept_short(): void
    {
        $this->fakeClaude([
            $this->turn(['business' => 'Candles']),
            $this->turn(['business' => ''], 'Who buys them?', ['options' => ['One', 'Two', 'Three', 'Four', 'Five'], 'topic' => 'nonsense']),
        ]);
        $campaign = $this->start(User::factory()->create());

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'Candles']);
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'In Lyon'])
            ->assertJsonPath('brief.0.fields.1.value', 'Candles')
            ->assertJsonPath('prompt.options', ['One', 'Two', 'Three', 'Four'])
            ->assertJsonPath('pending', null);
    }

    public function test_the_interview_finishes_once_claude_is_done_and_the_fields_are_covered(): void
    {
        $quick = array_fill_keys(Brief::QUICK, 'Something real');
        $this->fakeClaude([
            // Claude says done too early: a quick field is still empty, so it keeps going.
            $this->turn(['focus' => 'A product'], 'And who buys them?', ['done' => true]),
            $this->turn([...$quick, 'tone' => 'Warm (suggested)'], '', ['done' => true]),
        ]);
        $campaign = $this->start(User::factory()->create());

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'Candles'])->assertJsonPath('complete', false);
        $response = $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'Women in their thirties'])
            ->assertJsonPath('complete', true)
            ->assertJsonPath('prompt', null)
            ->assertJsonPath('brief.3.fields.0', ['key' => 'tone', 'label' => 'Brand tone', 'value' => 'Warm (suggested)', 'suggested' => true]);

        $last = $response->json('messages.'.(count($response->json('messages')) - 1).'.text');
        $this->assertStringContainsString('I suggested some answers for you', $last);
        // The interview hands over rather than just stopping: the kit, then making the content.
        $this->assertStringContainsString('Want me to write your content kit, then start making the content?', $last);

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'More'])
            ->assertJsonValidationErrors(['text' => 'This interview is finished.']);
    }

    public function test_it_stops_asking_at_the_question_limit(): void
    {
        $this->fakeClaude([$this->turn()]);
        $campaign = $this->start(User::factory()->create());
        $campaign->update(['asked' => Brief::MAX_QUESTIONS['quick']]);

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'Candles'])->assertJsonPath('complete', true);
    }

    public function test_finishing_now_has_claude_suggest_the_rest(): void
    {
        $fake = $this->fakeClaude([$this->turn(['budget' => 'Under $500 (suggested)'], '', ['done' => true])]);
        $campaign = $this->start(User::factory()->create());

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['finish' => true])
            ->assertOk()
            ->assertJsonPath('complete', true);

        $this->assertStringContainsString('THE CLIENT ASKED TO FINISH NOW', $fake->calls[0]['content']);
    }

    public function test_a_failed_turn_keeps_the_answer_and_can_be_tried_again(): void
    {
        $this->fakeClaude([
            new GenerationFailed('Claude is busy right now. Give it a minute and try again.'),
            $this->turn(['focus' => 'A product']),
        ]);
        $campaign = $this->start(User::factory()->create());

        // Nothing to retry while a question is open.
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", [])->assertJsonValidationErrors(['text' => 'Answer the question first.']);

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'A product'])
            ->assertStatus(502)
            ->assertJsonPath('message', 'Claude is busy right now. Give it a minute and try again.');

        $this->spa()->getJson("/api/campaigns/{$campaign->id}")
            ->assertJsonPath('awaiting_reply', true)
            ->assertJsonPath('messages.3', ['who' => 'client', 'text' => 'A product']);

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", [])
            ->assertOk()
            ->assertJsonPath('awaiting_reply', false)
            ->assertJsonPath('messages.4.text', 'What do you sell, exactly?');
    }

    public function test_when_claude_goes_away_mid_interview_the_standard_questions_take_over(): void
    {
        $this->fakeClaude([$this->turn(['focus' => 'A product'], 'What do you sell?', ['topic' => 'offer'])]);
        $campaign = $this->start(User::factory()->create());
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'A product']);

        $this->fakeClaude(enabled: false);
        $response = $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'Lavender candles'])
            ->assertOk()
            ->assertJsonPath('mode', 'script')
            ->assertJsonPath('brief.0.fields.2.value', 'Lavender candles')
            ->assertJsonPath('pending', 'business');

        $this->assertContains(
            ['who' => 'note', 'text' => 'AI isn’t available right now, so I’ll continue with a standard question list.'],
            $response->json('messages'),
        );
    }

    public function test_answering_more_questions_drops_the_suggestions_and_carries_on(): void
    {
        $quick = array_fill_keys(Brief::QUICK, 'Real');
        $this->fakeClaude([
            $this->turn([...$quick, 'tone' => 'Bold (suggested)', 'usp' => 'Real difference'], '', ['done' => true]),
            $this->turn([], 'What tone fits you best?', ['topic' => 'tone']),
        ]);
        $campaign = $this->start(User::factory()->create());
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'All of it'])->assertJsonPath('complete', true);

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/deeper")
            ->assertOk()
            ->assertJsonPath('depth', 'full')
            ->assertJsonPath('complete', false)
            ->assertJsonPath('brief.3.fields.0.value', '')
            ->assertJsonPath('brief.0.fields.3.value', 'Real difference')
            ->assertJsonPath('pending', 'tone');
    }

    public function test_photos_are_kept_described_and_the_interview_moves_on(): void
    {
        $fake = $this->fakeClaude([
            ['photos' => [
                ['kind' => 'person', 'title' => 'Founder at work', 'description' => 'A woman pouring wax.'],
                ['kind' => 'product', 'title' => 'Amber jar', 'description' => 'A candle in an amber glass jar.'],
            ]],
            $this->turn([], 'Where should we post?', ['topic' => 'channels']),
        ]);
        $campaign = $this->start(User::factory()->create());

        $response = $this->spa()->post("/api/campaigns/{$campaign->id}/photos", ['photos' => [$this->png(), $this->png('jar.png')]])
            ->assertOk()
            ->assertJsonCount(2, 'photos')
            ->assertJsonPath('photos.0.kind', 'person')
            ->assertJsonPath('photos.1.title', 'Amber jar')
            ->assertJsonPath('brief.4.fields.1.value', '2 photos (1 person, 1 product)')
            ->assertJsonPath('messages.3.text', 'Shared 2 photos')
            ->assertJsonPath('messages.4.text', 'Where should we post?');

        $ids = $response->json('messages.3.photos');
        $this->assertCount(2, $ids);

        // Claude saw both images, labelled in order, and the next turn read what they show.
        $look = $fake->calls[0]['content'];
        $this->assertSame(['type' => 'text', 'text' => 'Photo 1:'], $look[0]);
        $this->assertSame(['type' => 'base64', 'mediaType' => 'image/png', 'data' => self::PNG], $look[1]['source']);
        $this->assertStringContainsString('[Shared 2 photo(s): person — A woman pouring wax.; product — A candle in an amber glass jar.]', $fake->calls[1]['content']);

        // The owner can see a photo; nobody else can. Removing one deletes the file.
        $photo = $campaign->photos()->first();
        Storage::disk('local')->assertExists($photo->path);
        $this->assertSame(base64_decode(self::PNG), $this->spa()->get($response->json('photos.0.url'))->assertOk()->streamedContent());

        $this->actingAs(User::factory()->create())->spa()->get($response->json('photos.0.url'))->assertForbidden();

        $this->actingAs($campaign->user)->spa()->deleteJson($response->json('photos.0.url'))
            ->assertOk()
            ->assertJsonCount(1, 'photos')
            ->assertJsonPath('messages.3.photos', [$ids[1]]);
        Storage::disk('local')->assertMissing($photo->path);
    }

    public function test_photo_uploads_are_checked(): void
    {
        $this->fakeClaude(enabled: false);
        $campaign = $this->start(User::factory()->create());
        $url = "/api/campaigns/{$campaign->id}/photos";

        $this->spa()->post($url, ['photos' => [UploadedFile::fake()->create('brief.pdf', 10, 'application/pdf')]])
            ->assertJsonValidationErrors(['photos.0' => 'Use JPG, PNG, WebP or GIF photos.']);

        foreach (range(1, Brief::MAX_PHOTOS) as $i) {
            $campaign->photos()->create(['path' => "x/{$i}.png", 'mime' => 'image/png']);
        }
        $this->spa()->post($url, ['photos' => [$this->png()]])
            ->assertJsonValidationErrors(['photos' => 'You’ve reached 12 photos. Remove one to add another.']);
    }

    public function test_without_ai_a_photo_answers_the_photo_question(): void
    {
        $this->fakeClaude(enabled: false);
        $campaign = $this->start(User::factory()->create());
        $campaign->update(['pending' => 'photos', 'fields' => [...Brief::blank(), 'focus' => 'x', 'business' => 'x', 'offer' => 'x', 'goal' => 'x', 'audience' => 'x']]);

        $this->spa()->post("/api/campaigns/{$campaign->id}/photos", ['photos' => [$this->png()]])
            ->assertOk()
            ->assertJsonPath('brief.4.fields.1.value', '1 photo')
            ->assertJsonPath('pending', 'channels');
    }

    public function test_the_content_kit_streams_in_and_is_saved(): void
    {
        $fake = $this->fakeClaude([$this->turn(array_fill_keys(Brief::QUICK, 'Lyon candles'), '', ['done' => true])]);
        $campaign = $this->start(User::factory()->create());

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/kit")->assertJsonValidationErrors(['campaign' => 'Finish the interview first.']);
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/turn", ['text' => 'Everything']);

        $response = $this->spa()->postJson("/api/campaigns/{$campaign->id}/kit")->assertOk();
        $this->assertSame([
            ['event' => 'delta', 'data' => ['text' => '## Brand ']],
            ['event' => 'delta', 'data' => ['text' => 'snapshot']],
            ['event' => 'done', 'data' => ['model' => 'claude-opus-5-5']],
        ], $this->events($response));
        $this->assertSame('## Brand snapshot', $campaign->fresh()->kit);

        $call = $fake->calls[1];
        $this->assertSame(['stream', 'medium'], [$call['kind'], $call['effort']]);
        $this->assertStringContainsString('- **Business / who you are:** Lyon candles', $call['prompt']);
        $this->assertStringContainsString('[needs client photo]', $call['prompt']);
        $this->assertStringContainsString('Today is ', $call['prompt']);

        $this->spa()->getJson("/api/campaigns/{$campaign->id}")->assertJsonPath('kit', '## Brand snapshot')->assertJsonPath('has_kit', true);
    }

    public function test_the_content_kit_needs_ai_and_a_confirmed_account(): void
    {
        $this->fakeClaude(enabled: false);
        $campaign = $this->start(User::factory()->create());
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/kit")->assertStatus(503);

        $this->fakeClaude();
        $campaign = $this->start(User::factory()->unverified()->create());
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/kit")->assertForbidden();
    }

    public function test_campaigns_belong_to_their_owner(): void
    {
        $this->fakeClaude(enabled: false);
        $mine = $this->start($me = User::factory()->create());
        $theirs = $this->start(User::factory()->create());

        $this->actingAs($me)->spa()->getJson('/api/campaigns')
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $mine->id);

        $this->spa()->getJson("/api/campaigns/{$theirs->id}")->assertForbidden();
        $this->spa()->postJson("/api/campaigns/{$theirs->id}/turn", ['text' => 'Hi'])->assertForbidden();
        $this->spa()->post("/api/campaigns/{$theirs->id}/photos", ['photos' => [$this->png()]])->assertForbidden();
        $this->spa()->deleteJson("/api/campaigns/{$theirs->id}")->assertForbidden();
    }

    public function test_deleting_a_campaign_or_the_account_removes_the_photos(): void
    {
        $this->fakeClaude(enabled: false);
        $user = User::factory()->create();
        $first = $this->start($user);
        $second = $this->start($user);
        $this->spa()->post("/api/campaigns/{$first->id}/photos", ['photos' => [$this->png()]])->assertOk();
        $this->spa()->post("/api/campaigns/{$second->id}/photos", ['photos' => [$this->png()]])->assertOk();

        $this->spa()->deleteJson("/api/campaigns/{$first->id}")->assertNoContent();
        Storage::disk('local')->assertMissing($first->directory());
        Storage::disk('local')->assertExists($second->directory());
        $this->assertDatabaseCount('campaign_photos', 1);

        $this->spa()->deleteJson('/api/user', ['password' => 'password'])->assertNoContent();
        Storage::disk('local')->assertMissing(Campaign::directoryFor($user->id));
        $this->assertDatabaseCount('campaigns', 0);
    }
}

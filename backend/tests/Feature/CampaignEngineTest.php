<?php

namespace Tests\Feature;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\Asset;
use App\Models\Campaign;
use App\Models\CampaignItem;
use App\Models\ConnectorTest;
use App\Models\Device;
use App\Models\ItemVariant;
use App\Models\Post;
use App\Models\User;
use App\Services\Ai\TextGenerator;
use App\Services\Media\MediaInspector;
use Generator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CampaignEngineTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    private User $user;

    private Account $insta;

    private Account $x;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['ai.providers.higgsfield.key_id' => 'k', 'ai.providers.higgsfield.key_secret' => 's', 'ai.providers.higgsfield.plan' => ['ideogram-4', 'wan-2-7-i2v']]);
        $this->user = User::factory()->create(['timezone' => 'Europe/Paris']);
        $phone = Device::factory()->for($this->user)->create(['name' => 'Studio phone']);
        $this->insta = Account::factory()->for($this->user)->automated()->create(['platform' => 'instagram', 'handle' => 'maisoncire', 'device_id' => $phone->id, 'timezone' => 'Europe/Paris',
            'profile' => ['tone' => 'Warm and unhurried', 'avoid' => 'Exclamation marks; the word luxury']]);
        $this->x = Account::factory()->for($this->user)->create(['platform' => 'x', 'handle' => 'cire_lyon', 'timezone' => 'America/New_York']);
    }

    /**
     * Claude, played by a fake that answers each agent by what its schema asks for, and reads
     * the posts and variants it's given from the prompt.
     */
    private function fakeClaude(array $overrides = []): object
    {
        $fake = new class($this->insta->id, $this->x->id, $overrides) implements TextGenerator
        {
            public array $prompts = [];

            public function __construct(private int $insta, private int $x, private array $overrides) {}

            public function enabled(): bool
            {
                return true;
            }

            public function stream(string $model, string $system, string $prompt, ?string $effort = null): Generator
            {
                $this->prompts[] = ['system' => $system, 'prompt' => $prompt];
                yield 'A warm caption.';
            }

            public function json(string $model, string $system, string|array $content, array $schema, ?string $effort = null): array
            {
                $text = is_string($content) ? $content : '';
                $this->prompts[] = ['system' => $system, 'prompt' => $text];
                $props = $schema['properties'] ?? [];
                $indexes = fn () => array_map('intval', preg_match_all('/^(\d+)\. \[/m', $text, $m) ? $m[1] : []);

                return match (true) {
                    isset($props['big_idea']) => $this->overrides['plan'] ?? [
                        'big_idea' => 'The 9 pm ritual',
                        'pillars' => [['name' => 'Made slowly', 'why' => 'Process proves the craft.']],
                        'items' => [
                            ['title' => 'First autumn pour', 'pillar' => 'Made slowly', 'format' => 'image', 'message' => 'The new batch is ready.', 'hook' => '24 candles, one afternoon.', 'account_ids' => [$this->insta, $this->x]],
                            ['title' => 'Light it at nine', 'pillar' => 'Made slowly', 'format' => 'video', 'message' => 'A quiet ritual.', 'hook' => 'This is my 9 pm.', 'account_ids' => [$this->insta, 999]],
                            ['title' => 'Why small batches', 'pillar' => 'Made slowly', 'format' => 'text', 'message' => 'Small batches cure better.', 'hook' => 'We pour 24 at a time.', 'account_ids' => [$this->x]],
                        ],
                    ],
                    isset($props['items']) => ['items' => array_map(fn ($i) => [
                        'index' => $i, 'visual' => "Visual {$i}", 'image_prompts' => ["Prompt {$i}"], 'reference_photo' => 0,
                        'shots' => [['description' => 'Match strikes', 'camera' => 'close-up', 'duration' => 3], ['description' => 'Flame settles', 'camera' => 'slow push in', 'duration' => 9]],
                    ], $indexes())],
                    isset($props['captions']) => ['captions' => array_map(fn ($i) => ['index' => $i, 'caption' => "Master caption {$i}."], $indexes())],
                    isset($props['variants']) && isset($props['variants']['items']['properties']['mode']) => ['variants' => array_map(fn ($i) => [
                        'index' => $i, 'mode' => 'adapted', 'placement' => $schema['properties']['variants']['items']['properties']['placement']['enum'][0],
                        'caption' => str_contains($text, 'rejected the last version') ? "Rewritten {$i}, calmer." : "Adapted {$i} #candles",
                    ], $indexes())],
                    isset($props['variants']) => ['variants' => array_map(fn ($id) => [
                        'id' => (int) $id, 'status' => $this->overrides['qa'][(int) $id] ?? 'pass', 'issues' => isset($this->overrides['qa'][(int) $id]) ? ['Says “luxury”.'] : [],
                    ], preg_match_all('/^Variant (\d+) for/m', $text, $m) ? $m[1] : [])],
                    isset($props['changes']) => ['changes' => [['field' => 'tone', 'to' => 'Warm, unhurried, a little dry', 'reason' => 'Liked posts are drier.']]],
                    default => [],
                };
            }
        };
        $this->app->instance(TextGenerator::class, $fake);

        return $fake;
    }

    /** Higgsfield makes a 1×1 still, or a real 2-second clip when ffmpeg is here. */
    private function fakeHiggsfield(): void
    {
        ConnectorTest::create(['provider' => 'higgsfield', 'ok' => true, 'message' => 'Connected.']);
        $clip = 'not a video';
        if (app(MediaInspector::class)->canReadVideo()) {
            $path = tempnam(sys_get_temp_dir(), 'clip').'.mp4';
            Process::run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=540x960:rate=10', '-t', '2', '-pix_fmt', 'yuv420p', $path])->throw();
            $clip = file_get_contents($path);
        }
        Http::fake([
            'api.higgsfield.ai/ideogram/v4.0' => Http::response(['request_id' => 'img', 'status_url' => 'https://api.higgsfield.ai/requests/img/status']),
            'api.higgsfield.ai/requests/img/status' => Http::response(['status' => 'completed', 'images' => [['url' => 'https://cdn.example/still.png']]]),
            'api.higgsfield.ai/wan/v2.7/image-to-video' => Http::response(['request_id' => 'vid', 'status_url' => 'https://api.higgsfield.ai/requests/vid/status']),
            'api.higgsfield.ai/requests/vid/status' => Http::response(['status' => 'completed', 'video' => ['url' => 'https://cdn.example/clip.mp4']]),
            'api.higgsfield.ai/files/generate-upload-url' => Http::response(['public_url' => 'https://files.example/x.png', 'upload_url' => 'https://upload.example/put']),
            'upload.example/put' => Http::response('', 200),
            'cdn.example/still.png' => Http::response(base64_decode(self::PNG)),
            'cdn.example/clip.mp4' => Http::response($clip),
        ]);
    }

    private function formCampaign(): Campaign
    {
        $id = $this->actingAs($this->user)->spa()->postJson('/api/campaigns', [
            'source' => 'form', 'name' => 'Autumn pour',
            'brief' => ['goal' => 'Sell the autumn gift box', 'audience' => 'City women 28–45 who love slow evenings', 'message' => 'Light it at nine', 'key_facts' => 'Three 180 g candles, €48', 'deadline' => now()->addDays(20)->toDateString()],
        ])->assertCreated()->assertJsonPath('source', 'form')->assertJsonPath('brief_ready', true)->json('id');

        $this->spa()->patchJson("/api/campaigns/{$id}", [
            'account_ids' => [$this->insta->id, $this->x->id],
            'period_start' => now()->addDay()->toDateString(), 'period_end' => now()->addDays(7)->toDateString(),
        ])->assertOk();

        return Campaign::find($id);
    }

    public function test_a_campaign_runs_from_brief_to_scheduled_posts_with_a_person_at_both_gates(): void
    {
        $claude = $this->fakeClaude();
        $this->fakeHiggsfield();
        $campaign = $this->formCampaign();

        // The writer and the visual director: a plan, waiting at gate 6A.
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/plan")->assertOk();
        $campaign->refresh();
        $this->assertSame('plan_review', $campaign->stage);
        $this->assertSame(['writer', 'visual_director'], $campaign->steps()->pluck('agent')->all());
        [$image, $video, $text] = $campaign->items()->get();
        $this->assertSame([$this->insta->id], $video->account_ids, 'Accounts outside the campaign are dropped.');
        $this->assertCount(2, $video->shots);
        $this->assertSame(5, $video->shots[1]['duration'], 'Shots are kept to 2–5 seconds.');
        $this->assertStringContainsString('Three 180 g candles, €48', $claude->prompts[0]['prompt']);
        $this->assertStringContainsString('Never: Exclamation marks; the word luxury', $claude->prompts[0]['prompt']);
        $this->spa()->getJson('/api/inbox')->assertJsonPath('0.kind', 'plan_review');

        // Gate 6A: a person edits the plan, then approves it. Production runs to gate 6B.
        $this->spa()->patchJson("/api/campaigns/{$campaign->id}/items/{$image->id}", ['title' => 'The first autumn pour'])->assertOk();
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/approve-plan")->assertOk();
        $campaign->refresh();
        $this->assertSame('content_review', $campaign->stage);
        $this->assertSame(['writer', 'visual_director', 'writer', 'media', 'adapter', 'adapter', 'qa'], $campaign->steps()->pluck('agent')->all());

        $image->refresh();
        $video->refresh();
        $this->assertSame(['ready', 'Master caption 1.'], [$image->status, $image->caption]);
        $this->assertSame('ready', $video->status);
        $this->assertSame(['done', 'done'], array_column($video->shots, 'status'));
        if (app(MediaInspector::class)->canReadVideo()) {
            // Two shots joined into one clip.
            $film = Asset::find($video->asset_ids[0]);
            $this->assertSame(['video', 540, 960], [$film->kind, $film->width, $film->height]);
            $this->assertEqualsWithDelta(4, $film->duration, 0.5);
        }

        // A version per account, adapted, checked against the platform, and QA'd.
        $variants = ItemVariant::with('account')->get();
        $this->assertSame(4, $variants->count());
        $instaImage = $variants->first(fn ($v) => $v->campaign_item_id === $image->id && $v->account_id === $this->insta->id);
        $this->assertSame(['adapted', 'Adapted 1 #candles', 'feed', 'pass'], [$instaImage->mode, $instaImage->caption, $instaImage->placement, $instaImage->qa['status']]);
        $this->assertTrue($instaImage->checks['ok']);
        if (app(MediaInspector::class)->canReadVideo()) {
            // The vertical video failed the feed, so it moved to Reels.
            $reel = $variants->first(fn ($v) => $v->campaign_item_id === $video->id);
            $this->assertSame(['reel', 'feed'], [$reel->placement, $reel->checks['moved_from']]);
        }
        $this->spa()->getJson('/api/inbox')->assertJsonPath('0.kind', 'content_review');

        // Nothing can be scheduled before gate 6B.
        $range = ['from' => now()->addDay()->toDateString(), 'to' => now()->addDays(7)->toDateString()];
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/schedule", $range)->assertJsonValidationErrors('schedule');

        // Gate 6B: approve what passes.
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/variants/approve-all")->assertJsonPath('approved', 4);

        // The scheduler: a preview, then the real thing.
        $preview = $this->spa()->postJson("/api/campaigns/{$campaign->id}/schedule", [...$range, 'preview' => true])->assertOk()->json('proposal');
        $this->assertCount(4, $preview);
        $this->assertSame(0, Post::count());

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/schedule", [...$range, 'order' => [$text->id, $image->id, $video->id]])->assertOk()->assertJsonCount(4, 'posts');
        $this->assertSame('scheduled', $campaign->fresh()->stage);

        $posts = Post::with('account')->orderBy('scheduled_at')->get();
        $this->assertTrue($posts->every(fn (Post $p) => $p->status === PostStatus::Scheduled && $p->approved_at && $p->campaign_id === $campaign->id && $p->variant_id));
        // In the order given: the text post first.
        $this->assertSame('Why small batches', $posts->first()->title);
        // Each account's posts land at the account's own local time.
        $first = $posts->firstWhere('account_id', $this->insta->id);
        $this->assertContains($first->scheduled_at->setTimezone('Europe/Paris')->format('H:i'), ['09:00', '12:30', '18:30', '09:20', '12:50', '18:50']);
        // Never two posts on one account closer than its gap, never two on one phone at once.
        $insta = $posts->where('account_id', $this->insta->id)->values();
        $this->assertGreaterThanOrEqual(60, $insta[0]->scheduled_at->diffInMinutes($insta[1]->scheduled_at));
        $this->assertSame([], $this->spa()->getJson('/api/schedule/conflicts')->json());
        $this->assertNotEmpty($first->assets()->get());
    }

    public function test_gate_6b_blocks_what_fails_and_rewrites_what_is_sent_back(): void
    {
        $this->fakeClaude(['qa' => [1 => 'fail']]);
        $this->fakeHiggsfield();
        $campaign = $this->formCampaign();
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/plan");
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/approve-plan");

        $failed = ItemVariant::find(1);
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/variants/1/approve")
            ->assertJsonValidationErrors(['variant' => 'QA failed it. Edit it, or reject it with a note so it’s rewritten.']);
        // Approve-all leaves it alone.
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/variants/approve-all")->assertJsonPath('approved', 3);

        // Sent back with a note: the adapter rewrites it, told what was wrong.
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/variants/1/reject", ['feedback' => 'Too loud. Calmer, please.'])->assertOk();
        $failed->refresh();
        $this->assertSame(['draft', 'Rewritten 1, calmer.', 'Too loud. Calmer, please.'], [$failed->status, $failed->caption, $failed->feedback]);

        // A person's own edit: rechecked against the platform; over X's limit, it can't be approved.
        $xVariant = ItemVariant::where('account_id', $this->x->id)->first();
        $this->spa()->patchJson("/api/campaigns/{$campaign->id}/variants/{$xVariant->id}", ['caption' => str_repeat('a', 300)])->assertOk();
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/variants/{$xVariant->id}/approve")->assertJsonValidationErrors('variant');

        // "More like this" becomes a liked example in the account's memory.
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/variants/{$failed->id}/like")->assertOk();
        $this->assertDatabaseHas('account_memories', ['account_id' => $this->insta->id, 'kind' => 'example', 'content' => 'Rewritten 1, calmer.']);
    }

    public function test_without_a_video_model_the_media_team_makes_the_video_with_a_voice_and_music(): void
    {
        $this->fakeClaude(['plan' => ['big_idea' => 'x', 'pillars' => [], 'items' => [
            ['title' => 'Light it at nine', 'pillar' => 'p', 'format' => 'video', 'message' => 'A quiet ritual for the end of the day.', 'hook' => 'This is my 9 pm.', 'account_ids' => [$this->insta->id]],
        ]]]);
        $this->insta->update(['sound' => ['voice' => 'bf_emma', 'mood' => 'linen', 'accent' => '#f5b04c']]);
        $wav = function (float $seconds) {
            $data = '';
            for ($i = 0, $n = (int) ($seconds * 24000); $i < $n; $i++) {
                $data .= pack('v', ((int) (9000 * sin(2 * M_PI * 220 * $i / 24000))) & 0xFFFF);
            }

            return 'RIFF'.pack('V', 36 + strlen($data)).'WAVEfmt '.pack('VvvVVvv', 16, 1, 1, 24000, 48000, 2, 16).'data'.pack('V', strlen($data)).$data;
        };
        config(['ai.providers.sound.url' => 'http://sound.test']);
        Http::fake([
            'sound.test/health' => Http::response(['ok' => true]),
            'sound.test/v1/voices' => Http::response([['id' => 'bf_emma', 'name' => 'Emma', 'lang' => 'en-gb', 'language' => 'English · UK', 'gender' => 'female', 'style' => 'Poised.', 'sample' => 'Hi.']]),
            'sound.test/v1/speech' => fn ($r) => Http::response(['duration' => 0.9, 'audio' => base64_encode($wav(0.9)), 'voice' => $r['voice'], 'lang' => 'en-gb', 'words' => [['text' => 'This', 'start' => 0.0, 'end' => 0.2], ['text' => 'is', 'start' => 0.2, 'end' => 0.35], ['text' => 'my', 'start' => 0.35, 'end' => 0.5], ['text' => '9', 'start' => 0.5, 'end' => 0.7], ['text' => 'pm.', 'start' => 0.7, 'end' => 0.9]]]),
            'sound.test/v1/music' => fn ($r) => Http::response(['duration' => 3.0, 'audio' => base64_encode($wav(3.0)), 'meta' => ['mood' => $r['mood'], 'label' => 'Linen', 'key' => 'D major', 'bpm' => 66.0, 'seed' => 3]]),
        ]);

        $campaign = $this->formCampaign();
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/plan");
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/approve-plan")->assertOk();

        $item = CampaignItem::first();
        $this->assertSame('ready', $item->status, (string) $item->error);
        $video = Asset::find($item->asset_ids[0]);
        $this->assertSame(['video', 'reel', 1080, 1920], [$video->kind, $video->meta['sound'], $video->width, $video->height]);
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/v1/speech') && $r['voice'] === 'bf_emma' && str_contains($r['text'], 'This is my 9 pm.'));
        Http::assertSent(fn ($r) => str_ends_with($r->url(), '/v1/music') && $r['mood'] === 'linen');

        $step = $campaign->steps()->where('agent', 'media')->where('model', 'sound/kokoro')->sole();
        $this->assertSame('done', $step->status);
        $this->assertStringContainsString('Made the video for “Light it at nine”: Emma reads it, Linen plays under it', $step->summary);
        $this->assertSame('content_review', $campaign->fresh()->stage, 'Production carries on to the adapter and QA.');
    }

    public function test_without_media_models_the_operator_uploads_and_production_carries_on(): void
    {
        $this->fakeClaude(['plan' => ['big_idea' => 'x', 'pillars' => [], 'items' => [
            ['title' => 'Jar shot', 'pillar' => 'p', 'format' => 'image', 'message' => 'm', 'hook' => 'h', 'account_ids' => [$this->insta->id]],
        ]]]);
        $campaign = $this->formCampaign();
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/plan");
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/approve-plan");

        $item = CampaignItem::first();
        $this->assertSame(['producing', 'needs_media'], [$campaign->fresh()->stage, $item->status]);
        $this->assertStringContainsString('Upload media for this post', $item->error);

        Storage::disk('local')->put('assets/u/jar.png', base64_decode(self::PNG));
        $photo = Asset::factory()->for($this->user)->create(['path' => 'assets/u/jar.png', 'mime' => 'image/png', 'width' => 1080, 'height' => 1350]);
        $this->spa()->putJson("/api/campaigns/{$campaign->id}/items/{$item->id}/media", ['asset_ids' => [$photo->id]])->assertOk()->assertJsonPath('status', 'ready');

        $this->assertSame('content_review', $campaign->fresh()->stage);
        $this->assertSame([$photo->id], ItemVariant::first()->assets()->pluck('id')->all());
    }

    public function test_a_shot_can_be_made_again_on_its_own(): void
    {
        $this->fakeClaude();
        $this->fakeHiggsfield();
        $campaign = $this->formCampaign();
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/plan");
        $this->spa()->postJson("/api/campaigns/{$campaign->id}/approve-plan");
        $video = CampaignItem::where('format', 'video')->first();
        $before = $video->asset_ids;

        $this->spa()->postJson("/api/campaigns/{$campaign->id}/items/{$video->id}/shots/1", ['description' => 'Flame settles, steam from a cup'])
            ->assertOk()->assertJsonPath('shots.1.description', 'Flame settles, steam from a cup')->assertJsonPath('shots.1.status', 'done');

        $this->assertNotSame($before, $video->fresh()->asset_ids);
        $this->assertSame(2, $video->generations()->where('shot', 1)->where('kind', 'video')->count());
    }

    public function test_the_plan_needs_accounts_and_a_period_and_the_form_needs_the_basics(): void
    {
        $this->fakeClaude();
        $this->actingAs($this->user)->spa()->postJson('/api/campaigns', ['source' => 'form', 'brief' => ['goal' => 'x']])
            ->assertJsonValidationErrors(['brief.audience' => 'Say who it’s for.', 'brief.message' => 'Say what it has to get across.']);

        $id = $this->spa()->postJson('/api/campaigns', ['source' => 'form', 'brief' => ['goal' => 'g', 'audience' => 'a', 'message' => 'm']])->json('id');
        $this->spa()->postJson("/api/campaigns/{$id}/plan")->assertJsonValidationErrors(['account_ids', 'period_start']);

        $theirs = Account::factory()->create();
        $this->spa()->patchJson("/api/campaigns/{$id}", ['account_ids' => [$theirs->id]])->assertJsonValidationErrors('account_ids.0');

        // An unfinished interview can't be planned either.
        $interview = $this->spa()->postJson('/api/campaigns', ['depth' => 'quick'])->json('id');
        $this->spa()->postJson("/api/campaigns/{$interview}/plan")->assertJsonValidationErrors(['brief' => 'Finish the brief first.']);
    }

    public function test_conflicts_catch_a_phone_booked_twice_and_an_account_posting_too_often(): void
    {
        $other = Account::factory()->for($this->user)->create(['platform' => 'tiktok', 'device_id' => $this->insta->device_id]);
        $at = now()->addDay()->setTime(9, 0);
        Post::factory()->for($this->user)->scheduled($at)->create(['account_id' => $this->insta->id]);
        Post::factory()->for($this->user)->scheduled($at->copy()->addMinutes(5))->create(['account_id' => $other->id]);
        Post::factory()->for($this->user)->scheduled($at->copy()->addMinutes(30))->create(['account_id' => $this->insta->id]);

        $conflicts = collect($this->actingAs($this->user)->spa()->getJson('/api/schedule/conflicts')->json());
        // 9:00 and 9:05 share the phone; 9:00 and 9:30 are the same account, inside its hour.
        $this->assertSame(['phone', 'gap'], $conflicts->pluck('kind')->all());
        $this->assertStringContainsString('Studio phone is booked twice', $conflicts[0]['message']);
        $this->assertStringContainsString('@maisoncire posts twice within 30 minutes', $conflicts[1]['message']);
    }

    public function test_profile_changes_wait_for_approval_and_the_voice_reaches_every_generation(): void
    {
        $claude = $this->fakeClaude();
        $this->actingAs($this->user);

        // A direct edit doesn't touch the profile; a proposed change waits in the Inbox.
        $this->spa()->patchJson("/api/accounts/{$this->insta->id}", ['profile' => ['tone' => 'Loud']])->assertOk();
        $this->assertSame('Warm and unhurried', $this->insta->fresh()->profile['tone']);
        $change = $this->spa()->postJson("/api/accounts/{$this->insta->id}/profile/changes", ['field' => 'topics', 'to' => 'Evenings, slow living'])
            ->assertCreated()->assertJsonPath('status', 'pending')->json('id');
        $this->spa()->getJson('/api/inbox')->assertJsonPath('0.kind', 'profile_change');
        $this->spa()->postJson("/api/accounts/{$this->insta->id}/profile/changes/{$change}", ['approve' => true])->assertJsonPath('status', 'approved');
        $this->assertSame('Evenings, slow living', $this->insta->fresh()->profile['topics']);

        // Memory: instructions and examples, kept apart.
        $this->spa()->postJson("/api/accounts/{$this->insta->id}/memory", ['kind' => 'instruction', 'content' => 'Never mention prices.'])->assertCreated();
        $this->spa()->getJson("/api/accounts/{$this->insta->id}/voice")->assertJsonPath('memory.instruction.0.content', 'Never mention prices.')->assertJsonCount(0, 'memory.example');

        // The AI's suggestion, from what was liked and sent back.
        $this->spa()->postJson("/api/accounts/{$this->insta->id}/profile/suggest")->assertJsonValidationErrors('suggest');
        $this->insta->memories()->create(['kind' => 'example', 'content' => 'Dry and warm.', 'source' => 'liked']);
        $this->spa()->postJson("/api/accounts/{$this->insta->id}/profile/suggest")->assertCreated()->assertJsonPath('0.source', 'ai')->assertJsonPath('0.field', 'tone');

        // The composer writes in the account's voice.
        $this->spa()->postJson('/api/ai/write', ['brief' => 'Autumn pour', 'format' => 'image', 'platforms' => ['instagram'], 'account_id' => $this->insta->id])->assertOk()->streamedContent();
        $prompt = end($claude->prompts)['prompt'];
        $this->assertStringContainsString('<account_voice>', $prompt);
        $this->assertStringContainsString('Never mention prices.', $prompt);
        $this->assertStringContainsString('Topics: Evenings, slow living', $prompt);

        // A published post joins the account's history.
        $this->spa()->postJson('/api/posts', ['body' => 'It went out.', 'format' => 'text', 'platforms' => ['instagram'], 'account_id' => $this->insta->id, 'status' => 'published'])->assertCreated();
        $this->assertDatabaseHas('account_memories', ['account_id' => $this->insta->id, 'kind' => 'history', 'content' => 'It went out.']);
    }
}

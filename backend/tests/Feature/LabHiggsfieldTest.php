<?php

namespace Tests\Feature;

use App\Jobs\PollGeneration;
use App\Models\Asset;
use App\Models\ConnectorTest;
use App\Models\Generation;
use App\Models\NodeRun;
use App\Models\Project;
use App\Models\User;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Lab\Catalog;
use App\Services\Lab\Graph;
use App\Services\Lab\Templates;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Higgsfield's tools as Creative Lab nodes (Cinema Studio, Soul ID, Ads Studio, Motion Control, Restyle),
 * the requests each one sends, and the Higgsfield models' settings kept to what their routes take.
 */
class LabHiggsfieldTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    private User $user;

    private Project $project;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config([
            'ai.providers.higgsfield.key_id' => 'kid',
            'ai.providers.higgsfield.key_secret' => 'ksecret',
            'ai.providers.higgsfield.plan' => ['soul-v2', 'seedance-2', 'cinema-studio-4', 'soul-id', 'ads-studio', 'motion-control-std', 'motion-control-pro', 'genjutsu-restyle'],
        ]);
        ConnectorTest::create(['provider' => 'higgsfield', 'ok' => true, 'message' => 'Connected.']);
        $this->user = User::factory()->create();
        $this->project = $this->user->projects()->create(['name' => 'Autumn', 'canvas' => Graph::normalize(['version' => 2])]);
    }

    private function ops(array $ops)
    {
        return $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/ops", ['ops' => $ops]);
    }

    private function runNode(string $node)
    {
        return $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/{$node}/run");
    }

    private function picture(): Asset
    {
        $a = Asset::factory()->for($this->user)->create(['mime' => 'image/png']);
        Storage::disk('local')->put($a->path, base64_decode(self::PNG));

        return $a;
    }

    private function video(float $seconds = 8): Asset
    {
        $a = Asset::factory()->for($this->user)->video(duration: $seconds)->create();
        Storage::disk('local')->put($a->path, 'mp4 bytes');

        return $a;
    }

    /** Uploads answer with a public URL per file; the CDN serves what's made. */
    private function fakeHiggsfield(array $routes): void
    {
        $n = 0;
        Http::fake([
            'api.higgsfield.ai/files/generate-upload-url' => function () use (&$n) {
                $n++;

                return Http::response(['upload_url' => "https://storage.example/put/{$n}", 'public_url' => "https://cdn.example/in/{$n}", 'upload_headers' => []]);
            },
            'storage.example/*' => Http::response('', 200),
            'cdn.example/out/*' => Http::response(base64_decode(self::PNG), 200, ['Content-Type' => 'image/png']),
            ...$routes,
        ]);
    }

    public function test_every_node_says_whether_it_needs_ai(): void
    {
        $nodes = $this->spa()->actingAs($this->user)->getJson('/api/lab/catalog')->assertOk()->json('nodes');
        foreach ($nodes as $type => $n) {
            $this->assertContains($n['ai'], ['yes', 'some', 'no'], $type);
            $this->assertNotEmpty($n['ai_detail'], $type);
        }
        $this->assertSame(['yes', 'some', 'no'], [$nodes['image.generate']['ai'], $nodes['video.captions']['ai'], $nodes['finish.design']['ai']]);
    }

    public function test_higgsfields_tools_have_their_own_nodes_and_stay_out_of_the_plain_pickers(): void
    {
        $catalog = $this->spa()->actingAs($this->user)->getJson('/api/lab/catalog')->assertOk()->json();
        $this->assertSame('Higgsfield', $catalog['groups']['higgsfield']);
        $this->assertSame(['video.cinema', 'people.character', 'image.character', 'people.motion', 'image.ads', 'video.restyle'],
            array_keys(array_filter($catalog['nodes'], fn ($n) => $n['group'] === 'higgsfield')));
        $ids = fn (string $list) => array_column($catalog['models'][$list], 'id');
        $this->assertNotContains('higgsfield/motion-control-std', $ids('video_i2v'));
        $this->assertNotContains('higgsfield/cinema-studio-4', $ids('video_t2v'));
        $this->assertNotContains('higgsfield/ads-studio', $ids('image'));
        // A campaign's media team asking for "a video model" never gets one that needs a dance to copy.
        $this->assertNotContains('higgsfield/motion-control-std', array_column(app(ModelRegistry::class)->all('video'), 'id'));
        $this->assertContains('higgsfield/motion-control-std', array_column(app(ModelRegistry::class)->all(), 'id'));
        foreach (Templates::all() as $key => $t) {
            foreach ($t['graph']['nodes'] as $n) {
                $this->assertNotNull(Catalog::node($n['type']), "{$key}: {$n['type']}");
            }
        }
    }

    public function test_a_cinematic_shot_sends_the_directors_choices_and_its_references(): void
    {
        $product = $this->picture();
        $this->fakeHiggsfield([
            'api.higgsfield.ai/higgsfield/cinema-studio/4.0' => Http::response(['status' => 'queued', 'request_id' => 'cin-1', 'status_url' => 'https://api.higgsfield.ai/requests/cin-1/status']),
            'api.higgsfield.ai/requests/cin-1/status' => Http::response(['status' => 'completed', 'video' => ['url' => 'https://cdn.example/out/shot.mp4']]),
        ]);
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'product', 'type' => 'source.media', 'params' => ['assets' => [$product->id]]]],
            ['op' => 'add', 'node' => ['id' => 'shot', 'type' => 'video.cinema', 'params' => ['prompt' => '<<<image_1>>> on a rainy sill', 'camera' => 'bullet-time', 'genre' => 'noir', 'duration' => 8]]],
            ['op' => 'connect', 'from' => 'product', 'out' => 'image', 'to' => 'shot', 'in' => 'reference'],
        ])->assertOk()->assertJsonPath('nodes.shot.policy', 'manual')->assertJsonPath('nodes.shot.estimate.model', 'Cinema Studio 4');

        $this->runNode('shot')->assertCreated();
        $this->assertSame('succeeded', NodeRun::where('node_id', 'shot')->value('status'));
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/higgsfield/cinema-studio/4.0'
            && $r['camera_movement'] === 'bullet-time' && $r['genre'] === 'noir' && $r['duration'] === 8 && $r['aspect_ratio'] === '9:16'
            && $r['generate_audio'] === true && $r['image_urls'] === ['https://cdn.example/in/1'] && ! isset($r['color_palette']));
    }

    public function test_a_character_is_trained_once_and_its_pictures_keep_the_face(): void
    {
        $photos = [$this->picture(), $this->picture()];
        $this->fakeHiggsfield([
            'api.higgsfield.ai/v1/custom-references' => Http::response(['id' => 'ref-9', 'status' => 'queued']),
            'api.higgsfield.ai/v1/custom-references/ref-9' => Http::sequence()
                ->push(['id' => 'ref-9', 'status' => 'in_progress'])
                ->push(['id' => 'ref-9', 'status' => 'completed', 'model_version' => 'v2', 'thumbnail_url' => 'https://cdn.example/out/mia.png']),
            'api.higgsfield.ai/higgsfield-ai/soul/v2/standard' => Http::response(['status' => 'queued', 'request_id' => 'soul-1', 'status_url' => 'https://api.higgsfield.ai/requests/soul-1/status']),
            'api.higgsfield.ai/requests/soul-1/status' => Http::response(['status' => 'completed', 'images' => [['url' => 'https://cdn.example/out/1.png'], ['url' => 'https://cdn.example/out/2.png'], ['url' => 'https://cdn.example/out/3.png'], ['url' => 'https://cdn.example/out/4.png']]]),
        ]);
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'photos', 'type' => 'source.media', 'params' => ['assets' => array_map(fn ($a) => $a->id, $photos)]]],
            ['op' => 'add', 'node' => ['id' => 'mia', 'type' => 'people.character', 'params' => ['name' => 'Mia']]],
            ['op' => 'add', 'node' => ['id' => 'cafe', 'type' => 'image.character', 'params' => ['prompt' => 'Laughing in a café', 'variations' => '4']]],
            ['op' => 'connect', 'from' => 'photos', 'out' => 'image', 'to' => 'mia', 'in' => 'photos'],
            ['op' => 'connect', 'from' => 'mia', 'to' => 'cafe', 'in' => 'character'],
        ])->assertOk();

        // A face needs the person's agreement first.
        $this->runNode('mia')->assertStatus(422)->assertJsonPath('message', fn ($m) => str_contains($m, 'agreed'));
        $this->ops([['op' => 'set', 'id' => 'mia', 'params' => ['consent' => true]]])->assertOk();
        $this->runNode('mia')->assertCreated();

        $state = $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab")->json('nodes');
        $this->assertSame(['done', 'ref-9', 'v2', 'Mia'], [$state['mia']['status'], ...array_values(array_intersect_key($state['mia']['outputs']['character'], array_flip(['reference_id', 'version', 'name'])))]);
        $this->assertCount(1, $state['mia']['outputs']['image']['assets']);
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/v1/custom-references' && $r['name'] === 'Mia' && $r['model_version'] === 'v2'
            && $r['input_images'] === [['type' => 'image_url', 'image_url' => 'https://cdn.example/in/1'], ['type' => 'image_url', 'image_url' => 'https://cdn.example/in/2']]);

        $this->runNode('cafe')->assertCreated();
        $this->assertCount(4, $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab")->json('nodes.cafe.outputs.image.assets'));
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard'
            && $r['custom_reference_id'] === 'ref-9' && $r['batch_size'] === 4 && $r['resolution'] === '1080p' && $r['aspect_ratio'] === '3:4');
        // Trained once: the pictures didn't train it again.
        $this->assertSame(1, Generation::where('kind', 'character')->count());
    }

    public function test_ads_come_from_the_brief_and_the_product_photo(): void
    {
        $product = $this->picture();
        $this->fakeHiggsfield([
            'api.higgsfield.ai/higgsfield/ads-studio/v1.0' => Http::response(['status' => 'queued', 'request_id' => 'ads-1', 'status_url' => 'https://api.higgsfield.ai/requests/ads-1/status']),
            'api.higgsfield.ai/requests/ads-1/status' => Http::response(['status' => 'completed', 'images' => [['url' => 'https://cdn.example/out/a.png'], ['url' => 'https://cdn.example/out/b.png']]]),
        ]);
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'brief', 'type' => 'source.brief', 'params' => ['product' => 'Pumpkin latte', 'offer' => 'Two for one before ten', 'audience' => 'Commuters', 'cta' => 'Come in']]],
            ['op' => 'add', 'node' => ['id' => 'product', 'type' => 'source.media', 'params' => ['assets' => [$product->id]]]],
            ['op' => 'add', 'node' => ['id' => 'ads', 'type' => 'image.ads', 'params' => ['count' => 2]]],
            ['op' => 'connect', 'from' => 'brief', 'to' => 'ads', 'in' => 'brief'],
            ['op' => 'connect', 'from' => 'product', 'out' => 'image', 'to' => 'ads', 'in' => 'product'],
        ])->assertOk();
        $this->runNode('ads')->assertCreated();

        $this->assertCount(2, $this->spa()->actingAs($this->user)->getJson("/api/projects/{$this->project->id}/lab")->json('nodes.ads.outputs.image.assets'));
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/higgsfield/ads-studio/v1.0'
            && str_contains($r['prompt'], 'Advertise Pumpkin latte') && str_contains($r['prompt'], 'Two for one before ten')
            && $r['niche'] === 'Pumpkin latte' && $r['target_audience'] === 'Commuters' && $r['batch_size'] === 2 && $r['aspect_ratio'] === '4:5'
            && $r['image_urls'] === ['https://cdn.example/in/1']);
    }

    public function test_copy_the_moves_sends_the_picture_and_the_video_and_checks_the_length(): void
    {
        $who = $this->picture();
        $long = $this->video(45);
        $moves = $this->video(12);
        $this->fakeHiggsfield([
            'api.higgsfield.ai/kling-video/v3/motion-control/std' => Http::response(['status' => 'queued', 'request_id' => 'mc-1', 'status_url' => 'https://api.higgsfield.ai/requests/mc-1/status']),
            'api.higgsfield.ai/requests/mc-1/status' => Http::response(['status' => 'completed', 'video' => ['url' => 'https://cdn.example/out/dance.mp4']]),
        ]);
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'who', 'type' => 'source.media', 'params' => ['assets' => [$who->id]]]],
            ['op' => 'add', 'node' => ['id' => 'moves', 'type' => 'source.media', 'params' => ['assets' => [$long->id]]]],
            ['op' => 'add', 'node' => ['id' => 'dance', 'type' => 'people.motion', 'params' => ['consent' => true, 'sound' => false]]],
            ['op' => 'connect', 'from' => 'who', 'out' => 'image', 'to' => 'dance', 'in' => 'image'],
            ['op' => 'connect', 'from' => 'moves', 'out' => 'video', 'to' => 'dance', 'in' => 'video'],
        ])->assertOk();
        $this->runNode('dance')->assertCreated();
        $this->assertStringContainsString('up to 30 s', NodeRun::where('node_id', 'dance')->latest('id')->value('error'));

        $this->ops([['op' => 'set', 'id' => 'moves', 'params' => ['assets' => [$moves->id]]]])->assertOk();
        $this->runNode('dance')->assertCreated();
        $this->assertSame('succeeded', NodeRun::where('node_id', 'dance')->latest('id')->value('status'));
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/kling-video/v3/motion-control/std'
            && $r['image_url'] === 'https://cdn.example/in/1' && $r['video_url'] === 'https://cdn.example/in/2'
            && $r['keep_original_sound'] === 'no' && $r['character_orientation'] === 'video' && ! isset($r['prompt']));
    }

    public function test_restyle_needs_a_look_and_its_presets_come_from_higgsfield(): void
    {
        $clip = $this->video(10);
        $this->fakeHiggsfield([
            'api.higgsfield.ai/models/higgsfield/genjutsu/restyle/v1.0/presets' => Http::response(['items' => [['id' => 'c2143317-f28d-4c3c-a0b8-39bd547e08a7', 'name' => 'Cel-Shaded CG Anime', 'preview_url' => 'https://cdn.example/p.webp']]]),
            'api.higgsfield.ai/higgsfield/genjutsu/restyle/v1.0' => Http::response(['status' => 'queued', 'request_id' => 'rs-1', 'status_url' => 'https://api.higgsfield.ai/requests/rs-1/status']),
            'api.higgsfield.ai/requests/rs-1/status' => Http::response(['status' => 'completed', 'video' => ['url' => 'https://cdn.example/out/anime.mp4']]),
        ]);
        $this->spa()->actingAs($this->user)->getJson('/api/lab/higgsfield/presets/restyle')->assertOk()->assertJsonPath('presets.0.name', 'Cel-Shaded CG Anime');

        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'clip', 'type' => 'source.media', 'params' => ['assets' => [$clip->id]]]],
            ['op' => 'add', 'node' => ['id' => 'anime', 'type' => 'video.restyle']],
            ['op' => 'connect', 'from' => 'clip', 'out' => 'video', 'to' => 'anime', 'in' => 'video'],
        ])->assertOk();
        $this->runNode('anime')->assertCreated();
        $this->assertSame('Pick a look.', NodeRun::where('node_id', 'anime')->latest('id')->value('error'));

        $this->ops([['op' => 'set', 'id' => 'anime', 'params' => ['style' => 'c2143317-f28d-4c3c-a0b8-39bd547e08a7']]])->assertOk();
        $this->runNode('anime')->assertCreated();
        $this->assertSame('succeeded', NodeRun::where('node_id', 'anime')->latest('id')->value('status'));
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/higgsfield/genjutsu/restyle/v1.0'
            && $r['preset_id'] === 'c2143317-f28d-4c3c-a0b8-39bd547e08a7' && $r['video_url'] === 'https://cdn.example/in/1' && $r['resolution'] === '720p');
    }

    public function test_higgsfield_models_only_get_the_settings_their_route_takes(): void
    {
        $still = $this->picture();
        $this->fakeHiggsfield([
            'api.higgsfield.ai/bytedance/seedance-2.0/image-to-video' => Http::response(['status' => 'queued', 'request_id' => 'sd-1', 'status_url' => 'https://api.higgsfield.ai/requests/sd-1/status']),
            'api.higgsfield.ai/requests/sd-1/cancel' => Http::response('', 202),
            'api.higgsfield.ai/higgsfield-ai/soul/v2/standard' => Http::response(['status' => 'queued', 'request_id' => 'soul-2', 'status_url' => 'https://api.higgsfield.ai/requests/soul-2/status']),
        ]);
        // The requests stay queued at Higgsfield: nobody polls them here.
        Queue::fake([PollGeneration::class]);
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'still', 'type' => 'source.media', 'params' => ['assets' => [$still->id]]]],
            ['op' => 'add', 'node' => ['id' => 'move', 'type' => 'video.animate', 'params' => ['model' => 'higgsfield/seedance-2']]],
            ['op' => 'connect', 'from' => 'still', 'out' => 'image', 'to' => 'move', 'in' => 'image'],
            ['op' => 'add', 'node' => ['id' => 'three', 'type' => 'image.generate', 'params' => ['model' => 'higgsfield/soul-v2', 'prompt' => 'A mug', 'variations' => 3]]],
        ])->assertOk();

        // Seedance's image-to-video route takes no shape (the picture's is used): asking for one was refused.
        $this->runNode('move')->assertCreated();
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/bytedance/seedance-2.0/image-to-video' && ! isset($r['aspect_ratio']) && $r['duration'] === 5);
        // Stopped while queued at Higgsfield: canceled there, so it isn't charged.
        $this->spa()->actingAs($this->user)->postJson("/api/projects/{$this->project->id}/lab/nodes/move/stop")->assertOk();
        Http::assertSent(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/requests/sd-1/cancel');

        // Soul makes 1 or 4 at a time: three pictures are three requests of one.
        $this->runNode('three')->assertCreated();
        $soul = Http::recorded(fn (Request $r) => $r->url() === 'https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard');
        $this->assertCount(3, $soul);
        $this->assertTrue($soul->every(fn ($pair) => ! isset($pair[0]['batch_size'])));
    }

    public function test_a_pictures_prompt_never_names_what_to_avoid_and_asks_for_no_words_when_words_go_over_it(): void
    {
        $this->fakeHiggsfield([
            'api.higgsfield.ai/higgsfield-ai/soul/v2/standard' => Http::response(['status' => 'queued', 'request_id' => 'soul-3', 'status_url' => 'https://api.higgsfield.ai/requests/soul-3/status']),
        ]);
        Queue::fake([PollGeneration::class]);
        $this->ops([
            ['op' => 'add', 'node' => ['id' => 'brief', 'type' => 'source.brief', 'params' => ['product' => 'Ember & Fig candle', 'style' => 'warm still life', 'palette' => ['#EDE3D6', '#8A5A3B'], 'avoid' => 'the words cozy and vibe']]],
            ['op' => 'add', 'node' => ['id' => 'picture', 'type' => 'image.generate', 'params' => ['model' => 'higgsfield/soul-v2', 'prompt' => '{product}, hero shot']]],
            ['op' => 'add', 'node' => ['id' => 'words', 'type' => 'finish.design']],
            ['op' => 'connect', 'from' => 'brief', 'to' => 'picture', 'in' => 'brief'],
            ['op' => 'connect', 'from' => 'picture', 'out' => 'image', 'to' => 'words', 'in' => 'media'],
        ])->assertOk();
        $this->runNode('picture')->assertCreated();

        // A picture model draws the words it's given: the brief's "never" goes to the negative prompt only.
        $g = Generation::where('kind', 'image')->latest('id')->firstOrFail();
        $this->assertStringContainsString('Ember & Fig candle, hero shot. Style: warm still life', $g->prompt);
        $this->assertStringNotContainsString('cozy', $g->prompt);
        // Its colours by name: a hex code comes back lettered on the picture.
        $this->assertStringContainsString('colour palette cream, brown', $g->prompt);
        $this->assertStringNotContainsString('#EDE3D6', $g->prompt);
        $this->assertStringContainsString('the words cozy and vibe', $g->params['negative_prompt']);
        // Its words are drawn on it after: none in the picture.
        $this->assertStringContainsString('No text, letters, labels or logos', $g->prompt);
        $this->assertStringContainsString('logo', $g->params['negative_prompt']);
    }
}

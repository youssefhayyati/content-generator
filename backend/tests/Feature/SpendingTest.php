<?php

namespace Tests\Feature;

use App\Models\AiUsage;
use App\Models\User;
use App\Services\Ai\Media\GenerationRunner;
use App\Services\Ai\Pricing;
use App\Services\Ai\UsageMeter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * What the AI costs: billed by providers per token, picture or video second; the GPU pod's jobs
 * estimated from how long they ran; and the Spending overview that adds it all up.
 */
class SpendingTest extends TestCase
{
    use RefreshDatabase;

    private const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    public function test_each_model_says_how_it_is_charged(): void
    {
        config(['ai.providers.pod.hourly' => 0.36]);

        $this->assertSame(['billing' => 'billed', 'rate' => '$5 in · $25 out per 1M tokens'], Pricing::rate('anthropic', 'claude-opus-5'));
        $this->assertSame(['billing' => 'billed', 'rate' => '$0.112 a second of video'], Pricing::rate('higgsfield', 'higgsfield/kling-3-pro'));
        $this->assertSame(['billing' => 'billed', 'rate' => '$0.0032 a picture'], Pricing::rate('higgsfield', 'soul-v2'));
        $this->assertSame(['billing' => 'estimated', 'rate' => '≈ $0.36 an hour of pod time'], Pricing::rate('pod', 'pod/acestep'));
        // Ollama Cloud's plans draw on credits: its models cost what they list at.
        $this->assertSame(['billing' => 'billed', 'rate' => '$0.15 in · $0.50 out per 1M tokens'], Pricing::rate('ollama_cloud', 'glm-5.3-flash'));
        $this->assertSame(0.0008, Pricing::perOutput('ollama_cloud', 'ollama_cloud/glm-5.3-flash'));
        $this->assertSame('free', Pricing::rate('engine', 'engine/design')['billing']);
        // A paid model nobody priced isn't passed off as free.
        $this->assertSame(['billing' => 'unpriced', 'rate' => 'No price set'], Pricing::rate('higgsfield', 'seedance-2'));
    }

    public function test_runs_are_priced_by_what_they_made_or_by_pod_time(): void
    {
        config(['ai.providers.pod.hourly' => 0.36]);

        // Two 5-second clips at $0.112 a second.
        $this->assertSame(['cost' => 1.12, 'billing' => 'billed'], Pricing::run('higgsfield', 'higgsfield/kling-3-pro', 2, 5, 90));
        // Ten minutes on the pod: a sixth of its hourly rate.
        $this->assertSame(['cost' => 0.06, 'billing' => 'estimated'], Pricing::run('pod', 'pod/latentsync', 1, 0, 600));
        // Before running, the pod costs nothing extra: it's paid by the hour either way.
        $this->assertSame(0.0, Pricing::perOutput('pod', 'pod/latentsync'));
        $this->assertNull(Pricing::perOutput('higgsfield', 'seedance-2'));
    }

    public function test_a_pod_job_records_its_share_of_the_pods_hourly_rate(): void
    {
        Storage::fake('local');
        Storage::fake('public');
        config(['ai.providers.pod.hourly' => 0.36]);
        $this->freezeSecond();
        $user = User::factory()->create();
        $generation = $user->generations()->create(['kind' => 'song', 'model' => 'pod/acestep', 'prompt' => 'lofi', 'status' => 'running', 'started_at' => now()->subMinutes(5)]);

        app(GenerationRunner::class)->finish($generation, [['b64' => self::PNG, 'mime' => 'image/png']]);

        $usage = AiUsage::sole();
        $this->assertSame(['estimated', 300, 0.03, 'studio'], [$usage->billing, $usage->seconds, $usage->cost, $usage->purpose]);
        // The generation's own cost is what a provider bills: none.
        $this->assertSame(0.0, $generation->fresh()->cost);
    }

    public function test_spending_adds_up_billed_and_pod_costs_by_day_model_and_use(): void
    {
        config(['ai.providers.pod.hourly' => 0.36]);
        $user = User::factory()->create(['timezone' => 'UTC']);
        $meter = app(UsageMeter::class);

        $meter->within($user, null, 'composer', fn () => $meter->record('anthropic', 'claude-opus-5', 1_000_000, 0));
        $meter->within($user, null, 'lab', fn () => $meter->record('pod', 'pod/acestep', 0, 0, 0.36, 'estimated', 3600));
        $meter->within($user, null, 'lab', fn () => $meter->record('higgsfield', 'higgsfield/seedance-2', 0, 0, 0, 'unpriced'));
        // Someone else's, and last period's, don't count.
        $meter->within(User::factory()->create(), null, 'lab', fn () => $meter->record('anthropic', 'claude-opus-5', 1_000_000, 0));
        $old = $meter->within($user, null, 'composer', fn () => $meter->record('anthropic', 'claude-opus-5', 200_000, 0));
        $old->forceFill(['created_at' => now()->subDays(10)])->save();

        $this->actingAs($user)->spa()->getJson('/api/spending?days=7')
            ->assertOk()
            ->assertJsonPath('total', 5.36)
            ->assertJsonPath('billed', 5)
            ->assertJsonPath('estimated', 0.36)
            ->assertJsonPath('previous', 1)
            ->assertJsonPath('calls', 3)
            ->assertJsonPath('unpriced', 1)
            ->assertJsonPath('pod', ['hourly' => 0.36, 'seconds' => 3600, 'cost' => 0.36])
            ->assertJsonCount(7, 'daily')
            ->assertJsonPath('daily.6', ['date' => now()->toDateString(), 'billed' => 5, 'estimated' => 0.36])
            ->assertJsonPath('models.0.label', 'Claude Opus 5')
            ->assertJsonPath('models.0.rate', '$5 in · $25 out per 1M tokens')
            ->assertJsonPath('models.1.where', 'Your GPU pod')
            ->assertJsonPath('models.2.billing', 'unpriced')
            ->assertJsonPath('uses.0', ['label' => 'Writing posts', 'cost' => 5, 'calls' => 1])
            ->assertJsonPath('uses.1', ['label' => 'Creative Lab', 'cost' => 0.36, 'calls' => 2]);
    }
}

<?php

namespace App\Services\Ai\Models;

use Anthropic\Client;
use App\Models\ConnectorTest;
use App\Models\ModelEval;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Media\HiggsfieldClient;
use App\Services\Ai\OpenAiCompatibleGenerator;
use App\Services\Ai\TextGenerator;
use App\Services\Ai\UsageMeter;
use App\Services\Sound\SoundClient;
use App\Services\Sound\VoiceStudioClient;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * Every model the studio can use, local and cloud, in one list: what it's for, how it's
 * reached, whether it can run right now and if not why, and its eval score.
 *
 * Ids are "provider/model": anthropic/claude-opus-5-5, gateway/llama-3.3-70b, ollama/qwen2.5:7b,
 * higgsfield/ideogram-4.
 */
class ModelRegistry
{
    public const PROVIDERS = ['anthropic', 'gateway', 'groq', 'openrouter', 'ollama_cloud', 'ollama', 'higgsfield', 'google', 'sound', 'voicestudio'];

    public function __construct(private readonly TextGenerator $claude, private readonly UsageMeter $usage) {}

    /**
     * @return list<array{id: string, provider: string, model: string, label: string, kind: string, reach: string, local: bool, available: bool, reason: string|null, purpose: string|null, score: int|null}>
     */
    public function all(?string $kind = null): array
    {
        $models = [...$this->anthropic(), ...$this->openAi('gateway'), ...$this->openAi('groq'), ...$this->openAi('openrouter'), ...$this->openAi('ollama_cloud'), ...$this->ollama(), ...$this->higgsfield(), ...$this->google(), ...$this->sound(), ...$this->voicestudio()];
        $scores = ModelEval::query()
            ->selectRaw('model, avg(score) as score')
            ->whereIn('id', ModelEval::query()->selectRaw('max(id)')->groupBy('model', 'task'))
            ->groupBy('model')
            ->pluck('score', 'model');

        return array_values(array_filter(
            array_map(fn (array $m) => [...$m, 'score' => isset($scores[$m['id']]) ? (int) round($scores[$m['id']]) : null], $models),
            fn (array $m) => $kind === null || $m['kind'] === $kind,
        ));
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(string $id): ?array
    {
        return collect($this->all())->firstWhere('id', $id);
    }

    public function defaultText(): string
    {
        return $this->textModelOr((string) config('ai.default_text'));
    }

    /**
     * The preferred text model if it can run, otherwise whichever one can, or null when nothing
     * can — which is the honest answer to "is AI writing switched on", because a key for one
     * provider doesn't help a feature pointed at another.
     */
    public function availableText(string $preferred): ?string
    {
        $available = collect($this->all('text'))->where('available', true)->pluck('id');

        return $available->contains($preferred) ? $preferred : $available->first();
    }

    /**
     * The preferred text model if it can run, otherwise whichever one can. Configuring a model
     * that isn't reachable should cost a fallback, not a dead feature — and the caller records
     * the id this returns, so the run says which model actually wrote it.
     */
    public function textModelOr(string $preferred): string
    {
        return $this->availableText($preferred) ?? $preferred;
    }

    /**
     * The generator for a text model, and the model's name at its provider.
     *
     * @return array{0: TextGenerator, 1: string}
     *
     * @throws GenerationFailed when the model can't run.
     */
    public function text(string $id): array
    {
        $model = $this->find($id);
        if (! $model || $model['kind'] !== 'text') {
            throw new GenerationFailed('That model isn’t one the studio knows.');
        }
        if (! $model['available']) {
            throw new GenerationFailed("{$model['label']} isn’t available: {$model['reason']}");
        }

        return [match ($model['provider']) {
            'anthropic' => $this->claude,
            'ollama' => new OpenAiCompatibleGenerator('ollama', rtrim(config('ai.providers.ollama.url'), '/').'/v1', null, $this->usage),
            default => new OpenAiCompatibleGenerator($model['provider'], rtrim(config("ai.providers.{$model['provider']}.url"), '/'), config("ai.providers.{$model['provider']}.key"), $this->usage),
        }, $model['model']];
    }

    /**
     * Try a provider's credentials without spending anything, and remember the result.
     */
    public function test(string $provider): ConnectorTest
    {
        $started = microtime(true);
        try {
            $message = match ($provider) {
                'anthropic' => $this->testAnthropic(),
                'ollama' => $this->testOllama(),
                'higgsfield' => app(HiggsfieldClient::class)->test(),
                'sound' => $this->testSound(),
                'voicestudio' => $this->testVoiceStudio(),
                'google' => $this->testGoogle(),
                default => $this->testOpenAi(rtrim((string) config("ai.providers.{$provider}.url"), '/').'/models', config("ai.providers.{$provider}.key"), $provider),
            };
            $ok = true;
        } catch (Throwable $e) {
            [$ok, $message] = [false, $e instanceof GenerationFailed ? $e->getMessage() : 'Couldn’t connect: '.class_basename($e)];
        }
        Cache::forget("models.{$provider}");

        return ConnectorTest::create([
            'provider' => $provider,
            'ok' => $ok,
            'message' => mb_substr($message, 0, 250),
            'latency_ms' => (int) round((microtime(true) - $started) * 1000),
        ]);
    }

    /**
     * How each provider stands: configured, its last connector test.
     *
     * @return list<array<string, mixed>>
     */
    public function providers(): array
    {
        return array_map(function (string $p) {
            $test = ConnectorTest::latestFor($p);

            return [
                'id' => $p,
                'reach' => config("ai.providers.{$p}.reach"),
                'local' => (bool) config("ai.providers.{$p}.local", false),
                'configured' => $this->configured($p),
                'setup' => [
                    'anthropic' => 'Set ANTHROPIC_API_KEY.',
                    'gateway' => 'Set AI_GATEWAY_URL (an OpenAI-compatible /v1 base) and AI_GATEWAY_KEY.',
                    'groq' => 'Set GROQ_API_KEY (free at console.groq.com/keys).',
                    'openrouter' => 'Set OPENROUTER_API_KEY (free at openrouter.ai/keys).',
                    'ollama_cloud' => 'Set OLLAMA_CLOUD_API_KEY (free at ollama.com/settings/keys).',
                    'ollama' => 'Set OLLAMA_URL to an Ollama server, e.g. http://ollama:11434.',
                    'higgsfield' => 'Set HIGGSFIELD_KEY_ID and HIGGSFIELD_KEY_SECRET, and HIGGSFIELD_PLAN to the models your plan includes.',
                    'sound' => 'Run the sound service (docker compose up -d sound) and set SOUND_URL, e.g. http://sound:8000.',
                    'voicestudio' => 'Set VOICESTUDIO_URL to your VoiceStudio server, and VOICESTUDIO_KEY when it’s not on loopback.',
                    'google' => 'Set GEMINI_API_KEY for Gemini image generation and Veo video generation.',
                ][$p],
                'test' => $test ? ['ok' => $test->ok, 'message' => $test->message, 'latency_ms' => $test->latency_ms, 'at' => $test->created_at?->toIso8601ZuluString()] : null,
            ];
        }, self::PROVIDERS);
    }

    public function configured(string $provider): bool
    {
        return match ($provider) {
            'anthropic' => $this->claude->enabled(),
            'gateway' => filled(config('ai.providers.gateway.url')),
            'groq', 'openrouter', 'ollama_cloud' => filled(config("ai.providers.{$provider}.key")),
            'ollama' => filled(config('ai.providers.ollama.url')),
            'higgsfield' => filled(config('ai.providers.higgsfield.key_id')) && filled(config('ai.providers.higgsfield.key_secret')),
            'sound' => app(SoundClient::class)->configured(),
            'voicestudio' => app(VoiceStudioClient::class)->configured(),
            'google' => filled(config('ai.providers.google.key')),
            default => false,
        };
    }

    /* ------------------------------------------------------------------ */

    private function entry(string $provider, string $model, string $label, string $kind, ?string $purpose, bool $available, ?string $reason, ?bool $local = null, array $capabilities = []): array
    {
        return [
            'id' => "{$provider}/{$model}",
            'provider' => $provider,
            'model' => $model,
            'label' => $label,
            'kind' => $kind,
            'reach' => config("ai.providers.{$provider}.reach"),
            'local' => $local ?? (bool) config("ai.providers.{$provider}.local", false),
            'available' => $available,
            'reason' => $available ? null : $reason,
            'purpose' => $purpose,
            'capabilities' => (object) $capabilities,
        ];
    }

    private function anthropic(): array
    {
        $on = $this->claude->enabled();

        return collect(config('ai.providers.anthropic.models'))
            ->map(fn (array $m, string $id) => $this->entry('anthropic', $id, $m['label'], 'text', $m['purpose'] ?? null, $on, 'No Anthropic API key is set.'))
            ->values()->all();
    }

    /**
     * Text models discovered from an OpenAI-compatible GET {url}/models. `suffix` keeps only
     * the ids that end with it (OpenRouter's ':free' list); `local_models` marks the
     * effectively-free ones, and can pin the list exactly instead of discovering.
     */
    private function openAi(string $provider): array
    {
        if (! $this->configured($provider)) {
            return [];
        }
        $local = config("ai.providers.{$provider}.local_models", []);
        $suffix = (string) config("ai.providers.{$provider}.suffix", '');
        // A slow or unreachable provider must not empty the picker: cache only real lists, and
        // serve the last good one while the provider is having a moment.
        $cacheKey = "models.{$provider}";
        try {
            $r = Http::timeout(8)->when(filled(config("ai.providers.{$provider}.key")), fn ($h) => $h->withToken((string) config("ai.providers.{$provider}.key")))
                ->acceptJson()->get(rtrim(config("ai.providers.{$provider}.url"), '/').'/models');
            $found = $r->successful() ? collect($r->json('data', []))->pluck('id')->filter()->values()->all() : [];
            if ($found) {
                Cache::put($cacheKey, $found, 300);
                $text = $found;
            } else {
                $text = Cache::get($cacheKey, []);
            }
        } catch (Throwable) {
            $text = Cache::get($cacheKey, []);
        }
        if ($suffix !== '') {
            $text = array_values(array_filter($text, fn ($id) => str_ends_with($id, $suffix)));
        }
        if ($local && $provider === 'openrouter') {
            $text = $text ? array_values(array_intersect($text, $local)) : $local;
        }
        // Effectively free: pinned in local_models, or kept by a ':free'-style suffix filter.
        $free = fn ($id) => in_array($id, $local, true) || ($suffix !== '' && str_ends_with($id, $suffix));
        $images = config("ai.providers.{$provider}.image_models", []);
        $reach = config("ai.providers.{$provider}.reach");
        // Speech models come back in the same list: Whisper listens, and voices aren't writers.
        $listen = array_values(array_filter($text, fn ($id) => str_contains(strtolower($id), 'whisper')));
        $text = array_values(array_filter($text, fn ($id) => ! preg_match('/whisper|tts|playai|orpheus|guard|distil-/i', $id)));

        return [
            ...collect($text)->reject(fn ($id) => in_array($id, $images, true))
                ->map(fn ($id) => $this->entry($provider, $id, $id, 'text', $free($id) ? 'Free tier: effectively free, for prototyping' : "{$reach} model", true, null, $free($id)))->all(),
            ...collect($listen)->map(fn ($id) => $this->entry($provider, $id, $id, 'listen', "Transcripts through {$reach}", true, null))->all(),
            ...collect($images)->map(fn ($id) => $this->entry($provider, $id, $id, 'image', "Images through {$reach}", true, null))->all(),
        ];
    }

    private function ollama(): array
    {
        if (! $this->configured('ollama')) {
            return [];
        }
        try {
            $r = Http::timeout(8)->acceptJson()->get(rtrim(config('ai.providers.ollama.url'), '/').'/api/tags');
            $found = $r->successful() ? collect($r->json('models', []))->pluck('name')->filter()->values()->all() : [];
            if ($found) {
                Cache::put('models.ollama', $found, 300);
                $tags = $found;
            } else {
                $tags = Cache::get('models.ollama', []);
            }
        } catch (Throwable) {
            $tags = Cache::get('models.ollama', []);
        }

        return collect($tags)->map(fn ($id) => $this->entry('ollama', $id, $id, 'text', 'Installed locally: free, private, for prototyping', true, null))->values()->all();
    }

    private function higgsfield(): array
    {
        $configured = $this->configured('higgsfield');
        $plan = config('ai.providers.higgsfield.plan', []);
        $test = ConnectorTest::latestFor('higgsfield');

        return collect(config('ai.providers.higgsfield.models'))->map(function (array $m, string $id) use ($configured, $plan, $test) {
            $reason = match (true) {
                ! $m['route'] => 'No API route for this model yet.',
                ! in_array($id, $plan, true) => 'Not in your Higgsfield plan.',
                ! $configured => 'No Higgsfield API key is set.',
                ! $test => 'The Higgsfield connector hasn’t been tested.',
                ! $test->ok => 'The Higgsfield connector test failed: '.$test->message,
                default => null,
            };

            return $this->entry('higgsfield', $id, $m['label'], $m['kind'], $m['purpose'] ?? null, $reason === null, $reason, capabilities: $m['capabilities'] ?? []);
        })->values()->all();
    }

    /**
     * FlowAI Sound: voices, the composer and the listener, on this server. Available whenever the
     * service answers.
     */
    private function sound(): array
    {
        $client = app(SoundClient::class);
        if (! $client->configured()) {
            return [];
        }
        $up = $client->up();
        $reason = 'FlowAI Sound isn’t answering. Start it with docker compose up -d sound.';

        return [
            $this->entry('sound', 'kokoro', 'Kokoro voices', 'voice', 'Natural voiceovers in seven languages, made on this server', $up, $reason),
            $this->entry('sound', 'composer', 'FlowAI Composer', 'music', 'Original, licence-free music for every post', $up, $reason),
            $this->entry('sound', 'whisper', 'Whisper', 'listen', 'Transcripts, dictation and word timing for captions', $up, $reason),
        ];
    }

    /**
     * VoiceStudio: cloned and designed voices on a VoiceStudio server, next to the local ones.
     * Available whenever the server answers.
     */
    private function voicestudio(): array
    {
        $client = app(VoiceStudioClient::class);
        if (! $client->configured()) {
            return [];
        }
        $up = $client->up();

        return [
            $this->entry('voicestudio', 'voices', 'VoiceStudio voices', 'voice', 'Your cloned and designed voices, from your VoiceStudio server', $up, 'VoiceStudio isn’t answering. Check VOICESTUDIO_URL and that the server is up.'),
        ];
    }

    private function testVoiceStudio(): string
    {
        $client = app(VoiceStudioClient::class);
        if (! $client->configured()) {
            throw new GenerationFailed('No VOICESTUDIO_URL is set.');
        }
        Cache::forget('voicestudio.up');
        Cache::forget('voicestudio.voices');
        $r = Http::timeout(6)->acceptJson()
            ->when(filled(config('ai.providers.voicestudio.key')), fn ($h) => $h->withToken((string) config('ai.providers.voicestudio.key')))
            ->get($client->url().'/health');
        if (! $r->successful()) {
            throw new GenerationFailed("VoiceStudio answered {$r->status()}.");
        }
        $voices = count($client->voices());

        return "Connected. {$voices} voice ".($voices === 1 ? 'profile' : 'profiles').' ready.';
    }

    private function testSound(): string
    {
        $client = app(SoundClient::class);
        if (! $client->configured()) {
            throw new GenerationFailed('No SOUND_URL is set.');
        }
        Cache::forget('sound.up');
        $r = Http::timeout(6)->acceptJson()->get($client->url().'/health');
        if (! $r->successful()) {
            throw new GenerationFailed("FlowAI Sound answered {$r->status()}.");
        }

        return 'Connected. '.$r->json('voices').' voices, '.count($r->json('moods', [])).' music moods, Whisper '.$r->json('whisper').'.';
    }

    private function google(): array
    {
        $configured = $this->configured('google');

        return collect(config('ai.providers.google.models', []))->map(fn (array $m, string $id) => $this->entry(
            'google', $id, $m['label'], $m['kind'], $m['purpose'] ?? null,
            $configured, $configured ? null : 'No Gemini API key is set.',
            capabilities: $m['capabilities'] ?? [],
        ))->values()->all();
    }

    private function testAnthropic(): string
    {
        if (! $this->claude->enabled()) {
            throw new GenerationFailed('No Anthropic API key is set.');
        }
        $page = (new Client(apiKey: config('services.anthropic.key')))->models->list(limit: 5);
        $n = count($page->getItems());

        return "Connected. The key can see {$n}+ models.";
    }

    private function testOpenAi(string $url, ?string $key, string $provider = 'gateway'): string
    {
        $name = config("ai.providers.{$provider}.reach", 'The gateway');
        if (! filled(config("ai.providers.{$provider}.url"))) {
            throw new GenerationFailed("No {$name} URL is set.");
        }
        $r = Http::timeout(6)->when(filled($key), fn ($h) => $h->withToken((string) $key))->acceptJson()->get($url);
        if ($r->status() === 401 || $r->status() === 403) {
            throw new GenerationFailed("{$name} rejected the key.");
        }
        if (! $r->successful()) {
            throw new GenerationFailed("{$name} answered {$r->status()}.");
        }

        return 'Connected. '.count($r->json('data', [])).' models available.';
    }

    private function testOllama(): string
    {
        if (! filled(config('ai.providers.ollama.url'))) {
            throw new GenerationFailed('No Ollama URL is set.');
        }
        $r = Http::timeout(6)->acceptJson()->get(rtrim(config('ai.providers.ollama.url'), '/').'/api/tags');
        if (! $r->successful()) {
            throw new GenerationFailed("Ollama answered {$r->status()}.");
        }

        return 'Connected. '.count($r->json('models', [])).' models installed.';
    }

    private function testGoogle(): string
    {
        if (! $this->configured('google')) {
            throw new GenerationFailed('No Gemini API key is set.');
        }
        $r = Http::timeout(10)->withHeaders(['x-goog-api-key' => config('ai.providers.google.key')])
            ->acceptJson()->get(rtrim(config('ai.providers.google.url'), '/').'/models');
        if (in_array($r->status(), [401, 403], true)) {
            throw new GenerationFailed('Google rejected the Gemini API key.');
        }
        if (! $r->successful()) {
            throw new GenerationFailed("Google answered {$r->status()}.");
        }

        return 'Connected. Gemini and Veo are ready.';
    }
}

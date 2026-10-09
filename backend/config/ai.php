<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Model registry
    |--------------------------------------------------------------------------
    |
    | Every model the studio can use, local and cloud, in one list. Each
    | provider says how its models are reached; the model picker shows it.
    | Text models: Claude, any OpenAI-compatible gateway, Ollama on this
    | network. Images and video: Higgsfield, and gateway image models.
    |
    | A model is offered only when it can actually run: credentials set, and
    | for Higgsfield also an API route, a place in your plan, and a connector
    | test that passed (POST /api/models/test/higgsfield).
    |
    */

    // What the composer and the generators start on.
    'default_text' => env('AI_DEFAULT_TEXT', 'anthropic/claude-opus-5'),

    'providers' => [

        'anthropic' => [
            'reach' => 'Claude API',
            'local' => false,
            'models' => [
                'claude-opus-5' => ['label' => 'Claude Opus 5', 'purpose' => 'Writing and rewriting posts'],
                'claude-opus-5-5' => ['label' => 'Claude Opus 5.5', 'purpose' => 'Strategy, the agents and the content kit'],
                'claude-sonnet-5-5' => ['label' => 'Claude Sonnet 5.5', 'purpose' => 'Fast drafts, adaptations and triage'],
            ],
        ],

        // Any OpenAI-compatible endpoint: a team gateway, OpenRouter, vLLM, LM Studio.
        // Text models are discovered from GET {url}/models; list image models by id.
        'gateway' => [
            'reach' => 'Gateway',
            'url' => env('AI_GATEWAY_URL'),
            'key' => env('AI_GATEWAY_KEY'),
            'image_models' => array_values(array_filter(explode(',', (string) env('AI_GATEWAY_IMAGE_MODELS', '')))),
            // Models the gateway serves from local hardware rather than a vendor.
            'local_models' => array_values(array_filter(explode(',', (string) env('AI_GATEWAY_LOCAL_MODELS', '')))),
        ],

        // Groq: free key at console.groq.com/keys. Fast Llama and Gemma, all free-tier.
        'groq' => [
            'reach' => 'Groq',
            'url' => env('GROQ_URL', 'https://api.groq.com/openai/v1'),
            'key' => env('GROQ_API_KEY'),
            // Discovered models are kept only when their id ends with this ('' keeps all).
            'suffix' => '',
            // Effectively free: the free tier covers prototyping and then some.
            'local_models' => array_values(array_filter(explode(',', (string) env('GROQ_FREE_MODELS', 'llama-3.3-70b-versatile,llama-3.1-8b-instant')))),
        ],

        // OpenRouter: free key at openrouter.ai/keys. Hundreds of models; the picker keeps
        // the ':free' ones only, or exactly OPENROUTER_MODELS when it's set.
        'openrouter' => [
            'reach' => 'OpenRouter',
            'url' => env('OPENROUTER_URL', 'https://openrouter.ai/api/v1'),
            'key' => env('OPENROUTER_API_KEY'),
            'suffix' => env('OPENROUTER_SUFFIX', ':free'),
            'local_models' => array_values(array_filter(explode(',', (string) env('OPENROUTER_MODELS', '')))),
        ],

        // Local models on Ollama, used through its OpenAI-compatible API.
        // Ollama Cloud (ollama.com): hosted frontier-size models, free-tier key. OpenAI-compatible.
        'ollama_cloud' => [
            'reach' => 'Ollama Cloud',
            'url' => env('OLLAMA_CLOUD_URL', 'https://ollama.com/v1'),
            'key' => env('OLLAMA_CLOUD_API_KEY'),
            'suffix' => '',
            // Effectively free during the cloud preview, big enough for real writing.
            'local_models' => array_values(array_filter(explode(',', (string) env('OLLAMA_CLOUD_MODELS', 'gpt-oss:120b,gpt-oss:20b')))),
        ],

        // FlowAI Sound (sound/): voices (Kokoro), listening (Whisper) and the composer, on this
        // server. docker compose runs it; nothing to sign up for.
        'sound' => [
            'reach' => 'FlowAI Sound',
            'local' => true,
            'url' => env('SOUND_URL', 'http://sound:8000'),
        ],

        'ollama' => [
            'reach' => 'Ollama',
            'url' => env('OLLAMA_URL'),
            'local' => true,
        ],

        'higgsfield' => [
            'reach' => 'Higgsfield API',
            'local' => false,
            'url' => env('HIGGSFIELD_URL', 'https://api.higgsfield.ai'),
            'key_id' => env('HIGGSFIELD_KEY_ID'),
            'key_secret' => env('HIGGSFIELD_KEY_SECRET'),
            // The models your Higgsfield plan includes.
            'plan' => array_values(array_filter(explode(',', (string) env('HIGGSFIELD_PLAN', 'ideogram-4,wan-2-7-i2v')))),
            // route: the model's endpoint. image_field: where an input image goes. params: what may be passed through.
            // price: dollars per output, from your plan, for the usage numbers (null if unknown).
            'models' => [
                'ideogram-4' => ['label' => 'Ideogram 4.0', 'kind' => 'image', 'route' => '/ideogram/v4.0',
                    'image_field' => 'image_url', 'params' => ['aspect_ratio', 'rendering_speed', 'image_weight'], 'price' => null,
                    'purpose' => 'Photos and graphics from a prompt; remix a product photo'],
                'wan-2-7-i2v' => ['label' => 'Wan 2.7 · image to video', 'kind' => 'video', 'route' => '/wan/v2.7/image-to-video',
                    'image_field' => 'image_url', 'requires_image' => true, 'params' => ['duration', 'resolution', 'negative_prompt', 'seed'], 'price' => null,
                    'purpose' => 'Short clips that bring a still to life'],
                'soul' => ['label' => 'Higgsfield Soul', 'kind' => 'image', 'route' => null, 'purpose' => 'Fashion-grade portraits'],
                'kling' => ['label' => 'Kling', 'kind' => 'video', 'route' => null, 'purpose' => 'Text to video'],
                'seedance-2-5' => ['label' => 'Seedance 2.5', 'kind' => 'video', 'route' => null, 'purpose' => 'Reference to video'],
            ],
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Campaign agents
    |--------------------------------------------------------------------------
    |
    | The writer, visual director, adapter and QA run on `model`. The media
    | team uses the first available image and video models from the registry,
    | preferring these when they can run.
    |
    */

    'agents' => [
        'model' => env('AI_AGENTS_MODEL', 'anthropic/claude-opus-5-5'),
        'image_model' => 'higgsfield/ideogram-4',
        'video_model' => 'higgsfield/wan-2-7-i2v',
    ],

    /*
    |--------------------------------------------------------------------------
    | Campaign intake
    |--------------------------------------------------------------------------
    |
    | The model behind the intake interview, reading reference photos, and
    | writing the content kit. Interview turns run at low effort so replies
    | come back quickly; the kit is the deliverable and gets more thought.
    |
    */

    'intake' => [
        'model' => 'claude-opus-5-5',
        'interview_effort' => 'low',
        'kit_effort' => 'medium',
    ],

    /*
    |--------------------------------------------------------------------------
    | Prices
    |--------------------------------------------------------------------------
    |
    | Dollars per million tokens, [input, output], for the usage numbers in
    | Operations and on every run record.
    |
    */

    'prices' => [
        'claude-opus-5-5' => [4, 20],
        'claude-opus-5' => [5, 25],
        'claude-sonnet-5-5' => [2, 10],
        'claude-haiku-4-5' => [1, 5],
    ],

];

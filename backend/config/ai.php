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

        // Any OpenAI-compatible endpoint: Ollama Cloud, a team gateway, OpenRouter, vLLM, LM Studio.
        // Text models are discovered from GET {url}/models; list image models by id.
        //
        // Reasoning models (glm-5.3, glm-5.3-flash, deepseek, kimi) are left on their default
        // thinking mode deliberately. Ollama Cloud accepts `think: false` and
        // `reasoning_effort: "none"` but neither stops the model reasoning — they only stop it
        // being separated out, so the monologue lands in `choices[].message.content`, in one case
        // with a literal `</think>` tag still in it. On the default, `content` holds the answer
        // alone and the reasoning stays in `message.reasoning`, which this app never reads. So
        // the default is both cleaner and the only mode that cannot leak thinking into a caption.
        'gateway' => [
            // Whose gateway it is, for the model picker. Generic unless you say otherwise.
            'reach' => env('AI_GATEWAY_REACH', 'Gateway'),
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

        // VoiceStudio: cloned and designed voices on a VoiceStudio server, an alternative to the
        // local voices above. Speaks OpenAI-compatible speech at {url}/v1/audio/speech; the key
        // is the bearer token its remote auth expects (loopback needs none).
        'voicestudio' => [
            'reach' => 'VoiceStudio',
            'local' => false,
            'url' => env('VOICESTUDIO_URL'),
            'key' => env('VOICESTUDIO_KEY'),
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
            'plan' => array_values(array_filter(explode(',', (string) env('HIGGSFIELD_PLAN', 'ideogram-4,wan-2-7-i2v,soul-v2,soul,soul-cinema,grok-image-2,kling-3-pro,seedance-2,hailuo-2-3,cinema-studio-4,soul-id,ads-studio,motion-control-std,motion-control-pro,genjutsu-restyle')))),
            // route: the model's endpoint. image_field: where an input image goes. params: what may be passed through
            // (the request schema, docs.higgsfield.ai; i2v_params when the image-to-video route takes fewer).
            // price: dollars per output, from your plan, for the usage numbers (null if unknown).
            // feature: one of Higgsfield's own tools (Cinema Studio, Soul ID, Ads Studio, Motion Control, Restyle),
            // with a Creative Lab node of its own rather than a place in the plain picture and video pickers.
            'models' => [
                'ideogram-4' => ['label' => 'Ideogram 4.0', 'kind' => 'image', 'route' => '/ideogram/v4.0',
                    'image_field' => 'image_url', 'params' => ['aspect_ratio', 'rendering_speed', 'image_weight'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:5', '9:16', '16:9'], 'resolutions' => [], 'max_inputs' => 1, 'input_optional' => true],
                    'purpose' => 'Photos and graphics from a prompt; remix a product photo'],
                'wan-2-7-i2v' => ['label' => 'Wan 2.7 · image to video', 'kind' => 'video', 'route' => '/wan/v2.7/image-to-video',
                    'image_field' => 'image_url', 'requires_image' => true, 'params' => ['duration', 'resolution', 'negative_prompt', 'seed'], 'price' => null,
                    'capabilities' => ['durations' => [5, 10, 15], 'resolutions' => ['720p', '1080p'], 'max_inputs' => 1, 'requires_image' => true],
                    'purpose' => 'Short clips that bring a still to life'],
                // Soul makes 1 or 4 pictures a request (batch_size), at 720p unless asked: 1080p for posts.
                'soul-v2' => ['label' => 'Higgsfield Soul 2', 'kind' => 'image', 'route' => '/higgsfield-ai/soul/v2/standard',
                    'params' => ['aspect_ratio', 'resolution', 'seed', 'batch_size', 'custom_reference_id', 'custom_reference_strength'], 'extra' => ['resolution' => '1080p'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'], 'resolutions' => ['720p', '1080p'], 'default_resolution' => '1080p', 'max_inputs' => 0, 'seed' => true, 'max_outputs' => 4, 'batch_sizes' => [1, 4]],
                    'purpose' => 'High-end social photography and editorial portraits'],
                'soul' => ['label' => 'Higgsfield Soul', 'kind' => 'image', 'route' => '/higgsfield-ai/soul/standard',
                    'reference_field' => 'image_reference_url', 'reference_list' => false, 'params' => ['aspect_ratio', 'resolution', 'seed', 'batch_size', 'custom_reference_id', 'custom_reference_strength'], 'extra' => ['resolution' => '1080p'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'], 'resolutions' => ['720p', '1080p'], 'default_resolution' => '1080p', 'max_inputs' => 1, 'input_optional' => true, 'seed' => true, 'max_outputs' => 4, 'batch_sizes' => [1, 4]],
                    'purpose' => 'Fashion-grade portraits with an optional reference'],
                'soul-cinema' => ['label' => 'Soul Cinema', 'kind' => 'image', 'route' => '/higgsfield-ai/soul/cinema',
                    'params' => ['aspect_ratio', 'resolution', 'seed', 'batch_size', 'custom_reference_id', 'custom_reference_strength'], 'extra' => ['resolution' => '1080p'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'], 'resolutions' => ['720p', '1080p'], 'default_resolution' => '1080p', 'max_inputs' => 0, 'seed' => true, 'max_outputs' => 4, 'batch_sizes' => [1, 4]],
                    'purpose' => 'Cinematic campaign stills and key art'],
                // One picture a request: more are more requests.
                'grok-image-2' => ['label' => 'Grok Imagine Image 2', 'kind' => 'image', 'route' => '/xai/grok-imagine-image-2.0',
                    'reference_field' => 'image_urls', 'reference_list' => true, 'params' => ['aspect_ratio', 'resolution', 'quality'], 'extra' => ['quality' => 'medium'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'], 'resolutions' => ['1k', '2k'], 'default_resolution' => '2k', 'max_inputs' => 10, 'input_optional' => true],
                    'purpose' => 'Fast, flexible social visuals with up to ten references'],
                // The image-to-video routes take their shape from the picture: no aspect_ratio there.
                'kling-3-pro' => ['label' => 'Kling 3 Pro', 'kind' => 'video', 'route' => '/kling-video/v3.0/pro/text-to-video', 'i2v_route' => '/kling-video/v3.0/pro/image-to-video',
                    'image_field' => 'image_url', 'end_frame_field' => 'last_image_url', 'audio_field' => 'sound', 'audio_values' => ['on', 'off'], 'params' => ['aspect_ratio', 'duration'], 'i2v_params' => ['duration'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['16:9', '9:16', '1:1'], 'durations' => [5, 8, 10, 15], 'max_inputs' => 2, 'input_optional' => true, 'end_frame' => true, 'audio' => true],
                    'purpose' => 'Cinematic text-to-video or first/last-frame animation'],
                'seedance-2' => ['label' => 'Seedance 2', 'kind' => 'video', 'route' => '/bytedance/seedance-2.0/text-to-video', 'i2v_route' => '/bytedance/seedance-2.0/image-to-video',
                    'image_field' => 'image_url', 'end_frame_field' => 'end_image_url', 'audio_field' => 'generate_audio', 'params' => ['aspect_ratio', 'duration', 'resolution'], 'i2v_params' => ['duration', 'resolution'], 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], 'durations' => [5, 8, 10, 15], 'resolutions' => ['480p', '720p', '1080p', '4k'], 'default_resolution' => '1080p', 'max_inputs' => 2, 'input_optional' => true, 'end_frame' => true, 'audio' => true],
                    'purpose' => 'Social video with sound, from text or first/last frames'],
                'hailuo-2-3' => ['label' => 'Hailuo 2.3', 'kind' => 'video', 'route' => '/minimax/hailuo-2.3/standard/text-to-video', 'i2v_route' => '/minimax/hailuo-2.3/standard/image-to-video',
                    'image_field' => 'image_url', 'params' => ['duration'], 'extra' => ['prompt_optimizer' => true], 'price' => null,
                    'capabilities' => ['durations' => [6, 10], 'max_inputs' => 1, 'input_optional' => true],
                    'purpose' => 'Fast text-to-video or image animation for short-form content'],

                /* Higgsfield's own tools, each a Creative Lab node (Catalog, group higgsfield). */

                // A director's shot: camera move, genre, lens, film stock and grade picked, the rest left to it.
                // Reference pictures make it reference-to-video (<<<image_1>>> in the prompt points at one).
                'cinema-studio-4' => ['label' => 'Cinema Studio 4', 'kind' => 'video', 'route' => '/higgsfield/cinema-studio/4.0',
                    'reference_field' => 'image_urls', 'reference_list' => true,
                    'params' => ['aspect_ratio', 'duration', 'resolution', 'generate_audio', 'camera_movement', 'genre', 'era', 'light', 'pacing', 'camera_lens', 'camera_model', 'camera_aperture', 'color_palette'], 'price' => null,
                    'capabilities' => ['feature' => 'cinema', 'aspect_ratios' => ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], 'durations' => [4, 5, 6, 8, 10, 12, 15, 20, 25, 30], 'resolutions' => ['480p', '720p'], 'max_inputs' => 30, 'input_optional' => true, 'audio' => true, 'seconds' => 240],
                    'purpose' => 'Cinematic shots with real camera moves (dolly zoom, bullet time, drone orbit…), with sound'],
                // Trains a character from photos of one person; Soul pictures then keep that face.
                'soul-id' => ['label' => 'Soul ID', 'kind' => 'character', 'route' => '/v1/custom-references', 'price' => null,
                    'capabilities' => ['feature' => 'character', 'max_inputs' => 100, 'seconds' => 420],
                    'purpose' => 'A character trained once from photos, the same face in every picture'],
                // Finished ads (headline and copy drawn in), 1 to 8 concepts from one brief.
                'ads-studio' => ['label' => 'Ads Studio', 'kind' => 'image', 'route' => '/higgsfield/ads-studio/v1.0',
                    'reference_field' => 'image_urls', 'reference_list' => true, 'params' => ['aspect_ratio', 'batch_size', 'niche', 'target_audience', 'language'], 'price' => null,
                    'capabilities' => ['feature' => 'ads', 'aspect_ratios' => ['1:1', '4:5', '5:4', '16:9', '9:16', '4:3', '3:4', '21:9', '3:2', '2:3'], 'max_inputs' => 10, 'input_optional' => true, 'max_outputs' => 8, 'seconds' => 120],
                    'purpose' => 'Ready-to-post ads from a brief and product photos, several concepts at once'],
                // The moves of one video, done by the person in a picture (trends, dances, gestures).
                'motion-control-std' => ['label' => 'Kling 3 Motion Control', 'kind' => 'video', 'route' => '/kling-video/v3/motion-control/std',
                    'image_field' => 'image_url', 'video_field' => 'video_url', 'requires_image' => true, 'requires_video' => true, 'prompt_optional' => true,
                    'params' => ['keep_original_sound', 'character_orientation'], 'price' => null,
                    'capabilities' => ['feature' => 'motion', 'max_inputs' => 1, 'requires_image' => true, 'seconds' => 300],
                    'purpose' => 'The moves from a video, done by the person in your picture'],
                'motion-control-pro' => ['label' => 'Kling 3 Motion Control Pro', 'kind' => 'video', 'route' => '/kling-video/v3/motion-control/pro',
                    'image_field' => 'image_url', 'video_field' => 'video_url', 'requires_image' => true, 'requires_video' => true, 'prompt_optional' => true,
                    'params' => ['keep_original_sound', 'character_orientation'], 'price' => null,
                    'capabilities' => ['feature' => 'motion', 'max_inputs' => 1, 'requires_image' => true, 'seconds' => 420],
                    'purpose' => 'The same, sharper hands and faces; slower and dearer'],
                // A video in another look (anime, clay, comic…), its motion, framing and sound kept.
                'genjutsu-restyle' => ['label' => 'Genjutsu Restyle', 'kind' => 'video', 'route' => '/higgsfield/genjutsu/restyle/v1.0',
                    'video_field' => 'video_url', 'reference_field' => 'image_urls', 'reference_list' => true, 'requires_video' => true, 'prompt_optional' => true,
                    'params' => ['preset_id', 'resolution'], 'presets' => '/models/higgsfield/genjutsu/restyle/v1.0/presets', 'price' => null,
                    'capabilities' => ['feature' => 'restyle', 'resolutions' => ['480p', '720p', '1080p'], 'max_inputs' => 5, 'input_optional' => true, 'seconds' => 300],
                    'purpose' => 'Your video in another look, its motion and sound kept'],
            ],
        ],

        // The GPU pod's models and the assistant's own drawing, through the assistant service's engine.
        'pod' => ['reach' => 'Your GPU pod', 'local' => true],
        'engine' => ['reach' => 'The assistant service', 'local' => true],

        'google' => [
            'reach' => 'Google Gemini API',
            'local' => false,
            'url' => env('GOOGLE_GENAI_URL', 'https://generativelanguage.googleapis.com/v1beta'),
            'key' => env('GEMINI_API_KEY'),
            'models' => [
                'gemini-3.1-flash-image' => ['label' => 'Gemini 3.1 Flash Image', 'kind' => 'image', 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'], 'resolutions' => ['1K', '2K', '4K'], 'default_resolution' => '2K', 'max_inputs' => 10, 'input_optional' => true],
                    'purpose' => 'Google’s fast image model for generation and reference-based edits'],
                'veo-3.1-fast-generate-preview' => ['label' => 'Veo 3.1 Fast', 'kind' => 'video', 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['9:16', '16:9'], 'durations' => [4, 6, 8], 'resolutions' => ['720p', '1080p', '4k'], 'default_resolution' => '720p', 'max_inputs' => 2, 'input_optional' => true, 'end_frame' => true, 'audio' => true, 'audio_always_on' => true, 'seed' => true],
                    'purpose' => 'Vertical or landscape social video with native audio'],
                'veo-3.1-generate-preview' => ['label' => 'Veo 3.1', 'kind' => 'video', 'price' => null,
                    'capabilities' => ['aspect_ratios' => ['9:16', '16:9'], 'durations' => [4, 6, 8], 'resolutions' => ['720p', '1080p', '4k'], 'default_resolution' => '720p', 'max_inputs' => 2, 'input_optional' => true, 'end_frame' => true, 'audio' => true, 'audio_always_on' => true, 'seed' => true],
                    'purpose' => 'Highest-quality Google video with native audio'],
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
    | A full "provider/model" id, like default_text and agents.model, and
    | resolved through the registry: if this one can't run the interview falls
    | back to another model that can, rather than to the fixed question list.
    | Unset, it's the default text model.
    |
    */

    'intake' => [
        'model' => env('AI_INTAKE_MODEL', env('AI_DEFAULT_TEXT', 'gateway/glm-5.3-flash')),
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

    /*
    |--------------------------------------------------------------------------
    | The assistant's engine
    |--------------------------------------------------------------------------
    |
    | The assistant service (assistant/) runs the GPU pod's models and its own
    | drawing for Creative Lab nodes: http://assistant:8000 in docker compose.
    | Both read the repo's one .env, so ENGINE_KEY is the same on each side.
    |
    | `settings` are what the assistant reads from that file, for the Models
    | page to say which are filled in. Whether each one works is the
    | assistant's to say (GET /engine/catalog): it only sees a change once
    | it's recreated (docker compose up -d assistant).
    |
    */

    'engine' => [
        'url' => env('ENGINE_URL'),
        'key' => env('ENGINE_KEY'),
        // yt-dlp for YouTube nodes, and a cookies file for when YouTube asks the server to sign in.
        'ytdlp' => env('YTDLP_BIN', 'yt-dlp'),
        'ytdlp_cookies' => env('YTDLP_COOKIES'),
        'settings' => [
            'COMFYUI_URL' => env('COMFYUI_URL'),
            'COMFYUI_API_KEY' => env('COMFYUI_API_KEY'),
            'MUSIC_URL' => env('MUSIC_URL'),
            'MUSIC_API_KEY' => env('MUSIC_API_KEY'),
            'LIPSYNC_URL' => env('LIPSYNC_URL'),
            'LIPSYNC_API_KEY' => env('LIPSYNC_API_KEY'),
            'FACESWAP_URL' => env('FACESWAP_URL'),
            'FACESWAP_API_KEY' => env('FACESWAP_API_KEY'),
            'LLM_MODEL' => env('LLM_MODEL'),
        ],
    ],

    'prices' => [
        'claude-opus-5-5' => [4, 20],
        'claude-opus-5' => [5, 25],
        'claude-sonnet-5-5' => [2, 10],
        'claude-haiku-4-5' => [1, 5],
    ],

];

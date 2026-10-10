from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    # LLM
    ollama_api_key: str = ""
    ollama_host: str = "https://ollama.com"
    llm_model: str = "glm-5.3-flash"
    # GLM 5.3 Flash leaks its reasoning into the reply with think=false; "low" keeps it
    # separate and is the fastest clean option. Accepts true | false | low | medium | high
    llm_think: bool | Literal["low", "medium", "high"] = "low"
    # Tool-calling rounds per reply; a post or a carousel takes one (create_draft does it all)
    llm_max_tool_rounds: int = 12
    system_prompt: str = (
        "You are a friendly voice assistant having a spoken conversation. "
        "Your replies are converted to speech, so keep them short and natural: "
        "one to three sentences, no markdown, no lists, no emojis, no code. "
        "Spell out numbers and symbols the way you would say them. "
        "Use the available tools when they help you answer or act for the user, "
        "and briefly say what you did. Reply in the language the user speaks."
    )

    # ASR
    asr_model: str = "nvidia/nemotron-3.5-asr-streaming-0.6b"
    asr_language: str = "auto"
    asr_mode: str = "streaming"  # streaming | offline
    asr_lookahead: int = 3
    asr_device: str = "cuda"
    asr_dtype: Literal["float16", "bfloat16", "float32"] = "float16"

    # TTS
    tts_model: str = "k2-fsa/OmniVoice"
    tts_device: str = "cuda"
    # GTX 16xx cards have no tensor cores: fp16 is ~6x slower there and OmniVoice
    # produces unintelligible audio in fp16, so default to float32
    tts_dtype: Literal["float16", "bfloat16", "float32"] = "float32"
    tts_num_step: int = 8
    tts_speed: float = 1.0
    tts_voice_instruct: str = "female, moderate pitch, american accent"
    tts_ref_audio: str = ""
    tts_ref_text: str = ""
    # Speech from a VoiceStudio server instead of this PC's GPU (backend/voicestudio.py), e.g.
    # https://<pod-id>-8002.proxy.runpod.net. Empty = OmniVoice here, with the settings above
    tts_url: str = ""
    tts_api_key: str = ""
    # Until the user picks one: a VoiceStudio profile's name or id, or a catalog voice's id; empty = the
    # server's oldest profile. OpenAI names (alloy…) get a new random voice every sentence there
    tts_voice: str = ""

    # Browser agent (Playwright)
    browser_enabled: bool = True
    website_url: str = "https://demo.playwright.dev/todomvc/"
    browser_headless: bool = False  # forced on when there is no display
    browser_profile_dir: str = "browser-profile"  # cookies/logins persist here
    browser_llm_model: str = ""  # empty = same as LLM_MODEL
    browser_llm_think: bool | Literal["low", "medium", "high"] = "low"
    browser_max_steps: int = 25
    browser_screenshots: bool = True  # send a screenshot to the web UI after each step
    skills_dir: str = "skills"

    # Pictures and videos: the ComfyUI manager API on the RunPod pod (runpod/comfyui/API.md in content-generator)
    comfyui_url: str = ""  # https://<pod-id>-8000.proxy.runpod.net; empty = off
    comfyui_api_key: str = ""  # MANAGER_API_KEY from comfyui/pod.env
    comfyui_descriptions: str = "workflows/descriptions.yaml"  # what each workflow is for
    comfyui_timeout_minutes: int = 30  # give up waiting for one generation after this
    media_dir: str = "media"  # generated and attached files, served at /media
    data_dir: str = "data"  # conversations, so they can be reopened (backend/conversations.py); not served

    # Content studio: post drafts for Instagram and X (backend/studio.py)
    content_skills_dir: str = "skills/content"  # how to make each kind of post
    fonts_dir: str = "fonts"  # .ttf/.otf files for text on pictures; a file's name is its font name
    # Music under videos made with make_video (backend/reel.py): FlowAI Sound's composer, e.g.
    # http://sound:8000 next to FlowAI; empty = videos have only the voice
    sound_url: str = ""
    # Songs written for each video (backend/music.py): an ACE-Step 1.5 API, the RunPod pod's (content-generator/
    # runpod/music/, port 8003), or http://music:8000 next to FlowAI; empty = only the composer's moods
    music_url: str = ""
    music_api_key: str = ""  # its ACESTEP_API_KEY, when it has one
    music_timeout_seconds: int = 300  # the first song also loads the model
    # Lip sync for dubbed videos (backend/podjobs.py): the LatentSync API, the RunPod pod's (content-generator/
    # runpod/lipsync/, port 8004), or http://lipsync:8000 next to FlowAI; empty = dubbing is off
    lipsync_url: str = ""
    lipsync_api_key: str = ""  # its LIPSYNC_API_KEY, when it has one
    lipsync_timeout_minutes: int = 30  # the first dub also downloads and loads the model
    # Face swaps (backend/podjobs.py): inswapper_128 and GFPGAN in ONNX, the RunPod pod's (content-generator/
    # runpod/faceswap/, port 8005); empty = face swaps are off
    faceswap_url: str = ""
    faceswap_api_key: str = ""  # its FACESWAP_API_KEY
    faceswap_timeout_minutes: int = 20

    # FlowAI (content-generator/): where drafts are saved as posts and scheduled (backend/flowai.py)
    flowai_url: str = ""  # its API, e.g. http://localhost:8002; empty = off
    # The dashboard: links to posts point here, and FlowAI only accepts cookie sign-ins from it
    flowai_dashboard_url: str = "http://localhost:5173"
    # Until FlowAI issues the assistant a token (FLOWAI_INTEGRATION.md, change 1), it signs in as this user
    flowai_email: str = ""
    flowai_password: str = ""

    # The team's Android phone (backend/phone.py): the hackathon Phone API, whose agent posts drafts from the
    # phone's Instagram and X apps and reads back how they do
    phone_api_url: str = ""  # e.g. https://172.26.0.32/hack/v1; empty = off
    phone_api_key: str = ""  # the team key (hk_...)
    phone_verify_tls: bool = False  # the hackathon server's certificate is self-signed
    # Who drives the phone: "agent", the Phone API's own agent (POST /tasks, on the organisers' model account),
    # with PHONE_MODE and PHONE_POST_MODE; "direct", our own agent (backend/phone_direct.py), which looks at the
    # screen and sends the phone's direct controls itself, with PHONE_VISION_MODEL on our Ollama account; "auto",
    # the Phone API's agent, and ours takes a job over when that one errors or hangs (for PHONE_AGENT_RETRY_MINUTES
    # after it had no model to think with, ours starts the jobs)
    phone_driver: Literal["auto", "direct", "agent"] = "agent"
    phone_agent_retry_minutes: float = 30
    phone_vision_model: str = "kimi-k3"  # needs vision; glm-5.3-flash works too, a little slower
    phone_verify_posts: bool = True  # direct: look once more at the screen a post ended on before calling it up
    phone_action_gap_seconds: float = 5  # direct: at least this long between two taps, keys, swipes or typings
    phone_mode: Literal["flash", "pro"] = "flash"  # the API's agent for feedback and other tasks
    phone_post_mode: Literal["flash", "pro"] = "pro"  # for posting: pro also checks independently that it went up
    phone_max_steps: int = 40  # the team's limit
    phone_skills_dir: str = "skills/phone"  # how to post and check posts in each app
    phone_feedback_after_minutes: float = 60  # check a post's numbers this long after it went up; 0 = only when asked
    # While it posts, the phone asks an OK for plain input it can't check (Enter in a field it can't read): give it,
    # as part of the post the user asked for. Off: the assistant asks the user each time
    phone_auto_approve_posts: bool = True
    # Publish the posts FlowAI schedules from this phone when their time comes (backend/publisher.py): FlowAI's
    # agent API, with FLOWAI_URL, signed with the user's agent token (FlowAI's Phones page; empty = fetched by
    # signing in with FLOWAI_EMAIL and FLOWAI_PASSWORD)
    phone_publish: bool = True
    flowai_agent_token: str = ""
    phone_device_ref: str = ""  # the device ID the phone has in FlowAI; empty = the phone API's own (heracles-phone)
    phone_publish_poll_seconds: float = 15  # how often FlowAI is asked for a post to publish

    # VAD / turn taking
    vad_threshold: float = 0.5
    vad_min_silence_ms: int = 600
    vad_min_speech_ms: int = 250
    vad_preroll_ms: int = 300


settings = Settings()

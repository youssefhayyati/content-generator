import asyncio
import logging
from contextlib import asynccontextmanager

import torch

from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from transformers.audio_utils import load_audio

from .asr import ASREngine, resample
from .browser import Browser
from .comfyui import ComfyClient, ComfyError
from .config import ROOT, settings
from .conversations import ConversationStore
from .llm import LLM
from .music import SongWriter
from .phone import PhoneClient, PhoneError
from .phone_direct import DirectDriver, VisionModel
from .publisher import FlowAIAgentError, Publisher, agent_token
from .session import Models, VoiceSession
from .tts import SAMPLE_RATE as TTS_RATE
from .tts import TTSEngine
from .voicestudio import VoiceStudioTTS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
for name in ("httpx", "httpx2"):  # every model download request otherwise (httpx2: huggingface_hub)
    logging.getLogger(name).setLevel(logging.WARNING)
log = logging.getLogger("voice-agent")

MEDIA_DIR = ROOT / settings.media_dir
MEDIA_DIR.mkdir(parents=True, exist_ok=True)


async def check_phone(phone: PhoneClient):
    try:
        s = await phone.status()
        phone.device = settings.phone_device_ref or s.get("device_id") or ""
        if phone.driver:
            await phone.driver.ready()
        log.info("Phone %s: %s%s", s.get("device_id"), "online" if s.get("online") else "OFFLINE",
                 "" if s.get("ble_linked") else ", input board not linked")
    except PhoneError as exc:
        log.warning("Phone API at %s: %s (phone tools will report errors until it answers)", phone.base_url, exc)


async def start_publisher(app: FastAPI, phone: PhoneClient):
    """Publishing FlowAI's scheduled posts from the phone, once FlowAI and the phone answer."""
    warned = False
    while True:
        try:
            token = settings.flowai_agent_token
            if not token:
                if not (settings.flowai_email and settings.flowai_password):
                    log.info("FlowAI's scheduled posts aren't published from the phone: set FLOWAI_AGENT_TOKEN "
                             "(FlowAI's Phones page) or FLOWAI_EMAIL and FLOWAI_PASSWORD")
                    return
                token = await agent_token(settings.flowai_url, settings.flowai_dashboard_url,
                                          settings.flowai_email, settings.flowai_password)
            ref = settings.phone_device_ref or (await phone.status())["device_id"]
            phone.device = ref
            publisher = Publisher(phone, settings.flowai_url, token, ref, ROOT / settings.data_dir / "phone",
                                  ROOT / settings.phone_skills_dir, settings.phone_publish_poll_seconds,
                                  settings.phone_post_mode, settings.phone_mode, settings.phone_max_steps,
                                  settings.phone_feedback_after_minutes, MEDIA_DIR / "phone")
            publisher.start()
            app.state.publisher = publisher
            return
        except (FlowAIAgentError, PhoneError) as exc:
            if not warned:
                log.warning("Publishing from the phone waits: %s (trying again every 30 s)", exc)
                warned = True
        await asyncio.sleep(30)


async def check_comfy(comfy: ComfyClient):
    try:
        await comfy.refresh()
        log.info("ComfyUI at %s: %s", comfy.base_url,
                 ", ".join(f"{w.name}{'' if w.ready else ' (installing)'}" for w in comfy.workflows.values())
                 or "no workflows")
    except ComfyError as exc:
        log.warning("ComfyUI at %s: %s (generation tools will report errors until it is up)", comfy.base_url, exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.ollama_api_key:
        log.warning("OLLAMA_API_KEY is not set; LLM calls to Ollama cloud will fail")
    log.info("Loading models...")
    asr = ASREngine(settings.asr_model, settings.asr_device, getattr(torch, settings.asr_dtype),
                    settings.asr_language, settings.asr_lookahead)
    ref_text = settings.tts_ref_text
    if settings.tts_ref_audio and not ref_text and not settings.tts_url:
        # Transcribe the voice reference with our ASR instead of OmniVoice's Whisper (saves VRAM)
        ref_text = asr.transcribe(load_audio(settings.tts_ref_audio, sampling_rate=asr.sample_rate))
        log.info("Voice reference transcript: %r", ref_text)
    if settings.tts_url:
        tts = VoiceStudioTTS(settings.tts_url, settings.tts_api_key, settings.tts_voice, settings.tts_speed)
    else:
        tts = TTSEngine(settings.tts_model, settings.tts_device, getattr(torch, settings.tts_dtype),
                        settings.tts_num_step, settings.tts_speed,
                        settings.tts_voice_instruct, settings.tts_ref_audio, ref_text,
                        transcribe=lambda audio: asr.transcribe(resample(audio, TTS_RATE, asr.sample_rate)))
    app.state.models = Models(
        asr=asr,
        tts=tts,
        llm=LLM(settings.ollama_host, settings.ollama_api_key, settings.llm_model, settings.llm_think),
    )
    if settings.browser_enabled:
        browser = Browser(settings.website_url, settings.browser_headless, ROOT / settings.browser_profile_dir)
        try:
            await browser.start()
            app.state.models.browser = browser
            app.state.models.browser_llm = LLM(
                settings.ollama_host, settings.ollama_api_key,
                settings.browser_llm_model or settings.llm_model, settings.browser_llm_think,
            )
        except Exception as exc:
            # Keep the voice agent usable without website tools
            log.error("Browser failed to start, website tools disabled: %s", str(exc).splitlines()[0])
            log.error("If Chromium is missing system libraries, run: sudo .venv/bin/playwright install-deps chromium")
            await browser.close()
    if settings.music_url:
        app.state.models.music = SongWriter(settings.music_url, settings.music_api_key, settings.music_timeout_seconds)
        log.info("Songs for videos: ACE-Step at %s", settings.music_url)
    if settings.comfyui_url:
        comfy = ComfyClient(settings.comfyui_url, settings.comfyui_api_key, ROOT / settings.comfyui_descriptions)
        app.state.models.comfy = comfy
        app.state.comfy_check = asyncio.create_task(check_comfy(comfy))  # don't hold up startup
    else:
        log.info("COMFYUI_URL is not set: picture/video generation is off")
    if settings.phone_api_url:
        phone = PhoneClient(settings.phone_api_url, settings.phone_api_key, settings.phone_verify_tls)
        if settings.phone_driver == "direct":
            phone.driver = DirectDriver(phone, VisionModel(settings.ollama_host, settings.ollama_api_key,
                                                           settings.phone_vision_model), settings.phone_verify_posts)
            log.info("The phone is driven by our own agent (%s) on its direct controls", settings.phone_vision_model)
        app.state.models.phone = phone
        app.state.phone_check = asyncio.create_task(check_phone(phone))
        if settings.phone_publish and settings.flowai_url:
            app.state.publisher_start = asyncio.create_task(start_publisher(app, phone))
    else:
        log.info("PHONE_API_URL is not set: posting from the phone is off")
    app.state.models.conversations = ConversationStore(
        ROOT / settings.data_dir / "conversations", app.state.models.comfy, MEDIA_DIR, ROOT / settings.fonts_dir,
        settings.comfyui_timeout_minutes * 60, app.state.models.phone)
    log.info("Ready")
    yield
    if app.state.models.browser:
        await app.state.models.browser.close()
    if app.state.models.comfy:
        await app.state.models.comfy.close()
    if publisher := getattr(app.state, "publisher", None):
        await publisher.close()
    elif start := getattr(app.state, "publisher_start", None):
        start.cancel()
    if app.state.models.phone:
        await app.state.models.phone.close()


app = FastAPI(title="Voice Agent", lifespan=lifespan)


@app.get("/health")
def health():
    comfy = app.state.models.comfy
    return {"ok": True, "llm": settings.llm_model, "asr_mode": settings.asr_mode,
            "tts": "voicestudio" if settings.tts_url else "local", "flowai": settings.flowai_url or "off",
            "phone": phone_health(),
            "comfyui": "off" if not comfy else (comfy.error or f"ok, {len(comfy.workflows)} workflows")}


def phone_health() -> str:
    if not app.state.models.phone:
        return "off"
    phone = app.state.models.phone
    driver = f"our agent ({settings.phone_vision_model})" if phone.driver else "the Phone API's agent"
    publisher = getattr(app.state, "publisher", None)
    if not publisher:
        return f"on, driven by {driver} (FlowAI's scheduled posts aren't published from it)"
    return f"on, driven by {driver}, publishing FlowAI's scheduled posts as {publisher.device_ref}" + \
        (f" (waiting: {publisher.error})" if publisher.error else "")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    log.info("client connected")
    await VoiceSession(ws, app.state.models).run()
    log.info("client disconnected")


app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
app.mount("/fonts", StaticFiles(directory=ROOT / settings.fonts_dir), name="fonts")  # the page uses them too
app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")

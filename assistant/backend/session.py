"""One WebSocket conversation: mic audio -> VAD -> ASR -> LLM (+tools) -> TTS -> speaker.

Wire protocol
  client -> server
    binary: PCM16 little-endian mono 16 kHz mic audio
    json:   {"type": "text", "text": "..."}   typed user message
            {"type": "interrupt"}              stop the assistant
            {"type": "cancel_task"}            stop the running browser task
            {"type": "cancel_phone"}           stop what the team's phone is doing
            {"type": "upload", "name": "...", "data": "data:image/png;base64,..."}
                                               attach an image/video/audio file
            {"type": "upload", "name": "x.json", "workflow": {...}}
                                               attach a ComfyUI workflow file
            {"type": "reset"}                  start a new conversation (the old one is kept)
            {"type": "hello", "timezone": "Europe/Paris", "token": "...", "conversation": "...", "speech": true}
                                               the user's time zone, for scheduling; token (optional):
                                               the page's FlowAI sign-in (POST /api/assistant/session),
                                               so the assistant acts as that user; conversation
                                               (optional): the one to pick up again; speech (optional):
                                               as {"type": "speech"}
            {"type": "speech", "on": false}    replies as text only, not spoken (true: spoken again);
                                               samples of voices still play
            {"type": "conversations"}          the list of the user's conversations
            {"type": "new", "campaign": 3}     a new conversation; with campaign, that FlowAI campaign's
                                               posts in it as drafts
            {"type": "open" | "delete", "id": "..."}
            {"type": "rename", "id": "...", "title": "..."}
            {"type": "focus", "draft": 1, "slide": 1, "text": 2}
                                               what the user selected on screen ("this", "it");
                                               {"type": "focus"} clears it
            {"type": "mask", "draft": 1, "slide": 1, "data": "data:image/png;base64,..."}
                                               the area the user painted over on a slide (painted
                                               pixels opaque); without data, none
            {"type": "action", "name": ..., ...}
                                               a button on the page, done without the LLM:
              undo, save {"draft": 1}
              checkout {"draft": 1, "version": 3}   back to an earlier version (changing it branches)
              open_post {"post": 12}
              edit {"draft": 1, "title" | "caption" | "placement": "..."}
              edit_text {"draft": 1, "text": 2, "words": "...", "position", "size", "color", ...}
              add_text {"draft": 1, "slide": 1, "words": "...", "position", ...}
              remove_text {"draft": 1, "text": 2}
              arrange {"draft": 1, "order": [2, 1]}     slides reordered or dropped
              place {"draft": 1, "media": 4, "slide": 2}
                                               a picture on a slide (no slide: a new last one)
              new_draft {"platform": "instagram", "placement": "feed"}
              use_assets {"assets": [7, 8], "draft": 1}
                                               FlowAI gallery files into the conversation (and the draft)
              schedule {"draft": 1, "when": "2026-10-16T09:00:00Z"}
                                               asks for approval, like schedule_post
              open_campaign {"campaign": 3}    a FlowAI campaign's posts into this conversation
              edit_area {"draft": 1, "slide": 1, "mode": "remove", "prompt": "..."}
                                               change only the painted area (mode: change, remove,
                                               replace, improve)
              make_video {"draft": 1, "lines": [...], "cta", "cta_line", "music", "captions",
                          "motion", "placement", "voice"}
                                               the draft's pictures as a video read in a voice: voice is
                                               a voice's id (a ready one's or the catalog's), a
                                               description of one, or "mine" for the assistant's;
                                               left out, the last video's, or one that suits the post;
                                               music is a mood, "none", or a description of a song for
                                               the music model ("song": a new one written for the post)
            {"type": "approve" | "decline", "id": 3, "conversation": "..."}
                                               the user's answer to an approval (scheduling, a campaign
                                               version); with "done": true the page did it itself
            {"type": "voices", "q": "british", "lang": "English"}
                                               the voices to pick from (and catalog voices matching q)
            {"type": "voice", "id": "..."} | {"type": "voice", "archetype": "..."}
                                               speak in this voice from now on (a catalog voice is set
                                               up first); kept for the user
            {"type": "preview_voice", "id" | "archetype": "..."}
                                               play how a voice sounds (it stops what is being said)
            {"type": "video_voices", "draft": 1, "q": "calm deep male", "lang": "", "lines": [...]}
                                               the voices that fit a draft's video best: the ones matching
                                               q, or without q one suited to the post (and lines)
  server -> client
    binary: 4-byte little-endian turn id + PCM16 mono 24 kHz assistant speech
    json:   ready | vad | transcript | assistant_delta | assistant_done |
            tool_call | tool_result | interrupt | error |
            browser_task (started/done/failed/cancelled) | browser_step |
            phone_task (a job on the team's phone, kind post/feedback/task: started/awaiting approval/done/
                        failed/cancelled) | phone_step (one thing it did, with its screenshot) |
            phone_post (a draft posted from the phone: status, when, and its latest feedback numbers) |
            media_job (generate/install: started/running/done/failed/cancelled) |
            media (a generated or attached file, served at media/..., next to the page) |
            draft (a post draft's new version: its slides as files, where its texts are and how
                   readable, its pictures' colours, caption, platform check, and for a video draft
                   how it was made; quiet: true when it isn't one to bring on screen) |
            flowai (the signed-in user and their accounts) | posts (the latest FlowAI posts) |
            saved (a draft's FlowAI post: id, saved version, status, link) |
            linked (a draft that is a FlowAI campaign's post: campaign, item, version, status, times) |
            approval (something the user must approve on screen, and its outcome) |
            conversation (the conversation now on screen, whole: history, media, running jobs,
                          drafts, saved, linked, approvals; the page starts over from it) |
            about (its name or campaign changed) |
            conversations (the user's conversations, newest first, and which one is on screen) |
            voice (the voice it speaks in: id, name, description, language) |
            voices (the ones ready to use, catalog voices matching the search, and the current one) |
            video_voices (for a draft's video: the description they fit, the voices, best first, each
                          with catalog true or false, and the assistant's own voice) |
            fonts (after ready: the fonts texts can use, by style, each with its file under fonts/)

Conversations are kept (backend/conversations.py): this connection shows one at a time, and a
conversation outlives the connection, so a reconnect picks it up again.
"""

import asyncio
import json
import logging
import struct
import time
from dataclasses import dataclass, field
from datetime import datetime

import httpx
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from . import reel, tools
from .asr import ASREngine, StreamingTranscription
from .browser import Browser
from .browser_agent import BrowserAgent
from .comfyui import ComfyClient, ComfyError
from .config import ROOT, settings
from .conversations import Conversation, ConversationStore
from .flowai import FlowAIClient, FlowAISession
from .llm import LLM
from .media import MediaSession
from .music import SongWriter
from .phone import PhoneClient, PhoneSession
from .skills import catalogue, load_skills
from .studio import LOOK, StudioError, StudioSession, fonts_event, fonts_prompt
from .tts import SAMPLE_RATE as TTS_RATE
from .tts import SentenceChunker, TTSEngine
from .vad import TurnDetector

log = logging.getLogger(__name__)

SKILLS_INLINE_CHARS = 8000  # content skills up to this size go in the prompt instead of load_skill
MY_VOICE = {"mine", "yours", "your", "assistant", "you", "same", "current", "default", "own"}
CASTING = (
    "You cast the voice that reads a short social media video, and the music under it. Reply with JSON only, "
    'no other words: {"voice": "...", "language": "...", "music": "..."}. voice: 5 to 12 words in English, in this order: gender (male or '
    "female), age (child, teenager, young adult, middle-aged or elderly), pitch (low, moderate or high), an "
    "accent only if the post calls for one (american, british, australian...), then how it is said (warm, "
    "energetic, calm, luxurious, playful, confident...) and what for (advertisement, social or narration). "
    "Pick what suits the brand, the product and who it speaks to. language: the language the words are in, "
    "in English (English, French, Spanish...). music: the instrumental track under the voice, for a music model, "
    "10 to 25 words in English: the genre, two or three instruments, the mood and energy, and a tempo in bpm, e.g. "
    "'upbeat acoustic pop, bright ukulele, hand claps and shaker, feel-good and catchy, 112 bpm' or 'dark "
    "cinematic trap, deep 808 bass, sharp hi-hats, confident and hard-hitting, 140 bpm'. Make it catchy and "
    "right for the brand and its audience; no vocals, no song or artist names.")


@dataclass
class Models:
    asr: ASREngine
    tts: TTSEngine
    llm: LLM
    browser: Browser | None = None
    browser_llm: LLM | None = None
    comfy: ComfyClient | None = None
    music: SongWriter | None = None  # songs written for videos (ACE-Step), when MUSIC_URL is set
    phone: PhoneClient | None = None  # the team's phone, posting drafts from its apps, when PHONE_API_URL is set
    conversations: ConversationStore | None = None  # set once comfy is


@dataclass
class BrowserJob:
    id: int
    instruction: str
    task: asyncio.Task | None = None
    steps: list[str] = field(default_factory=list)
    started: float = field(default_factory=time.monotonic)
    result: str | None = None


class VoiceSession:
    def __init__(self, ws: WebSocket, models: Models):
        self.ws = ws
        self.m = models
        self.loop = asyncio.get_running_loop()
        self.vad = TurnDetector(settings.vad_threshold, settings.vad_min_silence_ms,
                                settings.vad_min_speech_ms, settings.vad_preroll_ms)
        self.store = models.conversations
        # Kept once FlowAI says whose it is; without FlowAI, they're all this machine's
        self.conv = self.store.new(None if settings.flowai_url else "local")
        self.conv.sessions.add(self)
        self.voice: dict = models.tts.default  # every sentence in this voice (load_voice)
        self.speech = True  # replies spoken; off: text only (the page's speech switch)
        self.flowai = self.new_flowai()
        self.flowai_loading: asyncio.Task | None = None
        self.switching = asyncio.Lock()  # one conversation change at a time
        self.skills_inline = False  # set by system_prompt()
        self.send_lock = asyncio.Lock()
        self.turn = 0
        self.response: asyncio.Task | None = None
        self.speaking_until = 0.0  # estimated end of client-side playback
        self.stream: StreamingTranscription | None = None
        self.utterance: list[np.ndarray] = []
        self.background: set[asyncio.Task] = set()
        self.actions: set[asyncio.Task] = set()  # buttons on the page being done; a switch waits for them
        self.user_speaking = False
        self.job: BrowserJob | None = None
        self.job_count = 0
        self.castings: dict[str, dict] = {}  # a post's content -> the voice described for it (cast)

    # The conversation on screen: its numbered pictures and files (generating them needs the ComfyUI
    # pod, self.m.comfy) and its drafts. Tools reach them as session.media and session.studio.
    @property
    def media(self) -> MediaSession:
        return self.conv.media

    @property
    def studio(self) -> StudioSession:
        return self.conv.studio

    @property
    def phone(self) -> PhoneSession:
        return self.conv.phone

    @property
    def owner(self) -> str | None:
        """Whose conversations this connection lists and keeps; None while FlowAI hasn't said."""
        return self.flowai.owner if self.flowai else "local"

    def new_flowai(self) -> FlowAISession | None:
        if not settings.flowai_url:
            return None
        client = FlowAIClient(settings.flowai_url, settings.flowai_dashboard_url,
                              settings.flowai_email, settings.flowai_password)
        return FlowAISession(client, self.conv, self.try_send)

    def remember(self, text: str):
        self.add_note(text, announce=False)

    def spawn(self, coro, group: set[asyncio.Task] | None = None) -> asyncio.Task:
        """Work off the receive loop, so mic audio keeps flowing meanwhile."""
        group = self.background if group is None else group
        task = asyncio.create_task(coro)
        group.add(task)
        task.add_done_callback(group.discard)
        return task

    def system_prompt(self) -> str:
        prompt = settings.system_prompt
        if self.m.browser:
            prompt += (
                f"\n\nYou can operate the website {settings.website_url} in a web browser by calling "
                "browser_task with a complete instruction. The task runs in the background: after starting "
                "it, say one short sentence such as 'On it', and never say it is done until you are given "
                "its result. If the user asks how it is going, use browser_task_status; if they want to "
                "stop it, use cancel_browser_task. The browser agent has these skills:\n"
                + catalogue(load_skills(ROOT / settings.skills_dir))
            )
        if self.m.comfy:
            prompt += (
                "\n\nYou can make pictures and videos with ComfyUI workflows by calling generate_media. It runs "
                "in the background: say one short sentence such as 'Sure, making it now', and never say it is "
                "ready until you are told. When it is, it is already on the user's screen, so just say so "
                "briefly. Pictures take seconds; videos take several minutes, so tell the user. Write the prompt "
                "in English as a rich visual description (subject, setting, style, lighting, camera, and motion "
                "for videos), expanding on what the user asked for. Every picture, video and attached file has a "
                "number the user can refer to; to change or animate a picture, use a workflow that needs an image "
                "and pass its number (the latest one is used by default). Use list_media_workflows when asked "
                "which workflows exist, media_status for progress, and cancel_media to stop one. To add a "
                "workflow, find it with search_workflow_templates (or use a workflow file the user attached, or "
                "a URL they give), confirm the choice with the user, then call add_media_workflow. "
                "Workflows on the pod:\n" + self.m.comfy.catalogue()
            )
        skills = load_skills(ROOT / settings.content_skills_dir)
        # Small playbooks go in the prompt: that saves a load_skill round (about two seconds) per new
        # kind of post, and prompt length barely changes response time. A big library is loaded on demand.
        self.skills_inline = sum(len(k.instructions) for k in skills.values()) <= SKILLS_INLINE_CHARS
        prompt += (
            "\n\nYou are also the content studio of a social media agency: you make posts for Instagram and X "
            "as drafts the user sees on screen, and change them when asked. A draft has a number, a caption, and "
            "slides (one picture or video each) with texts drawn on top. The user sees one draft at a time; a "
            "tool without a draft number changes that one, the draft on screen. An edit always changes the draft "
            "it is about, in place: never make a new draft (create_draft, from_draft) to change one. Every change "
            "is a new version of it, kept in its history. Make a new draft only when the user asks for a new or "
            "another post. Make a new post with one create_draft "
            "call that has everything: title, caption, texts"
            + (", and pictures (one prompt per slide: each is made in the draft's shape and goes in by itself "
               "when ready, so don't wait or check on it; you'll be told). To change what is in a slide's "
               "picture, call generate_media with draft and slide and an editing workflow; its prompt says only "
               "what to change, e.g. 'Remove the plant in the background, keep everything else the same'. The "
               "user can also paint over part of a slide's picture on screen (you're told when they do): then "
               "call edit_area to remove, replace, change or improve only that part, and the rest of the picture "
               "stays exactly as it is"
               if self.m.comfy else
               ". Pictures come from files the user attaches"
               + (" or from the FlowAI gallery (use_assets)" if self.flowai else "")
               + ", since making new ones is off")
            + ". Words on a picture or video always go through texts or add_text, never through the image model; "
            "on a video they show the whole time. Change the caption with update_draft and texts with edit_text or "
            "remove_text. To go back, use undo_draft (one step) or draft_versions to see every version and go to "
            "one; changing an earlier version starts a branch from it, and the others stay. "
            "Fonts, by style: pick ones that fit the brand and the post's mood (an elegant serif for luxury, "
            "handwriting for something personal, a condensed poster font for a sale), at most two per post, "
            "e.g. a display headline with a plain modern line under it:\n" + fonts_prompt(ROOT / settings.fonts_dir)
            + "\n"
            "A text the platform check calls hard to read needs a panel (style box) or a colour that stands out "
            "from its picture; each slide lists its picture's colours, which make texts look part of the post. "
            "make_video turns a draft, with one picture or several, into a short video: a voice reads a line "
            "per picture while the pictures slowly zoom and pan, with captions, music and an end card with a "
            "call to action ('Order now'). Write the lines like a short spoken ad: a hook, one idea per picture, "
            "then the call to action in cta_line. The video has a voice of its own, not the one you speak in: "
            "describe in voice the one that suits the post and its audience (gender, age, pitch, accent, how it "
            "is said), or pass the voice the user asked for; find_voices lists the ones that fit a description. "
            "Say which voice it is, so the user can ask for another. It is made in the background and takes the "
            "place of the draft's pictures in that same draft (they stay in its history); asking again, other "
            "words, music, button or voice, makes the video again in the same draft. Texts can then be added on "
            "the video itself with add_text. "
            + ("Its music is a song written for it: leave music out and the first video gets one that suits the "
               "post. To change it, describe the music in music (genre, instruments, mood and energy, tempo in "
               "bpm, no vocals), or pass 'song' for a new one written for the post; a mood of the composer's only "
               "when the user asks for one. "
               if self.m.music else "")
            + "Make independent changes together in one step. Change only what the user named (the headline is one "
            "text) and keep everything else. Never leave a placeholder such as [date] or [link] in a caption or "
            "text: write the real words (\"this Friday\") or ask. The user sees every new version, so say in a few "
            "words what changed instead of reading captions aloud, and mention any problem the platform check "
            "reports. "
            + ("How to make each kind of post:\n\n" + "\n\n".join(f"### {k.name}: {k.description}\n{k.instructions}"
                                                               for k in skills.values())
               if self.skills_inline else
               "Before making a kind of post, call load_skill for it and follow it. Content skills:\n"
               + catalogue(skills))
        )
        if self.flowai:
            prompt += self.flowai.prompt()
        if self.m.phone:
            minutes = settings.phone_feedback_after_minutes
            prompt += (
                "\n\nYou can publish drafts for real from the team's Android phone, which has the Instagram and X "
                "apps: post_on_phone puts the draft's pictures or video on the phone and has the phone's own agent "
                "post it with its caption. Publishing is public and can't be undone, so call it only when the user "
                "has just said to post that draft now; if they only said they like it, ask first. It takes a few "
                "minutes in the background: say one short sentence, and never say it's posted until you are told. "
                "The phone can only type plain letters, so emoji and special symbols are left out of the caption: "
                "when the reply says what was left out, tell the user in a few words. post_feedback reads how a "
                "post is doing (likes, comments, shares, saves, views, the latest comments) and what changed since "
                "the last check"
                + (f"; a check also runs by itself {minutes:g} minutes after posting" if minutes > 0 else "")
                + ". Sum it up in a sentence or two and, when the comments suggest one, give an idea for the next "
                "post. "
                + ("Posts scheduled in FlowAI (schedule_post, once approved) are published from this same phone by "
                   "themselves when their time comes, and checked the same way: phone_status lists the latest, and "
                   "post_feedback with flowai_post checks one. So to post later, schedule it; to post now, "
                   "post_on_phone. " if self.m.phone.publisher else "")
                + "phone_task does anything else on the phone (it can follow a phone skill), phone_status says "
                "what it's doing, answer_phone passes on the user's answer when the phone asks something or waits "
                "for their OK, and cancel_phone_task stops it. If the phone says an app isn't installed or logged "
                "in, tell the user: they log in on the phone themselves. Phone skills:\n"
                + catalogue(self.phone.skills())
            )
        # The date, not the time, so the prompt stays the same all day (the time is a tool call away)
        today = datetime.now(self.flowai.tz if self.flowai else None)
        prompt += f"\n\nToday is {today:%A} {today.day} {today:%B %Y}."
        if not self.speech:
            prompt += ("\n\nSpeech is off right now: the user reads your replies on screen instead of hearing "
                       "them, so a reply can be a little longer when that helps (a few options, exact names "
                       "and numbers), still in plain text.")
        return prompt

    # --- sending ------------------------------------------------------------------

    async def send(self, **msg):
        async with self.send_lock:
            await self.ws.send_text(json.dumps(msg))

    async def try_send(self, **msg):
        """For background work that may outlive the connection."""
        try:
            await self.send(**msg)
        except Exception:
            pass

    async def send_audio(self, turn: int, audio: np.ndarray):
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
        async with self.send_lock:
            await self.ws.send_bytes(struct.pack("<I", turn) + pcm)

    def send_threadsafe(self, **msg):
        asyncio.run_coroutine_threadsafe(self.send(**msg), self.loop)

    # --- main loop ----------------------------------------------------------------

    def load_flowai(self):
        """Reads the user and their accounts once: on the page's hello, which may carry its sign-in,
        or on the first turn for a page that doesn't say hello."""
        if self.flowai and not self.flowai_loading:
            self.flowai_loading = asyncio.create_task(self.flowai.load())

    async def run(self):
        await self.send(type="ready", tts_sample_rate=TTS_RATE, asr_mode=settings.asr_mode, songs=self.m.music is not None)
        await self.send(**fonts_event(ROOT / settings.fonts_dir))
        try:
            while True:
                msg = await self.ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg.get("bytes"):
                    await self.on_audio(msg["bytes"])
                elif msg.get("text"):
                    await self.on_message(json.loads(msg["text"]))
        except WebSocketDisconnect:
            pass
        finally:
            await self.interrupt(notify=False)
            await self.cancel_browser_task()
            await self.leave(self.conv)
            if self.flowai:
                await self.flowai.client.close()
            if self.stream:
                await asyncio.to_thread(self.stream.finish)

    async def on_message(self, msg: dict):
        match msg.get("type"):
            case "text" if msg.get("text", "").strip():
                text = msg["text"].strip()
                await self.send(type="transcript", text=text, final=True)
                await self.start_response(text)
            case "interrupt":
                await self.interrupt()
            case "cancel_task":
                await self.cancel_browser_task()
            case "cancel_phone":
                self.spawn(self.phone.cancel())
            case "upload":
                await self.on_upload(msg)
            case "hello":
                if "speech" in msg:
                    self.speech = msg["speech"] is not False
                if self.flowai:
                    self.flowai.set_timezone(msg.get("timezone", ""))
                    if msg.get("token") and not self.flowai_loading:
                        await self.flowai.use_token(str(msg["token"]))
                    self.load_flowai()
                self.spawn(self.on_conversation({"type": "hello", "id": msg.get("conversation")}))
                self.spawn(self.load_voice())
            case "focus":
                self.conv.focus = {k: msg[k] for k in ("draft", "slide", "text") if msg.get(k) not in (None, "")}
                if self.conv.focus.get("draft") in self.studio.drafts:  # the page shows it: changes go to it
                    self.studio.shown = self.conv.focus["draft"]
            case "mask":
                if problem := self.studio.set_mask(msg.get("draft"), msg.get("slide"), msg.get("data")):
                    await self.send(type="error", message=problem[:1].upper() + problem[1:] + ".")
            case "action" | "approve" | "decline":
                # Uploads to FlowAI take a moment: keep reading mic audio meanwhile
                self.spawn(self.on_action(msg), self.actions)
            case "conversations":
                self.spawn(self.send_conversations())
            case "new" | "open" | "rename" | "delete":
                self.spawn(self.on_conversation(msg))
            case "reset":
                self.spawn(self.on_conversation({"type": "new"}))
            case "voices":
                self.spawn(self.send_voices(str(msg.get("q") or ""), str(msg.get("lang") or "")))
            case "voice":
                self.spawn(self.set_voice(msg))
            case "preview_voice":
                self.spawn(self.preview_voice(msg))
            case "speech":
                self.speech = msg.get("on") is not False
                log.info("speech %s", "on" if self.speech else "off")
                if not self.speech:
                    self.speaking_until = 0.0  # the page stopped playing what was left
            case "video_voices":
                self.spawn(self.send_video_voices(msg))

    async def on_upload(self, msg: dict):
        try:
            await self.media.upload(msg.get("name", ""), msg.get("data"), msg.get("workflow"))
        except ComfyError as exc:
            await self.send(type="error", message=f"Upload failed: {exc}")

    async def on_action(self, msg: dict):
        """A button on the page: done directly, then the LLM is told so the conversation stays in step."""
        kind, name = msg["type"], msg.get("name")
        if msg.get("conversation") not in (None, "", self.conv.id):
            return  # pressed in a conversation that's no longer on screen
        if kind in ("approve", "decline"):
            if self.flowai:
                await self.flowai.decide(msg.get("id"), approve=kind == "approve", done=bool(msg.get("done")))
            return
        self.load_flowai()
        draft, style = msg.get("draft"), {k: msg[k] for k in LOOK if msg.get(k) not in (None, "")}
        if name == "undo":
            result = await self.studio.undo(draft)
            done = f"pressed Undo on draft {result.get('draft')}: it is now as it was before its last change " \
                   f"(version {result.get('version')})"
        elif name == "checkout":
            result = await self.studio.checkout(draft, msg.get("version"))
            done = f"went back to version {result.get('version')} of draft {result.get('draft')} in its history; " \
                   "changing it now starts a new branch from there, and the later versions stay to go back to"
        elif name == "save" and self.flowai:
            result = await self.flowai.save(draft)
            done = f"pressed Save: {result.get('saved')}"
        elif name == "open_post" and self.flowai:
            result = await self.flowai.open_post(msg.get("post"))
            done = f"opened a FlowAI post: {result.get('opened')}"
        elif name == "edit":
            fields = {k: msg[k] for k in ("title", "caption", "placement") if k in msg}
            result = await self.studio.update(draft, **fields)
            done = f"changed the {' and '.join(fields)} of draft {result.get('draft')} by hand"
        elif name == "edit_text":
            result = await self.studio.edit_text(draft, msg.get("text"), msg.get("words"), msg.get("slide"), **style)
            done = f"changed text {msg.get('text')} of draft {result.get('draft')} by hand" + \
                   (f" (its words are now “{msg['words']}”)" if msg.get("words") else "")
        elif name == "add_text":
            result = await self.studio.add_text(draft, msg.get("words", ""), msg.get("slide"), **style)
            done = f"added the text “{msg.get('words')}” to slide {msg.get('slide') or 1} of draft {result.get('draft')}"
        elif name == "remove_text":
            result = await self.studio.remove_text(draft, msg.get("text"))
            done = f"removed text {msg.get('text')} from draft {result.get('draft')}"
        elif name == "arrange":
            result = await self.studio.arrange(draft, msg.get("order"))
            done = f"rearranged the slides of draft {result.get('draft')}: the old slides " \
                   f"{', '.join(map(str, msg.get('order') or []))}, in that order"
        elif name == "place":
            result = await self.studio.place(draft, msg.get("media"), msg.get("slide"))
            done = f"put picture {msg.get('media')} on " + (f"slide {msg['slide']}" if msg.get("slide") else
                                                            "a new last slide") + f" of draft {result.get('draft')}"
        elif name == "new_draft":
            result = await self.studio.create(msg.get("platform") or "instagram", msg.get("placement"))
            done = f"started an empty {result.get('post')} as draft {result.get('draft')}"
        elif name == "use_assets" and self.flowai:
            result = await self.flowai.use_assets(msg.get("assets"))
            done = f"brought files from the FlowAI gallery into this conversation: {'; '.join(result.get('added', []))}"
            if draft not in (None, "") and "error" not in result:  # and onto the draft, as new last slides
                for number in result["numbers"]:
                    placed = await self.studio.place(draft, number)
                    if "error" in placed:
                        result = placed
                        break
                done += f", then added them to draft {draft} as new slides"
        elif name == "schedule" and self.flowai:
            result = await self.flowai.schedule(draft, msg.get("when"))
            done = f"asked to schedule a draft from the calendar: {result.get('asks')}"
        elif name == "edit_area":
            result = await self.studio.edit_area(draft, msg.get("slide"), msg.get("mode") or "change",
                                                 msg.get("prompt") or "")
            done = f"painted over an area of slide {result.get('slide')} of draft {result.get('draft')} " \
                   f"({result.get('area')}) and asked to {msg.get('mode') or 'change'} it" + \
                   (f": “{msg['prompt']}”" if msg.get("prompt") else "") + \
                   "; it is being edited and goes on the slide by itself"
        elif name == "make_video":
            result = await self.make_video(draft, **{k: msg[k] for k in ("lines", "cta", "cta_line", "music", "captions",
                                                                      "motion", "placement", "color", "voice") if k in msg})
            done = f"asked for a video of draft {result.get('source')} with these lines: " \
                   f"{json.dumps(msg.get('lines'), ensure_ascii=False)}, read by {result.get('voice')}; it is " \
                   f"being made into {result.get('into')}"
        elif name == "open_campaign" and self.flowai:
            if self.flowai_loading:
                await self.flowai_loading  # its accounts say which platform each post is for
            result = await self.flowai.open_campaign(msg.get("campaign"))
            opened = result.get("opened")
            done = f"opened the FlowAI campaign {result.get('campaign')} here: " + \
                   ("; ".join(opened) if isinstance(opened, list) else "no new drafts") + \
                   (f" (already open: {result['already_open']})" if result.get("already_open") else "") + \
                   (f". Some couldn't be opened: {'; '.join(result['failed'])}" if result.get("failed") else "")
        else:
            return
        if "error" in result:
            await self.send(type="error", message=result["error"][:1].upper() + result["error"][1:])
            return
        self.remember(f"On screen, the user {done}.")

    # --- conversations --------------------------------------------------------------

    async def on_conversation(self, msg: dict):
        """hello (once FlowAI said who the user is), new, open, rename or delete; then the list again."""
        async with self.switching:
            if self.flowai_loading:
                await self.flowai_loading  # whose conversations these are (it never raises)
            kind, owner, cid = msg["type"], self.owner, str(msg.get("id") or "")
            if owner:
                self.store.adopt(self.conv, owner)
            if kind == "hello":
                found = await self.store.open(owner, cid) if owner and cid and cid != self.conv.id else None
                if found and self.conv.empty:
                    await self.switch(found)
                else:
                    await self.send_conversation()
            elif kind == "new":
                await self.switch(self.store.new(owner))
                if msg.get("campaign") not in (None, ""):
                    await self.on_action({"type": "action", "name": "open_campaign", "campaign": msg["campaign"]})
            elif kind == "open":
                found = await self.store.open(owner, cid) if owner else None
                if not found:
                    await self.try_send(type="error", message="That conversation can't be found; it may have been "
                                                              "deleted.")
                elif found is not self.conv:
                    await self.switch(found)
            elif kind == "rename" and owner:
                await self.store.rename(owner, cid, str(msg.get("title") or ""))
            elif kind == "delete" and owner:
                if cid == self.conv.id:
                    await self.switch(self.store.new(owner))
                await self.store.delete(owner, cid)
            await self.send_conversations()

    async def switch(self, conv: Conversation):
        """Shows another conversation. What is being said stops; what is being made carries on in its own."""
        await self.interrupt()
        if self.actions:
            await asyncio.wait(set(self.actions))  # a save in flight finishes in the conversation it began in
        old, self.conv = self.conv, conv
        old.studio.set_mask()  # the page stops painting when it shows another conversation
        conv.sessions.add(self)
        conv.focus, conv.focus_told = {}, {}  # the page starts with nothing selected
        conv.announce = False  # what happened meanwhile is on screen: no need to say it right away
        if self.flowai:
            self.flowai.attach(conv)
        await self.leave(old)
        await self.send_conversation()

    async def leave(self, conv: Conversation):
        """This connection no longer shows it. A kept one is saved, and its generations go on (their
        pictures land in its drafts); others stop theirs, since nobody would see them."""
        conv.sessions.discard(self)
        if conv.owner:
            await conv.flush()
            self.store.release(conv)
        elif not conv.sessions:
            await conv.media.close()

    async def send_conversation(self):
        """The conversation on screen, whole: the page starts over from it."""
        c = self.conv
        await self.try_send(
            **{**c.about(), "type": "conversation"},
            history=c.history(), media=[i.event() for i in c.media.items.values() if i.kind in ("image", "video")],
            jobs=c.media.running(), drafts=c.studio.events(), **(self.flowai.snapshot() if self.flowai else {}))

    async def send_conversations(self):
        owner = self.owner
        items = await self.store.list(owner) if owner else []
        await self.try_send(type="conversations", items=items, current=self.conv.id, kept=bool(owner))

    # --- voice ----------------------------------------------------------------------
    # Every sentence is spoken in one voice: the user's pick, kept with their conversations
    # (prefs.json), so it's the same in all of them and after a reload; until they pick, TTS_VOICE.

    async def load_voice(self):
        if self.flowai_loading:
            await self.flowai_loading  # whose pick to read (it never raises)
        saved = (await self.store.prefs(self.owner)).get("voice") if self.owner else None
        if saved:
            try:
                self.voice = await asyncio.to_thread(self.find_voice, saved)
            except Exception as exc:
                log.warning("voice %s couldn't be checked: %s", saved.get("id"), exc)
                self.voice = saved  # the voice server is down: nothing is spoken anyway
        await self.try_send(type="voice", **self.voice)

    def find_voice(self, saved: dict) -> dict:
        """The saved pick if the server still has it; made again if it came from the catalog (a new
        pod starts with only its demo voice), the same voice as before; else the default."""
        tts = self.m.tts
        for v in tts.profiles():
            if v["id"] == saved.get("id"):
                return v
        return tts.adopt(saved["archetype"]) if saved.get("archetype") else tts.default

    async def set_voice(self, msg: dict):
        tts = self.m.tts
        try:
            if msg.get("archetype"):
                voice = await asyncio.to_thread(tts.adopt, str(msg["archetype"]))
            else:
                voice = next((v for v in await asyncio.to_thread(tts.profiles) if v["id"] == msg.get("id")), None)
        except Exception as exc:
            log.warning("voice %s couldn't be set up: %s", msg.get("archetype") or msg.get("id"), exc)
            voice = None
        if not voice:
            await self.try_send(type="error", message="That voice couldn't be set up. Try another one.")
            return await self.try_send(type="voice", **self.voice)
        self.voice = voice
        log.info("voice: %s (%s)", voice["name"], voice["id"])
        if self.owner:
            await self.store.set_prefs(self.owner, voice=voice)
        await self.try_send(type="voice", **voice)

    async def send_voices(self, q: str, lang: str):
        tts = self.m.tts
        try:
            ready = await asyncio.to_thread(tts.profiles)
            # A catalog voice already set up is among the ready ones
            catalog, total, languages = await asyncio.to_thread(
                tts.catalog, q, lang, {v["archetype"] for v in ready if v["archetype"]})
        except Exception as exc:
            log.warning("voices couldn't be listed: %s", exc)
            return await self.try_send(type="error", message="The voice server didn't answer. Try again in a moment.")
        await self.try_send(type="voices", q=q, lang=lang, current=self.voice["id"], choosable=tts.choosable,
                            ready=ready, catalog=catalog, total=total, languages=languages)

    async def preview_voice(self, msg: dict):
        """How a voice sounds, played like speech: it cuts off whatever was being said."""
        try:
            audio = await asyncio.to_thread(self.m.tts.sample, msg.get("id") or None, msg.get("archetype") or None)
        except Exception as exc:
            log.warning("voice %s couldn't be played: %s", msg.get("archetype") or msg.get("id"), exc)
            return await self.try_send(type="error", message="That voice can't be played right now.")
        await self.interrupt()
        await self.send_audio(self.turn, audio)
        self.speaking_until = time.monotonic() + len(audio) / TTS_RATE

    # --- a video's voice -------------------------------------------------------------
    # A video is read in a voice of its own, kept in its recipe: the one asked for, else the one its
    # last version had, else one cast for the post (the LLM describes the voice that suits it, and
    # the voice that fits that description best is used). The assistant keeps speaking in self.voice.

    async def make_video(self, draft=None, voice=None, **asked) -> dict:
        """make_video in the video's voice, over a song written for it (ACE-Step) or FlowAI Sound's
        composer, whichever is there."""
        songs, song = self.m.music, ""
        try:
            source, target = self.studio.video_drafts(draft)
            made = self.studio.recipe_of(target)
            before = made.get("voice")
            # A song suited to the post: for the first video, or when a new one is asked for
            if songs and (str(asked.get("music") or "").strip().lower() == "song"
                          or (asked.get("music") is None and not made)):
                song = (await self.cast(source, asked.get("lines")))["music"]
            if voice not in (None, ""):
                chosen = await self.video_voice(str(voice))
            elif before:
                chosen = await asyncio.to_thread(self.find_voice, before)
            else:
                chosen = await self.cast_voice(source, asked.get("lines"))
        except StudioError as exc:
            return {"error": str(exc)}
        except Exception as exc:  # the voice server: the video is still made, in the assistant's voice
            log.warning("no voice of its own for the video: %s", exc)
            chosen = self.voice
        tts, speaker = self.m.tts, chosen["id"]

        def compose(recipe: dict, seconds: float) -> bytes | None:  # in the render's thread
            mood = recipe["music"]
            if mood == "song":
                if songs:
                    try:
                        return songs.song(recipe["song"], seconds, recipe.get("seed"))
                    except Exception as exc:
                        log.warning("no song for the video, the composer's music instead: %s", exc)
                mood = "golden-hour"
            if not settings.sound_url:
                return None
            try:
                r = httpx.post(f"{settings.sound_url.rstrip('/')}/v1/music", timeout=120,
                               json={"mood": mood, "seconds": round(min(max(seconds, 5), 180), 1)})
                r.raise_for_status()
                return reel.music_wav(r.json()["audio"])
            except Exception as exc:
                log.warning("no music for the video: %s", exc)
                return None

        return await self.studio.make_video(draft, **asked, voice=chosen,
                                            speak=lambda text: tts.synthesize(text, speaker),
                                            compose=compose if settings.sound_url or songs else None,
                                            moods=tuple(reel.MOODS), songs=songs is not None, song=song)

    async def video_voice(self, wanted: str) -> dict:
        """A voice asked for by id (a ready one's or the catalog's), by name, or by a description of it."""
        tts = self.m.tts
        if wanted.strip().lower() in MY_VOICE:
            return self.voice
        if not tts.choosable:
            return tts.default
        found = await asyncio.to_thread(tts.find, wanted)
        if not found:
            best = await asyncio.to_thread(tts.match, wanted, "", 1)
            if not best:
                raise StudioError(f"no voice fits “{wanted}”; describe it in fewer words, e.g. “young female, warm”")
            found = best[0], best[0]["catalog"]
        v, catalog = found
        return await asyncio.to_thread(tts.adopt, v["id"]) if catalog else v

    async def cast(self, source, lines=None) -> dict:
        """The voice and music that suit a post, described: {"voice": "female, young adult, ...",
        "language": "...", "music": "upbeat acoustic pop, ..."}. Asked of the LLM once per content."""
        lines = [str(x) for x in lines] if isinstance(lines, list) else (source.video or {}).get("lines") or []
        texts = [t.text for sl in source.slides for t in sl.texts]
        post = "\n".join(filter(None, [
            f"Platform: {source.label}", source.title and f"Title: {source.title}",
            source.caption and f"Caption: {source.caption[:600]}", texts and f"Words on the pictures: {' / '.join(texts)}",
            any(lines) and f"What the voice says: {' / '.join(x for x in lines if x)}"]))
        if post in self.castings:
            return self.castings[post]
        described = {"voice": "", "language": "", "music": ""}
        try:
            reply = await self.m.llm.chat([{"role": "system", "content": CASTING}, {"role": "user", "content": post}], [])
            text = reply.content or ""
            found = json.loads(text[text.index("{"):text.rindex("}") + 1])
            described = {"voice": str(found.get("voice") or "")[:160], "language": str(found.get("language") or "")[:40],
                         "music": " ".join(str(found.get("music") or "").split())[:300]}
        except Exception as exc:
            log.warning("no voice described for draft %s: %s", source.id, exc)
        if described["voice"]:
            self.castings[post] = described
        return described

    async def cast_voice(self, source, lines=None) -> dict:
        """The voice that suits the post best, set up to speak (the assistant's own when nothing fits)."""
        tts = self.m.tts
        if not tts.choosable:
            return tts.default
        described = await self.cast(source, lines)
        if not described["voice"]:
            return self.voice
        best = await asyncio.to_thread(tts.match, described["voice"], described["language"], 1)
        if not best:
            return self.voice
        log.info("video voice for draft %s: %r -> %s", source.id, described["voice"], best[0]["name"])
        return await asyncio.to_thread(tts.adopt, best[0]["id"]) if best[0]["catalog"] else best[0]

    async def send_video_voices(self, msg: dict):
        tts, q, lang = self.m.tts, str(msg.get("q") or "").strip(), str(msg.get("lang") or "")
        reply = {"type": "video_voices", "draft": msg.get("draft"), "q": q, "lang": lang, "choosable": tts.choosable,
                 "mine": self.voice}
        try:
            described = {"voice": q, "language": ""}
            if not q:
                source, _ = self.studio.video_drafts(msg.get("draft"))
                described = await self.cast(source, msg.get("lines"))
            voices = await asyncio.to_thread(tts.match, described["voice"], lang or described["language"])
            languages = (await asyncio.to_thread(tts.catalog))[2] if tts.choosable else []
        except StudioError as exc:
            return await self.try_send(**reply, described="", voices=[], languages=[], error=str(exc))
        except Exception as exc:
            log.warning("voices for a video couldn't be found: %s", exc)
            return await self.try_send(type="error", message="The voice server didn't answer. Try again in a moment.")
        await self.try_send(**reply, described=described["voice"], language=described["language"], voices=voices,
                            languages=languages)

    def focus_note(self) -> str | None:
        """What the user selected or painted on screen, for "this" and "it", when it changed since the LLM
        was told."""
        conv, notes = self.conv, []
        if self.studio.mask_seq != conv.mask_told:
            conv.mask_told = self.studio.mask_seq
            if note := self.studio.mask_note():
                notes.append(note)
        if conv.focus != conv.focus_told and (note := self.selection_note()):
            notes.append(note)
        return " ".join(notes) or None

    def selection_note(self) -> str | None:
        conv = self.conv
        conv.focus_told = dict(conv.focus)
        d = self.studio.drafts.get(conv.focus.get("draft"))
        if not d:
            return None
        what = f"draft {d.id}"
        if conv.focus.get("slide"):
            what = f"slide {conv.focus['slide']} of {what}"
        if conv.focus.get("text"):
            try:
                _, t = d.find_text(conv.focus["text"])
                what = f"text {t.id} (“{t.text}”) on {what}"
            except Exception:
                pass
        return f"On screen, the user has selected {what}; “this” or “it” means that."

    # --- user speech --------------------------------------------------------------

    async def on_audio(self, data: bytes):
        samples = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
        for ev in self.vad.process(samples):
            if ev.kind == "start":
                await self.on_speech_start()
            elif ev.kind == "audio":
                if self.stream:
                    self.stream.feed(ev.audio)
                else:
                    self.utterance.append(ev.audio)
            elif ev.kind == "end":
                await self.on_speech_end()

    async def on_speech_start(self):
        self.user_speaking = True
        await self.send(type="vad", speaking=True)
        if self.assistant_active():
            await self.interrupt()  # barge-in
        self.utterance = []
        if settings.asr_mode == "streaming":
            self.stream = self.m.asr.stream(
                lambda text: self.send_threadsafe(type="transcript", text=text, final=False)
            )

    async def on_speech_end(self):
        await self.send(type="vad", speaking=False)
        stream, self.stream = self.stream, None
        audio, self.utterance = self.utterance, []
        # Finalize off the receive loop so mic audio keeps flowing
        task = asyncio.create_task(self.finalize(stream, audio))
        self.background.add(task)
        task.add_done_callback(self.background.discard)

    async def finalize(self, stream: StreamingTranscription | None, audio: list[np.ndarray]):
        t0 = time.perf_counter()
        text = ""
        try:
            if stream:
                text = await asyncio.to_thread(stream.finish)
            else:
                text = await asyncio.to_thread(self.m.asr.transcribe, np.concatenate(audio)) if audio else ""
            log.info("ASR %.0f ms: %r", (time.perf_counter() - t0) * 1000, text)
            await self.send(type="transcript", text=text, final=True)
            if text:
                await self.start_response(text)
        except Exception as exc:
            log.exception("ASR failed")
            await self.send(type="error", message=f"ASR failed: {exc}")
        finally:
            self.user_speaking = self.vad.in_speech  # a new utterance may have started
            if not text:
                self.maybe_announce()

    # --- assistant ----------------------------------------------------------------

    def assistant_active(self) -> bool:
        busy = self.response is not None and not self.response.done()
        return busy or time.monotonic() < self.speaking_until

    async def interrupt(self, notify: bool = True):
        if self.response and not self.response.done():
            self.response.cancel()
            try:
                await self.response
            except (asyncio.CancelledError, Exception):
                pass
        was_speaking = time.monotonic() < self.speaking_until
        self.response = None
        self.speaking_until = 0.0
        self.turn += 1  # client drops any audio from older turns
        if notify:
            await self.send(type="interrupt", turn=self.turn, was_speaking=was_speaking)

    async def start_response(self, text: str):
        await self.interrupt(notify=self.assistant_active())
        self.response = asyncio.create_task(self.respond(text, self.turn))

    async def respond(self, user_text: str | None, turn: int):
        """Answers user_text, or with None just reacts to pending notes (task results)."""
        if self.m.comfy:
            self.m.comfy.maybe_refresh()  # the workflow list in the prompt; picked up next turn
        self.load_flowai()
        if self.flowai_loading and not self.flowai_loading.done():
            await asyncio.wait({self.flowai_loading}, timeout=5)  # the accounts go in the prompt
        conv = self.conv  # a switch interrupts this reply first, so it stays the same throughout
        system = {"role": "system", "content": self.system_prompt()}
        if user_text and (focus := self.focus_note()):
            conv.notes.append(focus)
        for note in conv.notes:
            conv.messages.append({"role": "system", "content": note})
        conv.notes.clear()
        conv.announce = False
        if user_text:
            conv.messages.append({"role": "user", "content": user_text})
            if conv.heard(user_text):  # it has a name now
                self.spawn(self.send_conversations())
        sentences: asyncio.Queue[str | None] = asyncio.Queue()
        speaker = asyncio.create_task(self.speak(sentences, turn))
        t0 = time.perf_counter()
        first_token = True
        rounds, used, usage = 0, 0, {}
        exclude = (set() if self.m.browser else tools.BROWSER_TOOLS) | \
                  (set() if self.m.comfy else tools.MEDIA_TOOLS) | \
                  (set() if self.flowai else tools.FLOWAI_TOOLS) | \
                  (set() if self.m.phone else tools.PHONE_TOOLS) | \
                  ({"load_skill"} if self.skills_inline else set())
        try:
            for _ in range(settings.llm_max_tool_rounds):
                content, calls, chunker = "", [], SentenceChunker()
                rounds += 1
                try:
                    async for msg in self.m.llm.stream([system, *conv.messages], tools.schemas(exclude), usage):
                        if msg.content:
                            if first_token:
                                log.info("LLM first token %.0f ms", (time.perf_counter() - t0) * 1000)
                                first_token = False
                            content += msg.content
                            await self.send(type="assistant_delta", turn=turn, text=msg.content)
                            for s in chunker.push(msg.content):
                                sentences.put_nowait(s)
                        if msg.tool_calls:
                            calls.extend(msg.tool_calls)
                finally:
                    # Keep what was said in history, even if the user cut us off
                    if content or calls:
                        conv.messages.append({"role": "assistant", "content": content, "tool_calls": calls or None})
                        conv.changed()
                for s in chunker.flush():
                    sentences.put_nowait(s)
                if not calls:
                    break
                used += len(calls)
                await self.run_tools(conv, calls, turn)
            log.info("reply in %.1f s: %d model calls, %d tool calls, %d prompt and %d output tokens",
                     time.perf_counter() - t0, rounds, used, usage.get("prompt", 0), usage.get("output", 0))

            sentences.put_nowait(None)
            await speaker
            await self.send(type="assistant_done", turn=turn)
        except asyncio.CancelledError:
            speaker.cancel()
            raise
        except Exception as exc:
            speaker.cancel()
            log.exception("response failed")
            await self.send(type="error", message=f"Assistant failed: {exc}")
        # A task may have finished while we were talking
        self.loop.call_soon(self.maybe_announce)

    async def run_tools(self, conv: Conversation, calls: list, turn: int):
        pending = list(calls)
        try:
            while pending:
                call = pending[0]
                name, args = call.function.name, dict(call.function.arguments or {})
                await self.send(type="tool_call", turn=turn, name=name, arguments=args)
                result = await tools.run(name, args, session=self)
                log.info("tool %s(%s) -> %s", name, args, result[:200])
                await self.send(type="tool_result", turn=turn, name=name, result=result)
                conv.messages.append({"role": "tool", "tool_name": name, "content": result})
                pending.pop(0)
        finally:
            # Every tool call needs a result in history, or the next request is invalid
            for call in pending:
                conv.messages.append({"role": "tool", "tool_name": call.function.name,
                                      "content": json.dumps({"error": "interrupted by user"})})
            conv.changed()

    async def speak(self, sentences: asyncio.Queue, turn: int):
        while (text := await sentences.get()) is not None:
            if not self.speech:  # text only: the words are on screen already
                continue
            t0 = time.perf_counter()
            audio = await asyncio.to_thread(self.m.tts.synthesize, text, self.voice["id"])
            dur = len(audio) / TTS_RATE
            log.info("TTS %.0f ms for %.1f s audio: %r", (time.perf_counter() - t0) * 1000, dur, text)
            if turn != self.turn:
                return
            await self.send_audio(turn, audio)
            self.speaking_until = max(time.monotonic(), self.speaking_until) + dur

    # --- browser tasks ------------------------------------------------------------
    # A task runs in the background, independent of the spoken response, so the user
    # can keep talking (or barge in) without killing it. When it ends, its result is
    # queued as a note and the assistant announces it at the next quiet moment.

    async def start_browser_task(self, instruction: str) -> dict:
        if not self.m.browser:
            return {"error": "the browser is not available"}
        if self.job and not self.job.task.done():
            return {"error": f"task {self.job.id} ({self.job.instruction!r}) is still running; "
                             "wait for it or cancel it first"}
        self.job_count += 1
        job = BrowserJob(self.job_count, instruction)
        job.task = asyncio.create_task(self.run_browser_job(job))
        self.job = job
        return {"task_id": job.id, "status": "started"}

    async def run_browser_job(self, job: BrowserJob):
        await self.try_send(type="browser_task", id=job.id, status="started", text=job.instruction)
        browser = self.m.browser

        async def on_step(step: int, action: str, args: dict, result: str):
            job.steps.append(f"{action} {json.dumps(args, ensure_ascii=False)}: {result[:150]}")
            shot = None
            if settings.browser_screenshots:
                try:
                    shot = await browser.screenshot_b64()
                except Exception:
                    pass
            await self.try_send(type="browser_step", id=job.id, step=step, action=action,
                                args=args, result=result[:300], url=browser.page.url, screenshot=shot)

        try:
            async with browser.lock:  # one task at a time in the shared window
                agent = BrowserAgent(browser, self.m.browser_llm, load_skills(ROOT / settings.skills_dir),
                                     settings.website_url, settings.browser_max_steps, on_step)
                job.result = await agent.run(job.instruction)
            status = "done"
        except asyncio.CancelledError:
            job.result = "cancelled"
            await self.try_send(type="browser_task", id=job.id, status="cancelled")
            raise
        except Exception as exc:
            log.exception("browser task %d failed", job.id)
            job.result = f"it failed with an error: {exc}"
            status = "failed"
        log.info("browser task %d %s in %.1f s: %s", job.id, status, time.monotonic() - job.started, job.result)
        await self.try_send(type="browser_task", id=job.id, status=status, text=job.result)
        self.add_note(f"Browser task {job.id} ({job.instruction!r}) has finished. Result: {job.result}\n"
                      "Tell the user the outcome in one or two short spoken sentences.")

    def browser_task_status(self) -> dict:
        job = self.job
        if not job:
            return {"status": "no task has been started"}
        if job.task.done():
            return {"task_id": job.id, "status": "finished", "result": job.result}
        return {"task_id": job.id, "status": "running", "instruction": job.instruction,
                "seconds": round(time.monotonic() - job.started), "recent_steps": job.steps[-3:]}

    async def cancel_browser_task(self) -> dict:
        job = self.job
        if not job or job.task.done():
            return {"error": "no browser task is running"}
        job.task.cancel()
        try:
            await job.task
        except (asyncio.CancelledError, Exception):
            pass
        return {"task_id": job.id, "status": "cancelled"}

    def add_note(self, text: str, announce: bool = True):
        """Tells the LLM about an event on its next turn; announce=True also makes it speak up."""
        if announce:
            self.conv.notify(text)  # calls maybe_announce
        else:
            self.conv.remember(text)

    def maybe_announce(self):
        """Starts a response for pending notes once nobody is talking."""
        if not self.conv.announce or self.user_speaking:
            return  # the user's next turn will pick the notes up
        if self.response and not self.response.done():
            return  # respond() calls us again when it ends
        wait = self.speaking_until - time.monotonic()
        if wait > 0:  # let the current audio finish playing
            self.loop.call_later(wait + 0.3, self.maybe_announce)
            return
        self.response = asyncio.create_task(self.respond(None, self.turn))

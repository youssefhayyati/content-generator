"""Tools the voice assistant's LLM can call.

Register a tool with @tool, giving it a JSON-schema for its parameters. Tools may be
sync or async and should return something JSON-serializable (or a string). A tool that
declares a `session` parameter receives the current VoiceSession (not part of the schema).

Website actions are not listed here one by one: the assistant delegates a whole task to
the browser agent (backend/browser_agent.py), which has its own tools and skills. Pictures
and videos are made by ComfyUI workflows on the RunPod pod (backend/media.py). Posts for
Instagram and X are drafts (backend/studio.py), made by following a content skill
(skills/content/*.md), and saved to FlowAI through its API (backend/flowai.py). They are published
from the team's phone (backend/phone.py), whose own agent follows a phone skill (skills/phone/*.md).
"""

import asyncio
import inspect
import json
import logging
from collections.abc import Callable
from datetime import datetime

from .config import ROOT, settings
from .skills import load_skills
from .reel import MOODS, MOTIONS
from .studio import EDIT_MODES, POSITIONS, SIZES, STYLES

log = logging.getLogger(__name__)

_REGISTRY: dict[str, tuple[Callable, dict]] = {}


def tool(name: str, description: str, parameters: dict | None = None):
    def wrap(fn: Callable) -> Callable:
        _REGISTRY[name] = (fn, {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": parameters or {"type": "object", "properties": {}},
            },
        })
        return fn
    return wrap


def schemas(exclude: set[str] = frozenset()) -> list[dict]:
    return [schema for name, (_, schema) in _REGISTRY.items() if name not in exclude]


async def run(name: str, arguments: dict, **context) -> str:
    """`context` values (e.g. session=...) are passed to tools that declare them."""
    if name not in _REGISTRY:
        return json.dumps({"error": f"unknown tool {name!r}"})
    fn, schema = _REGISTRY[name]
    params = inspect.signature(fn).parameters
    arguments = {k: v for k, v in arguments.items() if k not in context}
    missing = [k for k in schema["function"]["parameters"].get("required", []) if arguments.get(k) in (None, "")]
    if missing:
        return json.dumps({"error": f"{name} needs {' and '.join(missing)}; nothing was done"})
    try:
        result = fn(**arguments, **{k: v for k, v in context.items() if k in params})
        if inspect.isawaitable(result):
            result = await result
    except Exception as exc:
        log.exception("tool %s failed", name)
        return json.dumps({"error": str(exc)})
    return result if isinstance(result, str) else json.dumps(result, default=str)


# --- Built-in tools -------------------------------------------------------------

@tool("get_current_time", "Get the current local date and time.")
def get_current_time():
    return {"now": datetime.now().strftime("%A %d %B %Y, %I:%M %p")}


@tool(
    "wait",
    "Pause for a number of seconds, e.g. while a page loads. Never to wait for the phone, a picture or a website "
    "task: you are told when those finish.",
    {
        "type": "object",
        "properties": {"seconds": {"type": "number", "description": "Seconds to wait (max 10)"}},
        "required": ["seconds"],
    },
)
async def wait(seconds: float):
    await asyncio.sleep(min(float(seconds), 10))
    return {"waited": seconds}


# --- Website (delegated to the browser agent) -------------------------------------

BROWSER_TOOLS = {"browser_task", "browser_task_status", "cancel_browser_task"}


@tool(
    "browser_task",
    "Start a task on the website in the web browser: navigating, clicking, filling forms, "
    "or reading information from pages. It runs in the background and you are told the result "
    "when it finishes. Give a complete, self-contained instruction including every detail the "
    "user gave.",
    {
        "type": "object",
        "properties": {"instruction": {"type": "string", "description": "What to do, in plain language"}},
        "required": ["instruction"],
    },
)
async def browser_task(instruction: str, session):
    return await session.start_browser_task(instruction)


@tool("browser_task_status", "Check progress of the running browser task.")
def browser_task_status(session):
    return session.browser_task_status()


@tool("cancel_browser_task", "Stop the running browser task.")
async def cancel_browser_task(session):
    return await session.cancel_browser_task()


# --- Images and video (ComfyUI on the RunPod pod) --------------------------------

MEDIA_TOOLS = {"generate_media", "media_status", "cancel_media", "list_media_workflows",
               "search_workflow_templates", "add_media_workflow", "edit_area"}


@tool(
    "generate_media",
    "Create a picture or a video with a ComfyUI workflow, or edit or animate an existing picture. "
    "It runs in the background; the result appears on the user's screen and you are told when it is ready.",
    {
        "type": "object",
        "properties": {
            "workflow": {"type": "string", "description": "Workflow name from the list"},
            "prompt": {"type": "string", "description": "Detailed visual description in English: subject, "
                                                        "setting, style, lighting, camera, motion for videos"},
            "image": {"type": "string", "description": "Only for workflows that need an image: the number of a "
                                                       "picture in this conversation, e.g. \"3\" (default: the "
                                                       "latest), or an https URL"},
            "options": {"type": "object", "description": "Other workflow inputs, e.g. {\"width\": 1216, "
                                                         "\"height\": 832} or {\"length\": 81}"},
            "draft": {"type": "integer", "description": "Make it for this post draft: the result replaces the "
                                                        "slide's picture, in the draft's shape. An editing workflow "
                                                        "edits the slide's current picture"},
            "slide": {"type": "integer", "description": "Which slide of the draft (default 1)"},
        },
        "required": ["workflow", "prompt"],
    },
)
async def generate_media(workflow: str, prompt: str, session, image: str | None = None,
                         options: dict | None = None, draft: int | None = None, slide: int | None = None, **extra):
    # Models sometimes put inputs like width at the top level instead of in options
    if isinstance(options, dict) or options is None:
        options = {**extra, **(options or {})}
    if draft not in (None, ""):
        return await session.studio.generate(draft, slide, workflow, prompt, image, options)
    return await session.media.generate(workflow, prompt, image, options)


@tool("media_status", "Check progress of picture/video generations, videos, dubs, face swaps and workflow installs: "
      "the stage each is at, its steps and percent when known, and the stages it went through.")
def media_status(session):
    return session.media.status()


@tool(
    "cancel_media",
    "Stop a picture or video generation.",
    {
        "type": "object",
        "properties": {"job": {"type": "integer", "description": "Job number (default: the latest running)"}},
    },
)
async def cancel_media(session, job: int | None = None):
    return await session.media.cancel(job)


@tool("list_media_workflows", "List the ComfyUI workflows on the pod: what each makes and its inputs.")
async def list_media_workflows(session):
    return await session.media.list_workflows()


@tool(
    "search_workflow_templates",
    "Search ComfyUI's built-in workflow templates, to find one to add. Not for face swaps or dubbing: those are "
    "swap_face and dub_video.",
    {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "Keywords, e.g. \"wan image to video\""}},
        "required": ["query"],
    },
)
async def search_workflow_templates(query: str, session):
    return await session.media.search_templates(query)


@tool(
    "add_media_workflow",
    "Add a new workflow to the pod from a built-in template, a workflow file the user attached, or a URL "
    "of a workflow JSON. Installing its nodes and models runs in the background and can take minutes. Not for "
    "face swaps or dubbing: those are swap_face and dub_video.",
    {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "New workflow name in lower_snake_case, e.g. wan14_i2v"},
            "description": {"type": "string", "description": "One sentence: what it makes and from what"},
            "template": {"type": "string", "description": "Template name from search_workflow_templates"},
            "file": {"type": "integer", "description": "Number of a workflow file the user attached"},
            "url": {"type": "string", "description": "https URL of a workflow JSON file"},
            "replace": {"type": "boolean", "description": "Overwrite an existing workflow with this name "
                                                          "(only if the user asked)"},
        },
        "required": ["name", "description"],
    },
)
async def add_media_workflow(name: str, session, description: str = "", template: str | None = None,
                             file: int | None = None, url: str | None = None, replace: bool = False):
    return await session.media.add_workflow(name, description, template, file, url, bool(replace))


# --- Voices, dubbing and face swaps (backend/dub.py) -----------------------------

LIPSYNC_TOOLS = {"dub_video"}  # with LIPSYNC_URL
FACESWAP_TOOLS = {"swap_face"}  # with FACESWAP_URL

@tool(
    "clone_voice",
    "Clone a voice from a recording in this conversation: an audio file, or a video's sound (5 to 20 seconds of "
    "one person speaking is best). The voice is then one of the ready voices: it can read videos (make_video's "
    "or dub_video's voice) or be the one you speak in. Only a voice the user has the right to use: their own, "
    "or someone's who agreed.",
    {
        "type": "object",
        "properties": {
            "media": {"type": "integer", "description": "Number of the audio or video file (default: the latest)"},
            "name": {"type": "string", "description": "What to call the voice, e.g. 'Sarah' or 'My voice'"},
            "speak": {"type": "boolean", "description": "Also speak in it yourself from now on (only if asked)"},
        },
    },
)
async def clone_voice(session, media: int | None = None, name: str = "", speak: bool = False):
    return await session.clone_voice(media, name, bool(speak))


@tool(
    "transcribe_media",
    "What is said in a video or audio file in this conversation, how long it lasts, and about how many words fit "
    "in that time. Use it before dub_video, to write new words that take about as long as the old ones.",
    {
        "type": "object",
        "properties": {"media": {"type": "integer", "description": "Number of the file (default: the latest video "
                                                                   "or audio)"}},
    },
)
async def transcribe_media(session, media: int | None = None):
    return await session.transcribe_media(media)


@tool(
    "dub_video",
    "Make the person in a video say other words: the words are read in their own voice, cloned from the video "
    "(or in another voice), and a lip-sync model redraws their mouth to match. The result is a new video. It "
    "runs in the background for a few minutes; you are told when it is ready.",
    {
        "type": "object",
        "properties": {
            "video": {"type": "integer", "description": "Number of the video (default: the latest)"},
            "script": {"type": "string", "description": "Exactly what they say now, in the language to speak, as "
                                                        "plain spoken words. About as long as the video: see "
                                                        "transcribe_media"},
            "voice": {"type": "string", "description": "Leave out for the speaker's own voice. Else a voice id "
                                                       "(find_voices, clone_voice), a description of a voice, or "
                                                       "'mine' for the one you speak in"},
        },
        "required": ["script"],
    },
)
async def dub_video(session, script: str, video: int | None = None, voice: str | None = None):
    return await session.dub_video(video, script, voice)


@tool(
    "swap_face",
    "Put the face from one picture onto the person in another picture or in a video (face swap: inswapper_128, "
    "the face restored with GFPGAN; the video keeps its sound). The result is a new picture or video, or with a "
    "draft it takes the place of that slide's picture or video. It runs in the background and you are told when it "
    "is ready. Only with the consent of the person whose face it is.",
    {
        "type": "object",
        "properties": {
            "face": {"type": "integer", "description": "Number of the picture with the face to use"},
            "target": {"type": "integer", "description": "Number of the picture or video to put it on (or give draft)"},
            "draft": {"type": "integer", "description": "Put it on this draft's slide instead: its picture or video is "
                                                        "changed and replaced"},
            "slide": {"type": "integer", "description": "Which slide of the draft (default 1)"},
            "every": {"type": "boolean", "description": "Change every face, not only the largest (default false)"},
        },
        "required": ["face"],
    },
)
async def swap_face(session, face: int, target: int | None = None, draft: int | None = None, slide: int | None = None,
                    every: bool = False):
    return await session.swap_face(face, target, draft, slide, bool(every))


# --- Post drafts for Instagram and X (backend/studio.py) -------------------------

_DRAFT = {"type": "integer", "description": "Draft number (default: the draft on the user's screen)"}
_LOOK = {
    "position": {"type": "string", "enum": POSITIONS, "description": "Where on the picture (default bottom)"},
    "size": {"type": "string", "description": f"{', '.join(SIZES)}, or a size in pixels (default large); "
                                              "long texts shrink to fit"},
    "color": {"type": "string", "description": "Text colour: a name or hex, e.g. white or #ffd400 (default white)"},
    "style": {"type": "string", "enum": STYLES, "description": "shadow (default), outline, box (a panel behind "
                                                              "the text, best on busy pictures) or plain"},
    "box_color": {"type": "string", "description": "Colour of the panel (style box) or outline (default black)"},
    "font": {"type": "string", "description": "A font's name from the fonts by style in your instructions, e.g. "
                                              "playfair or caveat (default bold)"},
}
_POST = {
    "placement": {"type": "string", "description": "Instagram: feed (default), story or reel. X: post"},
    "aspect": {"type": "string", "description": "Picture shape, e.g. 4:5, 1:1, 9:16, 16:9 (default: the "
                                                "placement's best shape)"},
    "title": {"type": "string", "description": "Short name for the draft, e.g. Summer sale launch"},
    "caption": {"type": "string", "description": "The post's text, written for the platform"},
    "media": {"type": "array", "items": {"type": "integer"},
              "description": "Picture or video numbers, one slide each, in order. On a change it is the whole new "
                             "list: slides keep their texts by position"},
    "background": {"type": "string", "description": "Colour of slides without a picture, e.g. #0e3b2e"},
}

STUDIO_TOOLS = {"create_draft", "update_draft", "add_text", "edit_text", "remove_text", "undo_draft",
                "draft_versions", "show_draft", "load_skill", "make_video", "find_voices"}


@tool(
    "load_skill",
    "Load the step-by-step instructions of a content skill. Do this before making that kind of post.",
    {
        "type": "object",
        "properties": {"name": {"type": "string", "description": "Skill name from the list"}},
        "required": ["name"],
    },
)
def load_skill(name: str):
    skills = load_skills(ROOT / settings.content_skills_dir)
    skill = skills.get(str(name).strip())
    if not skill:
        return {"error": f"there is no skill {name!r}. Skills: {', '.join(skills) or 'none'}"}
    return f"Skill {skill.name}:\n{skill.instructions}"


@tool(
    "create_draft",
    "Make a new post draft for Instagram or X, in one go: caption, the words on its slides and the pictures to "
    "make. It is drawn and shown on the user's screen after every change, with the platform's checks. Only for a "
    "new post the user asked for: to change a draft, change that draft.",
    {
        "type": "object",
        "properties": {
            "platform": {"type": "string", "enum": ["instagram", "x"]},
            **_POST,
            "texts": {"type": "array", "description": "Words to draw on the slides, as add_text takes them. With "
                                                      "from_draft they replace the copied texts",
                      "items": {"type": "object", "required": ["text"], "properties": {
                          "text": {"type": "string", "description": "The words"},
                          "slide": {"type": "integer", "description": "Slide number (default 1)"}, **_LOOK}}},
            "pictures": {"type": "array", "items": {"type": "string"},
                         "description": "One picture prompt per slide, slide 1 first: each is made in the draft's "
                                        "shape and goes in by itself when ready"},
            "workflow": {"type": "string", "description": "Workflow for the pictures (default: text to image)"},
            "from_draft": {"type": "integer", "description": "Copy this draft's pictures, texts and caption into "
                                                             "a second post, e.g. to adapt an Instagram post for X "
                                                             "when the user wants both"},
        },
        "required": ["platform"],
    },
)
async def create_draft(platform: str, session, placement: str | None = None, aspect: str | None = None,
                       title: str | None = None, caption: str | None = None, media: list | None = None,
                       background: str | None = None, from_draft: int | None = None, texts: list | None = None,
                       pictures: list | None = None, workflow: str | None = None):
    return await session.studio.create(platform, placement, aspect, title, caption, media, from_draft, background,
                                       texts, pictures, workflow)


@tool(
    "update_draft",
    "Change a draft's caption, title, placement, shape, background or pictures. Only what you give changes.",
    {"type": "object", "properties": {"draft": _DRAFT, **_POST}},
)
async def update_draft(session, draft: int | None = None, placement: str | None = None, aspect: str | None = None,
                       title: str | None = None, caption: str | None = None, media: list | None = None,
                       background: str | None = None):
    return await session.studio.update(draft, placement, aspect, title, caption, media, background)


@tool(
    "add_text",
    "Put text on a slide of a draft, a picture or a video: a headline, an offer, a call to action. It is drawn "
    "crisply and wrapped to fit (on a video, over the whole video); never ask the image model for words.",
    {
        "type": "object",
        "properties": {
            "draft": _DRAFT,
            "text": {"type": "string", "description": "The words; a line break starts a new line"},
            "slide": {"type": "integer", "description": "Slide number (default 1)"},
            **_LOOK,
        },
        "required": ["text"],
    },
)
async def add_text(text: str, session, draft: int | None = None, slide: int | None = None, **look):
    return await session.studio.add_text(draft, text, slide, **{k: v for k, v in look.items() if k in _LOOK})


@tool(
    "edit_text",
    "Change a text on a draft: its words, look, or slide. Only what you give changes.",
    {
        "type": "object",
        "properties": {
            "draft": _DRAFT,
            "text_id": {"type": "integer", "description": "The text's number on the draft"},
            "text": {"type": "string", "description": "New words"},
            "slide": {"type": "integer", "description": "Move it to this slide"},
            **_LOOK,
        },
        "required": ["text_id"],
    },
)
async def edit_text(text_id: int, session, draft: int | None = None, text: str | None = None,
                    slide: int | None = None, **look):
    return await session.studio.edit_text(draft, text_id, text, slide,
                                          **{k: v for k, v in look.items() if k in _LOOK})


@tool(
    "remove_text",
    "Take a text off a draft.",
    {
        "type": "object",
        "properties": {"draft": _DRAFT, "text_id": {"type": "integer", "description": "The text's number"}},
        "required": ["text_id"],
    },
)
async def remove_text(text_id: int, session, draft: int | None = None):
    return await session.studio.remove_text(draft, text_id)


@tool(
    "undo_draft",
    "Put a draft back the way it was before its last change. Call again to go further back.",
    {"type": "object", "properties": {"draft": _DRAFT}},
)
async def undo_draft(session, draft: int | None = None):
    return await session.studio.undo(draft)


@tool(
    "draft_versions",
    "A draft's history: every version, what each changed and which one is on screen. With version, the draft goes "
    "back to that version; a change after that starts a new branch from it, and the other versions stay there "
    "to come back to.",
    {"type": "object", "properties": {"draft": _DRAFT,
                                      "version": {"type": "integer", "description": "Go back to this version"}}},
)
async def draft_versions(session, draft: int | None = None, version: int | None = None):
    if version in (None, ""):
        return session.studio.history(draft)
    return await session.studio.checkout(draft, version)


@tool(
    "edit_area",
    "Change only the area of a slide's picture that the user painted over on screen; the rest of the picture "
    "stays exactly as it is. Use it whenever an area is painted and the user says what to do with it.",
    {
        "type": "object",
        "properties": {
            "mode": {"type": "string", "enum": list(EDIT_MODES),
                     "description": "remove: take it away and show what's behind. replace: put something else there "
                                    "(say what in prompt). change: alter what is there, e.g. its colour or material. "
                                    "improve: sharper, better lit, more realistic"},
            "prompt": {"type": "string", "description": "In English. replace: what goes there, e.g. 'a small cactus "
                                                        "in a terracotta pot'. change: the instruction, e.g. 'Make the "
                                                        "dress dark blue'. improve: optional, what to improve"},
            "draft": {"type": "integer", "description": "Default: the draft with the painted area"},
            "slide": {"type": "integer", "description": "Default: the painted slide"},
        },
        "required": ["mode"],
    },
)
async def edit_area(mode: str, session, prompt: str = "", draft: int | None = None, slide: int | None = None):
    return await session.studio.edit_area(draft, slide, mode, prompt)


@tool(
    "make_video",
    "Make a draft's pictures (one or several) into a short video: a voice that suits the video reads a line per "
    "picture while each picture slowly zooms or pans, with captions, music and an end card with a call to "
    "action. It is made in the background and takes the place of the pictures in the same draft (as an Instagram "
    "reel or an X post); the pictures stay in the draft's history. Asked again, the video is made again in that "
    "draft with the changes. The reply says which voice reads it.",
    {
        "type": "object",
        "properties": {
            "draft": {"type": "integer", "description": "The draft to make into a video, or whose video to make "
                                                        "again (default: the draft on the user's screen)"},
            "lines": {"type": "array", "items": {"type": "string"},
                      "description": "What the voice says over each picture: exactly one entry per picture, in "
                                     "order (a one-picture post has one entry). An entry can be one to three short "
                                     "spoken sentences; each sentence gets its own camera move. Hook first, no "
                                     "hashtags or emoji, and no call to action (that's cta_line). Leave out to keep "
                                     "the last video's lines"},
            "cta": {"type": "string", "description": "Words on the end card's button, 1 to 3 words, e.g. 'Shop now', "
                                                     "'Order yours', 'Book a table'; empty for no end card"},
            "cta_line": {"type": "string", "description": "The call to action the voice says on the end card, e.g. "
                                                          "'Order yours today, the link is in our bio.'"},
            "music": {"type": "string",
                      "description": "Background music. When songs are on, leave it out: the first video gets "
                                     "an instrumental song written for the post, and a video made again keeps its "
                                     "song. To change the song, describe the music for the music model, in English "
                                     "(genre, instruments, mood and energy, tempo in bpm, e.g. 'upbeat acoustic "
                                     "pop, ukulele and hand claps, catchy, 112 bpm'), or pass 'song' for a new one "
                                     "written for the post. Only when the user asks for one, or songs are off: one "
                                     "of the composer's moods, " + ", ".join(f"{k} ({v})" for k, v in MOODS.items())
                                     + ". Or none for no music"},
            "captions": {"type": "boolean", "description": "Show the spoken words (default true)"},
            "motion": {"type": "string", "enum": ["auto", "pan", *MOTIONS],
                       "description": "How the pictures move (default auto: a different move for each; pan: "
                                      "side to side, one way then the other)"},
            "placement": {"type": "string", "description": "Instagram: reel (default), story or feed. X: post"},
            "color": {"type": "string", "description": "The end card button's colour (default: the post's own)"},
            "voice": {"type": "string", "description": "Who reads it, in English: a description of the voice that "
                                                       "suits the post and its audience, e.g. 'female, young adult, "
                                                       "moderate pitch, american accent, warm, social' or 'male, "
                                                       "middle-aged, low pitch, british accent, calm, narration' (the "
                                                       "closest voice is used), a voice id from find_voices, or "
                                                       "'mine' for the voice you speak in. Leave out to keep the last "
                                                       "video's voice; the first video gets one cast for the post"},
            "language": {"type": "string", "description": "The language the lines are written in, when it isn't "
                                                          "English, e.g. 'Moroccan Arabic' for Darija, 'Egyptian "
                                                          "Arabic', 'French'. Any voice speaks it, with that "
                                                          "language's accent. Leave out to keep the last video's; "
                                                          "empty to have it guessed from the lines"},
        },
    },
)
async def make_video(session, draft: int | None = None, lines: list | None = None, cta: str | None = None,
                     cta_line: str | None = None, music: str | None = None, captions: bool | None = None,
                     motion: str | None = None, placement: str | None = None, color: str | None = None,
                     voice: str | None = None, language: str | None = None):
    return await session.make_video(draft, lines=lines, cta=cta, cta_line=cta_line, music=music, captions=captions,
                                    motion=motion, placement=placement, color=color, voice=voice, language=language)


@tool(
    "find_voices",
    "The voices that best fit a description, best first, to read a video (make_video's voice). Use it when the "
    "user wants to choose among a few, or to check a voice exists before using it.",
    {
        "type": "object",
        "properties": {
            "description": {"type": "string", "description": "In English: gender, age, pitch, accent, how it is "
                                                             "said, what for, e.g. 'female, elderly, warm, narration'"},
            "language": {"type": "string", "description": "The language it speaks, in English, e.g. 'French' "
                                                          "(default: any)"},
        },
        "required": ["description"],
    },
)
async def find_voices(session, description: str, language: str = ""):
    tts = session.m.tts
    if not tts.choosable:
        return {"voices": await asyncio.to_thread(tts.profiles),
                "note": "these are all the voices (no VoiceStudio server): its own and the ones cloned here"}
    _, _, labelled = await asyncio.to_thread(tts.catalog)
    known = next((lang for lang in labelled if lang.lower() == language.strip().lower()), "")
    found = await asyncio.to_thread(tts.match, description, known, 8)
    voices = [{k: v[k] for k in ("id", "name", "description", "language", "use") if v.get(k)} for v in found]
    if language.strip() and not known:
        # No voice is labelled with it, but every voice speaks it: searching again finds nothing more
        try:
            speaks = await asyncio.to_thread(tts.language, language)
        except ValueError as exc:
            return {"voices": voices, "error": str(exc)}
        return {"voices": voices,
                "note": f"any of these voices speaks {speaks}: write the lines in it and pass a voice's id as "
                        f"make_video's voice and '{speaks}' as its language. For a native speaker's own voice, "
                        f"the user can record one and clone it (clone_voice). Don't search again"}
    return {"voices": voices, "note": "pass a voice's id as make_video's voice"}


@tool(
    "show_draft",
    "Show a draft again on the user's screen and get all its details. Without a number, lists the drafts.",
    {"type": "object", "properties": {"draft": {"type": "integer", "description": "Draft number"}}},
)
async def show_draft(session, draft: int | None = None):
    return await session.studio.show(draft)


# --- FlowAI: saving, finding and scheduling posts (backend/flowai.py) --------------

FLOWAI_TOOLS = {"save_draft", "find_posts", "open_post", "find_assets", "use_assets", "schedule_post",
                "find_campaigns", "open_campaign", "fetch_x_post", "redesign_picture", "repost_to_instagram"}


@tool(
    "save_draft",
    "Save a draft to FlowAI as a post with status draft, or save its latest changes to the same post. The team "
    "sees it in FlowAI's Composer and calendar. A draft opened from a campaign is saved into that campaign.",
    {
        "type": "object",
        "properties": {
            "draft": _DRAFT,
            "account": {"type": "integer", "description": "FlowAI account number (default: the only account on "
                                                          "the draft's platform)"},
        },
    },
)
async def save_draft(session, draft: int | None = None, account: int | None = None):
    return await session.flowai.save(draft, account)


@tool(
    "find_posts",
    "Find posts saved in FlowAI (drafts, scheduled and published), newest first.",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Words in the title or caption"},
            "status": {"type": "string", "enum": ["draft", "scheduled", "published", "failed"]},
            "platform": {"type": "string", "enum": ["instagram", "x"]},
        },
    },
)
async def find_posts(session, query: str | None = None, status: str | None = None, platform: str | None = None):
    return await session.flowai.find_posts(query, status, platform)


@tool(
    "open_post",
    "Open a FlowAI post as a draft here, to show or change it. Saving the draft updates the same post.",
    {
        "type": "object",
        "properties": {"post": {"type": "integer", "description": "The post's number in FlowAI"}},
        "required": ["post"],
    },
)
async def open_post(post: int, session):
    return await session.flowai.open_post(post)


@tool(
    "find_campaigns",
    "Find the user's FlowAI campaigns, newest first: name, stage and how many posts each has.",
    {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "Words in the campaign's name"}},
    },
)
async def find_campaigns(session, query: str | None = None):
    return await session.flowai.find_campaigns(query)


@tool(
    "open_campaign",
    "Bring a FlowAI campaign's posts into this conversation as drafts, one per account version, to show or "
    "change them. Saving one changes that post in the campaign; a changed version waits for the user's approval.",
    {
        "type": "object",
        "properties": {"campaign": {"type": "integer", "description": "The campaign's number from find_campaigns"}},
        "required": ["campaign"],
    },
)
async def open_campaign(campaign: int, session):
    return await session.flowai.open_campaign(campaign)


@tool(
    "find_assets",
    "Find pictures and videos in the FlowAI gallery, newest first.",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Words in the file name"},
            "kind": {"type": "string", "enum": ["image", "video"]},
        },
    },
)
async def find_assets(session, query: str | None = None, kind: str | None = None):
    return await session.flowai.find_assets(query, kind)


@tool(
    "use_assets",
    "Bring pictures or videos from the FlowAI gallery into this conversation; each gets a number to use in drafts.",
    {
        "type": "object",
        "properties": {"assets": {"type": "array", "items": {"type": "integer"},
                                  "description": "Asset numbers from find_assets"}},
        "required": ["assets"],
    },
)
async def use_assets(assets: list, session):
    return await session.flowai.use_assets(assets)


@tool(
    "schedule_post",
    "Ask the user to approve publishing a draft at a time. It saves the draft first if needed, then shows an "
    "Approve button on screen. Nothing is booked until the user presses it; you are told when they do.",
    {
        "type": "object",
        "properties": {
            "draft": _DRAFT,
            "when": {"type": "string", "description": "Date and time in the user's time zone, e.g. 2026-10-16T09:00, "
                                                      "or \"queue\" for the account's next free posting time"},
        },
        "required": ["when"],
    },
)
async def schedule_post(when: str, session, draft: int | None = None):
    return await session.flowai.schedule(draft, when)


# Reposts from X to Instagram (backend/reposts.py)

@tool(
    "fetch_x_post",
    "Bring a post from X here to repost it on Instagram: FlowAI reads its author, text and pictures from its link, "
    "and the pictures get numbers here. Then redesign it before it goes anywhere.",
    {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "The post's link, e.g. https://x.com/someone/status/123…"},
            "account": {"type": "integer", "description": "The Instagram account it goes to (default: the only one)"},
        },
        "required": ["url"],
    },
)
async def fetch_x_post(url: str, session, account: int | None = None):
    from . import reposts
    return await reposts.fetch(session.flowai, url, account)


@tool(
    "redesign_picture",
    "Make a new picture for a repost with an image model in FlowAI, from a picture here as its reference (or from "
    "the instruction alone). It runs in the background, usually under a minute; you are told its number when ready.",
    {
        "type": "object",
        "properties": {
            "instruction": {"type": "string", "description": "What the new picture looks like: subject, style, "
                                                             "colours, mood; say to keep what matters from the original"},
            "media": {"type": "integer", "description": "The picture's number here to start from (none: from words)"},
            "model": {"type": "string", "enum": ["higgsfield/grok-image-2", "higgsfield/ideogram-4", "higgsfield/soul"],
                      "description": "Default grok-image-2; ideogram-4 is good with words on the picture"},
        },
        "required": ["instruction"],
    },
)
async def redesign_picture(instruction: str, session, media: int | None = None, model: str | None = None):
    from . import reposts
    return await reposts.redesign(session.flowai, instruction, media, model)


@tool(
    "repost_to_instagram",
    "Ask the user to approve a redesigned repost: an Approve card on screen for the Instagram draft, which also "
    "records that reusing the X post is allowed. Nothing is booked before they press it; you are told. Once "
    "approved, the team's phone posts it on Instagram at that time by itself.",
    {
        "type": "object",
        "properties": {
            "repost": {"type": "integer", "description": "The repost number from fetch_x_post"},
            "draft": _DRAFT,
            "when": {"type": "string", "description": "\"now\" (default: within a few minutes) or a date and time in "
                                                      "the user's time zone, e.g. 2026-10-16T09:00"},
        },
        "required": ["repost"],
    },
)
async def repost_to_instagram(repost: int, session, draft: int | None = None, when: str | None = None):
    from . import reposts
    return await reposts.ask(session.flowai, repost, draft, when)


# --- The team's phone: posting from its Instagram and X apps (backend/phone.py) ----

PHONE_TOOLS = {"post_on_phone", "post_feedback", "phone_task", "phone_status", "answer_phone", "cancel_phone_task"}


@tool(
    "post_on_phone",
    "Publish drafts for real, from the Instagram or X app on the team's phone: each one's pictures or video go to "
    "the phone, then the phone posts it with its caption. Publishing is public and can't be undone: only when the "
    "user has just said to post these drafts now (not save or schedule them). Several go up one after another by "
    "themselves. It runs in the background for a few minutes each; you are told as each one is up (the user sees "
    "the screenshot it ended on), so don't check on it. Also tries a post that failed again.",
    {
        "type": "object",
        "properties": {
            "draft": _DRAFT,
            "drafts": {"type": "array", "items": {"type": "integer"},
                       "description": "Several drafts to post, in this order (instead of draft)"},
            "again": {"type": "boolean", "description": "Post a draft that is already up (or may be) once more: "
                                                        "only when the user said so"},
        },
    },
)
async def post_on_phone(session, draft: int | None = None, drafts: list[int] | None = None, again: bool = False):
    return await session.phone.post(drafts or draft, bool(again))


@tool(
    "post_feedback",
    "Check how a post published from the phone is doing: likes, comments, shares, saves, views and the latest "
    "comments, and what changed since the last check. It runs on the phone in the background; you are told.",
    {
        "type": "object",
        "properties": {
            "post": {"type": "integer", "description": "Phone post number from this conversation (default: the latest)"},
            "flowai_post": {"type": "integer", "description": "Or a FlowAI post that went up by itself at its "
                                                              "scheduled time (phone_status lists them)"},
        },
    },
)
async def post_feedback(session, post: int | None = None, flowai_post: int | None = None):
    return await session.phone.feedback(post, flowai_post)


@tool(
    "phone_task",
    "Do something else on the team's Android phone (it has the Instagram and X apps): e.g. check which accounts "
    "are logged in, reply to a comment, read the notifications. Not for posting a draft (post_on_phone does that, "
    "and tries a failed one again). Give a complete, self-contained instruction. It runs in the background and you "
    "are told the result.",
    {
        "type": "object",
        "properties": {
            "instruction": {"type": "string", "description": "What to do on the phone, in plain language"},
            "skill": {"type": "string", "description": "A phone skill to follow, from the list in your instructions"},
        },
        "required": ["instruction"],
    },
)
async def phone_task(instruction: str, session, skill: str | None = None):
    return await session.phone.task(instruction, skill)


@tool("phone_status", "What the phone is doing, what it last said, and the posts made from it (here and FlowAI's "
                      "scheduled ones) with their numbers. Only when the user asks: you are told by yourself when "
                      "a job on the phone finishes.")
def phone_status(session):
    return session.phone.status()


@tool(
    "answer_phone",
    "Answer the phone when it asks something or waits for the user's OK: approve true/false for an approval "
    "(only as the user said, and only when you were told it waits for one), or text to tell it more, or to correct "
    "what it just did.",
    {
        "type": "object",
        "properties": {
            "approve": {"type": "boolean", "description": "The user's answer to what the phone wants to do"},
            "text": {"type": "string", "description": "What to tell the phone"},
        },
    },
)
async def answer_phone(session, approve: bool | None = None, text: str | None = None):
    return await session.phone.answer(text, approve)


@tool("cancel_phone_task", "Stop what the phone is doing, and the posts waiting their turn.")
async def cancel_phone_task(session):
    return await session.phone.cancel()


# Creative Lab: building and running node graphs in FlowAI (lab_tools.py registers its tools here)
from . import lab_tools  # noqa: E402,F401

# --- How content is made here, and the plan the user approves ------------------------
# A conversation makes content one way at a time: drafts here (the old-school way) or a Creative Lab canvas.
# Each way sees only its own tools (session.py, VoiceSession.respond), so one can't drift into the other.

DRAFT_TOOLS = (STUDIO_TOOLS - {"load_skill"}) | {"edit_area", "generate_media", "dub_video", "swap_face",
                                                 "save_draft", "open_post", "schedule_post", "open_campaign",
                                                 "post_on_phone"}
CANVAS_TOOLS = {name for name in _REGISTRY if name.startswith("lab_")}
MODES = {"drafts": "drafts in this chat", "canvas": "nodes on a Creative Lab canvas"}


@tool(
    "set_mode",
    "Switch how content is made in this conversation, when the user asks for the other way: drafts (the "
    "old-school way, drafts in this chat; they may say old school, classic, drafts, here) or canvas (a Creative "
    "Lab project of nodes; they may say canvas, flow, nodes, graph, Creative Lab). The page goes to that view and "
    "what was made stays where it is.",
    {"type": "object", "properties": {"mode": {"type": "string", "enum": list(MODES)}}, "required": ["mode"]},
)
async def set_mode(mode: str, session):
    return await session.set_mode(mode)


@tool(
    "propose_plan",
    "Show the user the plan on screen before making several posts, or anything slow or paid (videos, songs, "
    "dubbing, face swaps, cloud models), and wait: you are told when they approve it, or what to change. Not for "
    "one quick post. Once approved, make all of it without asking again; each post still needs its own approval "
    "to be scheduled.",
    {"type": "object", "properties": {
        "summary": {"type": "string", "description": "What it is, in one line: what, for whom, the angle, when"},
        "items": {"type": "array", "items": {"type": "string"},
                  "description": "What gets made, one short line each, e.g. \"Sun 12:00 · Instagram post · the "
                                 "octopus escapes the printer\""},
        "takes": {"type": "string", "description": "About how long it takes to make, e.g. \"about 8 minutes\""},
        "cost": {"type": "string", "description": "What it costs, if anything is paid"},
    }, "required": ["summary", "items"]},
)
async def propose_plan(session, summary: str, items: list | None = None, takes: str = "", cost: str = ""):
    if not session.flowai:
        return {"error": "FlowAI isn't connected, so nothing can be approved on screen; ask the user in words"}
    a = await session.flowai.ask("plan", str(summary)[:300], items=[str(i)[:200] for i in items or []][:60],
                                 takes=str(takes)[:80], cost=str(cost)[:80])
    return {"approval": a.id, "status": "waiting for the user to approve the plan on screen",
            "note": "make nothing until you are told they approved it; if they ask for a change, change the plan "
                    "and propose it again"}

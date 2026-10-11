"""The engine: what FlowAI's Creative Lab asks this service to make for its nodes.

Creative Lab (content-generator/backend, App\\Services\\Lab) runs a graph of nodes. The nodes that need the
GPU pod or this service's own drawing come here, one job each, over HTTP:

    POST   /engine/jobs              task + params (JSON) + files  -> {"id"}
    GET    /engine/jobs/{id}         {"status": running|done|failed|canceled, "stage", "share", "error", "files"}
    GET    /engine/jobs/{id}/files/n the n-th file it made
    DELETE /engine/jobs/{id}         stop it
    GET    /engine/catalog           the pod's workflows, which services answer, the fonts
    GET    /engine/voices?q=         the voices it reads with (VoiceStudio or OmniVoice), searched
    GET    /engine/voices/list       the ready voices and the catalog (q, lang), as the voice pickers show them
    GET    /engine/voices/sample     how one sounds (id, catalog), a WAV
    POST   /engine/voices/use        a catalog voice set up as a ready one
    POST   /engine/voices/clone      a voice cloned from a recording (recording, name)
    POST   /engine/faces             where the faces are in a few frames (for reframing on the speaker)

Tasks:
    comfy      a ComfyUI workflow on the pod: pictures, edits, videos (prompt, aspect, seconds, an image)
    song       an instrumental song from ACE-Step (description, seconds)
    dub        a video saying new words in its speaker's cloned voice (or another), lips redrawn (LatentSync)
    swap       a face put on the person in a picture or video (inswapper)
    design     words drawn on pictures or videos, sized for the platform (studio.py's drawing)
    slideshow  pictures into a video with a voice, captions, music and an end card (reel.py)
    retouch    only the painted part of a picture changed (retouch.py and the pod's edit workflow)

Every request carries X-Engine-Key when ENGINE_KEY is set. Jobs live in memory and their files in
MEDIA_DIR/engine/<id>/, for two hours: FlowAI copies what it needs into its own library when a job is done.
"""

import asyncio
import io
import json
import logging
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import wave
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import numpy as np
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from PIL import Image, ImageOps

from . import dub, platforms, reel, retouch
from .comfyui import ComfyError, describe_error, describe_progress
from .config import settings
from .media import _size, data_url, made_files
from .studio import (EDIT_PROMPTS, POSITIONS, SIZES, Text, _behind, _color, _sentences, draw_text, find_font,
                     font_catalog, picture_colours, readability)

log = logging.getLogger(__name__)

KEEP_SECONDS = 2 * 3600
POLL = 1.5
VIDEO_PLACEMENT = {"instagram": "reel", "x": "post"}
MAX_UPLOAD = 400 * 2**20


class EngineError(Exception):
    """A job couldn't be done; the message is for the person who asked."""


@dataclass
class Job:
    id: str
    task: str
    dir: Path
    status: str = "running"
    stage: str = "Starting"
    share: float | None = None
    error: str | None = None
    files: list[dict] = field(default_factory=list)  # {path, name, mime, meta}
    created: float = field(default_factory=time.time)
    handle: asyncio.Task | None = None
    stop: threading.Event = field(default_factory=threading.Event)
    on_cancel: list = field(default_factory=list)

    def info(self) -> dict:
        return {"id": self.id, "task": self.task, "status": self.status, "stage": self.stage, "share": self.share,
                "error": self.error,
                "files": [{"index": i, "name": f["name"], "mime": f["mime"], "meta": f.get("meta") or {}}
                          for i, f in enumerate(self.files)]}

    def step(self, stage: str, share: float | None = None):
        self.stage = stage[:1].upper() + stage[1:]
        self.share = None if share is None else round(max(0.0, min(1.0, share)), 3)

    def keep(self, data: bytes | Path, name: str, mime: str, meta: dict | None = None):
        path = self.dir / f"{len(self.files)}-{re.sub(r'[^\w.\-]+', '_', name)[:80]}"
        if isinstance(data, Path):
            shutil.move(str(data), path)
        else:
            path.write_bytes(data)
        self.files.append({"path": path, "name": name, "mime": mime, "meta": meta or {}})


class Engine:
    def __init__(self, models, media_dir: Path, fonts_dir: Path):
        self.m = models
        self.dir = media_dir / "engine"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.fonts_dir = fonts_dir
        self.jobs: dict[str, Job] = {}
        self._music_up: tuple[float, bool] | None = None

    # --- jobs ---------------------------------------------------------------------------

    def start(self, task: str, params: dict, files: dict[str, list[tuple[str, bytes]]]) -> Job:
        self._forget_old()
        work = {"comfy": self._comfy, "song": self._song, "dub": self._dub, "swap": self._swap,
                "design": self._design, "slideshow": self._slideshow, "retouch": self._retouch}.get(task)
        if not work:
            raise EngineError(f"the engine doesn't do {task!r}")
        job = Job(uuid.uuid4().hex[:16], task, self.dir / uuid.uuid4().hex[:16])
        job.dir.mkdir(parents=True)
        saved: dict[str, list[Path]] = {}
        for fieldname, items in files.items():
            for i, (name, data) in enumerate(items):
                path = job.dir / f"in-{fieldname}-{i}{Path(name).suffix.lower() or '.bin'}"
                path.write_bytes(data)
                saved.setdefault(fieldname, []).append(path)
        self.jobs[job.id] = job
        job.handle = asyncio.create_task(self._run(job, work, params, saved))
        return job

    async def _run(self, job: Job, work, params: dict, files: dict[str, list[Path]]):
        t0 = time.monotonic()
        try:
            await work(job, params, files)
            if not job.files:
                raise EngineError("it finished without making anything")
            job.status, job.stage, job.share = "done", "Done", 1.0
        except asyncio.CancelledError:
            job.status, job.error = "canceled", "stopped"
            raise
        except (EngineError, ComfyError, dub.DubError) as exc:
            job.status, job.error = "failed", str(exc)
        except Exception as exc:
            log.exception("engine job %s (%s) failed", job.id, job.task)
            job.status, job.error = "failed", f"something went wrong ({type(exc).__name__})"
        finally:
            for p in job.dir.glob("in-*"):
                p.unlink(missing_ok=True)
        log.info("engine %s %s: %s in %.1f s%s", job.task, job.id, job.status, time.monotonic() - t0,
                 f" ({job.error})" if job.error else "")

    def cancel(self, job: Job):
        job.stop.set()
        for hook in job.on_cancel:
            try:
                hook()
            except Exception:
                pass
        if job.handle and not job.handle.done():
            job.handle.cancel()
        job.status = "canceled"

    def _forget_old(self):
        now = time.time()
        for jid, job in list(self.jobs.items()):
            if now - job.created > KEEP_SECONDS and job.status != "running":
                shutil.rmtree(job.dir, ignore_errors=True)
                del self.jobs[jid]

    # --- what it can do -----------------------------------------------------------------

    async def catalog(self) -> dict:
        comfy = self.m.comfy
        workflows, comfy_status = [], "off"
        if comfy:
            try:
                if not comfy.workflows or comfy.error:
                    await comfy.refresh()
                comfy_status = "ok" if not comfy.error else comfy.error
            except ComfyError as exc:
                comfy_status = str(exc)
            workflows = [{"name": w.name, "ready": w.ready, "output": w.output, "media_inputs": w.media_inputs,
                          "description": w.about(), "inputs": [k for k in w.inputs]} for w in comfy.workflows.values()]
        fonts = font_catalog(self.fonts_dir)
        return {
            "workflows": workflows,
            "services": {
                "comfyui": comfy_status,
                "music": await asyncio.to_thread(self._music_status),
                "lipsync": self.m.lipsync.status if self.m.lipsync else "off",
                "faceswap": self.m.faceswap.status if self.m.faceswap else "off",
                # Where its voice comes from: the pod's VoiceStudio, or OmniVoice on this machine's GPU
                "tts": ("ok, VoiceStudio" if settings.tts_url else "ok, OmniVoice here") if self.m.tts else "off",
                "sound": "ok" if settings.sound_url else "off",
                # Its own model, for the Models page: Ollama Cloud needs the key, a self-hosted Ollama doesn't
                "llm": f"ok, {settings.llm_model}" if settings.ollama_api_key or "ollama.com" not in settings.ollama_host
                       else "off",
            },
            "fonts": [{"name": f.name, "label": f.label, "style": f.style, "suits": f.suits}
                      for f in fonts["fonts"].values()],
            "font_styles": fonts["styles"],
        }

    def _music_status(self) -> str:
        songs = self.m.music
        if not songs:
            return "off"
        if self._music_up and time.monotonic() - self._music_up[0] < 60:
            return "ok" if self._music_up[1] else "not answering"
        try:
            up = songs.http.get("/health", timeout=6).status_code < 500
        except httpx.HTTPError:
            up = False
        self._music_up = (time.monotonic(), up)
        return "ok" if up else "not answering"

    def voice_list(self, q: str = "", lang: str = "") -> dict:
        """The voices to pick from, as the assistant's own voice picker shows them: the ready ones (made,
        cloned or set up from the catalog), and the catalog matching q and lang (featured ones without)."""
        tts = self.m.tts
        if not tts:
            return {"ready": [], "catalog": [], "total": 0, "languages": [], "choosable": False, "clonable": False}
        ready = tts.profiles()
        catalog, total, languages = tts.catalog(q, lang, {v["archetype"] for v in ready if v.get("archetype")}) \
            if tts.choosable else ([], 0, [])
        if q:  # the ready ones that fit the words too
            words = q.lower().split()
            ready = [v for v in ready if all(w in json.dumps(v).lower() for w in words)]
        return {"ready": ready, "catalog": catalog, "total": total, "languages": languages,
                "choosable": tts.choosable, "clonable": tts.clonable}

    def voice_sample(self, voice: str, catalog: bool) -> bytes:
        """How a voice sounds, as a WAV."""
        audio = self.m.tts.sample(archetype=voice) if catalog else self.m.tts.sample(voice=voice)
        out = io.BytesIO()
        with wave.open(out, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
        return out.getvalue()

    def voices(self, q: str = "") -> list[dict]:
        tts = self.m.tts
        if not tts:
            return []
        ready = [{**v, "ready": True} for v in tts.profiles()]
        if not q:
            return ready[:60]
        words = q.lower().split()
        mine = [v for v in ready if all(w in json.dumps(v).lower() for w in words)]
        found = tts.match(q, "", 20) if tts.choosable else []
        seen = {v["id"] for v in mine}
        return [*mine, *[{**v, "ready": False} for v in found if v["id"] not in seen]][:40]

    # --- comfy: pictures, edits and videos on the pod ------------------------------------

    async def _comfy(self, job: Job, p: dict, files: dict[str, list[Path]]):
        comfy = self.m.comfy
        if not comfy:
            raise EngineError("picture and video generation is off (COMFYUI_URL is not set on the assistant)")
        name = str(p.get("workflow") or "")
        wf = comfy.workflows.get(name)
        if wf is None:
            await comfy.refresh()
            wf = comfy.workflows.get(name)
        if wf is None:
            raise EngineError(f"the pod has no workflow {name!r}")
        if not wf.ready:
            raise EngineError(f"{name} is still being installed on the pod; try again in a few minutes")
        inputs: dict = {}
        if p.get("prompt") and "prompt" in wf.inputs:
            inputs["prompt"] = str(p["prompt"])
        if "image" in wf.media_inputs:
            image = (files.get("image") or [None])[0]
            if not image:
                raise EngineError(f"{name} needs a picture")
            inputs["image"] = data_url(image.read_bytes(), image.name)
        aspect = p.get("aspect")
        if aspect and "image" not in wf.media_inputs and {"width", "height"} <= wf.inputs.keys():
            try:
                ratio = platforms.parse_aspect(str(aspect))
                inputs["width"], inputs["height"] = _size(ratio, wf.inputs["width"], wf.inputs["height"])
            except ValueError:
                pass
        if p.get("seconds") and "length" in wf.inputs:
            frames = int(float(p["seconds"]) * 24) + 1
            inputs["length"] = max(9, min(121, round((frames - 1) / 4) * 4 + 1))
        for key in ("negative_prompt", "negative"):
            if p.get("negative") and key in wf.inputs:
                inputs[key] = str(p["negative"])
        if p.get("seed") and "seed" in wf.inputs:
            inputs["seed"] = int(p["seed"])

        job.step("sending it to the pod")
        queued = await comfy.run(name, inputs)
        if queued.get("status") == "setting_up":
            raise EngineError(f"{name} is still being installed on the pod; try again in a few minutes")
        prompt_id = queued["prompt_id"]
        job.on_cancel.append(lambda: asyncio.get_event_loop().create_task(comfy.cancel(prompt_id)))
        deadline = time.monotonic() + settings.comfyui_timeout_minutes * 60
        errors = 0
        while True:
            await asyncio.sleep(POLL)
            if time.monotonic() > deadline:
                raise EngineError("the pod didn't finish in time; it may have restarted")
            try:
                res = await comfy.result(prompt_id)
                errors = 0
            except ComfyError:
                errors += 1
                if errors >= 5:
                    raise
                continue
            if res.get("status") == "done":
                break
            if res.get("status") == "error":
                raise EngineError(describe_error(res.get("messages")))
            if where := describe_progress(res.get("progress")):
                stage, detail, share = where
                job.step(f"{stage}{' · ' + detail if detail else ''}", share)
        made = made_files(res)
        if not made:
            raise EngineError("it finished without producing any file")
        job.step("downloading the result")
        for f in made:
            data = await comfy.download(f["url"])
            fname = f.get("filename") or "output"
            ext = Path(fname).suffix.lower()
            mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
                    ".mp4": "video/mp4", ".webm": "video/webm", ".gif": "image/gif"}.get(ext, "application/octet-stream")
            job.keep(data, fname, mime, {"workflow": name, "seed": queued.get("seed")})

    # --- songs ----------------------------------------------------------------------------

    async def _song(self, job: Job, p: dict, files):
        songs = self.m.music
        if not songs:
            raise EngineError("songs are off (MUSIC_URL is not set on the assistant)")
        seconds = float(p.get("seconds") or 30)
        description = str(p.get("description") or "warm instrumental background music")
        job.step("writing the song")
        data = await asyncio.to_thread(songs.song, description, seconds, p.get("seed"),
                                       lambda share: job.step("writing the song", share))
        job.keep(data, "song.wav", "audio/wav", {"sound": "music", "label": description[:80], "description": description})

    # --- voices -----------------------------------------------------------------------------

    async def _voice(self, wanted: str | None) -> dict | None:
        """A voice by id or name (a ready one, or the catalog's), or by a description. None: not given."""
        tts = self.m.tts
        if not wanted:
            return None
        found = await asyncio.to_thread(tts.find, wanted)
        if found:
            v, catalog = found
            return await asyncio.to_thread(tts.adopt, v["id"]) if catalog else v
        if not tts.choosable:
            return tts.default
        best = await asyncio.to_thread(tts.match, wanted, "", 1)
        if not best:
            raise EngineError(f"no voice fits {wanted!r}")
        return await asyncio.to_thread(tts.adopt, best[0]["id"]) if best[0].get("catalog") else best[0]

    async def _hear(self, wav: bytes) -> str:
        try:
            if heard := await asyncio.to_thread(self.m.tts.listen, wav):
                return heard
        except Exception as exc:
            log.info("the voice server didn't transcribe it (%s)", exc)
        if settings.sound_url:
            async with httpx.AsyncClient(timeout=300) as http:
                r = await http.post(f"{settings.sound_url.rstrip('/')}/v1/transcribe", content=wav,
                                    headers={"Content-Type": "audio/wav"})
                r.raise_for_status()
                return " ".join(str(r.json().get("text") or "").split())
        return ""

    async def _clone_from(self, path: Path, name: str) -> dict:
        clip = await asyncio.to_thread(dub.reference, await asyncio.to_thread(dub.sound_of, path))
        heard = await self._hear(clip)
        if not heard:
            raise EngineError("no words could be made out in the video to clone the voice from; pick a voice instead")
        try:
            return await asyncio.to_thread(self.m.tts.clone, name[:60], clip, heard)
        except Exception as exc:
            raise EngineError(f"the voice server couldn't clone the voice ({type(exc).__name__})") from None

    # --- dub ---------------------------------------------------------------------------------

    async def _dub(self, job: Job, p: dict, files):
        if not self.m.lipsync:
            raise EngineError("lip sync is off (LIPSYNC_URL is not set on the assistant)")
        video = (files.get("video") or [None])[0] or _fail("send the video")
        script = " ".join(str(p.get("script") or "").split())
        if not script:
            raise EngineError("write what they say now")
        info = await asyncio.to_thread(dub.check, video)
        speaker = await self._voice(p.get("voice"))
        if speaker is None:
            if not await asyncio.to_thread(dub.has_sound, video):
                raise EngineError("the video has no sound to clone the speaker's voice from: pick a voice")
            job.step("cloning the speaker's voice")
            speaker = await self._clone_from(video, f"Voice from {job.id}")
        job.step(f"reading the words in {speaker['name']}’s voice")
        audio = await asyncio.to_thread(self.m.tts.synthesize, script, speaker["id"], info["duration"])
        if not len(audio):
            raise EngineError("the voice server didn't read the words")
        speech, seconds = await asyncio.to_thread(dub.fit, audio, info["duration"])
        job.step("preparing the video")
        clip = await asyncio.to_thread(dub.for_pod, video, dub.LIPSYNC_FPS, False)
        made = await asyncio.to_thread(self.m.lipsync.sync, clip, speech, lambda stage, share: job.step(stage, share),
                                       job.stop.is_set)
        data = await asyncio.to_thread(dub.with_sound, made, speech)
        job.keep(data, "dub.mp4", "video/mp4", {**(await asyncio.to_thread(dub.meta, data)),
                                                "voice": speaker.get("id"), "voice_name": speaker.get("name"), "script": script})

    # --- face swap --------------------------------------------------------------------------

    async def _swap(self, job: Job, p: dict, files):
        swapper = self.m.faceswap
        if not swapper:
            raise EngineError("face swapping is off (FACESWAP_URL is not set on the assistant)")
        face = (files.get("face") or [None])[0] or _fail("send the face")
        target = (files.get("target") or [None])[0] or _fail("send what to put the face on")
        is_video = target.suffix.lower() in (".mp4", ".mov", ".webm", ".mkv")
        if is_video:
            await asyncio.to_thread(dub.check, target)
            job.step("preparing the video")
            target_file = ("target.mp4", await asyncio.to_thread(dub.for_pod, target))
        else:
            target_file = (target.name, target.read_bytes())
        made = await asyncio.to_thread(swapper.swap, (face.name, face.read_bytes()), target_file, bool(p.get("every")),
                                       lambda stage, share: job.step(stage, share), job.stop.is_set)
        if is_video:
            job.keep(made, "faceswap.mp4", "video/mp4", await asyncio.to_thread(dub.meta, made))
        else:
            job.keep(made, "faceswap.png", "image/png")

    # --- words on pictures --------------------------------------------------------------------

    def _fonts(self) -> dict:
        return font_catalog(self.fonts_dir)["all"]

    def _texts(self, raw: list, n: int) -> list[tuple[int, Text]]:
        fonts = self._fonts()
        out = []
        for i, t in enumerate(raw or [], 1):
            words = " ".join(str(t.get("text") or "").split()) if "\n" not in str(t.get("text") or "") else str(t.get("text")).strip()
            if not words:
                continue
            position = str(t.get("position") or "top").lower()
            size = str(t.get("size") or "large").lower()
            style = str(t.get("style") or "shadow").lower()
            font = t.get("font") or "bold"
            font = font if font in fonts else (find_font(self.fonts_dir, font) or "bold")
            color = str(t.get("color") or "white")
            try:
                _color(color)
            except Exception:
                color = "white"
            out.append((int(t.get("slide") or 1), Text(i, words, position if position in POSITIONS else "top",
                                                         size if size in SIZES or size.isdigit() else "large", color,
                                                         style if style in ("shadow", "box", "outline", "plain") else "shadow",
                                                         str(t.get("box_color") or "black"), font)))
        return out

    def _draw(self, img: Image.Image, texts: list[Text], safe) -> tuple[Image.Image, list[dict]]:
        fonts = self._fonts()
        size = img.size
        plain = img
        taken: dict[str, float] = {}
        boxes = []
        bottom = [t for t in reversed(texts) if t.position.startswith("bottom")]
        for t in [t for t in texts if t not in bottom] + bottom:
            font = fonts.get(t.font)
            img, height, (x, y, w, h) = draw_text(img, t, font.path if font else None, safe, taken.get(t.position, 0),
                                                  font.scale if font else 1.0)
            taken[t.position] = taken.get(t.position, 0) + height
            behind = _behind(plain, (x, y, x + w, y + h))
            boxes.append({"text": t.text, "box": [round(x / size[0], 4), round(y / size[1], 4), round(w / size[0], 4),
                                                  round(h / size[1], 4)], "readability": round(readability(t, behind), 2)})
        return img, boxes

    async def _design(self, job: Job, p: dict, files):
        platform = str(p.get("platform") or "instagram")
        platform = platform if platform in platforms.SPECS else "instagram"
        placement = str(p.get("placement") or "feed")
        placement = placement if placement in platforms.placements(platform) else platforms.placements(platform)[0]
        media = files.get("media") or []
        texts = self._texts(p.get("texts") or [], len(media))
        slides = max(len(media), int(p.get("slides") or 0), max((s for s, _ in texts), default=1), 1)
        background = str(p.get("background") or "#1c1c1c")
        spec = platforms.spec(platform, placement)
        safe = spec["safe"]

        def slide_size(path: Path | None) -> tuple[int, int]:
            if path is None:
                return spec["size"]
            if path.suffix.lower() in (".mp4", ".mov", ".webm"):
                info = reel.probe(path)
                ratio = info["width"] / info["height"] if info.get("width") else None
            else:
                with Image.open(path) as im:
                    w, h = ImageOps.exif_transpose(im).size
                ratio = w / h
            # The picture's own shape when the placement takes it; else the placement's.
            return platforms.canvas_size(platform, placement, ratio) if ratio and platforms.fits(platform, placement, ratio) \
                else spec["size"]

        def render(i: int):
            path = media[i] if i < len(media) else None
            mine = [t for s, t in texts if s == i + 1]
            size = slide_size(path)
            if path is not None and path.suffix.lower() in (".mp4", ".mov", ".webm"):
                if not mine:
                    return path.read_bytes(), f"slide-{i + 1}.mp4", "video/mp4", {}
                frame = reel.still(path, size, float(reel.probe(path).get("duration") or 0) / 3)
                _, boxes = self._draw(frame, mine, safe)
                overlay = reel.layer(size, lambda img: self._draw(img, mine, safe)[0])
                out = job.dir / f"slide-{i + 1}.mp4"
                reel.burn(path, overlay, out)
                return out, f"slide-{i + 1}.mp4", "video/mp4", {"texts": boxes}
            img = Image.new("RGB", size, _color(background))
            if path is not None:
                with Image.open(path) as src:
                    img = ImageOps.fit(ImageOps.exif_transpose(src).convert("RGB"), size, Image.LANCZOS)
            colours = picture_colours(img) if path is not None else []
            done, boxes = self._draw(img, mine, safe)
            buf = io.BytesIO()
            done.convert("RGB").save(buf, "JPEG", quality=92, optimize=True)
            return buf.getvalue(), f"slide-{i + 1}.jpg", "image/jpeg", {"texts": boxes, "colours": colours}

        for i in range(slides):
            job.step(f"drawing slide {i + 1} of {slides}", i / slides)
            data, name, mime, meta = await asyncio.to_thread(render, i)
            job.keep(data, name, mime, {**meta, "slide": i + 1, "platform": platform, "placement": placement})

    # --- pictures to video -----------------------------------------------------------------------

    async def _slideshow(self, job: Job, p: dict, files):
        tts = self.m.tts
        images = files.get("images") or []
        if not images:
            raise EngineError("send the pictures")
        # Lines are optional: without them the pictures move to the music alone
        lines = [str(x).strip() for x in (p.get("lines") or []) if str(x).strip()]
        n = len(images)
        if len(lines) > n:  # more lines than pictures: the last picture takes the rest
            lines = [*lines[:n - 1], " ".join(lines[n - 1:])]
        lines += [""] * (n - len(lines))
        platform = str(p.get("platform") or "instagram")
        platform = platform if platform in platforms.SPECS else "instagram"
        placement = VIDEO_PLACEMENT[platform]
        spec = platforms.spec(platform, placement)
        size = platforms.canvas_size(platform, placement)
        voice = (await self._voice(p.get("voice")) or tts.default) if any(lines) else {"id": None, "name": "no voice"}
        motion = str(p.get("motion") or "auto")
        fonts = self._fonts()
        bold = fonts.get("bold")
        accent = str(p.get("accent") or "#ffffff")
        music_choice = str(p.get("music") or "none")
        cta = str(p.get("cta") or "").strip()[:40]

        def build(progress):
            shots = []
            for i, (path, line) in enumerate(zip(images, lines)):
                with Image.open(path) as src:
                    picture = ImageOps.exif_transpose(src).convert("RGB")
                for k, part in enumerate(_sentences(line) or [""]):
                    m = len(shots)
                    kind = {"auto": reel.AUTO_MOTIONS[m % len(reel.AUTO_MOTIONS)], "pan": ("pan-right", "pan-left")[m % 2]
                            }.get(motion, motion if motion in reel.MOTIONS else "zoom-in")
                    shots.append(reel.Shot(picture, None, part, tts.synthesize(part, voice["id"]) if part else None, kind,
                                           enter=k == 0))
                progress(0.4 * (i + 1) / n)
            if cta:
                shots.append(reel.Shot(None, line=cta if voice["id"] else "", voice=tts.synthesize(cta, voice["id"]) if voice["id"] else None, card=cta))
            return shots

        doing = f"reading the lines in {voice['name']}’s voice" if any(lines) else "framing the pictures"
        job.step(doing)
        shots = await asyncio.to_thread(build, lambda share: job.step(doing, share))
        seconds = reel.length(shots)
        most = spec.get("duration", (0, 600))[1]
        if seconds > most:
            raise EngineError(f"the voiceover makes it {seconds:.0f} seconds, and {platforms.label(platform, placement)} "
                              f"takes up to {most:g}; shorter lines would fit")

        tune = None
        if music_choice == "track" and files.get("music"):
            tune = await asyncio.to_thread(_to_wav, files["music"][0])
        elif music_choice == "song" and self.m.music:
            job.step("writing the song")
            description = str(p.get("song") or "warm, upbeat instrumental for a social video")
            try:
                tune = await asyncio.to_thread(self.m.music.song, description, seconds + 1, None,
                                               lambda share: job.step("writing the song", share))
            except Exception as exc:
                log.warning("no song for the video: %s", exc)
        elif music_choice not in ("none", "track", "song"):
            # A mood: FlowAI Sound's composer when it runs, else a song in that mood from ACE-Step on the pod
            job.step("adding the music")
            if settings.sound_url:
                try:
                    async with httpx.AsyncClient(timeout=120) as http:
                        r = await http.post(f"{settings.sound_url.rstrip('/')}/v1/music",
                                            json={"mood": music_choice, "seconds": round(min(max(seconds + 1, 5), 180), 1)})
                        r.raise_for_status()
                        tune = reel.music_wav(r.json()["audio"])
                except Exception as exc:
                    log.info("FlowAI Sound's composer didn't answer (%s); a song instead", exc)
            if tune is None and self.m.music:
                description = f"{reel.MOODS.get(music_choice, 'warm')} instrumental, background music for a social video"
                try:
                    tune = await asyncio.to_thread(self.m.music.song, description, seconds + 1, None,
                                                   lambda share: job.step("writing the song", share))
                except Exception as exc:
                    log.warning("no music for the video: %s", exc)

        look = reel.Look(size, bold.path if bold else None, "#1c1c1c", bool(p.get("captions", True)), accent, spec["safe"])
        job.step("putting the video together", 0)
        data, meta = await asyncio.to_thread(reel.render, shots, look, tune,
                                             lambda share: job.step("putting the video together", share))
        job.keep(data, "video.mp4", "video/mp4", {**meta, "voice": voice.get("id"), "voice_name": voice.get("name"),
                                                  "lines": lines, "script": " ".join(x for x in lines if x)})

    # --- paint to change ----------------------------------------------------------------------------

    async def _retouch(self, job: Job, p: dict, files):
        comfy = self.m.comfy
        if not comfy:
            raise EngineError("picture editing is off (COMFYUI_URL is not set on the assistant)")
        image = (files.get("image") or [None])[0] or _fail("send the picture")
        mask_file = (files.get("mask") or [None])[0] or _fail("paint over the part to change first")
        mode = str(p.get("mode") or "change").lower()
        mode = {"delete": "remove", "erase": "remove", "enhance": "improve", "fix": "improve"}.get(mode, mode)
        if mode not in EDIT_PROMPTS:
            raise EngineError("mode is remove, replace, change or improve")
        what = str(p.get("prompt") or "").strip().rstrip(".")
        if mode in ("change", "replace") and not what:
            raise EngineError("say what the painted part becomes")
        found = [w.name for w in comfy.workflows.values() if w.ready and w.output == "image"
                 and w.media_inputs == ["image"] and w.slots.get("images", 1) == 1 and "prompt" in w.inputs]
        found.sort(key=lambda n: "edit" not in n)
        if not found:
            raise EngineError("there is no picture-editing workflow on the pod")

        def prepare():
            with Image.open(image) as src:
                base = ImageOps.exif_transpose(src).convert("RGB")
            area = retouch.read_mask(mask_file.read_bytes(), base.size)
            if retouch.coverage(area) < 0.0005:
                raise EngineError("nothing is painted")
            if mode in ("remove", "replace"):
                area = retouch.grow(area, 0.02)
            box = retouch.region(area)
            sent = (retouch.mark(base, area) if mode in ("remove", "replace") else base).crop(box)
            buf = io.BytesIO()
            sent.save(buf, "PNG")
            return base, area, box, buf.getvalue()

        base, area, box, part = await asyncio.to_thread(prepare)
        instruction = EDIT_PROMPTS[mode].format(what=f": {what}" if mode == "improve" and what else what)
        sub = Job(job.id + "-edit", "comfy", job.dir)
        sub.step = job.step  # its progress is this job's
        part_path = job.dir / "in-part.png"
        part_path.write_bytes(part)
        await self._comfy(sub, {"workflow": found[0], "prompt": instruction}, {"image": [part_path]})
        edited = sub.files[0]["path"]

        def paste() -> bytes:
            with Image.open(edited) as e:
                done = retouch.stitch(base, box, e, area)
            buf = io.BytesIO()
            done.save(buf, "PNG", optimize=True)
            return buf.getvalue()

        data = await asyncio.to_thread(paste)
        edited.unlink(missing_ok=True)
        job.keep(data, f"{mode}-area.png", "image/png", {"mode": mode, "prompt": what})

    # --- faces ---------------------------------------------------------------------------------------

    async def faces(self, frames: list[tuple[str, bytes]]) -> dict:
        """Where the faces are in each frame (fractions of its size), from the pod's face swap service."""
        swapper = self.m.faceswap
        if not swapper:
            raise EngineError("face detection needs the face swap service (FACESWAP_URL)")

        def ask():
            r = swapper.http.post("/v1/faces", files=[("frames", (n, d, "image/jpeg")) for n, d in frames], timeout=60)
            if r.status_code == 404:
                raise EngineError("the pod's face service has no face detection yet: redeploy it (runpod/deploy.sh)")
            r.raise_for_status()
            return r.json()

        return await asyncio.to_thread(ask)


def _fail(message: str):
    raise EngineError(message)


def _to_wav(path: Path) -> bytes:
    """Any sound file as 48 kHz stereo WAV bytes, for the video's music."""
    with tempfile.TemporaryDirectory(prefix="track-") as tmp:
        out = Path(tmp) / "track.wav"
        proc = subprocess.run([reel.ffmpeg(), "-y", "-loglevel", "error", "-i", str(path), "-ac", "2", "-ar", "48000",
                               str(out)], capture_output=True, timeout=300)
        if proc.returncode != 0:
            raise EngineError("the music track couldn't be read")
        return out.read_bytes()


# --- HTTP ---------------------------------------------------------------------------------------------

router = APIRouter(prefix="/engine")


def _engine(request: Request) -> Engine:
    engine = getattr(request.app.state, "engine", None)
    if engine is None:
        raise HTTPException(503, "the engine is still starting")
    return engine


def _auth(x_engine_key: str | None = Header(default=None)):
    if settings.engine_key and x_engine_key != settings.engine_key:
        raise HTTPException(401, "a wrong or missing X-Engine-Key")


@router.get("/catalog", dependencies=[Depends(_auth)])
async def catalog(request: Request):
    return await _engine(request).catalog()


@router.get("/voices", dependencies=[Depends(_auth)])
async def voices(request: Request, q: str = ""):
    try:
        return {"voices": await asyncio.to_thread(_engine(request).voices, q)}
    except Exception as exc:
        log.warning("voices: %s", exc)
        return {"voices": []}


@router.get("/voices/list", dependencies=[Depends(_auth)])
async def voice_list(request: Request, q: str = "", lang: str = ""):
    try:
        return await asyncio.to_thread(_engine(request).voice_list, q, lang)
    except Exception as exc:
        log.warning("voice list: %s", exc)
        raise HTTPException(502, "the voice server didn't answer") from None


@router.get("/voices/sample", dependencies=[Depends(_auth)])
async def voice_sample(request: Request, id: str, catalog: bool = False):
    try:
        wav = await asyncio.to_thread(_engine(request).voice_sample, id, catalog)
    except Exception as exc:
        log.warning("voice sample %s: %s", id, exc)
        raise HTTPException(502, "the voice server couldn't play that voice") from None
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "private, max-age=86400"})


@router.post("/voices/use", dependencies=[Depends(_auth)])
async def voice_use(request: Request):
    """A catalog voice set up as a ready one (rendered once, about three seconds): its profile."""
    wanted = str((await request.json()).get("id") or "")
    try:
        return await _engine(request)._voice(wanted) or _missing()
    except EngineError as exc:
        raise HTTPException(422, str(exc)) from None


@router.post("/voices/clone", dependencies=[Depends(_auth)])
async def voice_clone(request: Request, recording: UploadFile = File(...), name: str = Form("")):
    """A voice cloned from a recording (audio, or a video's sound): one of the ready voices from then on."""
    engine = _engine(request)
    if not engine.m.tts or not engine.m.tts.clonable:
        raise HTTPException(503, "voices can't be cloned here")
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / f"recording{Path(recording.filename or '').suffix or '.bin'}"
        path.write_bytes(await recording.read())
        try:
            return await engine._clone_from(path, name.strip() or "My voice")
        except (EngineError, dub.DubError) as exc:
            raise HTTPException(422, str(exc).replace("in the video ", "in the recording ")) from None


@router.post("/jobs", dependencies=[Depends(_auth)])
async def submit(request: Request):
    engine = _engine(request)
    form = await request.form(max_files=40, max_part_size=MAX_UPLOAD)
    task = str(form.get("task") or "")
    try:
        params = json.loads(str(form.get("params") or "{}"))
    except ValueError:
        raise HTTPException(422, "params must be JSON") from None
    files: dict[str, list[tuple[str, bytes]]] = {}
    for key, value in form.multi_items():
        if hasattr(value, "read") and hasattr(value, "filename"):
            files.setdefault(key, []).append((value.filename or key, await value.read()))
    try:
        job = engine.start(task, params if isinstance(params, dict) else {}, files)
    except EngineError as exc:
        raise HTTPException(422, str(exc)) from None
    return {"id": job.id}


@router.get("/jobs/{jid}", dependencies=[Depends(_auth)])
async def status(request: Request, jid: str):
    job = _engine(request).jobs.get(jid) or _missing()
    return job.info()


@router.get("/jobs/{jid}/files/{n}", dependencies=[Depends(_auth)])
async def file(request: Request, jid: str, n: int):
    job = _engine(request).jobs.get(jid) or _missing()
    if not 0 <= n < len(job.files):
        raise HTTPException(404, "no such file")
    f = job.files[n]
    return FileResponse(f["path"], media_type=f["mime"], filename=f["name"])


@router.delete("/jobs/{jid}", dependencies=[Depends(_auth)])
async def cancel(request: Request, jid: str):
    engine = _engine(request)
    job = engine.jobs.get(jid) or _missing()
    engine.cancel(job)
    return {"ok": True}


@router.post("/faces", dependencies=[Depends(_auth)])
async def faces(request: Request, frames: list[UploadFile] = File(...)):
    try:
        return await _engine(request).faces([(f.filename or "frame.jpg", await f.read()) for f in frames[:16]])
    except EngineError as exc:
        raise HTTPException(503, str(exc)) from None
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"the face service didn't answer ({type(exc).__name__})") from None


def _missing():
    raise HTTPException(404, "no such job (the assistant may have restarted)")

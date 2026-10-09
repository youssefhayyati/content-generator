"""FlowAI Sound: voices, listening and original music for the studio, on a plain CPU.

  GET  /health          what's loaded, what's offered
  GET  /v1/voices       the voices, with the line each one reads as a sample
  POST /v1/speech       {text, voice, speed, timings} → WAV (base64) + every word's start and end
  POST /v1/transcribe   WAV body (?language=fr) → text, segments and word timings
  GET  /v1/moods        the composer's moods
  POST /v1/music        {mood, seconds, bpm, key, seed, energy} → WAV (base64) + what was written

The box this runs on is small, so models load on first use, one job runs at a time, and a model
nobody has used for a few minutes is unloaded to give its memory back.
"""

from __future__ import annotations

import base64
import ctypes
import gc
import io
import os
import threading
import time

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from scipy.signal import resample_poly

import music
from align import align
from voices import SAMPLES, VOICES, WHISPER_LANG, by_id

MODELS = os.environ.get("MODELS", "/models")
IDLE = int(os.environ.get("IDLE_UNLOAD_SECONDS", "240"))
# How many models may sit in memory at once. One by default: on a small shared box the voice
# (~650 MB) and the listener (~300 MB) take turns rather than add up.
RESIDENT = int(os.environ.get("MAX_RESIDENT_MODELS", "1"))
WHISPER_SIZE = os.environ.get("WHISPER_MODEL", "base")
THREADS = int(os.environ.get("THREADS", "2"))

app = FastAPI(title="FlowAI Sound")
work = threading.Lock()  # one heavy job at a time: two cores don't share well


class Lazy:
    """A model that loads when first needed and lets go of its memory when left alone."""

    def __init__(self, name, load):
        self.name = name
        self._load = load
        self.model = None
        self.used = 0.0

    def get(self):
        if self.model is None:
            # Make room first: the least recently used model goes when the box allows only so many.
            others = sorted((m for m in MODELS_LOADED if m is not self and m.model is not None), key=lambda m: m.used)
            while others and len(others) >= RESIDENT:
                others.pop(0).unload()
            self.model = self._load()
        self.used = time.time()
        return self.model

    def unload(self):
        if self.model is not None:
            self.model = None
            _release()

    def idle(self, seconds: int) -> bool:
        if self.model is not None and time.time() - self.used > seconds:
            self.model = None
            return True
        return False


def _kokoro():
    import onnxruntime as ort
    from kokoro_onnx import Kokoro

    options = ort.SessionOptions()
    options.intra_op_num_threads = THREADS
    # Don't busy-wait between runs: on two cores, a spinning thread starves whoever's next
    # (the reel render, usually).
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    options.add_session_config_entry("session.inter_op.allow_spinning", "0")
    session = ort.InferenceSession(f"{MODELS}/kokoro-v1.0.onnx", options, providers=["CPUExecutionProvider"])
    return Kokoro.from_session(session, f"{MODELS}/voices-v1.0.bin")


def _whisper():
    from faster_whisper import WhisperModel

    return WhisperModel(WHISPER_SIZE, device="cpu", compute_type="int8", cpu_threads=THREADS, download_root=f"{MODELS}/whisper")


kokoro = Lazy("voice", _kokoro)
whisper = Lazy("listen", _whisper)
MODELS_LOADED = [kokoro, whisper]


try:
    _libc = ctypes.CDLL("libc.so.6")
except OSError:
    _libc = None


def _release():
    """Give freed memory back to the system, not just to Python's allocator."""
    gc.collect()
    if _libc:
        _libc.malloc_trim(0)


def _janitor():
    while True:
        time.sleep(20)
        with work:
            freed = [m.idle(IDLE) for m in (kokoro, whisper)]
        if any(freed):
            _release()


threading.Thread(target=_janitor, daemon=True).start()


def _wav(samples: np.ndarray, rate: int) -> str:
    buf = io.BytesIO()
    sf.write(buf, samples, rate, format="WAV", subtype="PCM_16")
    return base64.b64encode(buf.getvalue()).decode()


def _trim(samples: np.ndarray, rate: int, keep: float = 0.08) -> np.ndarray:
    """Cut the silence before the first word and after the last, keeping a breath of it."""
    loud = np.flatnonzero(np.abs(samples) > 0.01)
    if loud.size == 0:
        return samples
    pad = int(keep * rate)
    return samples[max(0, loud[0] - pad): min(len(samples), loud[-1] + pad)]


def _heard(audio16: np.ndarray, language: str | None, prompt: str | None = None, vad: bool = False):
    segments, info = whisper.get().transcribe(
        audio16, language=language, word_timestamps=True, initial_prompt=prompt, vad_filter=vad, beam_size=5,
    )
    segments = list(segments)
    words = [{"text": w.word.strip(), "start": float(w.start), "end": float(w.end)} for s in segments for w in (s.words or []) if w.word.strip()]
    return segments, info, words


@app.get("/health")
def health():
    return {
        "ok": True,
        "loaded": {"voice": kokoro.model is not None, "listen": whisper.model is not None},
        "voices": len(VOICES),
        "whisper": WHISPER_SIZE,
        "moods": list(music.MOODS),
    }


@app.get("/v1/voices")
def voices():
    return [{**v, "sample": SAMPLES[v["lang"]]} for v in VOICES]


class SpeechIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    voice: str = "af_heart"
    speed: float = Field(1.0, ge=0.5, le=1.6)
    timings: bool = True


@app.post("/v1/speech")
def speech(body: SpeechIn):
    v = by_id(body.voice)
    if not v:
        raise HTTPException(404, f"No voice called {body.voice}.")
    text = " ".join(body.text.split())
    with work:
        samples, rate = kokoro.get().create(text, voice=v["id"], speed=body.speed, lang=v["lang"])
        samples = _trim(np.asarray(samples, dtype=np.float32), rate)
        duration = len(samples) / rate
        words = []
        if body.timings:
            audio16 = resample_poly(samples, 16000, rate).astype(np.float32)
            _, _, heard = _heard(audio16, WHISPER_LANG.get(v["lang"]), prompt=text[:600])
            words = align(text, heard, duration)
        audio = _wav(samples, rate)
    _release()
    return {"sample_rate": rate, "duration": round(duration, 3), "audio": audio, "words": words, "voice": v["id"], "lang": v["lang"]}


@app.post("/v1/transcribe")
async def transcribe(request: Request, language: str | None = None):
    data = await request.body()
    if not data:
        raise HTTPException(422, "Send the audio as a WAV body.")
    try:
        audio, rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception as e:  # noqa: BLE001 - anything soundfile can't read is the caller's to fix
        raise HTTPException(422, f"That isn't audio I can read: {e}")
    audio = audio.mean(axis=1)
    if rate != 16000:
        audio = resample_poly(audio, 16000, rate).astype(np.float32)

    def run():
        with work:
            segments, info, words = _heard(audio, language or None, vad=len(audio) > 16000 * 45)
        _release()
        return {
            "language": info.language,
            "duration": round(len(audio) / 16000, 3),
            "text": " ".join(s.text.strip() for s in segments).strip(),
            "segments": [{"start": round(s.start, 3), "end": round(s.end, 3), "text": s.text.strip()} for s in segments],
            "words": [{"text": w["text"], "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in words],
        }

    return await run_in_threadpool(run)


@app.get("/v1/moods")
def moods():
    return music.moods()


class MusicIn(BaseModel):
    mood: str = "golden-hour"
    seconds: float = Field(30, ge=5, le=180)
    bpm: float | None = Field(None, ge=50, le=170)
    key: str | None = None
    seed: int | None = None
    energy: float = Field(0.6, ge=0, le=1)


@app.post("/v1/music")
def compose(body: MusicIn):
    if body.mood not in music.MOODS:
        raise HTTPException(404, f"No mood called {body.mood}.")
    with work:
        samples, meta = music.compose(body.mood, body.seconds, body.bpm, body.key, body.seed, body.energy)
        duration = round(len(samples) / music.SR, 3)
        audio = _wav(samples, music.SR)
        del samples
    _release()
    return {"sample_rate": music.SR, "duration": duration, "audio": audio, "meta": meta}

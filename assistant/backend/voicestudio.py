"""Speech from a VoiceStudio server instead of this PC's GPU.

VoiceStudio runs the same OmniVoice model behind an OpenAI-style API (POST /v1/audio/speech),
e.g. on a RunPod GPU. Asked for "pcm" it returns raw 24 kHz 16-bit mono, the format the web UI
plays, so a sentence goes straight through. On an L40 a five-second sentence takes about 0.4 s,
against about 4 s with OmniVoice on a GTX 1660 Ti. It also means the agent can run on a machine
without a GPU for speech (FLOWAI_INTEGRATION.md, "Where the agent runs").

Voices: a sentence only sounds like the one before if it is cloned from the same recording, which
is what a VoiceStudio voice profile holds. Any other voice ("alloy" and the other OpenAI names,
"default", even an id the server doesn't know, which it accepts all the same) gets OmniVoice's
default: a new random voice for every request. So voices are checked against the server's
profiles, and a voice from its catalog (1,100 described voices, "archetypes") becomes a profile
before it is used: VoiceStudio renders its sample once, and asking again returns the same profile.

A video has a voice of its own (session.py, video_voice): match finds the voices that fit a
description of it ("warm young female, upbeat, for an ad") among the ready ones and the catalog.
"""

import io
import logging
import re
import threading
import time
import wave

import httpx
import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 24000
OPENAI_VOICES = {"alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse",
                 "marin", "cedar", "default"}
CATALOG_SHOWN = 60
SAMPLE_SECONDS = 12  # a preview is the start of the voice's recording
MATCHES_SHOWN = 12

# Describing a voice (match): everyday words in the catalog's own (its descriptions read "female, young
# adult, moderate pitch, american accent"; its uses are narration, advertisement, social…)
SYNONYMS = {"man": "male", "men": "male", "guy": "male", "masculine": "male", "boy": "male",
            "woman": "female", "women": "female", "girl": "female", "lady": "female", "feminine": "female",
            "deep": "low", "old": "elderly", "older": "elderly", "senior": "elderly", "kid": "child",
            "teen": "teenager", "youthful": "young", "uk": "british", "us": "american",
            "ad": "advertisement", "ads": "advertisement", "advert": "advertisement",
            "commercial": "advertisement", "promo": "advertisement", "promotional": "advertisement",
            "marketing": "advertisement", "narrator": "narration", "storyteller": "narration",
            "storytelling": "narration", "tiktok": "social", "instagram": "social", "reel": "social",
            "explainer": "informative", "tutorial": "informative", "educational": "informative",
            "chatty": "conversational", "casual": "conversational"}
FILLER = {"a", "an", "the", "and", "or", "with", "for", "of", "in", "to", "voice", "voices", "pitch", "accent",
          "tone", "sounding", "speaker", "who", "that", "is", "very", "bit", "slightly", "video"}
USE_RANK = {"advertisement": 2, "social": 2, "narration": 2, "characters": 0, "entertainment": 0}  # others 1


def _gender(words: list[str]) -> str | None:
    return "female" if "female" in words else "male" if "male" in words else None


def _first_sentence(text: str) -> str:
    text = " ".join(str(text or "").split())
    return re.split(r"(?<=[.!?])\s", text, maxsplit=1)[0]


def _profile(p: dict) -> dict:
    """A profile as the page shows it."""
    tag = str(p.get("personality") or "")
    return {"id": p["id"], "name": p.get("name") or p["id"],
            "description": _first_sentence(p.get("description")) or p.get("instruct") or "",
            "language": p.get("language") or "",
            "archetype": tag.removeprefix("archetype:") if tag.startswith("archetype:") else None}


def _archetype(a: dict) -> dict:
    return {"id": a["id"], "name": a["name"], "description": a.get("instruct") or "", "language": a.get("language") or "",
            "use": a.get("use_case") or "", "featured": bool(a.get("is_featured"))}


def _wav(data: bytes) -> np.ndarray:
    """16-bit WAV -> 24 kHz float32 mono."""
    with wave.open(io.BytesIO(data)) as w:
        rate, channels, frames = w.getframerate(), w.getnchannels(), w.readframes(w.getnframes())
    audio = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    if rate != SAMPLE_RATE:
        n = int(len(audio) * SAMPLE_RATE / rate)
        audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
    return audio


class VoiceStudioTTS:
    """Same interface as tts.TTSEngine: synthesize(text, voice) -> 24 kHz float32 audio, and the
    voice calls below (all blocking: called in a thread)."""

    choosable = True  # the user can pick the voice

    def __init__(self, url: str, api_key: str, voice: str, speed: float = 1.0, model: str = "omnivoice"):
        self.http = httpx.Client(base_url=url.rstrip("/"), timeout=60,
                                 headers={"Authorization": f"Bearer {api_key}"} if api_key else None)
        self.speed, self.model = speed, model
        self._catalog: list[dict] | None = None
        self._catalog_lock = threading.Lock()
        t0 = time.perf_counter()
        self.default = self._default(voice)
        self._speech("Warming up.", self.default["id"])  # the server loads the model on its first request (about a minute)
        log.info("TTS: VoiceStudio at %s, ready in %.1f s; voice %s (%s)", url, time.perf_counter() - t0,
                 self.default["name"], self.default["id"])

    def _default(self, wanted: str) -> dict:
        """TTS_VOICE as a profile: a profile's id or name, or a catalog voice's id. Otherwise the
        server's oldest profile (its demo voice on a fresh install), which stays put as more are added."""
        profiles = sorted(self.http.get("/profiles").raise_for_status().json(), key=lambda p: p.get("created_at") or 0)
        wanted = wanted.strip()
        if wanted.lower() in OPENAI_VOICES:
            log.warning("TTS_VOICE=%s gives a different voice every sentence on VoiceStudio; using a profile instead",
                        wanted)
        elif wanted:
            for p in profiles:
                if wanted == p["id"] or wanted.lower() == str(p.get("name", "")).lower():
                    return _profile(p)
            try:
                return self.adopt(wanted)
            except httpx.HTTPError:
                log.warning("TTS_VOICE=%s is neither a VoiceStudio profile nor a catalog voice", wanted)
        if profiles:
            return _profile(profiles[0])
        log.warning("VoiceStudio has no voice profiles: each sentence gets a different voice until one is picked")
        return {"id": "default", "name": "VoiceStudio default", "description": "A different voice each sentence",
                "language": "", "archetype": None}

    def _speech(self, text: str, voice: str) -> np.ndarray:
        r = self.http.post("/v1/audio/speech", json={"model": self.model, "input": text, "voice": voice,
                                                     "speed": self.speed, "response_format": "pcm"})
        r.raise_for_status()
        return np.frombuffer(r.content, dtype="<i2").astype(np.float32) / 32768.0

    def synthesize(self, text: str, voice: str | None = None) -> np.ndarray:
        for attempt in (1, 2):
            try:
                return self._speech(text, voice or self.default["id"])
            except httpx.HTTPError as exc:
                log.warning("VoiceStudio speech failed (attempt %d): %s", attempt, exc)
        return np.zeros(0, dtype=np.float32)  # the words still show on screen

    # --- choosing a voice -------------------------------------------------------------

    def profiles(self) -> list[dict]:
        """The server's voices, oldest first."""
        found = self.http.get("/profiles").raise_for_status().json()
        return [_profile(p) for p in sorted(found, key=lambda p: p.get("created_at") or 0)]

    def catalog(self, q: str = "", lang: str = "", exclude: set[str] = frozenset()) -> tuple[list[dict], int, list[str]]:
        """Catalog voices matching every word of q (by its start: "brit" finds british, "male" not
        female) in their name, description and use; the featured ones without q or lang. Returns
        the first CATALOG_SHOWN, how many matched, and the catalog's languages."""
        voices = self._load_catalog()
        words = re.findall(r"\w+", q.lower())
        found = []
        for v in voices:
            if v["id"] in exclude or (lang and v["language"] != lang):
                continue
            if words:
                have = re.findall(r"\w+", f'{v["name"]} {v["description"]} {v["use"]} {v["language"]}'.lower())
                if not all(any(h.startswith(w) for h in have) for w in words):
                    continue
            elif not v["featured"] and not lang:
                continue
            found.append(v)
        found.sort(key=lambda v: not v["featured"])
        languages = sorted({v["language"] for v in voices if v["language"]}, key=lambda x: (x != "English", x))
        return found[:CATALOG_SHOWN], len(found), languages

    def _load_catalog(self) -> list[dict]:
        with self._catalog_lock:  # it doesn't change while the server runs: read it once
            if self._catalog is None:
                voices, offset = [], 0
                while True:
                    page = self.http.get("/archetypes", params={"limit": 500, "offset": offset}).raise_for_status().json()
                    voices += [_archetype(a) for a in page["items"]]
                    offset += 500
                    if offset >= page["total"] or not page["items"]:
                        break
                self._catalog = voices
            return self._catalog

    def find(self, wanted: str) -> tuple[dict, bool] | None:
        """A voice by its profile id or name, or its catalog id, and whether it's from the catalog."""
        wanted = wanted.strip()
        for p in self.profiles():
            if wanted == p["id"] or wanted.lower() == p["name"].lower():
                return p, False
        v = next((v for v in self._load_catalog() if v["id"] == wanted), None)
        return (v, True) if v else None

    def match(self, description: str, lang: str = "", limit: int = MATCHES_SHOWN) -> list[dict]:
        """The voices that best fit a description ("warm young female, upbeat, for an ad"), best first:
        the ready ones and the catalog's, each with catalog true or false. A gender asked for is a must,
        and so is the language when some voices have it; every other word counts towards the fit.
        Whispering voices only when asked for."""
        ready = self.profiles()
        taken = {v["archetype"] for v in ready if v["archetype"]}
        voices = [{**v, "catalog": False} for v in ready] + \
                 [{**v, "catalog": True} for v in self._load_catalog() if v["id"] not in taken]
        said = re.findall(r"\w+", description.lower())
        words, very = [SYNONYMS.get(w, w) for w in said if w not in FILLER], "very" in said
        gender = "female" if "female" in words else "male" if "male" in words else None
        if lang and any(v["language"] == lang for v in voices):
            voices = [v for v in voices if v["language"] == lang]
        scored = []
        for v in voices:
            have = re.findall(r"\w+", f'{v["name"]} {v["description"]} {v.get("use", "")} {v["language"]}'.lower())
            if gender and _gender(have) not in (gender, None):
                continue
            if "whisper" in have and "whisper" not in words:  # no one wants a whispered ad by surprise
                continue
            score = sum(any(h.startswith(w) for h in have) for w in words)
            # Between equals: "low pitch" when asked for low (not "very low"), then a voice for this kind of
            # video (narration, ads, social) before one for characters, then the featured ones
            off = "very" in have and not very
            scored.append((score, not off, USE_RANK.get(v.get("use"), 1), v.get("featured", False), not v["catalog"], v))
        scored.sort(key=lambda s: s[:5], reverse=True)
        return [s[-1] for s in scored[:limit]]

    def adopt(self, archetype: str) -> dict:
        """A catalog voice as a profile: rendered the first time (about 3 s), the same one after that."""
        pid = self.http.post(f"/archetypes/{archetype}/use").raise_for_status().json()["profile_id"]
        return _profile(self.http.get(f"/profiles/{pid}").raise_for_status().json())

    def sample(self, voice: str | None = None, archetype: str | None = None) -> np.ndarray:
        """How a voice sounds: a profile's own recording, or a catalog voice's preview (rendered the
        first time it is asked for)."""
        path = f"/archetypes/{archetype}/preview" if archetype else f"/profiles/{voice or self.default['id']}/audio"
        r = self.http.get(path, timeout=120)
        r.raise_for_status()
        return _wav(r.content)[: SAMPLE_SECONDS * SAMPLE_RATE]

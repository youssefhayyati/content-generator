"""OmniVoice TTS (k2-fsa) with a fixed voice across sentences."""

import difflib
import hashlib
import io
import json
import logging
import re
import threading
from collections.abc import Callable

import numpy as np
import soundfile as sf
import torch
from omnivoice import OmniVoice, VoiceClonePrompt

from .config import ROOT

log = logging.getLogger(__name__)

SAMPLE_RATE = 24000
VOICES_DIR = ROOT / "voices"
REFERENCE_TEXT = "Hello, it is nice to meet you. I am your assistant, and I am happy to help you with anything today."
DESIGN_ATTEMPTS = 8


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


class TTSEngine:
    """One voice, designed from TTS_VOICE_INSTRUCT or cloned from TTS_REF_AUDIO: nothing to pick
    (voicestudio.py offers a choice). The voice calls match VoiceStudioTTS's. Voices cloned from a
    recording (clone) are kept in voices/ as cloned-<key>.pt with a .json naming them."""

    choosable = False
    clonable = True

    def __init__(self, model_id: str, device: str, dtype: torch.dtype, num_step: int, speed: float,
                 voice_instruct: str, ref_audio: str = "", ref_text: str = "",
                 transcribe: Callable[[np.ndarray], str] | None = None):
        """`transcribe` (24 kHz audio -> text) is used to verify a designed voice is intelligible."""
        self.model = OmniVoice.from_pretrained(model_id, device_map=device, dtype=dtype)
        self.num_step = num_step
        self.speed = speed
        self.transcribe = transcribe
        self.lock = threading.Lock()  # one synthesis at a time on the GPU
        self.voice = self._load_voice(voice_instruct, ref_audio, ref_text)
        self.default = {"id": "local", "name": "This computer’s voice", "language": "", "archetype": None,
                        "description": "Cloned from your recording" if ref_audio else voice_instruct}
        self.clones: dict[str, tuple[dict, VoiceClonePrompt]] = {}  # id -> (profile, prompt)
        for about in sorted(VOICES_DIR.glob("cloned-*.json")):
            try:
                profile = json.loads(about.read_text(encoding="utf-8"))
                self.clones[profile["id"]] = profile, VoiceClonePrompt.load(str(about.with_suffix(".pt")))
            except Exception as exc:
                log.warning("cloned voice %s couldn't be loaded: %s", about.name, exc)
        self.synthesize("Warming up.")  # first call pays CUDA init costs
        log.info("TTS loaded (%s)", model_id)

    def _load_voice(self, instruct: str, ref_audio: str, ref_text: str) -> VoiceClonePrompt:
        """Without a fixed prompt OmniVoice picks a new random voice per call, so we
        always synthesize from a voice-clone prompt: either the user's reference clip
        or a reference we design once from the instruct text and cache on disk."""
        if ref_audio:
            return self.model.create_voice_clone_prompt(ref_audio=ref_audio, ref_text=ref_text)

        key = hashlib.sha1(f"{instruct}|{self.model.dtype}".encode()).hexdigest()[:10]
        prompt_path = VOICES_DIR / f"designed-{key}.pt"
        if prompt_path.exists():
            return VoiceClonePrompt.load(str(prompt_path))

        VOICES_DIR.mkdir(exist_ok=True)
        wav_path = VOICES_DIR / f"designed-{key}.wav"
        sf.write(wav_path, self._design(instruct), SAMPLE_RATE)
        prompt = self.model.create_voice_clone_prompt(ref_audio=str(wav_path), ref_text=REFERENCE_TEXT)
        prompt.save(str(prompt_path))
        return prompt

    def _design(self, instruct: str) -> np.ndarray:
        """Voice design is stochastic and sometimes yields mumbling; since every later
        sentence clones this reference, retry with new seeds until it transcribes well."""
        best, best_score = None, -1.0
        for seed in range(DESIGN_ATTEMPTS):
            torch.manual_seed(seed)
            audio = self.model.generate(text=REFERENCE_TEXT, instruct=instruct, num_step=32)[0]
            if self.transcribe is None:
                return audio
            heard = self.transcribe(audio)
            score = difflib.SequenceMatcher(None, _words(REFERENCE_TEXT), _words(heard)).ratio()
            log.info("Designing voice %r, attempt %d: intelligibility %.2f", instruct, seed + 1, score)
            if score > best_score:
                best, best_score = audio, score
            if score >= 0.9:
                break
        if best_score < 0.9:
            log.warning("Best designed voice only scored %.2f; consider TTS_REF_AUDIO", best_score)
        return best

    def synthesize(self, text: str, voice: str | None = None, seconds: float | None = None) -> np.ndarray:
        """Returns float32 mono audio at 24 kHz, in the one voice or a cloned one. seconds is
        VoiceStudio's: here a dub's speech is fitted to its video afterwards (dub.fit)."""
        prompt = self.clones[voice][1] if voice in self.clones else self.voice
        with self.lock, torch.inference_mode():
            audio = self.model.generate(
                text=text, voice_clone_prompt=prompt, num_step=self.num_step, speed=self.speed
            )[0]
        return np.asarray(audio, dtype=np.float32)

    def clone(self, name: str, wav: bytes, text: str = "") -> dict:
        """A voice cloned from a recording (a WAV of one person speaking), kept in voices/."""
        key = hashlib.sha1(wav).hexdigest()[:10]
        if f"clone-{key}" in self.clones:
            return self.clones[f"clone-{key}"][0]
        VOICES_DIR.mkdir(exist_ok=True)
        path = VOICES_DIR / f"cloned-{key}.wav"
        path.write_bytes(wav)
        text = text or self.listen(wav)
        with self.lock:
            prompt = self.model.create_voice_clone_prompt(ref_audio=str(path), ref_text=text)
        prompt.save(str(path.with_suffix(".pt")))
        profile = {"id": f"clone-{key}", "name": name, "description": "Cloned from a recording", "language": "",
                   "archetype": None, "cloned": True}
        path.with_suffix(".json").write_text(json.dumps(profile, ensure_ascii=False), encoding="utf-8")
        self.clones[profile["id"]] = profile, prompt
        return profile

    def listen(self, wav: bytes) -> str:
        """What a recording says, heard by the ASR (English only); empty without it."""
        if self.transcribe is None:
            return ""
        audio, rate = sf.read(io.BytesIO(wav), dtype="float32", always_2d=True)
        audio = audio.mean(axis=1)
        if rate != SAMPLE_RATE:
            n = int(len(audio) * SAMPLE_RATE / rate)
            audio = np.interp(np.linspace(0, len(audio) - 1, n), np.arange(len(audio)), audio).astype(np.float32)
        return self.transcribe(audio)

    def profiles(self) -> list[dict]:
        return [self.default, *(profile for profile, _ in self.clones.values())]

    def catalog(self, q: str = "", lang: str = "", exclude: set[str] = frozenset()) -> tuple[list[dict], int, list[str]]:
        return [], 0, []

    def find(self, wanted: str) -> tuple[dict, bool] | None:
        wanted = wanted.strip()
        found = next((v for v in self.profiles() if wanted == v["id"] or wanted.lower() == v["name"].lower()), None)
        return (found, False) if found else None

    def match(self, description: str, lang: str = "", limit: int = 0) -> list[dict]:
        return [{**v, "catalog": False} for v in self.profiles()]

    def adopt(self, archetype: str) -> dict:
        raise ValueError("voices can only be picked with a VoiceStudio server (VOICESTUDIO_URL)")

    def sample(self, voice: str | None = None, archetype: str | None = None) -> np.ndarray:
        return self.synthesize(REFERENCE_TEXT, voice)


_MARKDOWN = re.compile(r"[*_`#>|~]+|\[([^\]]*)\]\([^)]*\)")


def speakable(text: str) -> str:
    """Strips markdown the LLM may still emit so it isn't read aloud."""
    return re.sub(r"\s+", " ", _MARKDOWN.sub(lambda m: m.group(1) or " ", text)).strip()


class SentenceChunker:
    """Splits a token stream into speakable chunks as early as possible."""

    END = re.compile(r"(.+?[.!?。！？…]+[\"')\]]*)(\s+|$)", re.S)

    def __init__(self, max_chars: int = 220, first_clause_chars: int = 20):
        self.buf = ""
        self.max_chars = max_chars
        # Speak the first clause as soon as it's complete so audio starts sooner
        self.first_clause = re.compile(rf"(.{{{first_clause_chars},}}?[,;:，、—–])\s", re.S)

    def push(self, delta: str) -> list[str]:
        self.buf += delta
        out = []
        while True:
            m = self.END.match(self.buf)
            if m and m.group(2):  # require whitespace after the punctuation
                out.append(m.group(1))
                self.buf = self.buf[m.end():]
                continue
            if self.first_clause and not out and (m := self.first_clause.match(self.buf)):
                out.append(m.group(1))
                self.buf = self.buf[m.end():]
                continue
            if "\n" in self.buf:
                line, self.buf = self.buf.split("\n", 1)
                if line.strip():
                    out.append(line)
                continue
            if len(self.buf) > self.max_chars:
                cut = max(self.buf.rfind(", ", 0, self.max_chars), self.buf.rfind(" ", 0, self.max_chars))
                cut = cut if cut > 0 else self.max_chars
                out.append(self.buf[: cut + 1])
                self.buf = self.buf[cut + 1:]
                continue
            break
        if out:
            self.first_clause = None
        return [s for s in (speakable(x) for x in out) if s]

    def flush(self) -> list[str]:
        rest, self.buf = speakable(self.buf), ""
        return [rest] if rest else []

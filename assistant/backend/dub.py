"""Dubbing and face swaps: the ffmpeg steps on this machine around the pod's models.

A dub makes a video say new words in its speaker's own voice, with lips that match:

1. The video's sound is taken out (24 kHz mono), and its speaker's voice is cloned from it: a voice
   of the same TTS that speaks for the assistant (voicestudio.py, or OmniVoice here, tts.py).
2. The new words are read in that voice, asked to last as long as the video (VoiceStudio's duration).
   A read that still runs long is sped up a little to fit.
   A shorter one is padded with silence, so the whole video stays.
3. A lip-sync model redraws the mouth to match the new speech: LatentSync, a service of its own
   (podjobs.py; content-generator/runpod/lipsync/). It works at 25 frames a second, so the video goes
   there at that rate.
4. If the video comes back without sound, the new speech is laid under it.

A face swap (the pod's face swap service: inswapper_128 in ONNX, podjobs.py) needs nothing here but a
smaller copy of a big video.
"""

import io
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

from .comfyui import ComfyError
from .reel import ffmpeg, probe

RATE = 24000  # the TTS's
LIPSYNC_FPS = 25  # what LatentSync is trained at
MAX_SIDE = 1920  # videos go to the pod at most this big: a reel (1080 x 1920) keeps its size
MAX_SECONDS = 60  # longer videos take too long on the pod (and too much memory)
REFERENCE_SECONDS = 20  # of the speaker's voice to clone from
MIN_REFERENCE_SECONDS = 3
MAX_SPEEDUP = 1.3  # a read longer than the video is sped up at most this much; past that, the video loops


class DubError(ComfyError):
    """A failure with a message the assistant can pass on to the user."""


def _run(cmd: list[str], what: str) -> bytes:
    proc = subprocess.run(cmd, capture_output=True, timeout=600)
    if proc.returncode != 0:
        err = proc.stderr.decode(errors="replace").strip()
        raise DubError(f"{what} failed: {err.splitlines()[-1] if err else 'no output'}")
    return proc.stdout


def check(path: Path) -> dict:
    """A video's size and length; refuses one too long to send to the pod."""
    info = probe(path)
    if not info.get("duration"):
        raise DubError("that video can't be read")
    if info["duration"] > MAX_SECONDS:
        raise DubError(f"the video is {info['duration']:.0f} seconds long; {MAX_SECONDS} at most")
    return info


def has_sound(path: Path) -> bool:
    proc = subprocess.run([ffmpeg(), "-hide_banner", "-i", str(path)], capture_output=True, text=True,
                          errors="replace", timeout=60)
    return " Audio: " in proc.stderr


def _wav(source: Path, args: list[str], what: str) -> bytes:
    """A 24 kHz mono WAV made by ffmpeg from a file. Written to a file, not a pipe: through a pipe
    ffmpeg can't go back to write the WAV's length in its header."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out.wav"
        _run([ffmpeg(), "-y", "-loglevel", "error", "-i", str(source), "-vn", *args, "-ac", "1", "-ar", str(RATE),
              "-c:a", "pcm_s16le", str(out)], what)
        return out.read_bytes()


def _rework(wav: bytes, args: list[str], what: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "in.wav"
        source.write_bytes(wav)
        return _wav(source, args, what)


def sound_of(path: Path) -> bytes:
    """What the video (or audio file) says, as a 24 kHz mono WAV."""
    if not has_sound(path):
        raise DubError("it has no sound")
    return _wav(path, [], "taking the sound out")


def reference(wav: bytes) -> bytes:
    """The start of the speaker's voice, silence trimmed off the front, to clone it from."""
    clip = _rework(wav, ["-af", f"silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:{REFERENCE_SECONDS}"],
                   "cutting the voice sample")
    if seconds(clip) < MIN_REFERENCE_SECONDS:
        raise DubError(f"there are only {seconds(clip):.0f} seconds of voice to clone from; "
                       f"{MIN_REFERENCE_SECONDS} at least")
    return clip


def seconds(wav: bytes) -> float:
    with wave.open(io.BytesIO(wav)) as w:
        return w.getnframes() / w.getframerate()


def samples(wav: bytes) -> np.ndarray:
    """A 16-bit mono WAV made here as float32 samples (at RATE)."""
    with wave.open(io.BytesIO(wav)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0


def for_pod(path: Path, fps: int | None = None, sound: bool = True) -> bytes:
    """The video as the pod gets it: at most MAX_SIDE pixels on its long side, H.264, at fps if given
    (else its own rate), with or without its sound."""
    scale = f"scale='if(gt(iw,ih),min({MAX_SIDE},iw),-2)':'if(gt(iw,ih),-2,min({MAX_SIDE},ih))'"
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "pod.mp4"
        _run([ffmpeg(), "-y", "-loglevel", "error", "-i", str(path), "-vf", scale + (f",fps={fps}" if fps else ""),
              "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
              *(["-c:a", "aac", "-b:a", "160k"] if sound else ["-an"]), "-movflags", "+faststart", str(out)],
             "preparing the video")
        return out.read_bytes()


def wav_bytes(audio: np.ndarray, rate: int = RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    return buf.getvalue()


def fit(audio: np.ndarray, video_seconds: float) -> tuple[bytes, float]:
    """The new speech as a WAV as long as the video, and how long the speech itself is. A read that
    runs a little long is sped up (up to MAX_SPEEDUP; longer still, the lip sync plays the video back
    and forth under it), a short one is padded with silence (the lip sync cuts the video to the sound)."""
    wav = wav_bytes(audio)
    if len(audio) / RATE > video_seconds * 1.03:
        tempo = min(len(audio) / RATE / video_seconds, MAX_SPEEDUP)
        wav = _rework(wav, ["-af", f"atempo={tempo:.4f}"], "fitting the speech to the video")
    speech = samples(wav)
    missing = round(video_seconds * RATE) - len(speech)
    if missing > 0:
        wav = wav_bytes(np.concatenate([speech, np.zeros(missing, dtype=np.float32)]))
    return wav, round(len(speech) / RATE, 2)


def with_sound(video: bytes, wav: bytes) -> bytes:
    """The pod's video with the new speech under it (when it came back silent)."""
    with tempfile.TemporaryDirectory() as tmp:
        src, speech, out = Path(tmp) / "in.mp4", Path(tmp) / "speech.wav", Path(tmp) / "out.mp4"
        src.write_bytes(video)
        if has_sound(src):
            return video
        speech.write_bytes(wav)
        _run([ffmpeg(), "-y", "-loglevel", "error", "-i", str(src), "-i", str(speech), "-map", "0:v", "-map", "1:a",
              "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(out)],
             "adding the speech to the video")
        return out.read_bytes()


def meta(video: bytes) -> dict:
    """Width, height and duration of a made video, for the platform check when it goes in a draft."""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "made.mp4"
        path.write_bytes(video)
        return probe(path)

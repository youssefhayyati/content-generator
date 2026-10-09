"""The composer: an original, licence-free track for every post.

A small generative engine, not a sample library. Each mood is a recipe: tempo range, keys,
chord progressions (as roman numerals, so they work in any key), and which instruments play
what. Every instrument is synthesised here: detuned-saw pads, an FM electric piano, plucked
strings (Karplus-Strong), FM bells, a few kinds of bass, and a drum kit. A seed picks the key,
tempo, progression and every small human imperfection, so the same seed always gives the same
track and every new seed a new one.

Signal flow: instruments → buses (drums, bass, chords, lead) → a reverb send → sidechain
(for the dance moods) → master: high-pass, glue compression, loudness, soft limiter, fades.
"""

from __future__ import annotations

import re

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
    "dorian": [0, 2, 3, 5, 7, 9, 10],
    "lydian": [0, 2, 4, 6, 7, 9, 11],
}
NUMERALS = {"i": 0, "ii": 1, "iii": 2, "iv": 3, "v": 4, "vi": 5, "vii": 6}

MOODS = {
    "golden-hour": {
        "label": "Golden hour",
        "detail": "Warm lo-fi: dusty electric piano, lazy drums, vinyl crackle.",
        "bpm": (76, 86), "scale": "major", "keys": ["Eb", "F", "Ab", "Db", "Bb"],
        "progressions": [["ii9", "V9", "Imaj9", "vi9"], ["Imaj9", "vi9", "ii9", "V9"], ["IVmaj9", "iii7", "ii9", "Imaj9"]],
        "chord_bars": 1, "swing": 0.58, "drums": "lofi", "chords": "keys", "lead": None, "bass": "soft",
        "reverb": 0.22, "lofi": True, "colors": ["#f5b04c", "#e0745a"],
    },
    "linen": {
        "label": "Linen",
        "detail": "Airy ambient: slow pads, a few plucked notes, lots of air.",
        "bpm": (62, 70), "scale": "major", "keys": ["D", "E", "A", "B", "Gb"],
        "progressions": [["Iadd9", "IVmaj7", "vi7", "IVmaj7"], ["Iadd9", "iii7", "IVmaj7", "IVmaj7"], ["IVmaj7", "Iadd9", "V", "vi7"]],
        "chord_bars": 2, "swing": 0.5, "drums": None, "chords": "pad", "lead": "pluck-sparse", "bass": "drone",
        "reverb": 0.48, "lofi": False, "colors": ["#ecebe6", "#a5b4fc"],
    },
    "atelier": {
        "label": "Atelier",
        "detail": "Bright acoustic: plucked strings, shaker and a walking bass.",
        "bpm": (92, 104), "scale": "major", "keys": ["G", "C", "D", "A", "F"],
        "progressions": [["I", "V", "vi", "IV"], ["vi", "IV", "I", "V"], ["I", "IV", "vi", "V"], ["IV", "I", "V", "vi"]],
        "chord_bars": 1, "swing": 0.54, "drums": "acoustic", "chords": "pad-soft", "lead": "pluck-arp", "bass": "walk",
        "reverb": 0.2, "lofi": False, "colors": ["#5ee39a", "#f5b04c"],
    },
    "pulse": {
        "label": "Pulse",
        "detail": "Upbeat house: four-on-the-floor, pumping chords, a bass that moves.",
        "bpm": (118, 124), "scale": "minor", "keys": ["A", "F", "G", "C", "D"],
        "progressions": [["i", "VI", "III", "VII"], ["i", "iv", "VI", "v"], ["VI", "VII", "i", "i"], ["i7", "iv7", "VImaj7", "v7"]],
        "chord_bars": 1, "swing": 0.5, "drums": "house", "chords": "stab", "lead": None, "bass": "offbeat",
        "reverb": 0.16, "lofi": False, "sidechain": 0.6, "colors": ["#6366f1", "#ff8fa3"],
    },
    "night-drive": {
        "label": "Night drive",
        "detail": "Synthwave: arpeggiated bass, wide pads, a big gated snare.",
        "bpm": (96, 106), "scale": "minor", "keys": ["E", "Gb", "A", "D", "C"],
        "progressions": [["i", "VI", "VII", "i"], ["i", "III", "VII", "VI"], ["VI", "VII", "i", "v"]],
        "chord_bars": 1, "swing": 0.5, "drums": "retro", "chords": "pad", "lead": "arp-saw", "bass": "arp8",
        "reverb": 0.3, "lofi": False, "sidechain": 0.3, "colors": ["#ff5f57", "#8b5cf6"],
    },
    "bloom": {
        "label": "Bloom",
        "detail": "Dreamy and cinematic: swelling strings, glass bells, soft timpani.",
        "bpm": (66, 74), "scale": "lydian", "keys": ["F", "C", "G", "Bb", "D"],
        "progressions": [["Imaj7", "II", "Imaj7", "vi7"], ["Iadd9", "II", "iii7", "II"], ["vi7", "IVmaj7", "Imaj7", "II"]],
        "chord_bars": 2, "swing": 0.5, "drums": "soft", "chords": "strings", "lead": "bells", "bass": "drone",
        "reverb": 0.45, "lofi": False, "colors": ["#b49cff", "#6ee7f2"],
    },
}


def moods() -> list[dict]:
    return [{"id": k, "label": m["label"], "detail": m["detail"], "bpm": list(m["bpm"]), "colors": m["colors"]} for k, m in MOODS.items()]


# --------------------------------------------------------------------------------------------
# Harmony
# --------------------------------------------------------------------------------------------

_CHORD = re.compile(r"^(?P<num>[ivIV]+)(?P<ext>maj7|maj9|add9|sus2|sus4|7|9|13)?$")


def chord_tones(symbol: str, steps: list[int]) -> list[int]:
    """Semitones above the key's root, stacked in thirds inside the scale."""
    m = _CHORD.match(symbol)
    if not m:
        raise ValueError(f"Unknown chord {symbol}")
    degree = NUMERALS[m["num"].lower()]
    ext = m["ext"] or ""
    stack = [0, 2, 4]
    if ext in ("7", "maj7"):
        stack.append(6)
    elif ext in ("9", "maj9", "13"):
        stack += [6, 8]
    elif ext == "add9":
        stack.append(8)
    if ext == "sus2":
        stack[1] = 1
    elif ext == "sus4":
        stack[1] = 3
    return [steps[(degree + s) % 7] + 12 * ((degree + s) // 7) for s in stack]


def voice(tones: list[int], root: int, center: int, prev: list[int] | None, lo: int, hi: int) -> list[int]:
    """Pick the inversion and octave closest to the previous chord: smooth voice leading."""
    base = [root + t for t in tones]
    candidates = []
    for inv in range(len(base)):
        notes = base[inv:] + [x + 12 for x in base[:inv]]
        for shift in (-36, -24, -12, 0, 12, 24):
            c = sorted(x + shift for x in notes)
            if c[0] >= lo and c[-1] <= hi:
                candidates.append(c)
    if not candidates:
        folded = []
        for x in base:
            while x < lo:
                x += 12
            while x > hi:
                x -= 12
            folded.append(x)
        return sorted(set(folded))

    def cost(c):
        if prev and len(prev) == len(c):
            return sum(abs(a - b) for a, b in zip(c, prev)) + 0.15 * abs(np.mean(c) - center)
        return abs(np.mean(c) - center)

    return min(candidates, key=cost)


def hz(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


# --------------------------------------------------------------------------------------------
# Building blocks
# --------------------------------------------------------------------------------------------

def _t(n: int) -> np.ndarray:
    return np.arange(n) / SR


def _sos(kind: str, cut, order: int = 2):
    nyq = SR / 2
    if isinstance(cut, (tuple, list)):
        cut = [min(max(c, 20), nyq * 0.95) / nyq for c in cut]
    else:
        cut = min(max(cut, 20), nyq * 0.95) / nyq
    return butter(order, cut, btype=kind, output="sos")


def lp(x, cut, order=2):
    return sosfilt(_sos("lowpass", cut, order), x, axis=-1)


def hp(x, cut, order=2):
    return sosfilt(_sos("highpass", cut, order), x, axis=-1)


def bp(x, lo, hi, order=2):
    return sosfilt(_sos("bandpass", (lo, hi), order), x, axis=-1)


def _polyblep(ph: np.ndarray, dt: float) -> np.ndarray:
    out = np.zeros_like(ph)
    a = ph < dt
    x = ph[a] / dt
    out[a] = x + x - x * x - 1
    b = ph > 1 - dt
    x = (ph[b] - 1) / dt
    out[b] = x * x + x + x + 1
    return out


def saw(f: float, n: int, phase: float = 0.0) -> np.ndarray:
    """A band-limited sawtooth (polyBLEP): bright without the aliasing hiss."""
    dt = f / SR
    ph = (phase + dt * np.arange(n)) % 1.0
    return 2 * ph - 1 - _polyblep(ph, dt)


def sine(f: float, n: int, phase: float = 0.0) -> np.ndarray:
    return np.sin(2 * np.pi * f * _t(n) + phase)


def fade(n: int, attack: float, hold: float, release: float, curve: float = 1.0) -> np.ndarray:
    """Attack to full, hold, then a smooth release to silence."""
    t = _t(n)
    env = np.ones(n)
    if attack > 0:
        env = np.minimum(1, t / attack) ** curve
    rel = t > hold
    if release > 0:
        env[rel] *= np.clip(1 - (t[rel] - hold) / release, 0, 1) ** 2
    return env


def place(bus: np.ndarray, x: np.ndarray, at: float, gain: float = 1.0, pan: float = 0.0) -> None:
    """Mix a mono sound into a stereo bus at a time, with constant-power panning."""
    i = int(round(at * SR))
    if i >= bus.shape[1] or i + len(x) <= 0:
        return
    if i < 0:
        x = x[-i:]
        i = 0
    n = min(len(x), bus.shape[1] - i)
    angle = (pan + 1) * np.pi / 4
    bus[0, i:i + n] += x[:n] * gain * np.cos(angle)
    bus[1, i:i + n] += x[:n] * gain * np.sin(angle)


def place_stereo(bus: np.ndarray, x: np.ndarray, at: float, gain: float = 1.0) -> None:
    i = int(round(at * SR))
    if i >= bus.shape[1]:
        return
    n = min(x.shape[1], bus.shape[1] - i)
    bus[:, i:i + n] += x[:, :n] * gain


# --------------------------------------------------------------------------------------------
# Instruments
# --------------------------------------------------------------------------------------------

def pad_note(f: float, dur: float, rng, attack: float, release: float, detune=(-9, -3, 4, 10)) -> np.ndarray:
    """A stereo pad voice: detuned saws, different on each side for width, plus a sine an octave below."""
    n = int((dur + release) * SR)
    sides = []
    for flip in (1, -1):
        x = sum(saw(f * 2 ** (flip * c / 1200), n, rng.random()) for c in detune) / len(detune)
        x += 0.22 * sine(f / 2, n, rng.random() * 6)
        sides.append(x)
    env = fade(n, attack, dur, release, curve=1.6)
    return np.vstack(sides) * env


def string_note(f: float, dur: float, rng, attack: float, release: float) -> np.ndarray:
    """Strings: a slower, darker pad with vibrato that grows in."""
    n = int((dur + release) * SR)
    t = _t(n)
    vib = 1 + 0.0035 * np.sin(2 * np.pi * 5.2 * t + rng.random() * 6) * np.minimum(1, t / 1.5)
    sides = []
    for flip in (1, -1):
        x = np.zeros(n)
        for c in (-6, 0, 7):
            fr = f * 2 ** (flip * c / 1200)
            ph = (rng.random() + np.cumsum(fr * vib) / SR) % 1.0
            x += 2 * ph - 1 - _polyblep(ph, fr / SR)
        sides.append(x / 3)
    return np.vstack(sides) * fade(n, attack, dur, release, curve=2.0)


def epiano(f: float, dur: float, vel: float) -> np.ndarray:
    """An FM electric piano: a sine bent by its own octave, a bright tine on the attack."""
    n = int((dur + 1.4) * SR)
    t = _t(n)
    index = (1.4 + 1.6 * vel) * np.exp(-t * 3.2) + 0.25
    tone = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * t))
    tine = 0.18 * vel * np.sin(2 * np.pi * f * 7.0 * t + 0.6 * np.sin(2 * np.pi * f * t)) * np.exp(-t * 18)
    env = np.exp(-t * 0.9) * (1 - np.exp(-t * 600))
    off = t > dur
    env[off] *= np.exp(-(t[off] - dur) * 7)
    return (tone + tine) * env * (0.55 + 0.45 * vel)


def pluck(f: float, dur: float, rng, bright: float = 0.6, decay: float = 0.996) -> np.ndarray:
    """A plucked string (Karplus-Strong), worked a period at a time so it stays fast."""
    period = max(2, int(round(SR / f)))
    n = int((dur + 1.6) * SR)
    burst = rng.uniform(-1, 1, period)
    burst = lp(burst, 1500 + 7000 * bright) if period > 12 else burst
    x = np.zeros(n)
    x[:period] = burst
    y = np.zeros(n + period + 1)
    g = decay ** (220.0 / max(f, 60))  # higher notes ring a little shorter
    for s in range(0, n, period):
        e = min(s + period, n)
        y[s + period + 1:e + period + 1] = x[s:e] + 0.5 * g * (y[s + 1:e + 1] + y[s:e])
    out = y[period + 1:]
    t = _t(n)
    off = t > dur + 0.4
    out[off] *= np.exp(-(t[off] - dur - 0.4) * 9)
    return out * 0.9


def bell(f: float, vel: float, length: float = 4.0) -> np.ndarray:
    """A glassy FM bell: inharmonic partials that shimmer out."""
    n = int(length * SR)
    t = _t(n)
    index = 2.6 * np.exp(-t * 1.6) * vel
    x = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * 3.5 * t))
    x += 0.35 * np.sin(2 * np.pi * f * 2.756 * t) * np.exp(-t * 2.5)
    return x * np.exp(-t * 1.1) * (1 - np.exp(-t * 900)) * vel * 0.6


def bass_note(f: float, dur: float, kind: str, vel: float) -> np.ndarray:
    n = int((dur + 0.06) * SR)
    t = _t(n)
    if kind in ("offbeat", "arp8"):
        x = 0.7 * lp(saw(f, n), 380 + 500 * vel) + 0.6 * np.sin(2 * np.pi * f * t)
    elif kind == "drone":
        ph = (f * t) % 1.0
        x = (np.abs(2 * ph - 1) * 2 - 1) * 0.8 + 0.4 * np.sin(2 * np.pi * f * t)
        x = lp(x, 500)
    else:
        x = np.sin(2 * np.pi * f * t) + 0.28 * np.sin(4 * np.pi * f * t) + 0.08 * np.sin(6 * np.pi * f * t)
    x = np.tanh(1.4 * x)
    attack = 0.25 if kind == "drone" else 0.006
    env = np.minimum(1, t / attack) * (0.72 + 0.28 * np.exp(-t * 6))
    tail = t > dur
    env[tail] *= np.clip(1 - (t[tail] - dur) / 0.06, 0, 1)
    return x * env * vel


def kick(vel: float, rng, soft: bool = False) -> np.ndarray:
    n = int(0.55 * SR)
    t = _t(n)
    f = 44 + (95 if soft else 125) * np.exp(-t * (24 if soft else 34))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (6.5 if soft else 7.5))
    click = hp(rng.uniform(-1, 1, n), 2500) * np.exp(-t * 400) * (0.15 if soft else 0.35)
    x = np.tanh(1.8 * (body + click))
    return (lp(x, 2400) if soft else x) * vel


def snare(vel: float, rng, tone: float = 185, snap: float = 1.0, length: float = 0.3) -> np.ndarray:
    n = int(length * SR)
    t = _t(n)
    body = 0.55 * np.sin(2 * np.pi * tone * t) * np.exp(-t * 32) + 0.25 * np.sin(2 * np.pi * tone * 1.47 * t) * np.exp(-t * 40)
    noise = bp(rng.uniform(-1, 1, n), 1600, 8000) * np.exp(-t * 17 / snap) * 0.85
    return (body + noise) * vel


def clap(vel: float, rng) -> np.ndarray:
    n = int(0.35 * SR)
    t = _t(n)
    noise = bp(rng.uniform(-1, 1, n), 900, 5000)
    env = np.zeros(n)
    for k, d in enumerate((0.0, 0.011, 0.022)):
        m = t >= d
        env[m] += np.exp(-(t[m] - d) * (180 if k < 2 else 16)) * (0.8 if k < 2 else 1.0)
    return noise * env * vel * 0.9


_METAL = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)


def hat(vel: float, rng, open_: bool = False) -> np.ndarray:
    n = int((0.45 if open_ else 0.09) * SR)
    t = _t(n)
    metal = sum(np.sign(np.sin(2 * np.pi * f * 1.62 * t + rng.random())) for f in _METAL) / 6
    x = hp(0.6 * metal + 0.7 * rng.uniform(-1, 1, n), 7200)
    return x * np.exp(-t * (9 if open_ else 65)) * vel * 0.32


def shaker(vel: float, rng) -> np.ndarray:
    n = int(0.11 * SR)
    t = _t(n)
    env = np.minimum(1, t / 0.012) * np.exp(-np.maximum(0, t - 0.012) * 45)
    return bp(rng.uniform(-1, 1, n), 4500, 11000) * env * vel * 0.4


def rim(vel: float, rng) -> np.ndarray:
    n = int(0.08 * SR)
    t = _t(n)
    return (np.sin(2 * np.pi * 1750 * t) * 0.6 + hp(rng.uniform(-1, 1, n), 3000) * 0.4) * np.exp(-t * 85) * vel * 0.5


def timpani(vel: float, rng, f: float = 62) -> np.ndarray:
    n = int(2.2 * SR)
    t = _t(n)
    fr = f * (1 + 0.06 * np.exp(-t * 8))
    x = np.sin(2 * np.pi * np.cumsum(fr) / SR) + 0.3 * lp(rng.uniform(-1, 1, n), 300) * np.exp(-t * 12)
    return x * np.exp(-t * 2.2) * (1 - np.exp(-t * 300)) * vel * 0.8


def swell(length: float, rng) -> np.ndarray:
    """A reversed cymbal: noise that rises into the next downbeat."""
    n = int(length * SR)
    t = _t(n)
    return hp(rng.uniform(-1, 1, n), 5000) * (t / length) ** 3 * 0.35


def crackle(n: int, rng, rate: float = 7.0) -> np.ndarray:
    """Vinyl: sparse dust clicks over a very quiet hiss."""
    x = np.zeros(n)
    count = rng.poisson(rate * n / SR)
    at = rng.integers(0, max(1, n - 40), count)
    amp = rng.uniform(0.05, 0.4, count) * rng.choice([-1, 1], count)
    for i, a in zip(at, amp):
        x[i:i + 3] += a * np.array([1.0, -0.6, 0.25])
    x = bp(x, 900, 9000)
    hiss = lp(hp(rng.standard_normal(n), 2000), 9000) * 0.012
    return x + hiss


# --------------------------------------------------------------------------------------------
# Effects
# --------------------------------------------------------------------------------------------

def reverb(x: np.ndarray, rng, seconds: float = 2.6, damp: float = 6500) -> np.ndarray:
    """Convolution with a made-up room: decaying stereo noise, darker as it fades."""
    n = int(seconds * SR)
    t = _t(n)
    env = np.exp(-t * 6.9 / seconds)
    ir = np.vstack([rng.standard_normal(n) * env, rng.standard_normal(n) * env])
    early = lp(ir, damp)
    late = lp(ir, damp * 0.35)
    mix = np.clip(t / seconds * 1.6, 0, 1)
    ir = early * (1 - mix) + late * mix
    ir = np.hstack([np.zeros((2, int(0.018 * SR))), ir])
    ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True)) + 1e-9
    return np.vstack([fftconvolve(x[0], ir[0])[: x.shape[1]], fftconvolve(x[1], ir[1])[: x.shape[1]]])


def pingpong(x: np.ndarray, delay: float, feedback: float = 0.38, repeats: int = 5) -> np.ndarray:
    out = np.zeros_like(x)
    d = int(delay * SR)
    mono = x.mean(axis=0)
    for k in range(1, repeats + 1):
        if k * d >= x.shape[1]:
            break
        side = k % 2
        out[side, k * d:] += lp(mono[: x.shape[1] - k * d], 4200) * feedback ** k
    return out


def pump(n: int, kicks: list[float], depth: float) -> np.ndarray:
    """Sidechain: everything ducks under each kick and breathes back."""
    imp = np.zeros(n)
    for k in kicks:
        i = int(k * SR)
        if 0 <= i < n:
            imp[i] = 1.0
    kernel = np.exp(-_t(int(0.32 * SR)) / 0.09)
    env = np.clip(fftconvolve(imp, kernel)[:n], 0, 1)
    return 1 - depth * env


def sweep_lp(x: np.ndarray, base: float, depth: float, rate: float, phase: float = 0.0, block: int = 1024) -> np.ndarray:
    """A low-pass whose cutoff drifts slowly: chords that breathe."""
    out = np.zeros_like(x)
    zi = None
    for s in range(0, x.shape[1], block):
        e = min(s + block, x.shape[1])
        cut = base * 2 ** (depth * np.sin(2 * np.pi * rate * (s / SR) + phase))
        sos = _sos("lowpass", cut, 2)
        if zi is None:
            zi = np.zeros((x.shape[0], sos.shape[0], 2))
        for c in range(x.shape[0]):
            out[c, s:e], zi[c] = sosfilt(sos, x[c, s:e], zi=zi[c])
    return out


# --------------------------------------------------------------------------------------------
# Composition
# --------------------------------------------------------------------------------------------

def compose(mood: str = "golden-hour", seconds: float = 30.0, bpm: float | None = None, key: str | None = None,
            seed: int | None = None, energy: float = 0.6) -> tuple[np.ndarray, dict]:
    """Write and render a track. Returns (samples × 2 float32, what was written)."""
    m = MOODS.get(mood) or MOODS["golden-hour"]
    mood = next(k for k, v in MOODS.items() if v is m)
    seed = int(seed if seed is not None else np.random.default_rng().integers(1, 2**31 - 1))
    rng = np.random.default_rng(seed)
    energy = float(np.clip(energy, 0.0, 1.0))
    seconds = float(np.clip(seconds, 5.0, 180.0))

    bpm = float(bpm or rng.integers(m["bpm"][0], m["bpm"][1] + 1))
    key = key if key in NAMES else str(rng.choice(m["keys"]))
    steps = SCALES[m["scale"]]
    root = 48 + NAMES.index(key)  # the key's root around C3
    progression = list(m["progressions"][int(rng.integers(0, len(m["progressions"])))])

    beat = 60.0 / bpm
    bar = 4 * beat
    step16 = beat / 4
    bars = max(3, int(round(seconds / bar)))
    total = int((seconds + 4.0) * SR)  # room for tails; trimmed at the end
    chord_bars = m["chord_bars"]

    # Which chord plays in each bar; the last one resolves home.
    plan = []
    for b in range(bars):
        plan.append(progression[(b // chord_bars) % len(progression)])
    tonic = "Iadd9" if m["scale"] in ("major", "lydian") and m["chords"] in ("pad", "strings") else ("I" if m["scale"] != "minor" else "i")
    if m["scale"] in ("major", "lydian") and m["chords"] == "keys":
        tonic = "Imaj9"
    plan[-1] = tonic

    intro = 0 if bars <= 4 else (2 if chord_bars == 2 or bars >= 12 else 1)
    outro = 1
    breakdown = range(bars // 2, bars // 2 + 2) if bars >= 16 else range(0)

    drums = np.zeros((2, total))
    bass = np.zeros((2, total))
    chords = np.zeros((2, total))
    lead = np.zeros((2, total))

    def at(b: int, s: float) -> float:
        """Time of a 16th step in a bar, swung, with a little human drift."""
        swing = (m["swing"] - 0.5) * 2 * step16 if int(s) % 2 == 1 else 0.0
        drift = rng.normal(0, 0.004 if m["swing"] > 0.5 else 0.002)
        return b * bar + s * step16 + swing + drift

    prev = None
    kicks: list[float] = []
    chord_names = []

    # ---------------------------------------------------------------- chords and bass
    b = 0
    while b < bars:
        symbol = plan[b]
        span = 1
        while b + span < bars and plan[b + span] == symbol and span < chord_bars:
            span += 1
        tones = chord_tones(symbol, steps)
        chord_names.append(symbol)
        notes = voice(tones, root + 12, 62, prev, 51, 79)
        prev = notes
        start = b * bar
        dur = span * bar
        is_outro = b >= bars - outro
        quiet = 0.75 if b < intro else 1.0

        style = m["chords"]
        if style in ("pad", "pad-soft"):
            g = (0.16 if style == "pad" else 0.1) * quiet
            for f in notes:
                place_stereo(chords, pad_note(hz(f), dur, rng, attack=min(1.2, dur * 0.3), release=1.6), start, g)
        elif style == "strings":
            for f in notes:
                place_stereo(chords, string_note(hz(f), dur, rng, attack=min(2.2, dur * 0.45), release=2.5), start, 0.15 * quiet)
        elif style == "keys":
            hits = [(0, 1.0, 6), (10, 0.62, 5)] if not is_outro else [(0, 0.9, 16)]
            if energy > 0.7 and not is_outro:
                hits.append((6, 0.45, 2))
            for bb in range(span):
                for s, v, length in hits:
                    vel = float(np.clip(v * (0.82 + 0.18 * energy) * rng.uniform(0.9, 1.05), 0.2, 1))
                    t0 = at(b + bb, s)
                    for k, f in enumerate(notes):  # a slight strum, bottom up
                        place(chords, epiano(hz(f), length * step16, vel), t0 + k * 0.009, 0.16, pan=-0.35 + 0.7 * k / max(1, len(notes) - 1))
        elif style == "stab":
            for bb in range(span):
                for s in (2, 6, 10, 14) if not is_outro else (0,):
                    t0 = at(b + bb, s)
                    length = 1.6 * step16 if not is_outro else bar
                    for f in notes:
                        n = int((length + 0.12) * SR)
                        x = sum(saw(hz(f) * 2 ** (c / 1200), n, rng.random()) for c in (-12, 12)) / 2
                        x = lp(x, 1600 + 2200 * energy) * fade(n, 0.004, length, 0.12)
                        place(chords, x, t0, 0.24, pan=rng.uniform(-0.5, 0.5))

        # Bass
        kind = m["bass"]
        broot = root + tones[0]
        while broot > 45:
            broot -= 12
        while broot < 33:
            broot += 12
        fifth = broot + 7 if broot + 7 <= 52 else broot - 5
        for bb in range(span):
            bi = b + bb
            if bi < intro and kind not in ("drone",):
                continue
            if kind == "drone":
                if bb == 0:
                    place(bass, bass_note(hz(broot), dur, "drone", 0.5), start, 0.3)
            elif kind == "soft":
                place(bass, bass_note(hz(broot), 6 * step16, kind, 0.85), at(bi, 0), 0.48)
                if not is_outro:
                    place(bass, bass_note(hz(broot if rng.random() < 0.6 else fifth), 4 * step16, kind, 0.7), at(bi, 10), 0.48)
            elif kind == "walk":
                pattern = [(0, broot, 5), (6, broot, 2), (8, fifth, 4), (12, broot + (12 if rng.random() < 0.4 else 4), 3)]
                for s, note, length in (pattern if not is_outro else [(0, broot, 14)]):
                    place(bass, bass_note(hz(note), length * step16, kind, 0.75), at(bi, s), 0.55)
            elif kind == "offbeat":
                for s in (2, 6, 10, 14) if not is_outro else ():
                    note = broot + (12 if s == 14 and rng.random() < 0.5 else 0)
                    place(bass, bass_note(hz(note), 1.7 * step16, kind, 0.85), at(bi, s), 1.0)
            elif kind == "arp8":
                for s in range(0, 16, 2) if not is_outro else (0,):
                    note = broot + (12 if (s // 2) % 2 else 0)
                    place(bass, bass_note(hz(note), 1.8 * step16 if not is_outro else bar, kind, 0.8), at(bi, s), 0.42)
        b += span

    # ---------------------------------------------------------------- lead
    style = m["lead"]
    if style:
        prev = None
        for b in range(bars):
            tones = chord_tones(plan[b], steps)
            is_outro = b >= bars - outro
            if style == "pluck-sparse":
                pool = sorted(set(voice(tones, root + 24, 76, None, 67, 88)))
                for s in range(0, 16, 2):
                    if (rng.random() < 0.18 + 0.2 * energy and b >= max(1, intro)) or (s == 0 and b == 0):
                        place(lead, pluck(hz(float(rng.choice(pool))), 2 * step16, rng, bright=0.45), at(b, s), 0.75, pan=rng.uniform(-0.6, 0.6))
            elif style == "pluck-arp":
                if b < intro:
                    continue
                pool = voice(tones, root + 12, 70, prev, 62, 84)
                prev = pool
                order = pool + pool[-2:0:-1]
                for k, s in enumerate(range(0, 16, 2) if energy < 0.75 else range(16)):
                    if is_outro and s > 0:
                        break
                    note = order[k % len(order)]
                    place(lead, pluck(hz(note), (2 if energy < 0.75 else 1) * step16, rng, bright=0.65), at(b, s), 0.6, pan=(-0.4 if k % 2 else 0.4))
            elif style == "arp-saw":
                if b < intro:
                    continue
                pool = voice(tones, root + 24, 76, prev, 67, 91)
                prev = pool
                for k, s in enumerate(range(16)):
                    if is_outro:
                        break
                    note = pool[k % len(pool)]
                    n = int(1.2 * step16 * SR)
                    x = saw(hz(note), n, rng.random())
                    x = lp(x, 1200 + 3000 * energy) * fade(n, 0.003, 0.8 * step16, 0.3 * step16)
                    place(lead, x, at(b, s), 0.17, pan=0.3 * np.sin(k))
            elif style == "bells":
                pool = sorted(set(voice(tones, root + 24, 79, None, 72, 91)))
                for s in (0, 4, 6, 10, 12):
                    if rng.random() < 0.3 + 0.25 * energy and not (is_outro and s > 0):
                        place(lead, bell(hz(float(rng.choice(pool))), float(rng.uniform(0.6, 1.0))), at(b, s), 0.22, pan=rng.uniform(-0.7, 0.7))
        lead += pingpong(lead, beat * 0.75, 0.32 if style != "arp-saw" else 0.22)

    # ---------------------------------------------------------------- drums
    kit = m["drums"]
    if kit:
        for b in range(bars):
            is_outro = b >= bars - outro
            light = b < intro or b in breakdown
            fill = (b % 4 == 3) and not is_outro
            v = 0.75 + 0.25 * energy
            if kit == "lofi":
                if is_outro:
                    place(drums, kick(0.8, rng, soft=True), at(b, 0), 0.9)
                    continue
                if not light:
                    for s in (0, 7, 10) if rng.random() < 0.5 else (0, 10):
                        t0 = at(b, s)
                        place(drums, kick(v * (1 if s == 0 else 0.8), rng, soft=True), t0, 0.85)
                        kicks.append(t0)
                    for s in (4, 12):
                        place(drums, snare(v * 0.85, rng, tone=200, snap=0.8), at(b, s), 0.5, pan=0.05)
                    if fill:
                        place(drums, snare(0.35, rng, tone=200), at(b, 15), 0.4)
                for s in range(0, 16, 2):
                    if light and s % 4:
                        continue
                    place(drums, hat(v * (0.9 if s % 4 == 0 else 0.6) * rng.uniform(0.85, 1.05), rng), at(b, s), 0.55, pan=0.25)
            elif kit == "acoustic":
                if not light and not is_outro:
                    for s in (0, 8, 11) if rng.random() < 0.35 else (0, 8):
                        place(drums, kick(v * 0.85, rng, soft=True), at(b, s), 0.75)
                    for s in (4, 12):
                        place(drums, rim(v, rng), at(b, s), 0.6, pan=-0.15)
                for s in range(16):
                    if is_outro:
                        break
                    accent = 1.0 if s % 4 == 0 else (0.75 if s % 2 == 0 else 0.5)
                    if light and s % 2:
                        continue
                    place(drums, shaker(v * accent * rng.uniform(0.85, 1.1), rng), at(b, s), 0.5, pan=0.35)
                if is_outro:
                    place(drums, kick(0.7, rng, soft=True), at(b, 0), 0.75)
            elif kit == "house":
                for s in (0, 4, 8, 12):
                    if light and s:
                        continue
                    t0 = at(b, s)
                    place(drums, kick(v, rng), t0, 0.9)
                    kicks.append(t0)
                    if is_outro:
                        break
                if is_outro:
                    continue
                if not light:
                    for s in (4, 12):
                        place(drums, clap(v * 0.9, rng), at(b, s), 0.55)
                for s in (2, 6, 10, 14):
                    place(drums, hat(v * rng.uniform(0.85, 1.05), rng, open_=(s == 14 and b % 2 == 1)), at(b, s), 0.6, pan=0.2)
                if energy > 0.5 and not light:
                    for s in range(16):
                        place(drums, shaker(0.5 * rng.uniform(0.7, 1.0), rng), at(b, s), 0.35, pan=-0.3)
                if fill and not light:
                    place(drums, swell(bar, rng), b * bar, 0.6)
            elif kit == "retro":
                if is_outro:
                    place(drums, kick(0.9, rng), at(b, 0), 0.85)
                    continue
                if not light:
                    for s in (0, 8, 10) if fill else (0, 8):
                        t0 = at(b, s)
                        place(drums, kick(v, rng), t0, 0.85)
                        kicks.append(t0)
                    for s in (4, 12):
                        place(drums, snare(v, rng, tone=170, snap=1.6, length=0.5), at(b, s), 0.62)
                for s in range(0, 16, 2):
                    place(drums, hat(v * (0.8 if s % 4 else 1.0), rng), at(b, s), 0.45, pan=0.3)
            elif kit == "soft":
                if b % 2 == 0 and not light:
                    place(drums, timpani(0.7 * v, rng, f=hz(root - 12 + steps[0])), at(b, 0), 0.6)
                if (b % 4 == 3 or b == bars - 2) and not is_outro:
                    place(drums, swell(bar, rng), b * bar, 0.5)

    # ---------------------------------------------------------------- mix
    if m.get("sidechain"):
        duck = pump(total, kicks, m["sidechain"] * (0.7 + 0.3 * energy))
        chords *= duck
        bass *= 0.4 + 0.6 * duck
        lead *= 0.6 + 0.4 * duck

    if m["chords"] in ("pad", "pad-soft", "strings"):
        chords = sweep_lp(chords, 1500 + 2600 * energy, 0.7, 1 / (bar * 4), rng.random() * 6)
    if m["chords"] == "keys":
        trem = 1 + 0.12 * np.sin(2 * np.pi * 4.6 * _t(total))
        chords[0] *= trem
        chords[1] *= 2 - trem
    bass = lp(bass, 900)

    send = 0.35 * chords + 0.55 * lead + 0.12 * drums + 0.04 * bass
    wet = reverb(send, rng, seconds=2.2 + 2.5 * m["reverb"], damp=5200 if m["lofi"] else 7500)
    mix = drums + bass + chords + lead + wet * (0.9 * m["reverb"] + 0.25)

    if m["lofi"]:
        mix = lp(mix, 6800)
        mix = np.tanh(mix * 1.35) / 1.35
        mix += np.vstack([crackle(total, rng), crackle(total, rng)]) * 0.5

    # ---------------------------------------------------------------- master
    mix = hp(mix, 30)
    mix -= mix.mean(axis=1, keepdims=True)
    length = int(seconds * SR)
    mix = mix[:, :length]

    # Glue: a gentle compressor on the summed signal.
    level = np.sqrt(np.maximum(lp(np.mean(mix ** 2, axis=0), 6), 1e-9))
    threshold = np.percentile(level, 70)
    gain = np.where(level > threshold, (level / threshold) ** (1 / 2.2 - 1), 1.0)
    mix *= gain

    # Loudness: aim for about -15 dBFS RMS, then a soft limiter keeps peaks under -1 dBFS.
    rms = np.sqrt(np.mean(mix ** 2)) + 1e-9
    mix *= 10 ** (-15 / 20) / rms
    ceiling = 10 ** (-1 / 20)
    mix = ceiling * np.tanh(mix / ceiling)

    fade_in = 1.6 if m["drums"] in (None, "soft") else 0.04
    fade_out = min(3.5 if m["drums"] in (None, "soft") else 2.4, seconds * 0.3)
    t = _t(length)
    env = np.minimum(1, t / fade_in) * np.clip((seconds - t) / fade_out, 0, 1) ** 1.5
    mix *= env

    meta = {
        "mood": mood,
        "label": m["label"],
        "bpm": round(bpm, 1),
        "key": f"{key} {m['scale']}",
        "progression": chord_names,
        "bars": bars,
        "seed": seed,
        "energy": round(energy, 2),
    }
    return np.nan_to_num(mix.T, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32), meta

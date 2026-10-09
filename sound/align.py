"""Word timings for captions: the script's own words, timed by what Whisper heard.

Whisper may write "40" where the script says "Forty", or mishear a name. So the script stays
the source of the words, and Whisper only lends its clock: matched words take Whisper's times,
and unmatched runs share the time between their neighbours, longer words taking longer.
"""

import difflib
import re

_WORD = re.compile(r"\S+")


def _norm(word: str) -> str:
    return re.sub(r"[^\w']+", "", word.lower())


def align(script: str, heard: list[dict], duration: float) -> list[dict]:
    words = [m.group(0) for m in _WORD.finditer(script)]
    if not words:
        return []
    a = [_norm(w) for w in words]
    b = [_norm(h["text"]) for h in heard]
    times: list[tuple[float, float] | None] = [None] * len(words)

    matcher = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            h = heard[block.b + k]
            times[block.a + k] = (float(h["start"]), float(h["end"]))

    n = len(words)
    i = 0
    while i < n:
        if times[i] is not None:
            i += 1
            continue
        j = i
        while j < n and times[j] is None:
            j += 1
        start = times[i - 1][1] if i > 0 else (float(heard[0]["start"]) if heard and j < n and heard[0]["start"] < times[j][0] else 0.0)
        end = times[j][0] if j < n else duration
        if end <= start:
            end = start + 0.18 * (j - i)
        weights = [max(1, len(a[k])) + 1 for k in range(i, j)]
        total = sum(weights)
        t = start
        for k, w in zip(range(i, j), weights):
            d = (end - start) * w / total
            times[k] = (t, t + d)
            t += d
        i = j

    out = []
    last = 0.0
    for word, (s, e) in zip(words, times):
        s = max(last, min(s, duration))
        e = max(s + 0.04, min(e, duration))
        out.append({"text": word, "start": round(s, 3), "end": round(e, 3)})
        last = e
    return out

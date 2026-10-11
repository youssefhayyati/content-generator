"""Songs for videos from ACE-Step 1.5 (MIT; content-generator/runpod/music/), on the RunPod pod or this PC's GPU.

The composer in FlowAI Sound plays one of six moods; ACE-Step writes the music a description asks
for ("upbeat acoustic pop, bright ukulele and hand claps, 110 bpm"), so a video for a bakery and one
for a gym don't sound alike. The assistant's LLM writes that description for the post (session.py,
cast). Songs here are instrumental: they sit under the voice, which steps over them (reel.render).

Its API is a queue: POST /release_task gives a task id, POST /query_result says how far it has got and
when it's done, and GET /v1/audio returns the file. Blocking calls: run in a thread.
"""

import json
import logging
import time
from collections.abc import Callable

import httpx

log = logging.getLogger(__name__)

SHORTEST, LONGEST = 10, 600  # seconds ACE-Step makes
TAIL = 3  # a song ends with about two seconds of silence: made longer, it's past the video's end
POLL = 1.0


class MusicError(Exception):
    pass


class SongWriter:
    def __init__(self, url: str, api_key: str = "", timeout: float = 300):
        self.http = httpx.Client(base_url=url.rstrip("/"), timeout=60,
                                 headers={"Authorization": f"Bearer {api_key}"} if api_key else None)
        self.url, self.timeout = url, timeout

    def song(self, description: str, seconds: float, seed: int | None = None,
             progress: Callable[[float], None] | None = None) -> bytes:
        """An instrumental track as WAV bytes, at least `seconds` long. The same description and seed
        give the same song. progress(share) gets how much of it is made (0..1) as that moves on."""
        t0 = time.perf_counter()
        body = {"prompt": description, "lyrics": "[Instrumental]", "vocal_language": "unknown",
                "audio_duration": round(min(max(seconds + TAIL, SHORTEST), LONGEST), 1), "audio_format": "wav",
                "batch_size": 1, "inference_steps": 8, "thinking": False,
                "use_cot_caption": False, "use_cot_language": False}
        if seed is not None:
            body.update(use_random_seed=False, seed=int(seed))
        try:
            task = self._data(self.http.post("/release_task", json=body))["task_id"]
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise MusicError(f"ACE-Step at {self.url} isn't answering ({type(exc).__name__}); is it running?") from None
        while True:
            if time.perf_counter() - t0 > self.timeout:
                raise MusicError(f"ACE-Step took over {self.timeout:.0f} seconds")
            try:
                found = self._data(self.http.post("/query_result", json={"task_id_list": [task]}))
            except (httpx.HTTPError, ValueError, KeyError):
                found = None  # a blip, or RunPod's proxy page while it restarts: the time limit still holds
            done = found[0] if isinstance(found, list) and found and isinstance(found[0], dict) else {}
            if done.get("status") == 1:
                break
            if done.get("status") == 2:
                raise MusicError(f"ACE-Step couldn't make it: {done.get('result') or done.get('error') or 'no reason'}")
            if progress and (share := self._share(done)) is not None:
                progress(share)
            time.sleep(POLL)
        try:
            result = done["result"]
            result = json.loads(result) if isinstance(result, str) else result
            r = self.http.get(result[0]["file"], timeout=120)
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
            raise MusicError(f"ACE-Step's song couldn't be downloaded ({type(exc).__name__})") from None
        if r.status_code >= 400 or "text/html" in r.headers.get("content-type", ""):
            raise MusicError(f"ACE-Step's song couldn't be downloaded (HTTP {r.status_code})")
        log.info("song for %r: %.0f s in %.1f s", description[:60], seconds, time.perf_counter() - t0)
        return r.content

    @staticmethod
    def _share(task: dict) -> float | None:
        """How much of a running task is done: its result is a JSON list whose item has progress (0..1)."""
        try:
            result = task.get("result") or []
            result = json.loads(result) if isinstance(result, str) else result
            share =result[0].get("progress") if isinstance(result, list) and result else None
            return float(share) if share is not None else None
        except (ValueError, TypeError, AttributeError):
            return None

    @staticmethod
    def _data(r: httpx.Response):
        """Its answer's data. MusicError when ACE-Step said no; httpx.HTTPError or ValueError when the answer
        isn't its own (a blip, or RunPod's proxy page while it restarts)."""
        try:
            reply = r.json()
        except ValueError:
            r.raise_for_status()
            raise
        if not isinstance(reply, dict):
            r.raise_for_status()
            raise ValueError("not ACE-Step's answer")
        if reply.get("code", 200) != 200 or reply.get("error") or (r.status_code >= 400 and reply.get("detail")):
            raise MusicError(f"ACE-Step: {reply.get('error') or reply.get('detail') or reply.get('code')}")
        r.raise_for_status()
        return reply["data"]

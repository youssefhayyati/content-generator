"""The pod's job services (content-generator/runpod/): lip sync for dubbed videos (dub.py; LatentSync,
Apache-2.0) and face swaps (session.py; inswapper_128 and GFPGAN in ONNX). On the RunPod pod, or this PC's GPU.

Both work the same way: one POST with the files gives a job id, GET .../{id} says how far it has got, GET
.../{id}/<result> returns the made file, and DELETE stops it. Nothing waits on a long request, so they work
behind RunPod's proxy, which cuts a request at about 100 seconds. Blocking calls: run in a thread.
"""

import logging
import time
from collections.abc import Callable

import httpx

from .comfyui import ComfyError

log = logging.getLogger(__name__)

POLL = 2.0


class JobError(ComfyError):
    """A failure with a message the assistant can pass on to the user."""


class Stopped(Exception):
    pass


class JobService:
    what = "the service"
    path = ""  # its jobs, e.g. /v1/lipsync
    result = ""  # what GET .../{id}/<result> returns

    def __init__(self, url: str, api_key: str = "", timeout: float = 1800):
        self.http = httpx.Client(base_url=url.rstrip("/"), timeout=60,
                                 headers={"Authorization": f"Bearer {api_key}"} if api_key else None)
        self.url, self.timeout = url, timeout
        self.status = "not checked yet"  # for the agent's /health

    def check(self) -> str:
        """What the service says about itself, in a few words (kept in status)."""
        try:
            h = self.http.get("/health", timeout=10).raise_for_status().json()
            self.status = f"ok, {h.get('model')}" if h.get("status") == "ok" else \
                f"{h.get('status')}: {h.get('error') or 'downloading its models'}"
        except (httpx.HTTPError, ValueError) as exc:
            self.status = f"not reachable ({type(exc).__name__})"
        return self.status

    def run(self, files: dict, data: dict, progress: Callable[[str], None],
            stopped: Callable[[], bool] = lambda: False) -> bytes:
        """One job, from start to its made file. progress gets a few words whenever it moves on;
        stopped() true stops it (the service's job too)."""
        t0 = time.perf_counter()
        try:
            r = self.http.post(self.path, timeout=300, files=files, data=data)
        except httpx.HTTPError as exc:
            raise JobError(f"{self.what} at {self.url} isn't reachable ({type(exc).__name__})") from None
        job = self._json(r)["id"]
        shown = ""
        try:
            while True:
                if stopped():
                    raise Stopped()
                if time.perf_counter() - t0 > self.timeout:
                    raise JobError(f"{self.what} took over {self.timeout / 60:.0f} minutes")
                try:
                    st = self._json(self.http.get(f"{self.path}/{job}"))
                except httpx.HTTPError:
                    time.sleep(POLL)  # a blip shouldn't lose a few minutes of work
                    continue
                if st["status"] == "done":
                    break
                if st["status"] in ("failed", "cancelled"):
                    raise JobError(f"{st['status']}: {st.get('error') or 'no reason given'}")
                text = st.get("stage") or st["status"]
                if st.get("progress"):
                    text += f" {round(st['progress'] * 100)}%"
                if text != shown:
                    shown = text
                    progress(text)
                time.sleep(POLL)
            made = self.http.get(f"{self.path}/{job}/{self.result}", timeout=300)
            made.raise_for_status()
        except (Stopped, JobError):
            self._forget(job)
            raise
        log.info("%s %s: %.0f KB in %.1f s", self.what, job, len(made.content) / 1024, time.perf_counter() - t0)
        self._forget(job)
        return made.content

    def _forget(self, job: str):
        try:
            self.http.delete(f"{self.path}/{job}", timeout=10)
        except httpx.HTTPError:
            pass

    def _json(self, r: httpx.Response) -> dict:
        if r.status_code >= 400:
            try:
                detail = r.json().get("detail")
            except ValueError:
                detail = r.text[:200]
            raise JobError(f"{self.what} said: {detail or r.status_code}")
        return r.json()


class LipSync(JobService):
    """A video's mouth redrawn to say new speech; the video comes back as long as the speech, with it under."""
    what, path, result = "the lip sync", "/v1/lipsync", "video"

    def sync(self, video: bytes, speech: bytes, progress: Callable[[str], None],
             stopped: Callable[[], bool] = lambda: False) -> bytes:
        return self.run({"video": ("video.mp4", video, "video/mp4"), "audio": ("speech.wav", speech, "audio/wav")},
                        {}, progress, stopped)


class FaceSwap(JobService):
    """The face from one picture put on the person in a picture (a PNG back) or a video (an MP4, its sound kept)."""
    what, path, result = "the face swap", "/v1/faceswap", "result"

    def swap(self, face: tuple[str, bytes], target: tuple[str, bytes], every: bool, progress: Callable[[str], None],
             stopped: Callable[[], bool] = lambda: False) -> bytes:
        """face and target: (file name, bytes). every: change every face, not only the largest."""
        return self.run({"face": face, "target": target}, {"faces": "all" if every else "largest", "enhance": "true"},
                        progress, stopped)

"""Lip sync for dubbed videos (dub.py) from LatentSync (Apache-2.0; content-generator/lipsync/), on this
PC's GPU or a pod's.

Its API is a queue: POST /v1/lipsync takes the video and the speech and gives a job id, GET
/v1/lipsync/{id} says how far it has got, GET /v1/lipsync/{id}/video returns the made video, and DELETE
stops it. The video comes back as long as the speech, with the speech under it. Blocking calls: run
in a thread.
"""

import logging
import time
from collections.abc import Callable

import httpx

from .comfyui import ComfyError

log = logging.getLogger(__name__)

POLL = 2.0


class LipSyncError(ComfyError):
    """A failure with a message the assistant can pass on to the user."""


class Stopped(Exception):
    pass


class LipSync:
    def __init__(self, url: str, api_key: str = "", timeout: float = 1800):
        self.http = httpx.Client(base_url=url.rstrip("/"), timeout=60,
                                 headers={"Authorization": f"Bearer {api_key}"} if api_key else None)
        self.url, self.timeout = url, timeout
        self.status = "not checked yet"  # for /health

    def check(self) -> str:
        """What the service says about itself, in a few words (kept in status)."""
        try:
            h = self.http.get("/health", timeout=10).raise_for_status().json()
            self.status = f"ok, {h.get('model')}" if h.get("status") == "ok" else \
                f"{h.get('status')}: {h.get('error') or 'downloading the model'}"
        except httpx.HTTPError as exc:
            self.status = f"not reachable ({type(exc).__name__})"
        return self.status

    def sync(self, video: bytes, speech: bytes, progress: Callable[[str], None],
             stopped: Callable[[], bool] = lambda: False) -> bytes:
        """The video with its mouth redrawn to say the speech (a WAV), as MP4 bytes. progress gets a
        few words whenever it moves on; stopped() true stops it (the service's job too)."""
        t0 = time.perf_counter()
        try:
            r = self.http.post("/v1/lipsync", timeout=300, files={"video": ("video.mp4", video, "video/mp4"),
                                                                  "audio": ("speech.wav", speech, "audio/wav")})
        except httpx.HTTPError as exc:
            raise LipSyncError(f"the lip sync service at {self.url} isn't reachable ({type(exc).__name__})") from None
        job = self._json(r)["id"]
        shown = ""
        try:
            while True:
                if stopped():
                    raise Stopped()
                if time.perf_counter() - t0 > self.timeout:
                    raise LipSyncError(f"lip sync took over {self.timeout / 60:.0f} minutes")
                try:
                    st = self._json(self.http.get(f"/v1/lipsync/{job}"))
                except httpx.HTTPError:
                    time.sleep(POLL)  # a blip shouldn't lose a few minutes of work
                    continue
                if st["status"] == "done":
                    break
                if st["status"] in ("failed", "cancelled"):
                    raise LipSyncError(f"lip sync {st['status']}: {st.get('error') or 'no reason given'}")
                text = st.get("stage") or st["status"]
                if st.get("progress"):
                    text += f" {round(st['progress'] * 100)}%"
                if text != shown:
                    shown = text
                    progress(text)
                time.sleep(POLL)
            made = self.http.get(f"/v1/lipsync/{job}/video", timeout=300)
            made.raise_for_status()
        except (Stopped, LipSyncError):
            self._forget(job)
            raise
        log.info("lip sync %s: %.0f KB in %.1f s", job, len(made.content) / 1024, time.perf_counter() - t0)
        self._forget(job)
        return made.content

    def _forget(self, job: str):
        try:
            self.http.delete(f"/v1/lipsync/{job}", timeout=10)
        except httpx.HTTPError:
            pass

    @staticmethod
    def _json(r: httpx.Response) -> dict:
        if r.status_code >= 400:
            try:
                detail = r.json().get("detail")
            except ValueError:
                detail = r.text[:200]
            raise LipSyncError(f"the lip sync service said: {detail or r.status_code}")
        return r.json()

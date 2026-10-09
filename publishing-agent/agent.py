#!/usr/bin/env python3
"""The automation agent: drives phones for the FlowAI studio.

Polls the Laravel agent API for the run booked on its phone, executes it with the
publishing-studio device layer (a real phone over adb, or the built-in simulator),
and reports steps, screenshots and the outcome back.

The one rule that matters: sending a command is not publishing a post. The run
ends `confirmed` only when the account was observed afterwards; `uncertain` is a
valid, honest answer.

    pip install -r requirements.txt
    AGENT_TOKEN=... DEVICE_REF=phone-1 DRIVER=adb python agent.py

Env:
    FLOWAI_URL       default http://localhost:8000 — the Laravel API
    AGENT_TOKEN      required — from the dashboard's Phones page
    DEVICE_REF       required — the device ID the phone has in the studio
    DRIVER           adb (default) | simulator
    SIM_SERIAL       simulator serial (deterministic behavior per serial)
    SIM_FAIL_FIRST   simulator: fail this many publish attempts first (demo the recovery)
    POLL_SECONDS     default 5
"""

from __future__ import annotations

import os
import sys
import time
import tempfile
import traceback
from pathlib import Path

import httpx

# The publishing-studio backend is the device library; nothing of its app is run.
os.environ.setdefault("STUDIO_DATA_DIR", str(Path(__file__).parent / "data"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "publishing-studio" / "backend"))

from app.devices.base import DeviceDriver, DeviceError  # noqa: E402
from app.devices.adb import AdbDriver  # noqa: E402
from app.devices.simulator import SimulatorDriver  # noqa: E402
from app.publishing.context import BudgetExceeded, RunContext, StepRecord  # noqa: E402
from app.publishing.recipes.base import Evidence, PostPayload, PublishFailed, Recipe  # noqa: E402
from app.publishing.recipes.instagram import InstagramRecipe  # noqa: E402
from app.publishing.recipes.x import XRecipe  # noqa: E402

RECIPES: dict[str, type[Recipe]] = {"instagram": InstagramRecipe, "x": XRecipe}

FLOWAI_URL = os.environ.get("FLOWAI_URL", "http://localhost:8000").rstrip("/")
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "")
DEVICE_REF = os.environ.get("DEVICE_REF", "")
DRIVER_KIND = os.environ.get("DRIVER", "adb")
POLL_SECONDS = float(os.environ.get("POLL_SECONDS", "5"))


def make_driver() -> DeviceDriver:
    if DRIVER_KIND == "simulator":
        serial = os.environ.get("SIM_SERIAL", "sim-1")
        options = {"fail_first_attempts": int(os.environ.get("SIM_FAIL_FIRST", "0"))}
        return SimulatorDriver(serial, options)
    return AdbDriver(DEVICE_REF)


class Bridge:
    def __init__(self) -> None:
        if not AGENT_TOKEN or not DEVICE_REF:
            sys.exit("AGENT_TOKEN and DEVICE_REF are required (see the module docstring).")
        self.http = httpx.Client(
            base_url=FLOWAI_URL,
            headers={"Authorization": f"Bearer {AGENT_TOKEN}", "Accept": "application/json"},
            timeout=30,
        )

    # ---------------- the loop ----------------

    def run_forever(self) -> None:
        print(f"[agent] {DRIVER_KIND} phone {DEVICE_REF!r} working {FLOWAI_URL}", flush=True)
        while True:
            try:
                job = self.next_job()
            except httpx.HTTPError as exc:
                print(f"[agent] api unreachable: {exc}; retrying in 15s", flush=True)
                time.sleep(15)
                continue
            if job is None:
                time.sleep(POLL_SECONDS)
                continue
            try:
                self.execute(job)
            except Exception:  # noqa: BLE001 - the agent must never die on one run
                traceback.print_exc()
                time.sleep(5)

    def next_job(self) -> dict | None:
        r = self.http.get("/api/agent/next-job", params={"device_ref": DEVICE_REF})
        if r.status_code == 204:
            return None
        r.raise_for_status()
        return r.json()

    # ---------------- one run ----------------

    def execute(self, job: dict) -> None:
        run_id = job["run_id"]
        platform = job["account"]["platform"]
        print(f"[agent] run {run_id}: {job['goal']!r} → {platform}/@{job['account']['handle']}", flush=True)

        recipe_cls = RECIPES.get(platform)
        if recipe_cls is None:
            self.finish(run_id, "failed", note=f"the agent has no recipe for {platform} yet")
            return

        recipe = recipe_cls()
        driver = make_driver()
        pending: list[dict] = []

        def sink(rec: StepRecord) -> None:
            pending.append({"action": rec.action, "ok": rec.ok, "ms": rec.ms, "note": rec.detail[:190]})
            if len(pending) >= 4:
                self.flush_steps(run_id, pending)

        ctx = RunContext(
            run_id=run_id,
            driver=driver,
            sink=sink,
            step_budget=int(job.get("limits", {}).get("step_budget", 60)),
            timeout_s=int(job.get("limits", {}).get("hard_timeout_seconds", 300)),
        )

        evidence: Evidence | None = None
        error: str | None = None
        try:
            payload = PostPayload(
                caption=job["post"]["caption"] or "",
                hashtags=[],
                placement=job["post"].get("placement") or "feed",
                handle=job["account"]["handle"],
            )
            media = self.download_media(job.get("media") or [])
            if media:
                payload.media_path = ctx.push_media(media[0])
                if len(media) > 1:
                    ctx.note("media-note", f"{len(media)} assets attached; driving with the first")

            baseline = recipe.baseline(ctx)
            recipe.publish(ctx, payload)
            evidence = recipe.verify(ctx, payload, baseline)
        except BudgetExceeded as exc:
            error = f"run stopped by its own budget: {exc}"
        except PublishFailed as exc:
            error = str(exc)
        except DeviceError as exc:
            error = f"device error: {exc}"
        except Exception as exc:  # noqa: BLE001
            error = f"{type(exc).__name__}: {exc}"
            traceback.print_exc()
        finally:
            try:
                recipe.cleanup(ctx)
            except Exception:
                pass
            try:
                driver.close()
            except Exception:
                pass

        outcome, note = decide(evidence, error)
        self.flush_steps(run_id, pending)
        self.upload_screenshots(run_id, ctx)
        post_url = (evidence.checks.get("post_url") if evidence else None) or None
        self.finish(run_id, outcome, post_url=post_url, note=note)
        print(f"[agent] run {run_id}: {outcome} — {note}", flush=True)

    # ---------------- reporting ----------------

    def flush_steps(self, run_id: str, pending: list[dict]) -> None:
        while pending:
            batch, pending[:] = pending[:10], pending[10:]
            r = self.http.post(f"/api/agent/runs/{run_id}/steps", json={"steps": batch})
            if r.status_code >= 400:
                print(f"[agent] steps rejected: {r.status_code} {r.text[:200]}", flush=True)
                return

    def upload_screenshots(self, run_id: str, ctx: RunContext) -> None:
        from app.config import EVIDENCE_DIR

        names = [s.screenshot for s in ctx.steps if s.screenshot][-4:]
        for name in names:
            path = EVIDENCE_DIR / name
            if not path.exists():
                continue
            r = self.http.post(f"/api/agent/runs/{run_id}/screenshot", files={"file": (name, path.read_bytes(), "image/png")})
            if r.status_code >= 400:
                print(f"[agent] screenshot rejected: {r.status_code} {r.text[:200]}", flush=True)

    def finish(self, run_id: str, outcome: str, post_url: str | None = None, note: str | None = None) -> None:
        body = {"outcome": outcome, "post_url": post_url, "note": note}
        r = self.http.post(f"/api/agent/runs/{run_id}/finish", json={k: v for k, v in body.items() if v is not None})
        if r.status_code >= 400:
            print(f"[agent] finish rejected: {r.status_code} {r.text[:300]}", flush=True)

    def download_media(self, media: list[dict]) -> list[str]:
        out = []
        for m in media:
            r = self.http.get(m["url"])
            r.raise_for_status()
            suffix = {"image/png": ".png", "image/jpeg": ".jpg", "video/mp4": ".mp4"}.get(m["mime"], ".bin")
            fd, path = tempfile.mkstemp(prefix="flowai-media-", suffix=suffix)
            with os.fdopen(fd, "wb") as fh:
                fh.write(r.content)
            out.append(path)
        return out


def decide(evidence: Evidence | None, error: str | None) -> tuple[str, str]:
    """The single most important judgement in the system (mirrors the studio's runner)."""
    if evidence is not None and evidence.confirmed:
        return "confirmed", evidence.note
    if evidence is not None:
        return ("uncertain", evidence.note) if evidence.kind == "none" else ("failed", evidence.note)
    # The run broke before it could look. Once Share was tapped, we genuinely do not know.
    if error and any(w in error.lower() for w in ("budget", "timeout", "timed out")):
        return "uncertain", "failed after submitting; could not check the account"
    return "failed", error or "run failed before submitting"


if __name__ == "__main__":
    Bridge().run_forever()

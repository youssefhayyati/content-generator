"""Publishes the posts FlowAI schedules, from the team's phone, when their time comes.

FlowAI (content-generator/backend) books a run on a phone when an approved post's time comes, and waits for
an automation service to drive it: GET /api/agent/next-job?device_ref=<phone> gives the run (caption, media,
platform, placement); the service reports steps as it goes (POST /api/agent/runs/{run}/steps, also its
heartbeat: a run quiet for 10 minutes is swept) and a screenshot, then finishes it: confirmed (needs the
screenshot or a post URL), failed (FlowAI tries again later, up to 3 times) or uncertain (a person checks).
It signs every call with the user's agent token (FlowAI's Phones page).

This is that service. A run is posted exactly like a draft from the assistant (backend/phone.py): the media
goes on the phone first, the caption is made typable, and the goal is the phone skill for that kind of post
(skills/phone/post-*.md). The phone agent's actions are FlowAI's steps; a tap that the agent meant as
sharing is named tap:post-button, which is how FlowAI tells "never got to publish" (retry) from "may be up"
(a person checks) if a run goes quiet. Once a post is up, its numbers are checked like a draft's
(skills/phone/feedback-*.md), PHONE_FEEDBACK_AFTER_MINUTES later and whenever the assistant is asked
(post_feedback with flowai_post).

Every run taken is kept in DATA_DIR/phone/published.json, so a restart in the middle of one never posts it
twice: a run seen again is ended as uncertain for a person to check.
"""

import asyncio
import json
import logging
import mimetypes
import os
import re
import shutil
import time
from dataclasses import asdict
from pathlib import Path

import httpx

from . import platforms
from .phone import PhoneClient, PhoneError, PhoneJob, PhonePost, PhoneWork, feedback_note

log = logging.getLogger(__name__)

POST_BUTTON = re.compile(r"\b(share|post|publish|tweet)\b", re.I)  # what a tap that publishes is meant to do
KEPT = 200  # published posts remembered


class FlowAIAgentError(Exception):
    pass


class Publisher(PhoneWork):
    def __init__(self, client: PhoneClient, flowai_url: str, token: str, device_ref: str, data_dir: Path,
                 skills_dir: Path, poll_s: float = 15, post_mode: str = "pro", mode: str = "flash",
                 max_steps: int = 40, feedback_after_min: float = 60):
        super().__init__(client, skills_dir, mode, post_mode, max_steps, feedback_after_min)
        self.http = httpx.AsyncClient(base_url=flowai_url.rstrip("/"), timeout=httpx.Timeout(60, connect=10),
                                      headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
        self.device_ref, self.poll_s = device_ref, poll_s
        self.dir = data_dir
        self.file = data_dir / "published.json"
        self.posts: dict[int, PhonePost] = {}  # by our number
        self.runs: dict[str, int | None] = {}  # every FlowAI run taken -> its post (None: never got that far)
        self.reported: dict[int, int] = {}  # job id -> steps reported to FlowAI
        self.last_step_at: dict[int, float] = {}
        self.loop_task: asyncio.Task | None = None
        self._saving: asyncio.Task | None = None
        self.error: str | None = None  # why it can't publish right now, for the log
        client.publisher = self

    # --- the loop -------------------------------------------------------------------

    def start(self):
        self.load()
        self.replan_checks(self.posts.values())
        self.loop_task = asyncio.create_task(self.loop())
        log.info("Publishing FlowAI's scheduled posts from phone %s", self.device_ref)

    async def loop(self):
        while True:
            try:
                if not self.busy_error():
                    if job := await self.next_job():
                        await self.publish(job)
                        continue  # another may be waiting
                self._ok()
            except FlowAIAgentError as exc:
                self._problem(str(exc))
            except Exception as exc:
                log.exception("publishing from the phone failed")
                self._problem(f"it failed with an error: {exc}")
            await asyncio.sleep(self.poll_s)

    def _problem(self, why: str):
        if why != self.error:  # once, not every poll
            log.warning("FlowAI publishing: %s", why)
        self.error = why

    def _ok(self):
        if self.error:
            log.info("FlowAI publishing works again")
        self.error = None

    async def close(self):
        if self.loop_task:
            self.loop_task.cancel()
        await super().close()
        await self.save()
        await self.http.aclose()

    # --- FlowAI's agent API ---------------------------------------------------------

    async def call(self, method: str, path: str, **kw):
        try:
            r = await self.http.request(method, path, **kw)
        except httpx.HTTPError as exc:
            raise FlowAIAgentError(f"FlowAI can't be reached ({exc.__class__.__name__})") from None
        if r.status_code >= 400:
            try:
                why = r.json().get("message") or r.text[:200]
            except ValueError:
                why = r.text[:200]
            raise FlowAIAgentError(f"FlowAI answered {r.status_code} to {method} {path.split('?')[0]}: {why}")
        return r.json() if r.content and "json" in r.headers.get("content-type", "") else None

    async def next_job(self) -> dict | None:
        return await self.call("GET", "/api/agent/next-job", params={"device_ref": self.device_ref})

    async def report(self, run: str, action: str, ok: bool, ms: int, note: str = "", job: PhoneJob | None = None,
                     budget: int = 40):
        """One step on FlowAI's record (and a heartbeat); never past its step budget."""
        if job is not None:
            if self.reported.get(job.id, 0) >= budget:
                return
            self.reported[job.id] = self.reported.get(job.id, 0) + 1
        try:
            await self.call("POST", f"/api/agent/runs/{run}/steps",
                            json={"steps": [{"action": action[:60], "ok": ok, "ms": max(0, min(ms, 600000)),
                                             **({"note": note[:200]} if note else {})}]})
        except FlowAIAgentError as exc:
            log.warning("run %s: step not recorded: %s", run, exc)

    async def finish(self, run: str, outcome: str, note: str, shot: bytes | None = None) -> str:
        if shot:
            try:
                await self.call("POST", f"/api/agent/runs/{run}/screenshot",
                                files={"file": ("phone.jpg", shot, "image/jpeg")})
            except FlowAIAgentError as exc:
                log.warning("run %s: screenshot not kept: %s", run, exc)
                if outcome == "confirmed":
                    outcome, note = "uncertain", f"{note} (the screenshot proving it couldn't be kept)"
        await self.call("POST", f"/api/agent/runs/{run}/finish", json={"outcome": outcome, "note": note[:500]})
        return outcome

    # --- one run --------------------------------------------------------------------

    async def publish(self, fj: dict):
        run, account, post_in = fj["run_id"], fj.get("account") or {}, fj.get("post") or {}
        platform = account.get("platform", "")
        if run in self.runs:
            # Taken before and not finished (a restart in the middle): it may be up already, so never again
            await self.finish(run, "uncertain", "The assistant restarted while publishing this; check the account "
                                                "before trying again.")
            return
        self.runs[run] = None
        await self.save()
        placement = self._placement(platform, post_in)
        title = post_in.get("title") or fj.get("goal") or ""
        log.info("FlowAI run %s: %s %s for @%s: %s", run, platform, placement, account.get("handle"), title)
        if not placement:
            await self.finish(run, "failed", f"Posting on {platform} from the phone isn't set up: there's no phone "
                                             "skill for it (skills/phone).")
            return
        folder = self.dir / "runs" / run
        try:
            started = time.monotonic()
            files = await self._download(fj.get("media") or [], folder)
            kinds = [_kind(f) for f in files]
            plan = self.plan_post(platform, placement, post_in.get("caption") or "", kinds)
            post = PhonePost(max(self.posts, default=0) + 1, platform, placement, plan.caption,
                             flowai_post=post_in.get("id"), title=title)
            self.posts[post.id], self.runs[run] = post, post.id
            job = self.new_job("publish", f"publishing FlowAI post {post.flowai_post or title!r} as an "
                                          f"{platforms.label(platform, placement)}", post)
            job.run = run
            job.budget = budget = int((fj.get("limits") or {}).get("step_budget") or 40)
            await self.report(run, "transfer", True, round((time.monotonic() - started) * 1000),
                              f"{plan.media} to the phone" + (f"; the phone can't type {''.join(plan.dropped)}"
                                                              if plan.dropped else ""), job, budget)
            self.last_step_at[job.id] = time.monotonic()
            # The agent's steps, plus the transfer above, stay within FlowAI's budget
            job.runner = asyncio.create_task(self.post_files(job, files, plan, max_steps=budget - 1))
            await job.runner
        except PhoneError as exc:
            await self.finish(run, "failed", str(exc))
        finally:
            shutil.rmtree(folder, ignore_errors=True)
            await self.save()

    def _placement(self, platform: str, post: dict) -> str | None:
        if platform not in platforms.SPECS:
            return None
        placement = (post.get("placement") or "").lower()
        if placement in platforms.SPECS[platform]:
            return placement
        if platform == "instagram" and post.get("format") == "video":
            return "reel"
        return platforms.DEFAULT_PLACEMENT[platform]

    async def _download(self, media: list[dict], folder: Path) -> list[Path]:
        folder.mkdir(parents=True, exist_ok=True)
        files = []
        for i, m in enumerate(media, 1):
            ext = mimetypes.guess_extension(m.get("mime") or "") or (".mp4" if m.get("kind") == "video" else ".jpg")
            path = folder / f"{i}{'.jpg' if ext == '.jpe' else ext}"
            try:
                r = await self.http.get(m["url"], timeout=httpx.Timeout(300, connect=10))
            except httpx.HTTPError as exc:
                raise PhoneError(f"the post's media couldn't be fetched from FlowAI ({exc.__class__.__name__})") from None
            if r.status_code != 200:
                raise PhoneError(f"the post's media couldn't be fetched from FlowAI ({r.status_code})")
            await asyncio.to_thread(path.write_bytes, r.content)
            files.append(path)
        return files

    # --- hooks: FlowAI's record -----------------------------------------------------

    async def on_step(self, job: PhoneJob, name: str, params: dict, ok: bool, result: str):
        if job.kind != "publish":
            return
        now = time.monotonic()
        ms = round((now - self.last_step_at.get(job.id, now)) * 1000)
        self.last_step_at[job.id] = now
        action = "tap:post-button" if name == "tap" and POST_BUTTON.search(job.intent) else name
        job.tapped_post = job.tapped_post or (action == "tap:post-button" and ok)
        await self.report(job.run, action, ok, ms, job.intent or result, job, job.budget)

    async def on_approval(self, job: PhoneJob, a: dict):
        if job.kind == "publish":
            # The post was approved in FlowAI before it was scheduled: that's the OK publishing it needs
            log.info("run %s: the phone asked to %s (%s); approved, as the post was", job.run, a.get("action"),
                     a.get("reason"))
            await self.report(job.run, "approval", True, 0, f"the phone asked: {a.get('reason') or a.get('action')}",
                              job, job.budget)
            await self.answer_approval(job, True, "the post was approved in FlowAI")
        else:
            await self.answer_approval(job, False, "nobody is there to approve it")

    async def on_finished(self, job: PhoneJob):
        if job.kind == "feedback" and job.post:
            log.info("%s", feedback_note(job.post, job.snapshot, job.result, job.data).split("\n")[0])
        if job.kind != "publish" or job.status == "cancelled":
            return
        if job.success and job.status != "failed":
            outcome, up = "confirmed", True
        elif job.success is False and job.verdict:
            outcome, up = "uncertain", False  # it says it's done, the check doesn't agree
        else:
            outcome, up = ("uncertain" if job.tapped_post else "failed"), False  # failed: FlowAI tries again
        note = " ".join(x for x in (job.result, f"Check: {job.verdict}" if job.verdict else "") if x) or job.status
        shot = await self.client.screenshot(job.task, job.last_step) if job.task and job.last_step else None
        if outcome == "confirmed" and not shot:
            outcome, up = "uncertain", False
            note += " (no screenshot to prove it)"
        try:
            outcome = await self.finish(job.run, outcome, note, shot)
        except FlowAIAgentError as exc:
            log.warning("run %s: couldn't be finished in FlowAI: %s", job.run, exc)
        self.posted(job, job.post, up and outcome == "confirmed")
        if job.post.status == "unsure":
            job.post.detail = note
        if job.task and job.status == "waiting":  # don't hold the phone until the task times out
            try:
                await self.client.cancel(job.task)
                job.status = "done"
            except PhoneError:
                pass
        log.info("FlowAI run %s: %s (%s)", job.run, outcome, note)

    def on_changed(self, post: PhonePost | None = None):
        self.save_soon()

    # --- what the assistant sees ----------------------------------------------------

    def find(self, flowai_post) -> PhonePost:
        try:
            n = int(str(flowai_post).strip().lstrip("#"))
        except ValueError:
            raise PhoneError(f"{flowai_post!r} isn't a FlowAI post number") from None
        found = [p for p in self.posts.values() if p.flowai_post == n]
        if not found:
            raise PhoneError(f"FlowAI post {n} hasn't been published from the phone")
        # One post can take several attempts: the one that went up, else the latest
        return max(found, key=lambda p: (p.status in ("posted", "unsure"), p.id))

    def recent(self, n: int = 5) -> list[dict]:
        return [p.info() for p in sorted(self.posts.values(), key=lambda p: p.id)[-n:]] or \
            ["none published from the phone yet" + (f" ({self.error})" if self.error else "")]

    # --- kept on disk ---------------------------------------------------------------

    def load(self):
        try:
            data = json.loads(self.file.read_text())
        except FileNotFoundError:
            return
        except (OSError, ValueError) as exc:
            log.error("%s could not be read: %s", self.file, exc)
            return
        self.posts = {p["id"]: PhonePost.load(p) for p in data.get("posts", [])}
        self.runs = dict(data.get("runs", {}))

    def save_soon(self):
        if not (self._saving and not self._saving.done()):
            self._saving = asyncio.get_running_loop().create_task(self.save())

    async def save(self):
        posts = sorted(self.posts.values(), key=lambda p: p.id)[-KEPT:]
        keep = {p.id for p in posts}
        runs = {r: p for r, p in self.runs.items() if p is None or p in keep}
        data = {"posts": [asdict(p) for p in posts], "runs": runs}

        def write():
            self.dir.mkdir(parents=True, exist_ok=True)
            tmp = self.file.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, default=str))
            os.replace(tmp, self.file)

        try:
            await asyncio.to_thread(write)
        except OSError as exc:
            log.error("%s could not be saved: %s", self.file, exc)


def _kind(path: Path) -> str:
    return "video" if (mimetypes.guess_type(path.name)[0] or "").startswith("video") else "picture"


async def agent_token(flowai_url: str, dashboard_url: str, email: str, password: str) -> str:
    """The user's agent token, signed in as them (when FLOWAI_AGENT_TOKEN isn't set)."""
    from .flowai import FlowAIClient, FlowAIError

    client = FlowAIClient(flowai_url, dashboard_url, email, password)
    try:
        return (await client.get("/api/publishing/agent-token"))["token"]
    except (FlowAIError, KeyError, TypeError) as exc:
        raise FlowAIAgentError(f"the agent token couldn't be fetched: {exc}") from None
    finally:
        await client.close()

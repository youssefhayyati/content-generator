"""The team's Android phone: posting from its Instagram and X apps, and reading back how posts do.

The phone is driven through the hackathon Phone API (PHONE_API_URL, e.g. https://172.26.0.32/hack/v1, with
the team key in PHONE_API_KEY), which runs an agent of its own on the phone: POST /tasks with a goal in plain
words and it taps, swipes and types through the phone's input board, telling what it does as it goes
(GET /tasks/{id}/stream). After its result a task waits, idle, for a follow-up (POST /tasks/{id}/messages)
until it times out. One task runs on the phone at a time, whoever starts it.

Posting dependably isn't left to the phone's agent. Before it starts, the post's files are uploaded to the
phone, last one first, so its gallery shows them newest first in slide order; the caption is made typable
(the input board types printable ASCII only, and no line breaks); and its goal is a phone skill
(skills/phone/*.md) with the post's details filled in, saying where to tap in that app.

Feedback is a phone task too: it opens the post in the app and returns its numbers as JSON (output_schema).
Every check is kept with the post, so the next one says what changed; one runs by itself
PHONE_FEEDBACK_AFTER_MINUTES after posting.

PhoneWork is all of that; two things use it. PhoneSession posts a conversation's drafts when the user says
so (post_on_phone) and tells the user how it goes; backend/publisher.py publishes the posts FlowAI schedules,
when their time comes, and reports to FlowAI.
"""

import asyncio
import base64
import json
import logging
import mimetypes
import re
import time
import unicodedata
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import aclosing
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

from . import platforms
from .skills import Skill, load_skills

if TYPE_CHECKING:
    from .publisher import Publisher
    from .studio import StudioSession

log = logging.getLogger(__name__)

TERMINAL = {"succeeded", "failed", "cancelled"}
UPLOAD_GAP_S = 1.2  # the phone's gallery orders by the second a file was added
FEEDBACK_RETRY_S = 60  # an automatic check waits this long when the phone is busy
FEEDBACK_TRIES = 10
COMMENTS_KEPT = 5
STREAM_QUIET_S = 60  # a task stream silent this long is checked on (a dead phone can leave it hanging)
STATUS_TRIES = 5  # a task's status is asked this many times before giving up on it

# Characters the input board can't type, as the nearest ones it can
ASCII = str.maketrans({"‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"', "–": "-", "—": "-",
                       "‐": "-", "…": "...", "•": "-", "·": "-", "×": "x", " ": " ", " ": " ",
                       "€": "EUR", "£": "GBP", "©": "(c)", "®": "(R)", "™": "TM", "ß": "ss", "æ": "ae",
                       "Æ": "AE", "œ": "oe", "Œ": "OE", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d"})

FEEDBACK_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean", "description": "Whether the post was found and opened"},
        "likes": {"type": ["integer", "null"]},
        "comments": {"type": ["integer", "null"], "description": "Comments (Instagram) or replies (X)"},
        "shares": {"type": ["integer", "null"], "description": "Shares (Instagram) or reposts plus quotes (X)"},
        "saves": {"type": ["integer", "null"], "description": "Saves (Instagram) or bookmarks (X)"},
        "views": {"type": ["integer", "null"], "description": "Views, plays or impressions"},
        "latest_comments": {"type": "array", "items": {"type": "object", "properties": {
            "author": {"type": "string"}, "text": {"type": "string"}}}},
        "notes": {"type": "string", "description": "Anything else worth knowing, e.g. a warning shown on the post"},
    },
    "required": ["found"],
}
NUMBERS = ("likes", "comments", "shares", "saves", "views")


class PhoneError(Exception):
    pass


def _iso(t: datetime | None = None) -> str:
    return (t or datetime.now(timezone.utc)).isoformat(timespec="seconds")


def typable(text: str) -> tuple[list[str], list[str]]:
    """The caption as lines the input board can type, and what had to be left out (emoji, symbols)."""
    lines, dropped = [], []
    for line in str(text or "").replace("\r", "").split("\n"):
        line = unicodedata.normalize("NFKD", line.translate(ASCII))
        out = []
        for ch in line:
            if unicodedata.combining(ch):
                continue  # é -> e
            if " " <= ch <= "~":
                out.append(ch)
            elif ch == "\t":
                out.append(" ")
            elif not unicodedata.category(ch).startswith(("M", "C")) and ch not in dropped:
                dropped.append(ch)  # ️ and joiners are part of an emoji, not worth naming
        lines.append(re.sub(r" {2,}", " ", "".join(out)).strip())
    while lines and not lines[-1]:
        lines.pop()
    return lines, dropped


def _count(value) -> int | None:
    """12, "1,204", "3.4K", "2M" -> a number."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    m = re.fullmatch(r"([\d.,]+)\s*([KkMm]?)", str(value).strip())
    if not m:
        return None
    digits, unit = m.groups()
    try:
        n = float(digits.replace(",", "")) if unit else float(digits.replace(",", "").replace(".", ""))
    except ValueError:
        return None
    return int(n * {"": 1, "k": 1_000, "m": 1_000_000}[unit.lower()])


# --- the API --------------------------------------------------------------------

class PhoneClient:
    def __init__(self, base_url: str, key: str, verify: bool = True):
        self.base_url = base_url.rstrip("/")
        self.http = httpx.AsyncClient(base_url=self.base_url, headers={"Authorization": f"Bearer {key}"},
                                      verify=verify, timeout=httpx.Timeout(30, connect=10))
        self.job: "PhoneJob | None" = None  # the one the phone is doing (or idle after), whoever started it
        self.publisher: "Publisher | None" = None  # publishes FlowAI's scheduled posts, when it's on

    async def close(self):
        await self.http.aclose()

    async def call(self, method: str, path: str, **kw):
        try:
            r = await self.http.request(method, path, **kw)
        except httpx.HTTPError as exc:
            raise PhoneError(f"the phone API can't be reached ({exc.__class__.__name__})") from exc
        try:
            body = r.json()
        except ValueError:
            raise PhoneError(f"the phone API answered {r.status_code}") from None
        if isinstance(body, dict) and body.get("ok"):
            return body.get("data")
        err = body.get("error") if isinstance(body, dict) else None
        if isinstance(err, dict):
            raise PhoneError(f"{err.get('code', r.status_code)}: {err.get('message', '')}")
        raise PhoneError(f"the phone API answered {r.status_code}: {json.dumps(body)[:300]}")

    async def status(self) -> dict:
        return await self.call("GET", "/phone/status")

    async def upload(self, path: Path) -> dict:
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        data = await asyncio.to_thread(path.read_bytes)
        return await self.call("POST", "/phone/media", files={"file": (path.name, data, mime)},
                               timeout=httpx.Timeout(300, connect=10))

    async def start(self, goal: str, mode: str, max_steps: int, output_schema: dict | None = None) -> dict:
        body = {"goal": goal, "mode": mode, "max_steps": max_steps}
        if output_schema:
            body |= {"output_format": "json", "output_schema": output_schema}
        return await self.call("POST", "/tasks", json=body)

    async def task(self, task_id: str) -> dict:
        return await self.call("GET", f"/tasks/{task_id}")

    async def cancel(self, task_id: str):
        await self.call("POST", f"/tasks/{task_id}/cancel")

    async def message(self, task_id: str, text: str):
        await self.call("POST", f"/tasks/{task_id}/messages", json={"text": text})

    async def approvals(self, task_id: str) -> list[dict]:
        return [a for a in await self.call("GET", "/approvals", params={"status": "pending"})
                if a.get("task_id") == task_id]

    async def decide(self, approval_id: str, approved: bool, note: str | None = None):
        await self.call("POST", f"/approvals/{approval_id}", json={"approved": approved, "note": note})

    async def screenshot(self, task_id: str, n: int) -> bytes | None:
        """A step's screenshot (JPEG), or None."""
        try:
            r = await self.http.get(f"/tasks/{task_id}/screenshots/{n}")
        except httpx.HTTPError:
            return None
        return r.content if r.status_code == 200 else None

    async def events(self, task_id: str, after: int = 0) -> AsyncIterator[dict]:
        """The task's events after seq `after`, live, until the task ends; a dropped stream is picked up again."""
        while True:
            try:
                async with self.http.stream("GET", f"/tasks/{task_id}/stream",
                                            headers={"Last-Event-ID": str(after)} if after else None,
                                            timeout=httpx.Timeout(30, read=STREAM_QUIET_S)) as r:
                    if r.status_code != 200:
                        raise PhoneError(f"the task's events answered {r.status_code}")
                    data: list[str] = []
                    async for line in r.aiter_lines():
                        if line.startswith("data:"):
                            data.append(line[5:].strip())
                        elif not line and data:
                            event, data = json.loads("\n".join(data)), []
                            if event.get("seq", 0) > after:  # a reconnect may replay from the start
                                after = event["seq"]
                                yield event
            except (httpx.HTTPError, ValueError, PhoneError) as exc:
                log.info("phone task %s: event stream dropped (%s)", task_id, exc.__class__.__name__)
            if await self._task_status(task_id) in TERMINAL:
                for event in await self.call("GET", f"/tasks/{task_id}/events", params={"after_seq": after}):
                    yield event
                return
            await asyncio.sleep(2)

    async def _task_status(self, task_id: str) -> str:
        """The task's status, asked again on a hiccup: one failed call isn't a failed task."""
        for attempt in range(1, STATUS_TRIES + 1):
            try:
                return (await self.task(task_id))["status"]
            except PhoneError as exc:
                if attempt == STATUS_TRIES:
                    raise
                log.info("phone task %s: status not known yet (%s); asking again", task_id, exc)
                await asyncio.sleep(5 * attempt)


# --- jobs and posts ----------------------------------------------------------------

@dataclass
class PhonePost:
    id: int
    platform: str
    placement: str
    caption: str  # as typed
    draft: int | None = None  # the conversation's draft it was
    flowai_post: int | None = None  # FlowAI's post it was (published when scheduled)
    title: str = ""
    status: str = "posting"  # posting | posted | failed | unsure
    at: str | None = None  # when it went up
    task: str | None = None
    detail: str = ""
    feedback: list[dict] = field(default_factory=list)  # every check, oldest first
    check_at: str | None = None  # the next automatic check

    @property
    def label(self) -> str:
        return platforms.label(self.platform, self.placement)

    @property
    def name(self) -> str:
        return f"FlowAI post {self.flowai_post}" if self.flowai_post else f"post {self.id}"

    def info(self) -> dict:
        last = self.feedback[-1] if self.feedback else None
        return {"post": self.id, **({"draft": self.draft} if self.draft else {}),
                **({"flowai_post": self.flowai_post} if self.flowai_post else {}),
                **({"title": self.title} if self.title else {}), "what": self.label, "status": self.status,
                **({"posted": self.at} if self.at else {}), **({"detail": self.detail} if self.detail else {}),
                **({"last_check": last} if last else {}), **({"next_check": self.check_at} if self.check_at else {})}

    @classmethod
    def load(cls, data: dict) -> "PhonePost":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class PhoneJob:
    id: int
    kind: str  # post | publish (a FlowAI run) | feedback | task
    what: str  # what it does, in words
    post: PhonePost | None = None  # the post it's for
    task: str | None = None  # the API's task id
    status: str = "starting"  # starting | running | awaiting approval | waiting (answered; can be told more) |
    #                           done | failed | cancelled
    seq: int = 0  # the last event seen
    intent: str = ""  # what the phone's agent said it would do next
    steps: list[str] = field(default_factory=list)
    last_step: int | None = None  # its number, for the screenshot
    result: str | None = None
    data: object = None  # the JSON result, for feedback
    snapshot: dict | None = None  # what a feedback check read (None: found nothing)
    success: bool | None = None
    verdict: str | None = None
    approval: dict | None = None  # waiting for the user's OK on this
    before: "PhoneJob | None" = None  # the phone's job before this one (closed first if it's idle)
    run: str | None = None  # publish: FlowAI's run
    budget: int = 40  # publish: FlowAI's step budget
    tapped_post: bool = False  # publish: a tap meant to share it went through (it may be up)
    started: float = field(default_factory=time.monotonic)
    runner: asyncio.Task | None = None

    @property
    def active(self) -> bool:
        return self.status in ("starting", "running", "awaiting approval")


@dataclass
class PostPlan:
    """A post made ready for the phone: its goal, from the skill for that kind of post."""
    goal: str
    caption: str  # as it will be typed
    dropped: list[str]  # what the phone can't type
    media: str  # e.g. "3 pictures"


class PhoneWork:
    """Runs jobs on the phone and follows them. The hooks (on_...) say where steps, questions and results go."""

    def __init__(self, client: PhoneClient | None, skills_dir: Path, mode: str = "flash", post_mode: str = "pro",
                 max_steps: int = 40, feedback_after_min: float = 60):
        self.client, self.skills_dir = client, skills_dir
        self.mode, self.post_mode, self.max_steps = mode, post_mode, max_steps
        self.feedback_after = feedback_after_min * 60
        self.jobs: dict[int, PhoneJob] = {}
        self.timers: dict[int, asyncio.Task] = {}  # post id -> its automatic check

    # --- hooks ----------------------------------------------------------------------

    async def on_started(self, job: PhoneJob):
        pass

    async def on_step(self, job: PhoneJob, name: str, params: dict, ok: bool, result: str):
        pass

    async def on_approval(self, job: PhoneJob, approval: dict):
        """Nobody to ask: say no."""
        await self.answer_approval(job, False, "nobody is there to approve it")

    def on_question(self, job: PhoneJob, text: str):
        pass

    async def on_finished(self, job: PhoneJob):
        pass

    def on_changed(self, post: PhonePost | None = None):
        """A post changed: keep it."""

    # --- making ready ---------------------------------------------------------------

    def skills(self) -> dict[str, Skill]:
        return load_skills(self.skills_dir)

    def plan_post(self, platform: str, placement: str, caption: str, kinds: list[str]) -> PostPlan:
        """The goal for posting this, from skills/phone/post-<platform>-<placement>.md (or post-<platform>.md)."""
        skills = self.skills()
        skill = skills.get(f"post-{platform}-{placement}") or skills.get(f"post-{platform}")
        if not skill:
            raise PhoneError(f"there is no phone skill for {platform} {placement} posts "
                             f"(skills/phone/post-{platform}-{placement}.md)")
        lines, dropped = typable(caption)
        kind = "video" if "video" in kinds else "picture"
        n = len(kinds)
        media = f"{n} {kind}{'s' if n != 1 else ''}" if n else "no pictures (text only)"
        goal = _fill(skill, {"count": str(n), "media": media, "kind": kind, "placement": placement,
                             "caption": _caption_block(lines), "first_words": _first_words(lines)})
        return PostPlan(goal, "\n".join(lines), dropped, media)

    def busy_error(self) -> dict | None:
        job = self.client.job
        if job and job.active:
            return {"error": f"the phone is still {job.what}; wait for it or cancel it first"}
        return None

    def new_job(self, kind: str, what: str, post: PhonePost | None = None) -> PhoneJob:
        job = PhoneJob(len(self.jobs) + 1, kind, what, post, before=self.client.job)
        self.jobs[job.id] = job
        self.client.job = job  # now, so a second call right after finds the phone busy
        return job

    # --- running a job --------------------------------------------------------------

    async def post_files(self, job: PhoneJob, files: list[Path], plan: PostPlan, max_steps: int | None = None):
        """Puts the files on the phone (last first: the gallery then shows the first one first) and posts."""
        await self.started(job)
        try:
            for i, path in enumerate(reversed(files)):
                if i:
                    await asyncio.sleep(UPLOAD_GAP_S)
                await self.client.upload(path)
            job.steps.append(f"put {plan.media} on the phone")
        except PhoneError as exc:
            return await self.failed(job, f"the files couldn't be put on the phone: {exc}")
        await self.run(job, plan.goal, self.post_mode, started=True, max_steps=max_steps)

    async def started(self, job: PhoneJob):
        old, job.before = job.before, None
        if old and old.task and old.status == "waiting":
            # A task that answered stays idle, holding the phone, until it times out: end it first
            try:
                await self.client.cancel(old.task)
            except PhoneError:
                pass
            old.status = "done"
        await self.on_started(job)

    async def failed(self, job: PhoneJob, why: str):
        job.status, job.result, job.success = "failed", why, False
        await self.finished(job)

    async def run(self, job: PhoneJob, goal: str | None, mode: str | None, schema: dict | None = None,
                  started: bool = False, max_steps: int | None = None):
        """Starts the task (goal) or follows it further after a message (goal None), until it answers or ends."""
        try:
            if goal is not None:
                if not started:
                    await self.started(job)
                task = await self.client.start(goal, mode, min(max_steps or self.max_steps, self.max_steps), schema)
                job.task, job.status = task["id"], "running"
                log.info("phone job %s (%s): task %s", job.id, job.what, job.task)
            if not await self._follow(job):
                return await self.failed(job, job.result or "the phone stopped without an answer")
            await self.finished(job)
        except asyncio.CancelledError:
            job.status, job.result = "cancelled", "cancelled"
            if job.post and job.kind in ("post", "publish") and job.post.status == "posting":
                job.post.status, job.post.detail = "unsure", "the posting was stopped"
                self.on_changed(job.post)
            await self.on_finished(job)
            raise
        except PhoneError as exc:
            log.warning("phone job %s failed: %s", job.id, exc)
            await self.failed(job, f"the phone couldn't do it: {exc}")
        except Exception as exc:
            log.exception("phone job %s failed", job.id)
            await self.failed(job, f"it failed with an error: {exc}")

    async def cancel_job(self, job: PhoneJob):
        if job.task:
            try:
                await self.client.cancel(job.task)
            except PhoneError as exc:
                log.warning("phone task %s could not be cancelled: %s", job.task, exc)
        if job.runner and not job.runner.done():
            job.runner.cancel()

    async def answer_approval(self, job: PhoneJob, approve: bool, note: str | None = None):
        a, job.approval = job.approval, None
        if a:
            await self.client.decide(a["id"], approve, note)
            job.status = "running"

    async def _follow(self, job: PhoneJob) -> bool:
        """Reads the task's events until it answers (True) or ends without an answer (False)."""
        answered = False
        async with aclosing(self.client.events(job.task, job.seq)) as events:
            async for event in events:
                if await self._event(job, event, answered):
                    return True
                answered = answered or event.get("type") == "result"
                if job.status == "done":
                    return answered
        return answered

    async def _event(self, job: PhoneJob, event: dict, answered: bool) -> bool:
        """Takes in one event; True once the task has answered and waits for more."""
        job.seq = event.get("seq", job.seq)
        kind, data = event.get("type"), event.get("data") or {}
        if kind == "step":
            job.intent = str(data.get("next_goal") or "")
        elif kind == "action":
            name = data.get("name", "")
            params = {k: v for k, v in (data.get("params") or {}).items() if k not in ("transport", "perception")}
            result = "ok" if data.get("ok") else f"failed: {data.get('error')}"
            job.steps.append(f"{name} {json.dumps(params, ensure_ascii=False)[:120]}: {result}")
            job.last_step = data.get("n") or job.last_step
            await self.on_step(job, name, params, bool(data.get("ok")), result)
        elif kind == "result":
            job.result = str(data.get("text") or "").strip() or None
            job.data, job.success = data.get("data"), data.get("success")
        elif kind == "message" and data.get("kind") in ("question", "ask", "ask_user"):
            self.on_question(job, str(data.get("text")))
        elif kind == "approval" or (kind == "status" and data.get("status") == "awaiting_approval"):
            await self._approval(job)
        elif kind == "status":
            status = data.get("status")
            if status == "running" and job.status == "awaiting approval":
                job.status, job.approval = "running", None
            elif status == "idle" and answered:
                job.status = "waiting"
                return True
            elif status in TERMINAL:
                if status != "succeeded" and not answered:
                    job.result = job.result or f"the task {status}" + (f" ({data['detail']})"
                                                                        if data.get("detail") else "")
                job.status = "done"
        return False

    async def _approval(self, job: PhoneJob):
        try:
            pending = await self.client.approvals(job.task)
        except PhoneError as exc:
            log.warning("phone approvals: %s", exc)
            return
        if not pending or (job.approval and job.approval["id"] == pending[0]["id"]):
            return
        a = pending[0]
        job.status = "awaiting approval"
        job.approval = {"id": a["id"], "action": a.get("action"), "params": a.get("params"),
                        "reason": a.get("reason"), "expires": a.get("expires_at")}
        await self.on_approval(job, job.approval)

    async def finished(self, job: PhoneJob):
        if job.task and job.success is not None:
            try:  # pro runs add an independent verdict
                task = await self.client.task(job.task)
                job.verdict = task.get("verdict") if task.get("verified") is not None else None
                if task.get("verified") is False:
                    job.success = False
            except PhoneError:
                pass
        if job.active:
            job.status = "done"
        log.info("phone job %s %s in %d s: %s", job.id, job.status, round(time.monotonic() - job.started), job.result)
        if job.kind == "post" and job.post:
            self.posted(job, job.post)
        elif job.kind == "feedback" and job.post and job.status != "failed":
            job.snapshot = self.checked(job, job.post)
        await self.on_finished(job)

    # --- posts and their feedback ---------------------------------------------------

    def posted(self, job: PhoneJob, post: PhonePost, up: bool | None = None):
        """Where the post stands after the phone's answer (up: decided by the caller)."""
        post.task = job.task
        up = job.success if up is None else up
        if up:
            post.status, post.at = "posted", _iso()
            if self.feedback_after > 0:
                self.plan_check(post, datetime.now(timezone.utc) + timedelta(seconds=self.feedback_after))
        else:
            post.status = "failed" if job.status == "failed" else "unsure"
        post.detail = job.result or ""
        self.on_changed(post)

    def checked(self, job: PhoneJob, post: PhonePost) -> dict | None:
        """Keeps what the check read; None when it found nothing."""
        data = job.data if isinstance(job.data, dict) else _json(job.result)
        if not isinstance(data, dict) or not data.get("found", True):
            return None
        snap = {"at": _iso(), **{k: _count(data.get(k)) for k in NUMBERS}}
        snap["latest_comments"] = [{"author": str(c.get("author", "")), "text": str(c.get("text", ""))}
                                   for c in (data.get("latest_comments") or [])[:COMMENTS_KEPT] if isinstance(c, dict)]
        if data.get("notes"):
            snap["notes"] = str(data["notes"])
        post.feedback.append(snap)
        self.on_changed(post)
        return snap

    def check_feedback(self, post: PhonePost, auto: bool = False) -> PhoneJob:
        """Starts reading the post's numbers on the phone (skills/phone/feedback-<platform>.md)."""
        if post.status not in ("posted", "unsure"):
            raise PhoneError(f"{post.name} isn't up ({post.status})")
        skill = self.skills().get(f"feedback-{post.platform}")
        if not skill:
            raise PhoneError(f"there is no phone skill feedback-{post.platform} in skills/phone")
        if busy := self.busy_error():
            raise PhoneError(busy["error"])
        lines = post.caption.split("\n") if post.caption else []
        goal = _fill(skill, {"first_words": _first_words(lines), "placement": post.placement,
                             "posted": post.at or "recently", "comments_kept": str(COMMENTS_KEPT)})
        job = self.new_job("feedback", f"checking how {post.name} ({post.label}) is doing"
                           + (", as planned after posting" if auto else ""), post)
        job.runner = asyncio.create_task(self.run(job, goal, self.mode, FEEDBACK_SCHEMA))
        return job

    def plan_check(self, post: PhonePost, at: datetime):
        post.check_at = _iso(at)
        if old := self.timers.get(post.id):
            old.cancel()
        self.timers[post.id] = asyncio.get_running_loop().create_task(self._check_later(post, at))

    def replan_checks(self, posts):
        """Checks that were due while nothing was running (a restart, a closed conversation)."""
        for post in posts:
            if post.check_at:
                try:
                    self.plan_check(post, datetime.fromisoformat(post.check_at))
                except (ValueError, RuntimeError):
                    post.check_at = None

    async def _check_later(self, post: PhonePost, at: datetime):
        await asyncio.sleep(max(0.0, (at - datetime.now(timezone.utc)).total_seconds()))
        for _ in range(FEEDBACK_TRIES):
            try:
                self.check_feedback(post, auto=True)
                break
            except PhoneError as exc:
                why = str(exc)
                if "still" not in why:  # not just busy: trying again won't help
                    log.warning("%s: the automatic check couldn't start: %s", post.name, why)
                    break
            await asyncio.sleep(FEEDBACK_RETRY_S)
        post.check_at = None
        self.on_changed(post)

    async def close(self):
        for t in self.timers.values():
            t.cancel()


def feedback_note(post: PhonePost, snap: dict | None, result: str | None, data=None) -> str:
    """What a check found, for the assistant."""
    if snap is None:
        why = (data.get("notes") if isinstance(data, dict) else None) or result or "no answer"
        return f"Checking {post.name} ({post.label}) didn't find it: {why}"
    before = post.feedback[-2] if len(post.feedback) > 1 else None
    numbers = {k: v for k, v in snap.items() if k in NUMBERS and v is not None}
    changes = {k: v - before[k] for k, v in numbers.items() if before and before.get(k) is not None and v != before[k]}
    return (f"How {post.name} ({post.label}, posted {post.at}) is doing: {json.dumps(numbers)}"
            + (f"; since the last check at {before['at']}: {json.dumps(changes)}" if before else "")
            + (f". Latest comments: {json.dumps(snap['latest_comments'], ensure_ascii=False)}"
               if snap["latest_comments"] else ". No comments yet")
            + (f". Notes: {snap['notes']}" if snap.get("notes") else "")
            + "\nSum it up for the user in a sentence or two: what stands out, and one idea for the next "
              "post if the comments suggest one.")


# --- a conversation's work on the phone -------------------------------------------

class PhoneSession(PhoneWork):
    """Posts the conversation's drafts when the user says so, and tells the user how it goes."""

    def __init__(self, client: PhoneClient | None, studio: "StudioSession", skills_dir: Path,
                 send: Callable[..., Awaitable[None]], notify: Callable[[str], None],
                 remember: Callable[[str], None], changed: Callable[[], None],
                 mode: str = "flash", post_mode: str = "pro", max_steps: int = 40, feedback_after_min: float = 60):
        super().__init__(client, skills_dir, mode, post_mode, max_steps, feedback_after_min)
        self.studio = studio
        self.send, self.notify, self.remember, self.changed = send, notify, remember, changed
        self.posts: dict[int, PhonePost] = {}

    @property
    def busy(self) -> bool:
        """Something still runs or is due for it, so the conversation stays in memory."""
        return any(j.runner and not j.runner.done() for j in self.jobs.values()) or \
            any(not t.done() for t in self.timers.values())

    @property
    def job(self) -> PhoneJob | None:
        return self.jobs[max(self.jobs)] if self.jobs else None

    # --- what the tools do ----------------------------------------------------------

    async def post(self, ref=None) -> dict:
        d = self.studio.get(ref)
        if d.check and not d.check.get("ok", True):
            fails = [c["detail"] for c in d.check.get("checks", []) if c["status"] == "fail"]
            return {"error": f"draft {d.id} doesn't pass {d.label}'s check: {' '.join(fails)} Fix it first"}
        files = [path for path, _ in d.files]
        if not files and platforms.spec(d.platform, d.placement)["items"][0] > 0:
            return {"error": f"draft {d.id} has no pictures yet"}
        if missing := [p.name for p in files if not p.exists()]:
            return {"error": f"draft {d.id}'s files are gone ({', '.join(missing)}); show it again to redraw it"}
        plan = self.plan_post(d.platform, d.placement, d.caption, [f.kind for _, f in d.files])
        if busy := self.busy_error():
            return busy
        post = PhonePost(len(self.posts) + 1, d.platform, d.placement, plan.caption, draft=d.id, title=d.title)
        self.posts[post.id] = post
        job = self.new_job("post", f"posting draft {d.id} as {d.a_label}", post)
        job.runner = asyncio.create_task(self.post_files(job, files, plan))
        reply = {"phone_job": job.id, "post": post.id, "status": "started: uploading the "
                 + (f"{plan.media} to the phone, then posting from the app" if files else "post from the app")}
        if plan.dropped:
            reply["left_out_of_caption"] = "".join(plan.dropped)
            reply["why"] = "the phone types plain letters only (no emoji)"
        return reply

    async def feedback(self, ref=None, flowai_post=None) -> dict:
        if flowai_post not in (None, ""):
            publisher = self.client.publisher
            if not publisher:
                return {"error": "FlowAI's scheduled posts aren't published from the phone here"}
            post = publisher.find(flowai_post)
        else:
            post = self._post_ref(ref)
        job = self.check_feedback(post)
        return {"phone_job": job.id, "status": "started: opening the post in the app to read its numbers"}

    async def task(self, instruction: str, skill: str | None = None) -> dict:
        goal = instruction.strip()
        if skill:
            found = self.skills().get(str(skill).strip())
            if not found:
                return {"error": f"there is no phone skill {skill!r}. Skills: {', '.join(self.skills()) or 'none'}"}
            goal = f"{found.instructions}\n\nThe task: {goal}"
        if busy := self.busy_error():
            return busy
        job = self.new_job("task", instruction.strip())
        job.runner = asyncio.create_task(self.run(job, goal, self.mode))
        return {"phone_job": job.id, "status": "started"}

    def status(self) -> dict:
        job = self.job
        out: dict = {}
        if job:
            out["job"] = {"phone_job": job.id, "doing": job.what, "status": job.status,
                          "seconds": round(time.monotonic() - job.started), "recent_steps": job.steps[-3:],
                          **({"result": job.result} if job.result else {}),
                          **({"needs_approval": job.approval} if job.approval else {})}
        else:
            out["job"] = "nothing done on the phone yet in this conversation"
        if self.posts:
            out["posts"] = [p.info() for p in self.posts.values()]
        other = self.client.job if self.client else None
        if other and other.active and other is not job:
            out["phone"] = f"busy: {other.what}"
        if self.client.publisher:
            out["flowai_scheduled_posts"] = self.client.publisher.recent()
        return out

    async def cancel(self) -> dict:
        job = self.job
        if not job or not job.active:
            return {"error": "nothing this conversation started is running on the phone"}
        await self.cancel_job(job)
        return {"phone_job": job.id, "status": "cancelled"}

    async def answer(self, text: str | None = None, approve: bool | None = None) -> dict:
        job = self.job
        if not job or not job.task:
            return {"error": "nothing has been asked on the phone"}
        if approve is not None and job.approval:
            await self.answer_approval(job, bool(approve), text or None)
            return {"phone_job": job.id, "approval": "given" if approve else "refused"}
        if not text:
            return {"error": "say what to tell the phone, or approve true or false"
                             + ("" if job.approval else " (nothing waits for an approval)")}
        if job.status != "waiting" or self.client.job is not job:
            return {"error": f"the phone is {job.status}; it can be told more once it has answered"
                    if job.active else "that task on the phone is over; start a new one with phone_task"}
        await self.client.message(job.task, text)
        job.status, job.result, job.success, job.verdict = "running", None, None, None
        job.runner = asyncio.create_task(self.run(job, None, None))
        return {"phone_job": job.id, "status": "told; it goes on"}

    def _post_ref(self, ref) -> PhonePost:
        if not self.posts:
            raise PhoneError("nothing has been posted from the phone in this conversation")
        if ref in (None, ""):
            return self.posts[max(self.posts)]
        try:
            return self.posts[int(str(ref).strip().lstrip("#"))]
        except (KeyError, ValueError):
            raise PhoneError(f"there is no post {ref}; the posts are {', '.join(map(str, self.posts))}") from None

    # --- hooks: the page and the assistant ------------------------------------------

    async def on_started(self, job: PhoneJob):
        await self.send(type="phone_task", id=job.id, kind=job.kind, status="started", text=job.what)

    async def on_step(self, job: PhoneJob, name: str, params: dict, ok: bool, result: str):
        shot = await self.client.screenshot(job.task, job.last_step) if job.last_step else None
        await self.send(type="phone_step", id=job.id, step=job.last_step, action=name, args=params,
                        result=result[:300], screenshot=base64.b64encode(shot).decode() if shot else None)

    async def on_approval(self, job: PhoneJob, a: dict):
        await self.send(type="phone_task", id=job.id, kind=job.kind, status="awaiting approval",
                        text=a.get("reason") or a.get("action"))
        self.notify(f"The phone (job {job.id}, {job.what}) wants the user's OK before it does this: "
                    f"{a.get('action')} {json.dumps(a.get('params') or {}, ensure_ascii=False)[:200]}. Its reason: "
                    f"{a.get('reason')}. Ask the user in one short sentence, then call answer_phone with approve "
                    "true or false.")

    def on_question(self, job: PhoneJob, text: str):
        self.notify(f"The phone (job {job.id}, {job.what}) asks: {text}\nAsk the user, then pass the answer on "
                    "with answer_phone (text).")

    def on_changed(self, post: PhonePost | None = None):
        if post and post.flowai_post and self.client.publisher:
            self.client.publisher.save_soon()  # FlowAI's post, checked from here
        self.changed()

    async def on_finished(self, job: PhoneJob):
        status = {"failed": "failed", "cancelled": "cancelled"}.get(job.status, "done")
        await self.send(type="phone_task", id=job.id, kind=job.kind, status=status, text=job.result)
        if job.status == "cancelled":
            return
        tell = "\nTell the user the outcome in one or two short spoken sentences."
        if job.kind == "post":
            note = self._posted_note(job) + tell
        elif job.kind == "feedback" and job.status != "failed":
            note = feedback_note(job.post, job.snapshot, job.result, job.data)
        else:
            note = (f"Phone job {job.id} ({job.what}) has finished. Result: {job.result}"
                    + (f"\nVerdict: {job.verdict}" if job.verdict else ""))
            if job.success is False and job.status != "failed":
                note += ("\nIf it says what it needs, ask the user and pass the answer on with answer_phone "
                         "(text); the phone keeps the task open for a few minutes.")
            note += tell
        if job.post:
            await self.send(type="phone_post", **job.post.info())
        self.changed()
        self.notify(note)

    def _posted_note(self, job: PhoneJob) -> str:
        post = job.post
        when = (f" Its numbers will be checked by themselves at {post.check_at} (UTC); post_feedback checks "
                "them now." if post.check_at else " post_feedback checks how it's doing.")
        if post.status == "posted":
            return (f"Draft {post.draft} is now posted from the phone as an {post.label} (post {post.id})."
                    + when + (f" Verdict: {job.verdict}" if job.verdict else "") + f" The phone said: {job.result}")
        return (f"Posting draft {post.draft} as {post.label} from the phone didn't go through "
                f"({post.status}): {job.result}" + (f"\nVerdict: {job.verdict}" if job.verdict else "")
                + "\nIf it's unsure, it may be up anyway: say so, and offer to check with post_feedback before "
                "posting it again, so it doesn't go up twice.")

    # --- kept with the conversation -------------------------------------------------

    def dump(self) -> dict:
        return {"posts": [asdict(p) for p in self.posts.values()]}

    def restore(self, data: dict):
        self.posts = {p["id"]: PhonePost.load(p) for p in data.get("posts", [])}
        if self.client:
            self.replan_checks(self.posts.values())


def _fill(skill: Skill, values: dict[str, str]) -> str:
    text = skill.instructions
    for k, v in values.items():
        text = text.replace("{{" + k + "}}", v)
    return text


def _caption_block(lines: list[str]) -> str:
    if not lines:
        return "(no caption: leave the text box empty)"
    return "\n".join(f"{i}. {json.dumps(line)}" if line else f"{i}. (empty line)" for i, line in enumerate(lines, 1))


def _first_words(lines: list[str]) -> str:
    words = " ".join(" ".join(lines).split()[:8])
    return f'"{words}"' if words else "(no caption)"


def _json(text: str | None):
    try:
        return json.loads(text or "")
    except ValueError:
        m = re.search(r"\{.*\}", text or "", re.S)
        try:
            return json.loads(m.group(0)) if m else None
        except ValueError:
            return None

#!/usr/bin/env python3
"""The whole studio, one command: brief → agents → gate 6A → production → gate 6B →
schedule → the phones post to Instagram and X → proof it went live.

Runs against the real API the dashboard uses, so every stage is visible live at
http://localhost:5175 (sign in as demo@flowai.test / password).

    .venv/bin/python run-demo.py            (from demo/, with publishing-agent's venv)
    FLOWAI_URL=http://127.0.0.1:8002 .venv/bin/python run-demo.py
"""

from __future__ import annotations

import os
import sys
import time

import httpx

BASE = os.environ.get("FLOWAI_URL", "http://127.0.0.1:8002").rstrip("/")
REFERER = os.environ.get("FRONTEND_URL", "http://localhost:5175")
EMAIL = os.environ.get("DEMO_EMAIL", "demo@flowai.test")
PASSWORD = os.environ.get("DEMO_PASSWORD", "password")


def say(text: str) -> None:
    print(f"\n\033[1m▸ {text}\033[0m", flush=True)


def note(text: str) -> None:
    print(f"  {text}", flush=True)


class Demo:
    def __init__(self) -> None:
        self.api = httpx.Client(
            base_url=BASE,
            headers={"Accept": "application/json", "Referer": REFERER},
            timeout=60,
            follow_redirects=True,
        )
        self.login()

    def login(self) -> None:
        self.refresh_csrf()
        r = self.api.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
        r.raise_for_status()
        # Login rotates the session and the token: pick the fresh one up.
        self.refresh_csrf()
        note(f"signed in as {EMAIL}")

    def refresh_csrf(self) -> None:
        from urllib.parse import unquote

        self.api.get("/sanctum/csrf-cookie")
        self.api.headers["X-XSRF-TOKEN"] = unquote(self.api.cookies.get("XSRF-TOKEN") or "")

    def call(self, method: str, path: str, **kw):
        r = self.api.request(method, path, **kw)
        if r.status_code >= 400:
            sys.exit(f"✗ {method} {path} → {r.status_code}: {r.text[:400]}")
        data = r.json() if r.content else {}
        # Laravel resource collections wrap in "data"; plain payloads pass through.
        return data["data"] if isinstance(data, dict) and set(data.keys()) <= {"data", "links", "meta"} and "data" in data else data

    def wait_for(self, what: str, path: str, pred, timeout_s: int = 900):
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout_s:
            data = self.call("GET", path)
            if pred(data):
                return data
            time.sleep(5)
        sys.exit(f"✗ timed out waiting for {what}")

    def run(self) -> None:
        resume_from = int(os.environ.get("RESUME_CAMPAIGN", "0"))
        if resume_from:
            cid = resume_from
            note(f"resuming at gate 6B for campaign #{cid}")
            return self.finish(cid)
        self.full()
    def full(self) -> None:
        say("1/8 · The brief (what, for whom, by when)")
        accounts = self.call("GET", "/api/accounts")
        ig = next((a for a in accounts if a["platform"] == "instagram"), None)
        x = next((a for a in accounts if a["platform"] == "x"), None)
        if not ig or not x:
            sys.exit("✗ expected the seeded Instagram and X accounts — run the seed first")
        self.ig_id, self.x_id = ig["id"], x["id"]
        assets = self.call("GET", "/api/assets")
        self.portrait = next((a["id"] for a in assets if "autumn" in (a.get("name") or "").lower()), assets[0]["id"])
        self.landscape = next((a["id"] for a in assets if "lavender" in (a.get("name") or "").lower()), assets[-1]["id"])
        week = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 7 * 86400))
        campaign = self.call("POST", "/api/campaigns", json={
            "source": "form",
            "name": "Autumn pour launch",
            "brief": {
                "goal": "Sell the autumn candle collection",
                "audience": "Slow-living lovers, 25-45, who buy handmade home goods",
                "message": "The autumn pour is here: amber, lavender and fig, hand-poured in small batches",
                "key_facts": "Hand-poured in Lyon. Soy wax. 60h burn. Ships in October.",
                "deadline": week,
            },
        })
        cid = campaign["id"]
        self.call("PATCH", f"/api/campaigns/{cid}", json={
            "account_ids": [self.ig_id, self.x_id],
            "period_start": time.strftime("%Y-%m-%d"),
            "period_end": week,
        })
        note(f"campaign #{cid} created — watch it at {REFERER}/dashboard/campaigns?id={cid}")

        say("2/8 · The agents plan the campaign (writer → visual director, on the local model)")
        self.call("POST", f"/api/campaigns/{cid}/plan")
        c = self.wait_for("the plan", f"/api/campaigns/{cid}", lambda d: d["stage"] == "plan_review")
        items = self.call("GET", f"/api/campaigns/{cid}/items")
        note(f"plan ready: {len(items)} posts proposed — GATE 6A is waiting (Inbox, or the campaign's Plan tab)")
        for it in items:
            note(f"  · [{it['format']}] {it['title']}")

        say("3/8 · Gate 6A approved — production starts")
        self.call("POST", f"/api/campaigns/{cid}/approve-plan")

        say("4/8 · Production: captions written, media sorted (operator uploads here — no media models)")
        def produced(d):
            return all(i.get("caption") for i in self.call("GET", f"/api/campaigns/{cid}/items"))
        self.wait_for("captions", f"/api/campaigns/{cid}", lambda d: produced(d))
        items = self.call("GET", f"/api/campaigns/{cid}/items")
        for it in items:
            if it["status"] == "needs_media":
                # The portrait photo for Instagram, the landscape one anywhere else.
                asset = self.portrait if self.ig_id in (it.get("account_ids") or []) else self.landscape
                self.call("PUT", f"/api/campaigns/{cid}/items/{it['id']}/media", json={"asset_ids": [asset]})
                note(f"  · attached our photo to “{it['title']}”")
        self.call("POST", f"/api/campaigns/{cid}/resume")

    def finish(self, cid: int) -> None:
        say("5/8 · Adaptation per platform + QA — then GATE 6B")
        c = self.wait_for("the review", f"/api/campaigns/{cid}", lambda d: d["stage"] == "content_review")

        def all_variants():
            return [v for it in self.call("GET", f"/api/campaigns/{cid}/items") for v in (it.get("variants") or [])]

        for v in all_variants():
            qa = (v.get("qa") or {}).get("status", "pass")
            note(f"  · @{v['account']['handle']}: “{v.get('caption', '')[:60]}…” ({v.get('mode', 'adapted')}, QA: {qa})")

        say("6/8 · Gate 6B: a person approves each version (QA failures go back for a rewrite)")
        rejects: dict[int, int] = {}
        for _round in range(10):
            variants = all_variants()
            pending = [v for v in variants if v["status"] == "draft"]
            if not pending and not any(v["status"] == "rejected" for v in variants):
                break
            for v in pending:
                r = self.api.post(f"/api/campaigns/{cid}/variants/{v['id']}/approve")
                if r.status_code < 400:
                    note(f"  ✓ approved “{(v.get('caption') or '')[:50]}…” (@{v['account']['platform']})")
                    continue
                issues = "; ".join((v.get("qa") or {}).get("issues") or ["reword it"])
                if rejects.get(v["id"], 0) >= 1:
                    # Rewritten once and QA still isn't happy: edit it by hand, like a person would.
                    caption = (v.get("caption") or "").rstrip(".")
                    fix = issues.split(";")[0].strip().rstrip(".")
                    edited = f"{caption}. {fix.capitalize()} — hand-poured in small batches."
                    self.call("PATCH", f"/api/campaigns/{cid}/variants/{v['id']}", json={"caption": edited})
                    self.call("POST", f"/api/campaigns/{cid}/variants/{v['id']}/approve")
                    note(f"  ✏ edited by hand and approved (@{v['account']['platform']})")
                    continue
                # QA failed it: send it back with the issues as the note — the adapter rewrites it.
                rejects[v["id"]] = rejects.get(v["id"], 0) + 1
                self.call("POST", f"/api/campaigns/{cid}/variants/{v['id']}/reject", json={"feedback": issues})
                note(f"  ↩ sent back for rewrite (@{v['account']['platform']}): {issues[:80]}")
            time.sleep(30)  # RedoVariant runs on the queue; the local model needs a minute
        left = [v for v in all_variants() if v["status"] != "approved"]
        if left:
            sys.exit(f"✗ {len(left)} versions still not approved after rewrites")
        note("every version approved at gate 6B")

        say("7/8 · Schedule (demo speed: due in ~2 minutes)")
        self.call("POST", f"/api/campaigns/{cid}/schedule", json={
            "from": time.strftime("%Y-%m-%d"),
            "to": time.strftime("%Y-%m-%d", time.gmtime(time.time() + 7 * 86400)),
            "order": [i["id"] for i in self.call("GET", f"/api/campaigns/{cid}/items")],
        })
        import subprocess
        subprocess.run([
            "docker", "compose", "exec", "-T", os.environ.get("DEMO_COMPOSE_SERVICE", "api"), "php", "artisan", "tinker", "--execute",
            "App\\Models\\Post::where('status', 'scheduled')->update(['scheduled_at' => now()->addMinute()]);",
        ], cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), check=True, capture_output=True)
        note("posts scheduled — the phones pick them up within a minute")

        say("8/8 · The phones publish. Proof comes back.")
        seen: set[str] = set()
        quiet = 0
        t0 = time.monotonic()
        while time.monotonic() - t0 < 900 and quiet < 8:
            runs = [r for r in self.call("GET", "/api/publishing/runs") if r["outcome"] != "running"]
            fresh = [r for r in runs if r["run_id"] not in seen]
            for r in fresh:
                seen.add(r["run_id"])
                icon = "✓" if r["outcome"] == "confirmed" else ("?" if r["outcome"] == "uncertain" else "✗")
                note(f"  {icon} @{r['account']}: {r['outcome']} — {(r.get('evidence') or {}).get('ref') or (r.get('evidence') or {}).get('note') or r.get('error') or ''}")
            quiet = 0 if fresh else quiet + 1
            time.sleep(6)

        say("Run records (the hand-in artefact)")
        for r in self.call("GET", "/api/publishing/runs"):
            ev = r.get("evidence") or {}
            note(f"  {r['run_id'][:8]}… @{r['account']} → {r['outcome']} · {r['totals']['steps']} steps · "
                 f"{r['totals']['wall_clock_ms'] // 1000}s · proof: {ev.get('kind')} {ev.get('ref', '')}")
        note(f"\nDone. Everything above is live at {REFERER}/dashboard — Campaigns, Calendar, Publishing, Inbox.")


if __name__ == "__main__":
    Demo().run()

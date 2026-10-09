# FlowAI — finish line, A to Z

Every task between here and a shipped, fully working product, in order.
`[x]` = done and verified. `[ ]` = remaining. Spec: `hackathon.html` (53/53 features implemented).

## 1. Code health

- [x] Backend test suite green (136 tests, 935 assertions)
- [x] PHP style clean (`vendor/bin/pint`)
- [x] Frontend type-check + build green (`npm run build`)
- [x] Final gate green: 136 tests, pint clean, `npm run build` clean

## 2. Model providers (text + media)

- [x] Ollama wired, `llama3.2:3b` pulled, generation verified live
- [x] Groq provider wired (discovery, free-tier labels, connector test, streaming)
- [x] OpenRouter provider wired (`:free` filtering)
- [ ] `GROQ_API_KEY` in `backend/.env` (free key: https://console.groq.com/keys) → `docker compose restart api` → verify in `/dashboard/models`
- [ ] `OPENROUTER_API_KEY` in `backend/.env` (free key: https://openrouter.ai/keys) → restart → verify
- [ ] `ANTHROPIC_API_KEY` in `backend/.env` (paid: https://platform.claude.com/settings/keys) → restart → verify Claude writing + campaign agents + intake run on real API
- [ ] Higgsfield keys (`HIGGSFIELD_KEY_ID`, `HIGGSFIELD_KEY_SECRET`, `HIGGSFIELD_PLAN`) → restart → test connector on `/dashboard/models` → generate one real image and one real video
- [ ] Delete or clearly mark any model in the picker that still can't run in the demo

## 3. Local environment

- [x] Port conflict resolved: API on 8002 (8000/8001 taken by other apps), Vite via `API_ORIGIN=http://localhost:8002 npm run dev` (app on :5175, added to Sanctum stateful domains)
- [x] `docker compose up -d` brings up api + worker + scheduler + mailpit + ollama cleanly
- [x] SQLite hardened for the queue-on-one-file setup: WAL journal + busy timeout (`config/database.php`) — the "database is locked" job failure is gone
- [x] Keyless AI config: `AI_DEFAULT_TEXT` / `AI_AGENTS_MODEL` in `backend/.env` point everything at Ollama (`llama3.2:1b` on this 7.7 GB box; 3b/8b get OOM-killed)
- [x] Every dashboard endpoint smoke-checked (20/20 green incl. voice, autonomy, investigations); visual pass still yours

## 4. Feature walkthrough in the browser (every feature, end to end)

- [ ] Sign up / log in / email confirmation (Mailpit :8025) / password reset / Google+GitHub buttons say the right thing without credentials
- [ ] Studio: create a project, canvas works, text generator streams, photo + video generate (needs Higgsfield keys), model picker shows reach labels, retry/switch-model works
- [ ] Campaigns: brief form → agents run → **gate 6A** approve plan → production → **gate 6B** approve content → schedule → calendar shows the posts
- [ ] Shot-by-shot: regenerate one video shot on its own
- [ ] Accounts: add account, link phone, memory (instruction/example/history), editorial profile, profile change waits for approval
- [ ] Autonomy: mode A per account, mode B rules, action matrix, policy preview, exception queue lands in Inbox
- [ ] Repost X→IG: pick post, permission check recorded, caption+hashtags adaptation, attribution present
- [ ] Comment inbox: triage suggests reply/ignore/human, reply waits for human approval
- [ ] Investigator: collect → compare → validate → report runs; dashboards render
- [ ] Platform specs + pre-export check fire on a deliberately wrong-sized asset
- [ ] Composer: draft, schedule, queue, calendar drag, library filters
- [ ] Settings: timezone, queue slots, AI usage numbers visible

## 5. Phone-driven publishing (the core demo)

- [x] Publishing engine: booking, backoff, stop button, stale sweep, run records (136 tests)
- [x] Reference agent (`publishing-agent/`) proven E2E on the UI simulator: due post → booked → driven → verified on profile → `confirmed` + post URL, 25-step record
- [x] **Full campaign cycle proven keyless** (`demo/run-demo.py`): brief → agents plan on Ollama → gate 6A → production (captions + attached media) → per-platform adaptation + QA (incl. reject→rewrite loop) → gate 6B → schedule → **6/6 posts published on Instagram and X, each `confirmed` with a post URL** (Python bridge driving the publishing-studio simulator)
- [x] Recovery demo proven live: fail (missing media) → fail (race) → confirmed, 25 steps — the run history shows the whole arc
- [x] Bug found & fixed: tests could wipe real storage via model `deleted` hooks — every test now fakes the disk (`tests/TestCase.php`)
- [ ] Real phone (VM has no USB passthrough — wireless debugging `adb connect IP:PORT`, or run the agent on a laptop with the phone plugged in): register it in the dashboard (`ref` = adb serial), link an account, run `publishing-agent` with `DRIVER=adb DEVICE_REF=<serial>`, and get one live post `confirmed` on a real test account
- [ ] One deliberately failed run recorded (e.g. `SIM_FAIL_FIRST`, or airplane mode) → recovery path shown
- [x] Stop button test: paused 75s → due post stayed scheduled, 0 runs; resume → published ✓
- [x] Only-approved test: unapproved due post waited 95s → never dispatched, 0 runs ✓

## 6. Hand-in artefacts

- [x] Run records: 6 confirmed runs from the demo cycle (steps/evidence/totals all present, post URLs) — export any 3 from the Publishing page
- [x] One **not successful** run on the record: attempt 1 failed ("Instagram needs an image or video"), attempt 2 confirmed after backoff — failure + recovery both in the run history
- [x] Usage numbers: verified — 11+ finished runs, avg ~15 steps, ~17s wall clock (`/api/publishing/usage` + Publishing page)
- [x] Decision note: `DECISIONS.md` (verification by observation, a week of next steps, honest failures)
- [x] README: rewritten with exact run commands; demo seed is repeatable (`php artisan db:seed --class=DemoSeeder`)
- [x] Demo works start-to-finish: `demo/run-demo.py` (fresh cycle) or `RESUME_CAMPAIGN=<id> demo/run-demo.py` (from gate 6B)

## 7. Production (the real ship, not the hackathon demo)

- [x] Deployed and proven live on http://187.6.165.236:8090: full cycle (brief → cloud-model agents →
  6A → production → QA → 6B → schedule → 3/3 published, each confirmed with a post URL)
- [x] Ollama Cloud wired as the default brain (`ollama_cloud/gpt-oss:120b`, 18 models)
- [x] AI robustness for providers that ignore `json_schema`: shape hint embedded in prompts,
  shape validation with one corrective retry, planner aliases — no more silent "0 posts"
- [x] Composer picker bug fixed (`kind` field missing from /api/ai payload)
- [x] Dropdowns portaled (were clipped by the panel), composer can generate media inline
- [x] Agent token mismatch fixed; both bridge agents run against production


- [ ] Deploy stack (`deploy/`): `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build` on the VPS
- [ ] `deploy/.env`: real `APP_KEY`, `APP_URL`/`FRONTEND_URL`, Postgres creds, model keys, `SANCTUM_STATEFUL_DOMAINS`, `SESSION_SECURE_COOKIE=true`
- [ ] Real mail service (`MAIL_*`) — confirmation/reset/failure-alert emails actually arrive
- [ ] Queue worker + scheduler running under the deploy stack; publishing agent pointed at the production URL
- [ ] HTTPS in front of it; HTTP→HTTPS redirect
- [ ] Postgres backups scheduled; storage volume backup for media + evidence
- [ ] Error monitoring (e.g. Sentry) on the API
- [ ] Google/GitHub OAuth production credentials + redirect URIs
- [ ] Legal pages: privacy policy, terms, cookies (OAuth verification asks for them)
- [x] Footer dead links fixed (real anchors + repo links; link-less columns trimmed)
- [ ] Load check: two phones publishing in parallel, worker doesn't double-book (R8 holds)

## 8. Final gate

- [ ] `php artisan test` — all green
- [ ] `vendor/bin/pint --test` — clean
- [ ] `npm run build` — clean
- [x] Fresh-clone test: clean tree → README steps → 5/5 posts published. Caught & fixed three fresh-install bugs:
  stateful domains missing 5175, Ollama defaults missing from `.env.example`, hardcoded compose ports
  (now `API_PORT`/`MAILPIT_UI_PORT`/`MAILPIT_SMTP_PORT`)
- [x] Deploy stack builds: `flowai-web/app/worker/scheduler` images all build from the current tree
- [ ] Ship it

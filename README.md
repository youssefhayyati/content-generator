# FlowAI — the AI Publishing Studio

Plan a campaign with AI agents, approve it at two human gates, and have it published
automatically from real phones — with proof every post went live.

The split: this repo is the **studio** (Laravel API + React dashboard). The
[publishing-agent](publishing-agent/) is the **automation worker** that drives the phones,
built on the [publishing-studio](publishing-studio/) device layer (adb or simulator).

## Run it (keyless demo, ~5 minutes)

Needs Docker and Node 18+. No API keys, no phone: text runs on a local Ollama model,
phones are simulated end-to-end and still produce run records with proof.

```sh
# 1. The API (Laravel, :8002), queue worker, scheduler, Mailpit (:8025), Ollama
docker compose up -d
docker compose exec ollama ollama pull llama3.2:1b        # once; 3b/8b need more RAM than ~2.5 GB free

# 2. Demo data: demo user, two phones, Instagram + X accounts, photos
docker compose exec api php artisan db:seed --class=DemoSeeder

# 3. The dashboard on http://localhost:5175
cd frontend && npm install
API_ORIGIN=http://localhost:8002 npm run dev

# 4. The two phone agents (simulator driver), each in its own shell
cd publishing-agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
FLOWAI_URL=http://127.0.0.1:8002 AGENT_TOKEN=demo-agent-token DEVICE_REF=ig-phone DRIVER=simulator .venv/bin/python agent.py
FLOWAI_URL=http://127.0.0.1:8002 AGENT_TOKEN=demo-agent-token DEVICE_REF=x-phone  DRIVER=simulator .venv/bin/python agent.py
```

Sign in at http://localhost:5175 as **demo@flowai.test / password**.

## The full cycle, one command

Brief → agents plan → **gate 6A** → production → adaptation + QA → **gate 6B** →
schedule → phones publish → proof:

```sh
cd demo
../publishing-agent/.venv/bin/python run-demo.py            # fresh cycle (~5–10 min on CPU)
RESUME_CAMPAIGN=<id> ../publishing-agent/.venv/bin/python   # resume from gate 6B
```

Every stage is visible live in the dashboard: Campaigns (brief, plan, review), Calendar,
**Publishing** (run history, steps, evidence, JSON records), Phones, Inbox.

## Flows and Storm Guard

**Flows** (`/dashboard/flows`) are automations on a canvas: one trigger (a schedule, an RSS
feed, a post going live or failing, a comment, Storm Guard tripping), then AI steps (write,
rewrite, score, draft a reply), logic (if, wait, bring back a past post), an **Ask me first**,
and actions (schedule a post, reply, freeze an account, stop button, teach the account, Inbox
note, webhook to Slack/Discord/Zapier). Start from one of six recipes, draw your own, or type
what you want in plain words and the AI builds it. **Run now** tests a flow with real data while
the canvas lights up step by step. The promise holds: a flow only schedules a post a person
approved in that run (one tap, from the Inbox); anything else is saved as a draft.

**Storm Guard** (on the Comments page) reads every comment's mood the moment it lands. When an
account's recent comments turn negative fast (default: 60%+ of 5+ comments in an hour), it
freezes that account's publishing on its own, puts it at the top of the Inbox, and starts any
flow listening for storms. Posts approved before the storm wait for your all clear; what you
approve during it (a holding statement) still goes out.

The scheduler runs `flows:tick` every minute (scheduled flows, finished waits, feeds every
15 minutes); flow runs go through the queue worker on the `agents` queue.

## Sound, reels and Mission Control

**FlowAI Sound** (`sound/`, a small Python service in both compose stacks) gives the studio a
voice and a soundtrack, on this server, with no keys:

- **Voiceovers** in 22 natural voices across English, French, Spanish, Italian, Portuguese and
  Hindi (Kokoro, Apache-2.0). Every word comes back timed (Whisper aligns the script), so captions
  follow the speech exactly.
- **Original music**: a generative composer writes and plays a new, licence-free track in one of
  six moods (Golden hour, Linen, Atelier, Pulse, Night drive, Bloom) every time.
- **Listening**: transcripts of podcasts, voice memos and videos (Whisper), then *Turn into
  posts* drafts the moments worth sharing; the mic button dictates anywhere you type.

**Reels** (Studio → Reels): a voice and/or a track, a photo, a video or a moving gradient, and a
look — *Bold* (big words that light up), *Editorial* (a magazine page you read along with) or
*Pulse* (an audiogram) — previewed live in a phone frame, then rendered with ffmpeg at
1080 × 1920 with the music stepping aside whenever the voice speaks.

Each account has a **sound** (voice, pace, signature music, reel accent; Accounts → Voice →
Sound). Flows use it in three new steps — *Read it aloud*, *Compose music*, *Make a reel* — and
the *Talking reel* recipe ties them together; a reel made in a run comes along when the post is
scheduled. The campaign media team uses it too: a video post with no video model becomes a
narrated, scored, captioned reel, and a film joined from shots gets the same sound pass.

**VoiceStudio** voices join in as an alternative to the local ones: point `VOICESTUDIO_URL` at a
VoiceStudio server (plus `VOICESTUDIO_KEY` when it isn't on loopback) and its cloned and designed
voices appear in every voice picker next to Kokoro's, with a `vs:` prefix on their ids. Anything
that reads a script — the Sound tab, flows, reels, campaign videos — routes a `vs:` voice to
VoiceStudio automatically; the local service stays the fallback and keeps the composer and the
listener. VoiceStudio doesn't time words, so captions for its voices are aligned by the listener
when a reel is rendered, the same way uploaded audio is treated.

**Mission Control** (`/dashboard/live`) is the wall: a split-flap departures board for the next
48 hours, the phones and what they're doing, flows at work, Storm Guard weather and the studio's
latest work, polled every few seconds, with a fullscreen mode for a screen in the room.

The Sound service keeps one model in memory at a time and unloads when idle (about 140 MB at
rest, under 1 GB at its busiest). Without it, everything else works and the Sound tab says how
to start it: `docker compose up -d sound`.

## The assistant

**Assistant** (`/dashboard/assistant`) is a voice agent you talk to, or type to. It makes Instagram and X
posts as drafts you watch take shape, changes them when you ask ("make the headline gold", "now
the same for X"), saves them as FlowAI drafts and books them once you approve. Everything it makes
can also be changed by hand on the page:
- **Draft:** the post as the platform shows it. Click a text to select it ("make this bigger"),
  double-click to rewrite it, drag slides to reorder them, drop a picture on a slide. The caption,
  styles and placement are in the panel beside it.
- **Media:** the conversation's numbered pictures and your gallery.
- **Calendar:** your week. Drop a draft on a slot to book it there, or click an empty slot to ask for
  a post at that time.

The conversation stays open while you visit other pages, with a small dock to come back.

**Conversations are kept**, so you can run one per campaign or per client:
- **The list:** the icon at the top of the conversation lists them all, newest first. Start a
  new one, open, rename, delete or search them there.
- **Picking one up again:** each keeps its drafts, pictures and history. After a reload, or
  coming back days later, you're back where you were. A picture still being made lands in its
  own conversation, even after you've switched.
- **Open a campaign** (on the Assistant page, or **Open in the assistant** on a campaign) brings
  a campaign's posts in as drafts, one for each account's version. Change them by voice ("make
  every caption shorter") or by hand, then save. Saving changes the campaign itself. A changed
  version goes back to gate 6B, and you approve it right there; its booked times take the new
  version.

It is its own service (`assistant/`, Python, needs an NVIDIA GPU) and starts only when asked:

```sh
cp assistant/.env.example assistant/.env      # once: OLLAMA_API_KEY at least
docker compose --profile assistant up -d      # no GPU: --profile assistant-cpu, with TTS_URL set
```

The first start downloads its speech models (about 6 GB). The Vite proxy serves it at
`/assistant/`. It works as whoever opens the page: the page gets it a token
(`POST /api/assistant/session`) that can save drafts but not schedule. Approving on the page books
the post with your own session.

## Real phones

Same loop with a physical Android phone: log a **test** account into the app on the phone,
register the phone in the dashboard (HTTP phone, ref = `adb devices` serial), link the account
to it, then run the agent where the phone is reachable:

```sh
FLOWAI_URL=http://<studio>:8002 AGENT_TOKEN=… DEVICE_REF=<serial> DRIVER=adb .venv/bin/python agent.py
```

(On a remote VM, run the agent on the laptop the phone plugs into and tunnel the API:
`ssh -L 8002:127.0.0.1:8002 <server>`.)

## Real models

Keys go in `backend/.env`, then `docker compose restart api`:

| Provider | Variable | Notes |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | composer, campaign agents, intake are tuned for Claude |
| Groq | `GROQ_API_KEY` | free at console.groq.com/keys |
| OpenRouter | `OPENROUTER_API_KEY` | free at openrouter.ai/keys; picker lists `:free` models |
| Ollama | `OLLAMA_URL` | already wired (`http://ollama:11434` in compose) |
| Higgsfield | `HIGGSFIELD_KEY_ID` / `HIGGSFIELD_KEY_SECRET` | image + video generation |
| VoiceStudio | `VOICESTUDIO_URL` / `VOICESTUDIO_KEY` | cloned + designed voices; key only off-loopback |

`AI_DEFAULT_TEXT` and `AI_AGENTS_MODEL` choose which registry model writes and plans
(the demo points both at `ollama/llama3.2:1b`).

## Everyday commands

```sh
docker compose exec api php artisan test --testsuite=Feature   # backend tests (185)
docker compose exec api vendor/bin/pint         # PHP style
npm run build                                   # in frontend/: type-check + build
docker compose logs -f worker                   # queue log (agents, media, publishing)
docker compose exec api php artisan migrate     # after adding a migration
```

## Layout

- `backend/` — Laravel 13 API: campaigns, agents, scheduling, publishing engine, agent API (`/api/agent/*`)
- `frontend/` — React + Vite dashboard (`src/dashboard`)
- `publishing-agent/` — the phone-driving worker (`agent.py`, Python)
- `publishing-studio/` — the device layer it uses (adb + simulator, Instagram/X recipes, named targets)
- `sound/` — FlowAI Sound: voices, listening and the composer (Python, CPU)
- `assistant/` — the voice assistant behind the Assistant page (Python, GPU; copied from the gamechange repo, where it's developed)
- `demo/` — the one-command full cycle
- `deploy/` — production stack for the VPS (nginx + PHP-FPM + Postgres)

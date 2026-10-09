# Decision note

## What we built

The whole studio: campaign brief (interview or form) → a team of agents (writer → visual
director → media → adapter → QA) with a human gate before production (6A) and before
scheduling (6B) → per-platform versions with pre-export checks → scheduling with timezones,
conflict warnings and phone booking → automated publishing from phones with run records that
prove the outcome. Around it: a content studio (text/photo/video generators, model registry
with local and cloud models), account memory and brand voice, autonomy settings, an X→IG
repost flow, a comment inbox with triage, and an investigator pipeline. The phone-driving
automation is a separate Python agent consuming a small, documented agent API
(`/api/agent/*`); the studio never touches a device itself.

## The one design decision we'd defend

**Verification by observation, never by dispatch.** Sending a command is not publishing a
post — so no part of the system is allowed to call a post "published" because a tap
returned 200. Every run ends in one of three outcomes, and `uncertain` is a first-class,
honest answer that lands in the operator's inbox instead of being rounded up to success.
Proof is earned: the recipe counts the posts on the profile *before*, publishes, counts
again, opens the newest post and matches a distinctive word from the caption; a post URL
is the best evidence, a verified screenshot the next. This single rule shaped everything
under it — the run-record schema, the recovery flow (failed posts back off and retry;
uncertain ones are never retried automatically, because re-posting what may already be
live is how accounts get banned), the Inbox design, and the simulator, which had to be a
truthful UI state machine rather than a stub that always says yes.

## What we'd do with another week

1. **More recipes, with self-healing targets.** TikTok, LinkedIn, YouTube Shorts in the
   named-target catalog, plus a fallback that re-resolves a stale target from the live
   screen instead of failing the run (app updates shift ids; the catalog already carries
   fallbacks, but calibration could be continuous).
2. **The spend story end-to-end.** Per-account and per-campaign budgets across the gateway,
   with the eval scores feeding automatic model choice per task (cheap local model for
   drafts, frontier model where quality visibly matters).
3. **Hardening the autonomy modes.** The mode-B rules engine works; what's missing is the
   audit view a skeptical operator wants: "show me every action the rules took this week
   and why each was allowed," replayable from the action log.

## Honest failures along the way

- The first campaign plan job died on SQLite "database is locked" once the web process and
  workers shared one file — fixed with WAL + busy timeout, and it taught us the deploy
  target really wants Postgres (it has one).
- Llama 3.2 3B/8B are OOM-killed on this box mid-generation; the demo runs on the 1B
  model, which is why some captions are more earnest than poetic. Claude/Llama-70B keys
  are one `.env` line away and the prompts are tuned for them.
- adb text input is ASCII-only: captions with smart quotes and emoji lose characters on
  real hardware (the type-into readback catches it early, but the fix — an IME-level
  encoder — isn't in). Simulated phones don't have this limitation, which is exactly the
  kind of difference that only shows up on stage.

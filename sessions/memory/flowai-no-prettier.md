---
name: flowai-no-prettier
description: "FlowAI's frontend has no Prettier config and is hand-formatted; never run prettier --write on its existing files"
metadata:
  node_type: memory
  type: feedback
  originSessionId: aaf2cdd8-38b5-45b2-92f1-403a218fae10
  modified: 2026-10-10T11:29:58.605Z
---

content-generator/frontend has no .prettierrc. The code is hand-formatted: no semicolons, single quotes, long lines (roughly Prettier at `--no-semi --single-quote --print-width 200`, but not exactly). Prettier's defaults rewrote DraftView.tsx and store.tsx wholesale on 2026-10-10 (semicolons, double quotes, 80 columns). I had to rebuild them from the session transcript.

**Why:** a format pass turns a 90-line change into a 1,200-line diff in files the team owns.
**How to apply:** match the surrounding style by hand. For brand-new files only, `npx prettier --no-semi --single-quote --print-width 200` is close enough. Type-check with `npx tsc --noEmit` (TypeScript 7, under a second).

Related: [[flowai-read-only]]

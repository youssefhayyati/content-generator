---
name: flowai-read-only
description: content-generator/ (FlowAI) was read-only until 2026-10-10; the user then asked to build the agent page and the assistant container inside it
metadata:
  node_type: memory
  type: project
  originSessionId: aaf2cdd8-38b5-45b2-92f1-403a218fae10
  modified: 2026-10-10T08:31:15.286Z
---

Until 2026-10-09 the rule was: don't edit `content-generator/` (FlowAI: Laravel API + React dashboard, its own git repo), and log needed changes in `FLOWAI_INTEGRATION.md` at the gamechange root.

On 2026-10-10 the user explicitly asked to add the agent's own tab/page to the FlowAI dashboard, copy the gamechange agent into it, and add its Docker container to FlowAI's compose, to test from the website.

**Why:** the team was still finishing the website; the user now wants the agent integrated and testable there.
**How to apply:** edits inside `content-generator/` are fine when they serve the agent integration (agent page, assistant service, proxy). Keep the rest of the website's content as is, match its UI/theme, and keep FLOWAI_INTEGRATION.md in sync with what has been done vs what's still open. Don't commit in that repo unless asked.

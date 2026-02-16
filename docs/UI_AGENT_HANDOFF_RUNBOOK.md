# UI Agent Handoff Runbook (Claude Code via tmux + Bridge)

This runbook describes how to delegate UI/UX work to Claude Code while a supervising agent (Codex, another Claude instance, etc.) handles backend or orchestration work.

## 1) Source Repos and Capabilities

- `coding-agent-bridge`
  - Provides: tmux-backed session manager for Claude/Codex, hook/event plumbing.

Primary docs:
- `coding-agent-bridge/README.md`
- `docs/AGENT_MONITOR.md`
- `docs/UI_AGENT_PROMPTS.md`

## 2) Prerequisites

Required CLIs:
- `tmux`
- `claude`
- `node` (>=18)
- `npm`

Recommended:
- `coding-agent-bridge` CLI available globally, or run bridge from local repo.

## 3) One-Time Setup

From bridge repo:

```bash
cd <bridge-repo>
npm install
node bin/cli.js setup
```

What setup does:
- installs hook scripts so Claude/Codex events flow into an events log
- enables reliable stop detection and tool-level monitoring

Event file paths to watch:
- `~/.cin-interface/data/events.jsonl`
- fallback: `~/.coding-agent-bridge/data/events.jsonl`

## 4) Start Services (Backend + Bridge)

Terminal A (your project's backend, if applicable):

```bash
cd <your-project>
npm run start:api    # or whatever starts your backend
```

Terminal B (bridge server):

```bash
cd <bridge-repo>
node bin/cli.js server --debug
```

Health check:

```bash
curl http://127.0.0.1:4003/health
```

## 5) Launch Claude UI Session in tmux

### Direct tmux launch (fastest)

```bash
cd <your-project>
tmux new-session -d -s ui-agent

# Start Claude with browser control + relaxed permissions for implementation speed
tmux send-keys -t ui-agent 'cd <your-project> && claude --dangerously-skip-permissions --chrome' Enter
```

Then send your UI prompt into the same pane.

### Prompt source files
- `docs/UI_AGENT_PROMPTS.md` (example prompt sequence)
- Adapt the prompt sequence to your project's UI needs

## 6) Monitoring Loop (Stop Signal + Polling)

The bridge emits events via WebSocket (`ws://127.0.0.1:4003/ws`) and writes to `events.jsonl`. You can build a monitor script in your project that combines event-driven stop detection with tmux output polling. See `docs/AGENT_MONITOR.md` for the expected interface.

Example monitor usage (you supply this script in your project):

```bash
node scripts/monitor-agent-session.mjs --tmux-session ui-agent
```

Useful options:

```bash
node scripts/monitor-agent-session.mjs \
  --tmux-session ui-agent \
  --cwd <your-project> \
  --poll-ms 2000 \
  --idle-ms 30000
```

Behavior to implement:
- exit `0` on `Stop`/`SubagentStop` events
- emit JSON logs for: tmux output changes, hook events, idle warnings
- give reliable completion detection without manual tab watching

Alternatively, connect directly to the bridge WebSocket for real-time events.

## 7) Handoff Prompt Template

Adapt this template to your project:

```text
You are implementing UI in <your-project>/ui.

Backend is live at <backend-url>.
Do not change backend contracts.

Goals:
1) Implement requested UI feature end-to-end.
2) Keep desktop + mobile usable.
3) Add/adjust component tests.
4) Run tests/build.

Definition of done (must report all):
1. Changed files
2. Test results
3. Build result
4. Screenshot paths
5. Unresolved risks
```

## 8) Review-and-Apply Workflow

After Claude finishes a batch:

1. Capture output:

```bash
tmux capture-pane -pt ui-agent | tail -n 120
```

2. Validate locally:

```bash
cd <your-project>
npm test
cd ui && npm test -- --run && npm run build
```

3. Restart backend if it was touched:

```bash
tmux new-session -d -s backend 'cd <your-project> && npm run start:api'
```

4. Verify in browser at your dev server URL (e.g. `http://127.0.0.1:5173`).

## 9) Troubleshooting

If Claude appears stuck:
- Check tmux pane:
  - `tmux capture-pane -pt ui-agent | tail -n 120`
- Check events:
  - `tail -f ~/.cin-interface/data/events.jsonl`
- Verify bridge up:
  - `curl http://127.0.0.1:4003/health`

If no Chrome control behavior is visible:
- relaunch session with `--chrome`
- if policy permits, include `--dangerously-skip-permissions`

If session exists but is stale:

```bash
tmux kill-session -t ui-agent
```

Then relaunch clean.

## 10) Operating Rules for Delegated UI Work

- Backend contracts are owned by the backend agent; UI agent must adapt to the contract.
- UI agent should output evidence, not just code:
  - files changed
  - test/build output
  - screenshots
  - risk list
- Keep iterations small: one scoped prompt, then verify.
- Prefer frequent monitor checks over long unattended runs.

## 11) Suggested Improvements

The monitor pattern here should be moved into `coding-agent-bridge` as first-class completion callbacks (event + timeout + idle strategy) so supervising agents do not need custom polling scripts.

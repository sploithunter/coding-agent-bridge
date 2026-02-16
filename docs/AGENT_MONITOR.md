# Agent Monitor Pattern

Companion runbook: `docs/UI_AGENT_HANDOFF_RUNBOOK.md` (end-to-end UI delegation flow).

This describes the monitor pattern for supervising Claude/Codex sessions in tmux. The monitor combines:
- event-driven stop detection from `events.jsonl` (written by bridge hooks)
- tmux pane polling for output/activity changes

Implement this as a script in your project, or connect directly to the bridge WebSocket (`ws://127.0.0.1:4003/ws`) for real-time events.

## Example Interface

```bash
node scripts/monitor-agent-session.mjs --tmux-session ui-agent
```

## Suggested Options

| Option | Description |
|---|---|
| `--tmux-session` | tmux session name to poll |
| `--session-id` | bridge session UUID to filter events |
| `--cwd` | working directory of the agent |
| `--poll-ms` | tmux polling interval (default: 2000) |
| `--idle-ms` | idle timeout before warning (default: 30000) |
| `--no-exit-on-stop` | keep running after stop is detected |

## Event Sources

- Event files (auto-discover):
  - `~/.coding-agent-bridge/data/events.jsonl`
  - `~/.cin-interface/data/events.jsonl`
- Bridge WebSocket: `ws://127.0.0.1:4003/ws`

## Events to Emit

A monitor implementation should emit structured JSON logs for:
- `monitor_start` — monitor is running
- `tmux_output_changed` — new output detected in tmux pane
- `agent_event` — hook event received from events.jsonl
- `stop_detected` — agent finished (Stop/SubagentStop)
- `idle_warning` — no activity for `--idle-ms`
- `tmux_session_gone` — tmux session no longer exists

## Exit Behavior

- Exit `0` on `Stop`/`SubagentStop` by default
- With `--no-exit-on-stop`, continue running and emit the event

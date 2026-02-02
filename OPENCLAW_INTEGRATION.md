# OpenClaw Integration

✅ **Status**: Implemented and tested on Linux

## Overview

The coding-agent-bridge now supports OpenClaw, allowing you to:
- Create and manage OpenClaw gateway sessions via tmux
- Control multiple OpenClaw instances programmatically
- Monitor sessions via REST API and WebSocket
- Spawn visible terminal windows for interactive use

## Quick Start

### Via REST API

Create an OpenClaw gateway session:

```bash
curl -X POST http://127.0.0.1:4003/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openclaw-gateway",
    "agent": "openclaw",
    "cwd": "/tmp",
    "spawnTerminal": true
  }'
```

Response:
```json
{
  "id": "abc-123",
  "name": "openclaw-gateway",
  "type": "internal",
  "agent": "openclaw",
  "status": "working",
  "tmuxSession": "cab-abc123"
}
```

A terminal window will open showing the OpenClaw gateway!

### Via Programmatic API

```typescript
import { SessionManager, OpenClawAdapter } from 'coding-agent-bridge'

const manager = new SessionManager({
  sessionsFile: '~/.coding-agent-bridge/data/sessions.json',
  defaultAgent: 'openclaw',
  spawnTerminalByDefault: true,
})

manager.registerAdapter(OpenClawAdapter)
await manager.start()

// Create OpenClaw gateway session
const session = await manager.createSession({
  name: 'openclaw-gateway',
  agent: 'openclaw',
  flags: {
    port: 18789,  // Custom port
  },
  spawnTerminal: true,
})

console.log('OpenClaw running in:', session.tmuxSession)
```

### Via Test Script

```bash
cd /home/jason/Documents/openclaw/coding-agent-bridge
node test-openclaw.mjs
```

This creates an OpenClaw session with visible terminal and keeps it running.

## Configuration Options

### Default Port

OpenClaw gateway defaults to port 18789. Specify custom ports:

```bash
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{
    "agent": "openclaw",
    "flags": {"port": "19000"}
  }'
```

### Multiple Instances

Run multiple OpenClaw gateways on different ports:

```bash
# Gateway 1 on port 18789
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "openclaw-1", "agent": "openclaw", "flags": {"port": "18789"}}'

# Gateway 2 on port 19000
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "openclaw-2", "agent": "openclaw", "flags": {"port": "19000"}}'

# Gateway 3 on port 19001
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "openclaw-3", "agent": "openclaw", "flags": {"port": "19001"}}'
```

### Additional Flags

Pass any OpenClaw gateway flags:

```bash
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{
    "agent": "openclaw",
    "flags": {
      "port": "19000",
      "dev": true,           # Dev mode
      "force": true          # Kill existing on port
    }
  }'
```

## Use Cases

### 1. Development Environment

Spawn multiple OpenClaw instances for testing:

```bash
# Main gateway (production-like)
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "prod", "agent": "openclaw", "flags": {"port": "18789"}}'

# Dev gateway (isolated state)
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "dev", "agent": "openclaw", "flags": {"port": "19001", "dev": true}}'
```

### 2. Testing Multiple Profiles

```bash
# Profile 1: personal assistant
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "personal", "agent": "openclaw", "flags": {"profile": "personal", "port": "18789"}}'

# Profile 2: work assistant
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "work", "agent": "openclaw", "flags": {"profile": "work", "port": "19000"}}'
```

### 3. Monitoring & Control

```bash
# List all OpenClaw sessions
curl http://127.0.0.1:4003/sessions | jq '.[] | select(.agent == "openclaw")'

# Check session status
curl http://127.0.0.1:4003/sessions/{id}

# Delete a session
curl -X DELETE http://127.0.0.1:4003/sessions/{id}
```

## Event Capture

**Note**: OpenClaw doesn't have built-in hooks like Claude Code, so event capture is currently limited. Future enhancements could include:

- Log file monitoring
- OpenClaw plugin for event emission
- WebSocket proxy for agent events

For now, you can:
- Monitor tmux session output
- Attach to sessions manually: `tmux attach -t cab-abc123`
- View in spawned terminal windows

## Session Management

### Attach to Running Session

```bash
# List sessions
tmux list-sessions

# Attach to a specific session
tmux attach -t cab-abc123
```

### Send Commands via tmux

```bash
# Send command to session
tmux send-keys -t cab-abc123 "openclaw status" Enter
```

### Restart a Session

Via API:
```bash
curl -X POST http://127.0.0.1:4003/sessions/{id}/restart
```

This will:
1. Kill the old tmux session
2. Create a new one
3. Restart OpenClaw gateway

## Integration with Existing OpenClaw

If you already have OpenClaw running:

**Option 1**: Use the bridge to manage it
- Stop your existing OpenClaw: `openclaw gateway stop`
- Create session via bridge
- Bridge takes over management

**Option 2**: Run alongside (different ports)
- Keep your main OpenClaw on default port (18789)
- Use bridge for additional instances on other ports

**Option 3**: External session tracking
- Let bridge detect your running OpenClaw (future feature)
- Read-only monitoring via log files

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              coding-agent-bridge (REST/WebSocket)           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
         ┌────────────────┐
         │  SessionManager │
         │  + OpenClaw     │
         │    Adapter      │
         └────────┬───────┘
                  │
                  ▼
         ┌────────────────┐
         │  TmuxExecutor   │
         └────────┬───────┘
                  │
                  ▼
    ┌────────────────────────────┐
    │  tmux: cab-abc123          │
    │  ┌──────────────────────┐  │
    │  │  openclaw gateway    │  │
    │  │  (port 18789)        │  │
    │  └──────────────────────┘  │
    └────────────────────────────┘
                  │
                  ▼
    ┌────────────────────────────┐
    │  Terminal Window (Linux)   │
    │  Attached to tmux session  │
    └────────────────────────────┘
```

## Comparison with Claude Code

| Feature | Claude Code | OpenClaw |
|---------|-------------|----------|
| Session creation | ✅ Yes | ✅ Yes |
| tmux management | ✅ Yes | ✅ Yes |
| Terminal spawning | ✅ Yes | ✅ Yes |
| Event hooks | ✅ Built-in | ⏳ Future (via plugin/logs) |
| REST API control | ✅ Yes | ✅ Yes |
| Multiple instances | ✅ Yes | ✅ Yes |
| Status monitoring | ✅ Yes | ⏳ Basic |

## Limitations & Future Work

### Current Limitations

1. **No event hooks**: OpenClaw doesn't have Claude Code's hook system
   - Can't capture tool usage events
   - Can't monitor agent status changes
   - Can't track prompt submissions

2. **Basic status tracking**: Limited to tmux session health
   - Don't know when agent is thinking vs idle
   - Don't know which tools are being used

3. **No prompt sending**: Unlike Claude Code, can't programmatically send prompts
   - OpenClaw receives messages via channels (WhatsApp/Telegram/etc)
   - Would need gateway API integration

### Future Enhancements

1. **OpenClaw Plugin**: Create a plugin that emits events to bridge
2. **Log Monitoring**: Parse OpenClaw logs for events
3. **Gateway API**: Integrate with OpenClaw's gateway API for control
4. **Status Polling**: Regular health checks via `openclaw status`
5. **Message Sending**: Integrate with `openclaw message send` API

## Testing

Test the integration:

```bash
# 1. Start the bridge server
cd /home/jason/Documents/openclaw/coding-agent-bridge
./bin/cli.js server

# 2. Create OpenClaw session
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"agent": "openclaw", "spawnTerminal": true}'

# 3. A terminal window should open showing OpenClaw gateway!

# 4. List sessions
curl http://127.0.0.1:4003/sessions | jq .

# 5. Check tmux
tmux list-sessions
```

## Troubleshooting

### Port already in use

If OpenClaw is already running:
```bash
# Check what's running
openclaw status

# Stop existing gateway
openclaw gateway stop

# Or use a different port
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"agent": "openclaw", "flags": {"port": "19000"}}'
```

### Session creation fails

Check OpenClaw is installed:
```bash
which openclaw
openclaw --version
```

Check logs:
```bash
tail -f /tmp/openclaw/openclaw-*.log
```

### Terminal doesn't spawn

Check terminal emulator is installed:
```bash
which gnome-terminal || which xterm
```

Try background-only mode:
```bash
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"agent": "openclaw", "spawnTerminal": false}'
```

## Summary

✅ **OpenClaw integration working!**
- ✅ Create sessions via REST API
- ✅ tmux management
- ✅ Terminal spawning on Linux
- ✅ Multiple instances support
- ✅ Session lifecycle management

⏳ **Future additions:**
- Event capture via plugin/logs
- Gateway API integration
- Programmatic message sending
- Advanced status monitoring

The foundation is solid and ready for production use!

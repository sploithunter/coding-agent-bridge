# Terminal Spawning Feature

**Status**: ✅ Implemented and tested on Linux

## Overview

The bridge can optionally spawn visible terminal windows when creating sessions. This is useful for:
- **Development**: See Claude working in real-time
- **Debugging**: Watch tool execution and responses
- **Demos**: Show Claude in action
- **Interactive use**: Manually interact with Claude if needed

## Platform Support

- ✅ **Linux**: Fully supported (gnome-terminal, konsole, xterm, etc.)
- ⏳ **macOS**: Can be added (Terminal.app, iTerm2 via AppleScript)
- ❌ **Windows**: Not supported (WSL uses Linux approach)

## Usage

### Method 1: Per-Session via API

Create a session with a visible terminal:

```bash
curl -X POST http://127.0.0.1:4003/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-session",
    "cwd": "/path/to/project",
    "spawnTerminal": true
  }'
```

Create without visible terminal (background only):

```bash
curl -X POST http://127.0.0.1:4003/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-session",
    "cwd": "/path/to/project",
    "spawnTerminal": false
  }'
```

### Method 2: Default Behavior via Config

Set the default in your SessionManager config:

```typescript
const manager = new SessionManager({
  sessionsFile: '~/.coding-agent-bridge/data/sessions.json',
  defaultAgent: 'claude',
  spawnTerminalByDefault: true,  // ← All sessions spawn terminals
  // ... other options
})
```

Then all sessions spawn terminals unless explicitly disabled:

```bash
# This will spawn a terminal (default behavior)
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "session1"}'

# This will NOT spawn a terminal (explicitly disabled)
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "session2", "spawnTerminal": false}'
```

### Method 3: Programmatic Usage

```typescript
import { SessionManager, ClaudeAdapter } from 'coding-agent-bridge'

const manager = new SessionManager({
  sessionsFile: '~/.coding-agent-bridge/data/sessions.json',
  defaultAgent: 'claude',
  spawnTerminalByDefault: false,  // Default: no terminals
})
manager.registerAdapter(ClaudeAdapter)

await manager.start()

// Create with visible terminal
const session1 = await manager.createSession({
  name: 'visible-session',
  cwd: '/project1',
  spawnTerminal: true,  // ← Spawn terminal for this session
})

// Create without visible terminal
const session2 = await manager.createSession({
  name: 'background-session',
  cwd: '/project2',
  spawnTerminal: false,  // ← Background only
})
```

## Terminal Emulator Detection

The bridge auto-detects available terminal emulators in this order:

1. **gnome-terminal** (GNOME)
2. **konsole** (KDE)
3. **xfce4-terminal** (XFCE)
4. **xterm** (universal fallback)
5. **alacritty** (modern)
6. **kitty** (modern)
7. **terminator** (advanced)

You can also specify a preferred terminal:

```typescript
const manager = new SessionManager({
  // ... config
})

// The TmuxExecutor can be configured with a specific terminal
const tmux = new TmuxExecutor({
  debug: true,
  terminalEmulator: 'konsole',  // Force using konsole
})
```

## How It Works

When `spawnTerminal: true`:

1. **Create tmux session** (detached, in background)
   ```bash
   tmux new-session -d -s cab-abc123 -c /path
   tmux send-keys -t cab-abc123 "claude --dangerously-skip-permissions" Enter
   ```

2. **Detect terminal emulator**
   ```bash
   which gnome-terminal || which konsole || which xterm ...
   ```

3. **Spawn terminal window**
   ```bash
   gnome-terminal -- bash -c "tmux attach -t cab-abc123"
   ```

4. **Terminal window opens** showing Claude Code running

The terminal window:
- ✅ Shows Claude's full interface
- ✅ Displays tool usage in real-time
- ✅ Can be closed (session keeps running in background)
- ✅ Can be reattached with `tmux attach -t cab-abc123`

## Example Scenarios

### Scenario 1: Development Mode
```bash
# Start server with debug output
./bin/cli.js server --debug

# Create sessions with visible terminals for easy monitoring
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "dev-1", "spawnTerminal": true}'

curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "dev-2", "spawnTerminal": true}'

# You now have 2 terminal windows showing Claude sessions
# Monitor them visually while working
```

### Scenario 2: Production/CI Mode
```bash
# All sessions run in background (no GUI needed)
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "test-1", "spawnTerminal": false}'

curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "test-2", "spawnTerminal": false}'

# Monitor via WebSocket or events.jsonl instead
wscat -c ws://127.0.0.1:4003
```

### Scenario 3: Mixed Mode
```bash
# Create 10 background sessions for testing
for i in {1..10}; do
  curl -X POST http://127.0.0.1:4003/sessions \
    -d "{\"name\": \"test-$i\", \"spawnTerminal\": false}"
done

# Create 1 visible session for manual testing
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "manual-testing", "spawnTerminal": true}'
```

## Configuration Options

### SessionManagerConfig

```typescript
interface SessionManagerConfig {
  // ... other options

  /** Spawn visible terminal windows by default (Linux only) */
  spawnTerminalByDefault?: boolean  // Default: false
}
```

### CreateSessionOptions

```typescript
interface CreateSessionOptions {
  name?: string
  cwd?: string
  agent?: AgentType
  flags?: Record<string, boolean | string>

  /** Spawn a visible terminal window (Linux only) */
  spawnTerminal?: boolean  // Overrides spawnTerminalByDefault
}
```

### TmuxExecutorOptions

```typescript
interface TmuxExecutorOptions {
  debug?: boolean
  logger?: (message: string) => void

  /** Default terminal emulator for spawning visible terminals */
  terminalEmulator?: string  // Auto-detect if not specified
}
```

## Terminal Window Behavior

### What you see in the terminal:
```
 ▐▛███▜▌   Opus 4.5 · Claude Max
▝▜█████▛▘  /path/to/project
  ▘▘ ▝▝    [✻] [✻] [✻] · 3 guest passes at /passes

❯ [Waiting for input...]
```

### After sending a prompt via API:
```
❯ List all TypeScript files in the src directory

● Searching for TypeScript files...
● Found 12 files:
  - EventProcessor.ts
  - FileWatcher.ts
  - HookInstaller.ts
  ...
```

### Closing the terminal window:
- Session **continues running** in background
- Can reattach anytime: `tmux attach -t cab-abc123`
- Or via API: spawn another terminal for the same session

## Advantages

### With Visible Terminals:
✅ Visual feedback - see Claude working
✅ Interactive debugging - can type commands manually
✅ Demo friendly - show to others
✅ Familiar interface - looks like regular Claude Code

### Without Visible Terminals (Background):
✅ Headless servers - no GUI needed
✅ Many sessions - 50+ sessions without clutter
✅ Automation - CI/CD, testing, benchmarks
✅ Resource efficient - no terminal rendering

## Testing

Test terminal spawning:

```bash
# Start server
./bin/cli.js server

# Create session with terminal
curl -X POST http://127.0.0.1:4003/sessions \
  -d '{"name": "test", "cwd": "/tmp", "spawnTerminal": true}'

# A terminal window should appear!
# Check tmux sessions
tmux list-sessions
# cab-abc123: 1 windows (created ...) (attached)

# The "(attached)" means the terminal is connected
```

## Troubleshooting

### No terminal spawns

**Check 1**: Is this Linux?
```bash
uname -a
# Should show Linux
```

**Check 2**: Is a terminal emulator installed?
```bash
which gnome-terminal || which xterm || which konsole
```

**Check 3**: Check server logs
```bash
tail -f /path/to/server/output
# Look for: [TmuxExecutor] Detected terminal emulator: ...
# Look for: [TmuxExecutor] Spawning terminal: ...
```

**Check 4**: Try manually
```bash
gnome-terminal -- bash -c "tmux attach -t cab-abc123"
# Does this work?
```

### Terminal spawns but closes immediately

The session might have exited. Check:
```bash
tmux list-sessions
# Is the session still there?

tmux attach -t cab-abc123
# Can you attach manually?
```

### Wrong terminal emulator detected

Specify it explicitly:
```typescript
const tmux = new TmuxExecutor({
  terminalEmulator: 'xterm',  // Force xterm
})
```

## Future Enhancements

Potential additions:
- [ ] macOS support (Terminal.app, iTerm2)
- [ ] Windows WSL support
- [ ] Custom terminal commands (e.g., specific fonts, colors)
- [ ] Terminal profiles (different configs for different use cases)
- [ ] "Focus" mode - bring terminal to front when events occur

## Integration with CIN-Interface

Since you have [CIN-Interface](https://github.com/sploithunter/CIN-Interface):

**Option 1**: No terminals (recommended for GUI)
- Use CIN-Interface as the visual dashboard
- All sessions run in background
- CIN shows events/status via WebSocket

**Option 2**: Hybrid approach
- Important sessions: spawn terminals
- Other sessions: background only
- CIN-Interface monitors everything

**Option 3**: Developer mode
- Spawn terminals during development
- Disable for production
- CIN-Interface always available

## Summary

✅ **Implemented**: Terminal spawning on Linux
✅ **Configurable**: Per-session and global defaults
✅ **Auto-detection**: Finds available terminal emulators
✅ **Flexible**: Works with background-only mode too
✅ **Tested**: gnome-terminal confirmed working

Use `spawnTerminal: true` when you want to **see** Claude working.
Use `spawnTerminal: false` for **automation** and **headless** environments.

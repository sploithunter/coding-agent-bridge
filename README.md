# coding-agent-bridge

A bridge for managing AI coding assistant sessions (Claude Code, OpenAI Codex, etc.) via tmux with hooks integration.

## Features

- **Multi-Agent Support**: Works with Claude Code, OpenAI Codex, and extensible to other AI coding assistants
- **Session Management**: Create, monitor, and control coding sessions via tmux
- **Real-time Events**: Watch tool usage, status changes, and agent activity via WebSocket
- **Hook Integration**: Automatic event capture from agent hooks
- **External Session Discovery**: Monitor sessions started outside the bridge (read-only)
- **REST API**: Full HTTP API for session management
- **CLI Tools**: Easy setup, diagnostics, and server management

## Installation

```bash
npm install coding-agent-bridge
```

Or install globally for CLI access:

```bash
npm install -g coding-agent-bridge
```

### Prerequisites

- **Node.js** >= 18.0.0
- **tmux** - Terminal multiplexer for session management
- **jq** - JSON processor (used by hook scripts)
- **curl** - HTTP client (used by hook scripts)

Check prerequisites with:

```bash
coding-agent-bridge doctor
```

## Quick Start

### 1. Install Hooks

```bash
coding-agent-bridge setup
```

This installs hook scripts for Claude Code and Codex that capture events and send them to the bridge.

### 2. Start the Server

```bash
coding-agent-bridge server
```

The server runs on `http://127.0.0.1:4003` by default.

### 3. Create a Session

```bash
curl -X POST http://127.0.0.1:4003/sessions \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project", "cwd": "/path/to/project"}'
```

Or use the TypeScript API:

```typescript
import { SessionManager, ClaudeAdapter } from 'coding-agent-bridge'

const manager = new SessionManager({
  sessionsFile: '~/.coding-agent-bridge/data/sessions.json',
  defaultAgent: 'claude',
})
manager.registerAdapter(ClaudeAdapter)

const session = await manager.createSession({
  name: 'my-project',
  cwd: '/path/to/project',
})

console.log('Session created:', session.id)
```

## CLI Commands

### `coding-agent-bridge setup`

Install hooks for all supported agents.

```bash
# Install for all agents
coding-agent-bridge setup

# Install for specific agent
coding-agent-bridge setup --agent claude
```

### `coding-agent-bridge uninstall`

Remove hooks from all agents.

```bash
coding-agent-bridge uninstall
```

### `coding-agent-bridge doctor`

Check dependencies and installation status.

```bash
coding-agent-bridge doctor
```

### `coding-agent-bridge server`

Start the bridge server.

```bash
# Default settings
coding-agent-bridge server

# Custom port and host
coding-agent-bridge server --port 5000 --host 0.0.0.0

# With debug output
coding-agent-bridge server --debug
```

## API Reference

### SessionManager

The core class for managing coding sessions.

```typescript
import { SessionManager, ClaudeAdapter, CodexAdapter } from 'coding-agent-bridge'

const manager = new SessionManager({
  sessionsFile: '/path/to/sessions.json',
  defaultAgent: 'claude',
  workingTimeoutMs: 120000,      // 2 minutes
  offlineCleanupMs: 3600000,     // 1 hour
  staleCleanupMs: 604800000,     // 7 days
  trackExternalSessions: true,
  debug: false,
})

// Register adapters for agents you want to support
manager.registerAdapter(ClaudeAdapter)
manager.registerAdapter(CodexAdapter)

// Start the manager (enables health checks)
await manager.start()
```

#### Creating Sessions

```typescript
// Create an internal session (spawns tmux + agent)
const session = await manager.createSession({
  name: 'my-project',
  cwd: '/path/to/project',
  agent: 'claude',  // or 'codex'
})

// Session is automatically created in tmux
console.log(session.tmuxSession)  // 'cab-1234567890'
```

#### Listing Sessions

```typescript
// List all sessions
const sessions = manager.listSessions()

// Filter by type
const internal = manager.listSessions({ type: 'internal' })
const external = manager.listSessions({ type: 'external' })

// Filter by status
const working = manager.listSessions({ status: 'working' })
const idle = manager.listSessions({ status: 'idle' })

// Filter by agent
const claudeSessions = manager.listSessions({ agent: 'claude' })
```

#### Session Control

```typescript
// Send a prompt to a session
await manager.sendPrompt(session.id, 'Write a hello world function')

// Cancel current operation (sends Ctrl+C)
await manager.cancel(session.id)

// Restart an offline session
await manager.restart(session.id)

// Delete a session
await manager.deleteSession(session.id)
```

#### Events

```typescript
// Session lifecycle events
manager.on('session:created', (session) => {
  console.log('New session:', session.name)
})

manager.on('session:updated', (session, changes) => {
  console.log('Session updated:', session.id, changes)
})

manager.on('session:deleted', (session) => {
  console.log('Session deleted:', session.id)
})

manager.on('session:status', (session, oldStatus, newStatus) => {
  console.log(`${session.name}: ${oldStatus} -> ${newStatus}`)
})
```

### BridgeServer

HTTP and WebSocket server for remote access.

```typescript
import { BridgeServer, SessionManager } from 'coding-agent-bridge'

const server = new BridgeServer({
  port: 4003,
  host: '127.0.0.1',
  allowedOrigins: ['http://localhost:*'],
  debug: false,
})

server.setSessionManager(manager)
await server.start()

// Broadcast events to WebSocket clients
server.broadcast(event)
server.broadcastSessionUpdate(session, 'status')
```

#### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |
| GET | `/sessions` | List all sessions |
| POST | `/sessions` | Create new session |
| GET | `/sessions/:id` | Get session by ID |
| PATCH | `/sessions/:id` | Update session |
| DELETE | `/sessions/:id` | Delete session |
| POST | `/sessions/:id/prompt` | Send prompt to session |
| POST | `/sessions/:id/cancel` | Cancel current operation |
| POST | `/sessions/:id/restart` | Restart offline session |
| POST | `/event` | Receive hook events |

#### WebSocket

Connect to `ws://127.0.0.1:4003` to receive real-time events:

```javascript
const ws = new WebSocket('ws://127.0.0.1:4003')

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)

  switch (data.type) {
    case 'init':
      // Initial session list
      console.log('Sessions:', data.sessions)
      break
    case 'event':
      // Agent event (tool use, stop, etc.)
      console.log('Event:', data.data)
      break
    case 'session:created':
    case 'session:updated':
    case 'session:deleted':
    case 'session:status':
      console.log('Session update:', data.data)
      break
  }
}

// Keep-alive ping
setInterval(() => {
  ws.send(JSON.stringify({ type: 'ping' }))
}, 30000)
```

### FileWatcher

Watch the events file for new entries.

```typescript
import { FileWatcher } from 'coding-agent-bridge'

const watcher = new FileWatcher('/path/to/events.jsonl', {
  pollIntervalMs: 1000,
  processExisting: false,  // Start from end of file
  debug: false,
})

watcher.on('line', (line) => {
  console.log('New event:', JSON.parse(line))
})

watcher.on('error', (err) => {
  console.error('Watcher error:', err)
})

await watcher.start()
```

### EventProcessor

Parse and normalize events from different agents.

```typescript
import { EventProcessor } from 'coding-agent-bridge'

const processor = new EventProcessor({ debug: false })

processor.on('event', (processed) => {
  console.log('Agent:', processed.agent)
  console.log('Session:', processed.agentSessionId)
  console.log('Event:', processed.event)
})

// Process a raw JSON line
const result = processor.processLine(jsonLine)
```

### HookInstaller

Manage hook installation for agents.

```typescript
import { HookInstaller } from 'coding-agent-bridge'

const installer = new HookInstaller({
  dataDir: '~/.coding-agent-bridge',
  debug: false,
})

// Check dependencies
const deps = await installer.checkDependencies()
console.log('tmux:', deps.find(d => d.name === 'tmux')?.available)

// Install hooks
const results = await installer.installAll()
for (const result of results) {
  console.log(`${result.agent}: ${result.success ? 'OK' : result.message}`)
}

// Check status
const status = await installer.getStatus()
for (const s of status) {
  console.log(`${s.agent}: ${s.installed ? 'installed' : 'not installed'}`)
}

// Uninstall hooks
await installer.uninstallAll()
```

## Session Types

### Internal Sessions

Created by the bridge, fully managed:
- Spawned in tmux with the agent CLI
- Can send prompts, cancel, restart
- Automatically tracked and persisted

### External Sessions

Discovered via hooks, read-only:
- Started outside the bridge (e.g., in a terminal)
- Events captured via hooks
- Cannot send prompts directly
- Can view activity and status

## Agent Adapters

### ClaudeAdapter

For Claude Code CLI. Hooks into:
- PreToolUse, PostToolUse
- Stop, SubagentStop
- SessionStart, SessionEnd
- UserPromptSubmit, Notification

### CodexAdapter

For OpenAI Codex CLI. Hooks into:
- notify (with event_type: tool_start, tool_end, response, error)

### Creating Custom Adapters

```typescript
import type { AgentAdapter } from 'coding-agent-bridge'

const MyAdapter: AgentAdapter = {
  name: 'my-agent',
  displayName: 'My Agent',

  buildCommand(options) {
    return `my-agent ${options?.cwd ? `--cwd ${options.cwd}` : ''}`
  },

  parseHookEvent(hookName, data) {
    // Parse and return normalized event
    return {
      type: 'stop',
      agent: 'my-agent',
      // ...
    }
  },

  extractSessionId(event) {
    return event.sessionId
  },

  getHookConfig() {
    return {
      hookNames: ['my_hook'],
      settingsPath: '~/.my-agent/settings.json',
      timeout: 30,
    }
  },

  getSettingsPath() {
    return '~/.my-agent/settings.json'
  },

  async installHooks(hookScriptPath) {
    // Install hooks into agent settings
  },

  async uninstallHooks() {
    // Remove hooks from agent settings
  },
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     coding-agent-bridge                          │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    HTTP/WebSocket Server                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │   Session    │  │    Event     │  │    Agent Adapters     │  │
│  │   Manager    │◄─┤  Processor   │  │ Claude │ Codex │ ... │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
│         │                 ▲                     │                │
│         ▼                 │                     ▼                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │    Tmux      │  │    File      │  │   Hook Installer      │  │
│  │   Executor   │  │   Watcher    │  │                       │  │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                 ▲                     │
         ▼                 │                     ▼
    tmux sessions    events.jsonl         Agent settings
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CODING_AGENT_BRIDGE_URL` | Server URL for hooks | `http://127.0.0.1:4003` |
| `CODING_AGENT_BRIDGE_DEBUG` | Enable debug logging | (unset) |

### Data Directory

Default: `~/.coding-agent-bridge/`

```
~/.coding-agent-bridge/
├── hooks/
│   └── coding-agent-hook.sh    # Universal hook script
└── data/
    ├── events.jsonl            # Event log
    └── sessions.json           # Session state
```

## Development

```bash
# Clone the repository
git clone https://github.com/sploithunter/coding-agent-bridge.git
cd coding-agent-bridge

# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npm run typecheck

# Build
npm run build

# Development with watch
npm run dev
```

## Test Coverage

The package includes comprehensive tests:

- **TmuxExecutor**: 16 unit tests + 10 integration tests
- **ClaudeAdapter**: 21 tests
- **CodexAdapter**: 20 tests
- **SessionManager**: 37 unit tests + 18 integration tests
- **FileWatcher**: 15 tests
- **EventProcessor**: 27 tests
- **BridgeServer**: 21 tests
- **HookInstaller**: 17 tests

Total: **202 tests**

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

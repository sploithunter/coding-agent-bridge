# coding-agent-bridge

A bridge for managing AI coding assistant sessions (Claude Code, Codex, Gemini, etc.) via tmux with hooks integration.

## Features

- **Session Management**: Create, monitor, and control AI coding assistant sessions via tmux
- **Multi-Agent Support**: Built-in adapters for Claude Code and OpenAI Codex, extensible for others
- **Event Streaming**: Real-time events from agent hooks via EventEmitter and WebSocket
- **External Session Detection**: Auto-discover and monitor external sessions via hooks
- **HTTP/WebSocket API**: RESTful API for session control, WebSocket for real-time events

## Installation

```bash
npm install coding-agent-bridge
```

### Prerequisites

- Node.js 18+
- tmux
- jq (for hook script)
- One or more AI coding assistants: Claude Code, Codex, etc.

## Quick Start

```typescript
import { createBridge } from 'coding-agent-bridge'

// Create a bridge instance
const bridge = createBridge({
  dataDir: '~/.my-app',
  defaultAgent: 'claude',
})

// Start the bridge
await bridge.start()

// Create a session
const session = await bridge.createSession({
  name: 'my-project',
  cwd: '/path/to/project',
  agent: 'claude', // or 'codex'
})

// Send a prompt
await bridge.sendPrompt(session.id, 'Hello!')

// Listen for events
bridge.on('event', (event) => {
  console.log('Event:', event.type, event.tool)
})

bridge.on('session:status', (session, from, to) => {
  console.log(`Session ${session.name}: ${from} -> ${to}`)
})
```

## CLI

```bash
# Install hooks for all supported agents
coding-agent-bridge setup

# Install hooks for specific agent
coding-agent-bridge setup --agent claude
coding-agent-bridge setup --agent codex

# Check dependencies and hook status
coding-agent-bridge doctor

# Remove hooks
coding-agent-bridge uninstall

# Start the server
coding-agent-bridge server
```

## API Reference

### `createBridge(config?: BridgeConfig): Bridge`

Create a new bridge instance.

#### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dataDir` | `string` | `~/.coding-agent-bridge` | Data directory for sessions and events |
| `port` | `number` | `4003` | HTTP/WebSocket server port |
| `defaultAgent` | `string` | `'claude'` | Default agent for new sessions |
| `agents` | `string[]` | `['claude', 'codex']` | Enabled agent types |
| `trackExternalSessions` | `boolean` | `true` | Auto-detect external sessions via hooks |
| `workingTimeoutMs` | `number` | `120000` | Timeout before marking working sessions idle |
| `debug` | `boolean` | `false` | Enable debug logging |

### Session Methods

```typescript
// Create a new internal session
const session = await bridge.createSession({
  name: 'my-project',
  cwd: '/path/to/project',
  agent: 'claude', // or 'codex'
})

// List all sessions
const sessions = bridge.listSessions()

// Filter sessions
const claudeSessions = bridge.listSessions({ agent: 'claude' })
const workingSessions = bridge.listSessions({ status: 'working' })

// Get a specific session
const session = bridge.getSession(id)

// Delete a session
await bridge.deleteSession(id)

// Send a prompt (internal sessions only)
await bridge.sendPrompt(id, 'Hello!')

// Cancel (Ctrl+C)
await bridge.cancel(id)

// Restart
await bridge.restart(id)
```

### Events

```typescript
// All agent events
bridge.on('event', (event: AgentEvent) => { ... })

// Session lifecycle
bridge.on('session:created', (session: Session) => { ... })
bridge.on('session:updated', (session: Session, changes) => { ... })
bridge.on('session:deleted', (session: Session) => { ... })

// Status changes
bridge.on('session:status', (session, from, to) => { ... })
```

### Custom Agent Adapters

```typescript
import { createBridge, AgentAdapter } from 'coding-agent-bridge'

const myAdapter: AgentAdapter = {
  name: 'my-agent',
  displayName: 'My AI Agent',
  buildCommand: (options) => 'my-agent-cli --flag',
  parseHookEvent: (hookName, data) => { ... },
  extractSessionId: (event) => event.agentSessionId,
  getHookConfig: () => ({ ... }),
  getSettingsPath: () => '~/.my-agent/config.json',
  installHooks: async (path) => { ... },
  uninstallHooks: async () => { ... },
  isAvailable: async () => true,
}

const bridge = createBridge()
bridge.registerAgent(myAdapter)
```

## HTTP API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/sessions` | List all sessions |
| POST | `/sessions` | Create a new session |
| GET | `/sessions/:id` | Get session details |
| DELETE | `/sessions/:id` | Delete a session |
| POST | `/sessions/:id/prompt` | Send a prompt |
| POST | `/sessions/:id/cancel` | Cancel (Ctrl+C) |
| POST | `/sessions/:id/restart` | Restart session |
| WS | `/` | WebSocket for real-time events |
| GET | `/health` | Server health check |

## Supported Agents

### Claude Code
- Full hook support (PreToolUse, PostToolUse, Stop, etc.)
- Session detection and tracking
- Permission handling

### OpenAI Codex
- Notify hook support
- Thread ID tracking
- Event mapping to common format

### Adding New Agents
Implement the `AgentAdapter` interface to add support for additional AI coding assistants.

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

## License

MIT

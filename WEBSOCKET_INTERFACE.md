# WebSocket Interface Specification

**Version**: 1.0.0
**Last Updated**: 2025-01-23

This document defines the standard WebSocket protocol for real-time communication between coding agent bridges and their clients. All implementations (CIN-Interface, harness-bench, etc.) should conform to this specification.

## Overview

The WebSocket protocol provides:
- **Real-time event streaming** from coding agents (Claude, Codex, etc.)
- **Session management updates** as sessions are created, updated, or deleted
- **Bidirectional communication** for client requests (history, ping, etc.)

## Connection

Connect to the bridge server's WebSocket endpoint:
```
ws://localhost:4003/
```

Origins must match the server's allowed origins (default: `localhost:*`, `127.0.0.1:*`).

## Message Format

All messages are JSON objects with the following envelope:

```typescript
interface WSMessage {
  /** Message type identifier */
  type: string;
  /** Message payload (type-specific) */
  data?: unknown;
}
```

**Important**: Use `data` (not `payload`) as the payload field name for consistency.

---

## Server → Client Messages

### Connection Established: `init`

Sent immediately upon WebSocket connection. Provides initial state.

```typescript
interface WSInitMessage {
  type: 'init';
  data: {
    sessions: Session[];
  };
}
```

**Example**:
```json
{
  "type": "init",
  "data": {
    "sessions": [
      {
        "id": "abc-123",
        "name": "my-project",
        "type": "internal",
        "agent": "claude",
        "status": "idle",
        "cwd": "/home/user/projects/my-project",
        "createdAt": 1706054400000,
        "lastActivity": 1706054400000
      }
    ]
  }
}
```

### Agent Event: `event`

Broadcast when an agent emits an event (tool use, stop, etc.).

```typescript
interface WSEventMessage {
  type: 'event';
  data: AgentEvent;
}
```

**Example** (pre_tool_use):
```json
{
  "type": "event",
  "data": {
    "id": "evt-001",
    "type": "pre_tool_use",
    "timestamp": 1706054400000,
    "sessionId": "abc-123",
    "agent": "claude",
    "cwd": "/home/user/projects/my-project",
    "tool": "Read",
    "toolInput": { "file_path": "/home/user/projects/my-project/src/index.ts" },
    "toolUseId": "tu-001"
  }
}
```

**Example** (post_tool_use):
```json
{
  "type": "event",
  "data": {
    "id": "evt-002",
    "type": "post_tool_use",
    "timestamp": 1706054401000,
    "sessionId": "abc-123",
    "agent": "claude",
    "cwd": "/home/user/projects/my-project",
    "tool": "Read",
    "toolInput": { "file_path": "/home/user/projects/my-project/src/index.ts" },
    "toolResponse": { "content": "..." },
    "toolUseId": "tu-001",
    "success": true,
    "duration": 150
  }
}
```

**Example** (stop):
```json
{
  "type": "event",
  "data": {
    "id": "evt-003",
    "type": "stop",
    "timestamp": 1706054402000,
    "sessionId": "abc-123",
    "agent": "claude",
    "cwd": "/home/user/projects/my-project",
    "stopHookActive": false,
    "response": "I've completed the task."
  }
}
```

### Session Created: `session:created`

Broadcast when a new session is created.

```typescript
interface WSSessionCreatedMessage {
  type: 'session:created';
  data: Session;
}
```

**Example**:
```json
{
  "type": "session:created",
  "data": {
    "id": "def-456",
    "name": "new-session",
    "type": "internal",
    "agent": "claude",
    "status": "idle",
    "cwd": "/home/user/projects/new-project",
    "createdAt": 1706054500000,
    "lastActivity": 1706054500000,
    "tmuxSession": "bridge-def456"
  }
}
```

### Session Updated: `session:updated`

Broadcast when a session's properties change (name, cwd, currentTool, etc.).

```typescript
interface WSSessionUpdatedMessage {
  type: 'session:updated';
  data: Session;
}
```

### Session Deleted: `session:deleted`

Broadcast when a session is deleted/terminated.

```typescript
interface WSSessionDeletedMessage {
  type: 'session:deleted';
  data: Session;
}
```

### Session Status Changed: `session:status`

Broadcast when a session's status changes (idle → working → waiting → offline).

```typescript
interface WSSessionStatusMessage {
  type: 'session:status';
  data: Session;
}
```

### History Response: `history`

Response to a `get_history` request from the client.

```typescript
interface WSHistoryMessage {
  type: 'history';
  data: AgentEvent[];
}
```

### Pong: `pong`

Response to a `ping` request from the client.

```typescript
interface WSPongMessage {
  type: 'pong';
}
```

---

## Client → Server Messages

### Ping: `ping`

Keep-alive ping. Server responds with `pong`.

```typescript
interface WSPingMessage {
  type: 'ping';
}
```

### Request History: `get_history`

Request recent event history for active sessions.

```typescript
interface WSGetHistoryMessage {
  type: 'get_history';
  data?: {
    /** Max events to return (default: 100) */
    limit?: number;
    /** Filter by session ID */
    sessionId?: string;
  };
}
```

### Subscribe (Optional): `subscribe`

Subscribe to specific event types or sessions. If not sent, client receives all events.

```typescript
interface WSSubscribeMessage {
  type: 'subscribe';
  data?: {
    /** Session IDs to subscribe to (empty = all) */
    sessions?: string[];
    /** Event types to subscribe to (empty = all) */
    eventTypes?: EventType[];
  };
}
```

---

## Type Definitions

### Session

```typescript
type SessionStatus = 'idle' | 'working' | 'waiting' | 'offline';
type SessionType = 'internal' | 'external';
type AgentType = 'claude' | 'codex' | string;

interface Session {
  /** Unique identifier (UUID) */
  id: string;
  /** User-friendly name */
  name: string;
  /** How the session was created */
  type: SessionType;
  /** Which agent is running */
  agent: AgentType;
  /** Current session status */
  status: SessionStatus;
  /** Working directory */
  cwd: string;
  /** When the session was created (ms since epoch) */
  createdAt: number;
  /** Last activity timestamp (ms since epoch) */
  lastActivity: number;
  /** tmux session name (internal sessions only) */
  tmuxSession?: string;
  /** Agent's internal session ID */
  agentSessionId?: string;
  /** Currently executing tool */
  currentTool?: string;
}
```

### AgentEvent

```typescript
type EventType =
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'stop'
  | 'subagent_stop'
  | 'session_start'
  | 'session_end'
  | 'user_prompt_submit'
  | 'notification';

interface BaseEvent {
  id: string;
  timestamp: number;
  type: EventType;
  sessionId: string;
  agentSessionId?: string;
  agent: AgentType;
  cwd: string;
}

interface PreToolUseEvent extends BaseEvent {
  type: 'pre_tool_use';
  tool: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  assistantText?: string;
}

interface PostToolUseEvent extends BaseEvent {
  type: 'post_tool_use';
  tool: string;
  toolInput: Record<string, unknown>;
  toolResponse: Record<string, unknown>;
  toolUseId: string;
  success: boolean;
  duration?: number;
}

interface StopEvent extends BaseEvent {
  type: 'stop';
  stopHookActive: boolean;
  response?: string;
}

interface SubagentStopEvent extends BaseEvent {
  type: 'subagent_stop';
  status?: string;
}

interface SessionStartEvent extends BaseEvent {
  type: 'session_start';
  source: string;
}

interface SessionEndEvent extends BaseEvent {
  type: 'session_end';
  reason?: string;
}

interface UserPromptSubmitEvent extends BaseEvent {
  type: 'user_prompt_submit';
  prompt?: string;
}

interface NotificationEvent extends BaseEvent {
  type: 'notification';
  message?: string;
  level?: string;
}

type AgentEvent =
  | PreToolUseEvent
  | PostToolUseEvent
  | StopEvent
  | SubagentStopEvent
  | SessionStartEvent
  | SessionEndEvent
  | UserPromptSubmitEvent
  | NotificationEvent;
```

---

## Extension Points

Implementations may extend this specification with additional message types. Extension message types should be namespaced to avoid conflicts:

```typescript
// CIN-Interface extensions
type: 'cin:text_tiles'
type: 'cin:git_status'
type: 'cin:permission_prompt'

// Harness-bench extensions
type: 'harness:test_started'
type: 'harness:test_completed'
type: 'harness:benchmark_result'
```

Extension messages follow the same envelope format:
```typescript
interface WSExtensionMessage {
  type: `${namespace}:${name}`;
  data?: unknown;
}
```

---

## Migration Notes

### From CIN-Interface Legacy Format

If migrating from the legacy CIN-Interface format:

| Legacy | Standard |
|--------|----------|
| `{ type: 'connected', payload: {...} }` | `{ type: 'init', data: {...} }` |
| `{ type: 'sessions', payload: [...] }` | `{ type: 'init', data: { sessions: [...] } }` |
| `payload` | `data` |

### Backward Compatibility

During migration, servers may support both formats:
1. Accept `payload` or `data` in incoming messages
2. Optionally send both `payload` and `data` in outgoing messages

---

## Implementation Checklist

### Server Implementation
- [ ] Send `init` message on WebSocket connection
- [ ] Broadcast `event` messages for all agent events
- [ ] Broadcast `session:created` when sessions are created
- [ ] Broadcast `session:updated` when sessions are modified
- [ ] Broadcast `session:deleted` when sessions are deleted
- [ ] Broadcast `session:status` when session status changes
- [ ] Respond to `ping` with `pong`
- [ ] Respond to `get_history` with `history`
- [ ] Handle `subscribe` for filtering (optional)

### Client Implementation
- [ ] Handle `init` to populate initial state
- [ ] Handle `event` to update UI/state with agent activity
- [ ] Handle `session:*` messages to maintain session list
- [ ] Handle `history` response
- [ ] Send `ping` periodically for keep-alive (recommended: 30s)
- [ ] Reconnect on disconnection with exponential backoff

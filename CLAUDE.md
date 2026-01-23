# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Development Philosophy

### Test Early, Test Often
- Write tests alongside implementation, not after
- Run tests at the end of every phase before moving on
- Tests should cover both unit tests AND integration/E2E tests where applicable
- No phase is complete until tests pass

### Integration as You Go
- Don't build in isolation - integrate components as they're built
- E2E tests should verify the full flow works, not just individual pieces
- When adding new functionality, update existing tests to cover integration points

### Keep Going Until Complete
- Don't take shortcuts
- Don't do any hand waving
- Don't assume errors are from previous issues - ALL errors must be fixed
- Test everything end-to-end before considering a task complete

## Project Overview

**coding-agent-bridge** is a bridge for managing AI coding assistant sessions (Claude Code, Codex, Gemini, etc.) via tmux with hooks integration.

### Key Features
- Multi-agent support via adapter pattern
- Session management (create, monitor, control via tmux)
- Event streaming from agent hooks
- External session detection and monitoring
- HTTP/WebSocket API

## Development Commands

```bash
# Build TypeScript
npm run build

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Type check
npm run typecheck

# Development mode (watch)
npm run dev
```

## Architecture

```
src/
├── index.ts              # Main exports
├── types.ts              # Type definitions
├── TmuxExecutor.ts       # Safe tmux command execution
├── adapters/
│   ├── ClaudeAdapter.ts  # Claude Code adapter
│   └── CodexAdapter.ts   # OpenAI Codex adapter
├── SessionManager.ts     # (Phase 3) Session CRUD & state
├── EventProcessor.ts     # (Phase 4) Event parsing & routing
├── Server.ts             # (Phase 5) HTTP/WebSocket server
└── hooks/
    └── HookInstaller.ts  # (Phase 6) Hook management

hooks/
└── coding-agent-hook.sh  # Universal hook script

tests/
├── TmuxExecutor.test.ts
├── ClaudeAdapter.test.ts
├── CodexAdapter.test.ts
└── (integration tests as components are built)
```

## Testing Strategy

### Unit Tests
- TmuxExecutor: Validation functions, command building
- Adapters: Command building, event parsing, hook config
- SessionManager: State machine, CRUD operations
- EventProcessor: Event parsing, routing logic

### Integration Tests
- TmuxExecutor + tmux: Actual session create/kill (requires tmux)
- Adapters + filesystem: Hook installation
- SessionManager + TmuxExecutor: Full session lifecycle
- EventProcessor + FileWatcher: Event flow

### E2E Tests
- Full flow: Hook script → Event file → EventProcessor → SessionManager → WebSocket
- Session control: Create session → Send prompt → Receive events → Cancel

## Phase Completion Checklist

Before marking a phase complete:
1. [ ] All unit tests pass
2. [ ] Integration tests pass (where applicable)
3. [ ] E2E tests pass (where applicable)
4. [ ] Code compiles without errors
5. [ ] Functionality works when manually tested
6. [ ] Changes committed and pushed

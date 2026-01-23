/**
 * Coding Agent Bridge
 *
 * A bridge for managing AI coding assistant sessions (Claude, Codex, etc.) via tmux with hooks integration.
 *
 * @example
 * ```typescript
 * import { createBridge } from 'coding-agent-bridge'
 *
 * const bridge = createBridge({
 *   dataDir: '~/.my-app',
 *   defaultAgent: 'claude',
 * })
 *
 * await bridge.start()
 *
 * // Create a session
 * const session = await bridge.createSession({
 *   name: 'my-project',
 *   cwd: '/path/to/project',
 * })
 *
 * // Send a prompt
 * await bridge.sendPrompt(session.id, 'Hello, Claude!')
 *
 * // Listen for events
 * bridge.on('event', (event) => {
 *   console.log('Event:', event.type, event.tool)
 * })
 *
 * bridge.on('session:status', (session, from, to) => {
 *   console.log(`Session ${session.name}: ${from} -> ${to}`)
 * })
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  // Agent types
  AgentType,

  // Session types
  SessionStatus,
  SessionType,
  TerminalInfo,
  Session,
  CreateSessionOptions,
  SessionFilter,

  // Event types
  EventType,
  BaseEvent,
  PreToolUseEvent,
  PostToolUseEvent,
  StopEvent,
  SubagentStopEvent,
  SessionStartEvent,
  SessionEndEvent,
  UserPromptSubmitEvent,
  NotificationEvent,
  AgentEvent,

  // Configuration
  BridgeConfig,
  ResolvedConfig,

  // Agent adapter
  HookConfig,
  AgentCommandOptions,
  AgentAdapter,

  // Bridge API
  ImageInput,
  SendResult,
  BridgeEvents,
  Bridge,
} from './types.js'

// =============================================================================
// Core Components
// =============================================================================

export {
  TmuxExecutor,
  createTmuxExecutor,
  validateSessionName,
  validatePath,
  validatePaneId,
} from './TmuxExecutor.js'

export type {
  TmuxSession,
  TmuxExecutorOptions,
  SendKeysOptions,
  PasteBufferOptions,
} from './TmuxExecutor.js'

export {
  SessionManager,
  createSessionManager,
} from './SessionManager.js'

export type {
  SessionManagerConfig,
  SessionManagerEvents,
} from './SessionManager.js'

// =============================================================================
// Adapters
// =============================================================================

export { ClaudeAdapter } from './adapters/ClaudeAdapter.js'
export { CodexAdapter } from './adapters/CodexAdapter.js'

// =============================================================================
// Main API
// =============================================================================

// TODO: Implement in Phase 2-5
// export { createBridge } from './Bridge.js'

// Placeholder until Bridge is implemented
import type { Bridge, BridgeConfig } from './types.js'

/**
 * Create a new bridge instance.
 *
 * @param config - Bridge configuration options
 * @returns A new Bridge instance
 *
 * @example
 * ```typescript
 * const bridge = createBridge({
 *   dataDir: '~/.cin-interface',
 *   port: 4003,
 * })
 * ```
 */
export function createBridge(_config?: BridgeConfig): Bridge {
  // TODO: Implement in Phase 2-5
  throw new Error('createBridge not yet implemented - coming in Phase 2-5')
}

// =============================================================================
// Utilities
// =============================================================================

// TODO: Export utilities in Phase 6
// export { setupHooks, uninstallHooks, checkDependencies } from './HookInstaller.js'

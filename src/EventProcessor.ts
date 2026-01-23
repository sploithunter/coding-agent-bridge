/**
 * EventProcessor - Parses and normalizes events from hooks
 *
 * Receives raw JSON lines from FileWatcher, parses them into typed events,
 * extracts session identifiers, and routes events to the appropriate sessions.
 */

import { EventEmitter } from 'events'
import type {
  AgentEvent,
  EventType,
  PreToolUseEvent,
  PostToolUseEvent,
  StopEvent,
  SubagentStopEvent,
  SessionStartEvent,
  SessionEndEvent,
  UserPromptSubmitEvent,
  NotificationEvent,
  AgentType,
  TerminalInfo,
} from './types.js'
import { ClaudeAdapter } from './adapters/ClaudeAdapter.js'
import { CodexAdapter } from './adapters/CodexAdapter.js'
import type { AgentAdapter } from './types.js'

/**
 * Adapter object type - must have agentType, parseHookEvent, etc.
 */
type AdapterObject = AgentAdapter

export interface EventProcessorOptions {
  /** Enable debug logging */
  debug?: boolean
}

export interface ProcessedEvent {
  /** The parsed event */
  event: AgentEvent
  /** Agent session ID (from hooks) */
  agentSessionId: string
  /** Agent type (claude, codex, etc.) */
  agent: AgentType
  /** Terminal info if available */
  terminal?: TerminalInfo
  /** Working directory */
  cwd?: string
}

export interface EventProcessorEvents {
  event: [processed: ProcessedEvent]
  error: [error: Error, rawLine: string]
}

/**
 * Raw event format from hook scripts
 */
interface RawHookEvent {
  // Common fields
  event_type?: string
  type?: string
  hook_type?: string
  hook_event_name?: string  // Claude Code uses this field name
  timestamp?: string
  cwd?: string
  working_directory?: string

  // Session identifiers
  session_id?: string
  claude_session_id?: string

  // Terminal info
  tmux_pane?: string
  tmux_socket?: string
  tty?: string

  // Agent-specific
  agent?: string

  // Claude-specific fields
  tool_name?: string
  tool_input?: unknown
  tool_response?: unknown
  response?: string
  reason?: string
  message?: string
  title?: string

  // Codex-specific fields
  tool?: string
  input?: unknown
  output?: unknown

  // Catch-all for other fields
  [key: string]: unknown
}

export class EventProcessor extends EventEmitter {
  private options: Required<EventProcessorOptions>
  private adapters: Map<string, AdapterObject> = new Map()

  constructor(options: EventProcessorOptions = {}) {
    super()
    this.options = {
      debug: options.debug ?? false,
    }

    // Register default adapters
    this.adapters.set('claude', ClaudeAdapter)
    this.adapters.set('codex', CodexAdapter)
  }

  /**
   * Register an adapter for an agent type
   */
  registerAdapter(adapter: AdapterObject): void {
    this.adapters.set(adapter.name, adapter)
  }

  /**
   * Process a raw JSON line from the events file
   */
  processLine(line: string): ProcessedEvent | null {
    try {
      const raw = JSON.parse(line) as RawHookEvent

      // Determine agent type
      const agent = this.detectAgent(raw)
      if (!agent) {
        this.debug('Could not detect agent type for event:', line.substring(0, 100))
        return null
      }

      // Get adapter
      const adapter = this.adapters.get(agent)
      if (!adapter) {
        this.debug('No adapter for agent:', agent)
        return null
      }

      // Extract hook name for adapter
      // Claude Code uses hook_event_name, others may use hook_type, type, or event_type
      const hookName = raw.hook_event_name || raw.hook_type || raw.type || raw.event_type || ''

      // Use adapter to parse the event
      const partialEvent = adapter.parseHookEvent(hookName, raw)
      if (!partialEvent) {
        this.debug('Adapter could not parse event:', line.substring(0, 100))
        return null
      }

      // Validate and complete the event
      const event = this.validateEvent(partialEvent)
      if (!event) {
        this.debug('Invalid event (missing required fields):', line.substring(0, 100))
        return null
      }

      // Extract session identifier from adapter or raw event
      const agentSessionId =
        adapter.extractSessionId(partialEvent) ||
        this.extractSessionId(raw, agent)
      if (!agentSessionId) {
        this.debug('No session ID in event:', line.substring(0, 100))
        return null
      }

      // Extract terminal info
      const terminal = this.extractTerminalInfo(raw)

      // Extract cwd
      const cwd = raw.cwd || raw.working_directory

      const processed: ProcessedEvent = {
        event,
        agentSessionId,
        agent,
        terminal,
        cwd,
      }

      this.debug('Processed event:', event.type, 'session:', agentSessionId)
      this.emit('event', processed)

      return processed
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(String(err))
      this.emit('error', error, line)
      return null
    }
  }

  /**
   * Process multiple lines (batch processing)
   */
  processLines(lines: string[]): ProcessedEvent[] {
    const results: ProcessedEvent[] = []
    for (const line of lines) {
      const processed = this.processLine(line)
      if (processed) {
        results.push(processed)
      }
    }
    return results
  }

  /**
   * Detect agent type from raw event
   */
  private detectAgent(raw: RawHookEvent): AgentType | null {
    // Explicit agent field
    if (raw.agent === 'claude' || raw.agent === 'codex') {
      return raw.agent
    }

    // Claude-specific indicators
    if (raw.claude_session_id) {
      return 'claude'
    }

    // Claude hook types
    const claudeHookTypes = [
      'PreToolUse',
      'PostToolUse',
      'Stop',
      'SubagentStop',
      'SessionStart',
      'SessionEnd',
      'UserPromptSubmit',
      'Notification',
    ]

    const hookType = raw.hook_event_name || raw.hook_type || raw.type || raw.event_type
    if (hookType && claudeHookTypes.includes(hookType)) {
      return 'claude'
    }

    // Codex-specific indicators
    const codexHookTypes = ['exec_start', 'exec_end', 'message', 'error']
    if (hookType && codexHookTypes.includes(hookType)) {
      return 'codex'
    }

    // Try to detect from event structure
    if (raw.tool_name && raw.tool_input !== undefined) {
      return 'claude'
    }

    if (raw.tool && raw.input !== undefined) {
      return 'codex'
    }

    return null
  }

  /**
   * Extract session identifier from raw event
   */
  private extractSessionId(raw: RawHookEvent, agent: AgentType): string | null {
    // Claude session ID
    if (raw.claude_session_id) {
      return raw.claude_session_id
    }

    // Generic session ID
    if (raw.session_id) {
      return raw.session_id
    }

    // For Codex, use tmux pane as session identifier if no session_id
    if (agent === 'codex' && raw.tmux_pane) {
      return `codex-${raw.tmux_pane}`
    }

    // Fallback: use tty as identifier
    if (raw.tty) {
      return `${agent}-${raw.tty}`
    }

    return null
  }

  /**
   * Extract terminal info from raw event
   */
  private extractTerminalInfo(raw: RawHookEvent): TerminalInfo | undefined {
    if (!raw.tmux_pane && !raw.tty) {
      return undefined
    }

    return {
      tmuxPane: raw.tmux_pane,
      tmuxSocket: raw.tmux_socket,
      tty: raw.tty,
    }
  }

  /**
   * Validate and complete a partial event to ensure required fields are present
   */
  private validateEvent(partial: Partial<AgentEvent>): AgentEvent | null {
    // Required fields for all events
    if (!partial.type || !partial.agent) {
      return null
    }

    // Ensure we have id and timestamp
    const event = {
      ...partial,
      id: partial.id || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      timestamp: partial.timestamp || Date.now(),
    } as AgentEvent

    return event
  }

  private debug(...args: unknown[]): void {
    if (this.options.debug) {
      console.log('[EventProcessor]', ...args)
    }
  }
}

/**
 * Create a new EventProcessor instance
 */
export function createEventProcessor(
  options?: EventProcessorOptions
): EventProcessor {
  return new EventProcessor(options)
}

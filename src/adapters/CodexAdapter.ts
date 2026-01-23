/**
 * OpenAI Codex Adapter
 *
 * Adapter for managing Codex CLI sessions.
 */

import type {
  AgentAdapter,
  AgentCommandOptions,
  AgentEvent,
  HookConfig,
} from '../types.js'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Default Codex flags for internal sessions.
 */
const DEFAULT_FLAGS = {
  'full-auto': true,
}

/**
 * Codex hook names (uses notify hook system).
 */
const HOOK_NAMES = ['notify']

/**
 * Adapter for OpenAI Codex CLI.
 */
export const CodexAdapter: AgentAdapter = {
  name: 'codex',
  displayName: 'OpenAI Codex',

  buildCommand(options?: AgentCommandOptions): string {
    const flags = { ...DEFAULT_FLAGS, ...options?.flags }
    const flagsStr = Object.entries(flags)
      .filter(([_, value]) => value !== false)
      .map(([key, value]) => {
        if (value === true) return `--${key}`
        return `--${key}=${value}`
      })
      .join(' ')

    return `codex ${flagsStr}`.trim()
  },

  parseHookEvent(hookName: string, data: unknown): Partial<AgentEvent> | null {
    if (!data || typeof data !== 'object') return null
    if (hookName !== 'notify') return null

    const d = data as Record<string, unknown>

    // Codex uses a different event structure via notify hook
    const event: Partial<AgentEvent> = {
      agent: 'codex',
      cwd: typeof d.cwd === 'string' ? d.cwd : process.cwd(),
    }

    // Extract thread ID as session ID
    if (typeof d.thread_id === 'string') {
      event.agentSessionId = d.thread_id
    }

    // Map Codex event types to our types
    const eventType = d.event_type as string | undefined
    switch (eventType) {
      case 'tool_start':
        event.type = 'pre_tool_use'
        if (typeof d.tool === 'string') {
          (event as Record<string, unknown>).tool = d.tool
        }
        break
      case 'tool_end':
        event.type = 'post_tool_use'
        if (typeof d.tool === 'string') {
          (event as Record<string, unknown>).tool = d.tool
        }
        (event as Record<string, unknown>).success = d.success !== false
        break
      case 'response':
        event.type = 'stop'
        break
      case 'session_start':
        event.type = 'session_start'
        break
      case 'session_end':
        event.type = 'session_end'
        break
      default:
        event.type = 'notification'
    }

    return event
  },

  extractSessionId(event: Partial<AgentEvent>): string | undefined {
    return event.agentSessionId
  },

  getHookConfig(): HookConfig {
    return {
      hookNames: HOOK_NAMES,
      settingsPath: this.getSettingsPath(),
      timeout: 5,
    }
  },

  getSettingsPath(): string {
    // Codex config location
    return join(homedir(), '.codex', 'config.json')
  },

  async installHooks(_hookScriptPath: string): Promise<void> {
    // TODO: Implement in Phase 6
    throw new Error('installHooks not yet implemented')
  },

  async uninstallHooks(): Promise<void> {
    // TODO: Implement in Phase 6
    throw new Error('uninstallHooks not yet implemented')
  },

  async isAvailable(): Promise<boolean> {
    // TODO: Check if 'codex' command exists in PATH
    return true
  },
}

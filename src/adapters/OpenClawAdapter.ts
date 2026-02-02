/**
 * OpenClaw Adapter
 *
 * Adapter for managing OpenClaw agent sessions.
 */

import type {
  AgentAdapter,
  AgentCommandOptions,
  AgentEvent,
  HookConfig,
  TerminalInfo,
} from '../types.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'

const execAsync = promisify(exec)

/**
 * Default OpenClaw flags for internal sessions.
 */
const DEFAULT_FLAGS: Record<string, boolean | string> = {
  // OpenClaw runs interactively by default
  // We'll let it run in the terminal and handle input via tmux
}

/**
 * OpenClaw adapter for coding-agent-bridge.
 *
 * Note: OpenClaw doesn't have built-in hooks like Claude Code,
 * so event capture would need to be implemented separately
 * (e.g., via log monitoring or custom plugins).
 */
export const OpenClawAdapter: AgentAdapter = {
  name: 'openclaw',
  displayName: 'OpenClaw',

  buildCommand(options?: AgentCommandOptions): string {
    const flags = { ...DEFAULT_FLAGS, ...options?.flags }
    const parts = ['openclaw', 'gateway']

    // Add port if specified
    if (flags.port) {
      parts.push('--port', String(flags.port))
    }

    // Add other flags
    for (const [key, value] of Object.entries(flags)) {
      if (key === 'port') continue // Already handled
      if (value === false) continue
      if (value === true) {
        parts.push(`--${key}`)
      } else {
        parts.push(`--${key}`, String(value))
      }
    }

    return parts.join(' ')
  },

  parseHookEvent(hookName: string, data: unknown): Partial<AgentEvent> | null {
    // OpenClaw doesn't have built-in hooks yet
    // This would need to be implemented via log monitoring or custom plugins
    if (!data || typeof data !== 'object') return null

    const d = data as Record<string, unknown>

    // Placeholder event structure
    const baseEvent = {
      id: randomUUID(),
      timestamp: Date.now(),
      type: 'notification' as const,
      agent: 'openclaw' as const,
      cwd: (d.cwd as string) ?? process.cwd(),
      agentSessionId: d.session_id as string,
    }

    return baseEvent
  },

  extractSessionId(event: Partial<AgentEvent>): string | undefined {
    return event.agentSessionId
  },

  getHookConfig(): HookConfig {
    return {
      hookNames: [],
      settingsPath: this.getSettingsPath(),
      timeout: 5,
    }
  },

  getSettingsPath(): string {
    // OpenClaw config location
    return `${process.env.HOME}/.openclaw/openclaw.json`
  },

  async installHooks(hookScriptPath: string): Promise<void> {
    // OpenClaw doesn't have a hook system like Claude Code yet
    // This could be implemented as a plugin or via log monitoring
    console.log('[OpenClawAdapter] Hook installation not yet implemented for OpenClaw')
    console.log('[OpenClawAdapter] Consider using log monitoring or creating an OpenClaw plugin')
  },

  async uninstallHooks(): Promise<void> {
    // No hooks to uninstall
  },

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which openclaw')
      return true
    } catch {
      return false
    }
  },
}

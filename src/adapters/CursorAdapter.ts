/**
 * Cursor Agent Adapter
 *
 * Adapter for managing Cursor Agent CLI sessions.
 * Cursor Agent uses a similar hook system to other coding agents.
 */

import type {
  AgentAdapter,
  AgentCommandOptions,
  AgentEvent,
  HookConfig,
  PreToolUseEvent,
  PostToolUseEvent,
  StopEvent,
  SessionStartEvent,
  SessionEndEvent,
  NotificationEvent,
  TerminalInfo,
} from '../types.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'

const execAsync = promisify(exec)

/**
 * Default Cursor Agent flags for internal sessions.
 */
const DEFAULT_FLAGS: Record<string, boolean | string> = {
  'yes': true, // Auto-approve prompts
}

/**
 * Cursor Agent hook names.
 * Based on common agent hook patterns.
 */
const HOOK_NAMES = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionStart',
  'SessionEnd',
  'Notification',
]

/**
 * Map Cursor hook names to event types.
 */
const HOOK_TYPE_MAP: Record<string, AgentEvent['type']> = {
  PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use',
  Stop: 'stop',
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  Notification: 'notification',
}

/**
 * Cursor hook data structure (from stdin).
 */
interface CursorHookData {
  session_id?: string
  cwd?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_use_id?: string
  tool_output?: Record<string, unknown>
  tool_response?: Record<string, unknown>
  error?: string
  success?: boolean
  message?: string
  level?: string
  source?: string
  // Terminal info
  tmux_pane?: string
  tmux_socket?: string
  tty?: string
}

/**
 * Parse terminal info from hook data.
 */
function parseTerminalInfo(data: CursorHookData): TerminalInfo | undefined {
  if (data.tmux_pane || data.tmux_socket || data.tty) {
    return {
      tmuxPane: data.tmux_pane,
      tmuxSocket: data.tmux_socket,
      tty: data.tty,
    }
  }
  return undefined
}

/**
 * Adapter for Cursor Agent CLI.
 */
export const CursorAdapter: AgentAdapter = {
  name: 'cursor',
  displayName: 'Cursor Agent',

  buildCommand(options?: AgentCommandOptions): string {
    const flags = { ...DEFAULT_FLAGS, ...options?.flags }
    const parts = ['cursor-agent']

    for (const [key, value] of Object.entries(flags)) {
      if (value === false) continue
      if (value === true) {
        parts.push(`--${key}`)
      } else {
        parts.push(`--${key}=${value}`)
      }
    }

    return parts.join(' ')
  },

  parseHookEvent(hookName: string, data: unknown): Partial<AgentEvent> | null {
    if (!data || typeof data !== 'object') return null

    const type = HOOK_TYPE_MAP[hookName]
    if (!type) return null

    const d = data as CursorHookData

    // Base event properties
    const baseEvent = {
      id: randomUUID(),
      timestamp: Date.now(),
      type,
      agent: 'cursor' as const,
      cwd: d.cwd ?? process.cwd(),
      agentSessionId: d.session_id,
    }

    // Type-specific event building
    switch (type) {
      case 'pre_tool_use': {
        const event: Partial<PreToolUseEvent> = {
          ...baseEvent,
          type: 'pre_tool_use',
          tool: d.tool_name ?? 'unknown',
          toolInput: d.tool_input ?? {},
          toolUseId: d.tool_use_id ?? randomUUID(),
        }
        return event
      }

      case 'post_tool_use': {
        const event: Partial<PostToolUseEvent> = {
          ...baseEvent,
          type: 'post_tool_use',
          tool: d.tool_name ?? 'unknown',
          toolInput: d.tool_input ?? {},
          toolResponse: d.tool_response ?? d.tool_output ?? {},
          toolUseId: d.tool_use_id ?? randomUUID(),
          success: d.success ?? !d.error,
        }
        return event
      }

      case 'stop': {
        const event: Partial<StopEvent> = {
          ...baseEvent,
          type: 'stop',
          stopHookActive: false,
        }
        return event
      }

      case 'session_start': {
        const event: Partial<SessionStartEvent> = {
          ...baseEvent,
          type: 'session_start',
          source: d.source ?? 'cursor',
          terminal: parseTerminalInfo(d),
        }
        return event
      }

      case 'session_end': {
        const event: Partial<SessionEndEvent> = {
          ...baseEvent,
          type: 'session_end',
        }
        return event
      }

      case 'notification': {
        const event: Partial<NotificationEvent> = {
          ...baseEvent,
          type: 'notification',
          message: d.message,
          level: d.level,
        }
        return event
      }

      default:
        return baseEvent
    }
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
    // Cursor config location
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')

    // Check common locations
    // ~/.cursor-agent/config.json (default)
    // ~/.config/cursor-agent/config.json (XDG)
    if (process.env.XDG_CONFIG_HOME) {
      return join(xdgConfig, 'cursor-agent', 'config.json')
    }
    return join(homedir(), '.cursor-agent', 'config.json')
  },

  async installHooks(hookScriptPath: string): Promise<void> {
    const settingsPath = this.getSettingsPath()

    // Ensure directory exists
    await mkdir(dirname(settingsPath), { recursive: true })

    // Read existing settings or create new
    let settings: Record<string, unknown> = {}
    try {
      const content = await readFile(settingsPath, 'utf8')
      settings = JSON.parse(content)
    } catch {
      // File doesn't exist or invalid JSON - start fresh
    }

    // Ensure hooks object exists
    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {}
    }
    const hooks = settings.hooks as Record<string, unknown>

    // Add hook configurations for each hook name
    for (const hookName of HOOK_NAMES) {
      hooks[hookName] = {
        command: hookScriptPath,
        timeout: 5,
      }
    }

    // Write updated settings
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  },

  async uninstallHooks(): Promise<void> {
    const settingsPath = this.getSettingsPath()

    try {
      const content = await readFile(settingsPath, 'utf8')
      const settings = JSON.parse(content) as Record<string, unknown>

      if (settings.hooks && typeof settings.hooks === 'object') {
        const hooks = settings.hooks as Record<string, unknown>

        // Remove our hook configurations
        for (const hookName of HOOK_NAMES) {
          delete hooks[hookName]
        }

        // Remove hooks object if empty
        if (Object.keys(hooks).length === 0) {
          delete settings.hooks
        }

        await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
      }
    } catch {
      // Settings file doesn't exist or can't be read - nothing to uninstall
    }
  },

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which cursor-agent')
      return true
    } catch {
      return false
    }
  },
}

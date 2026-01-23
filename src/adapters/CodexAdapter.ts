/**
 * OpenAI Codex Adapter
 *
 * Adapter for managing Codex CLI sessions.
 * Codex uses a different hook system (notify) and event structure.
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
 * Default Codex flags for internal sessions.
 */
const DEFAULT_FLAGS: Record<string, boolean | string> = {
  'full-auto': true,
}

/**
 * Codex uses a simpler notify hook system.
 */
const HOOK_NAMES = ['notify']

/**
 * Codex event types (from notify hook).
 */
type CodexEventType =
  | 'tool_start'
  | 'tool_end'
  | 'response'
  | 'session_start'
  | 'session_end'
  | 'error'
  | 'message'

/**
 * Codex notify hook data structure.
 */
interface CodexHookData {
  thread_id?: string
  event_type?: CodexEventType
  cwd?: string
  tool?: string
  tool_input?: Record<string, unknown>
  tool_output?: Record<string, unknown>
  success?: boolean
  message?: string
  response?: string
  error?: string
  // Terminal info
  tmux_pane?: string
  tmux_socket?: string
  tty?: string
}

/**
 * Parse terminal info from hook data.
 */
function parseTerminalInfo(data: CodexHookData): TerminalInfo | undefined {
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
 * Adapter for OpenAI Codex CLI.
 */
export const CodexAdapter: AgentAdapter = {
  name: 'codex',
  displayName: 'OpenAI Codex',

  buildCommand(options?: AgentCommandOptions): string {
    const flags = { ...DEFAULT_FLAGS, ...options?.flags }
    const parts = ['codex']

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
    if (hookName !== 'notify') return null

    const d = data as CodexHookData

    // Base event properties
    const baseEvent = {
      id: randomUUID(),
      timestamp: Date.now(),
      agent: 'codex' as const,
      cwd: d.cwd ?? process.cwd(),
      agentSessionId: d.thread_id,
    }

    // Map Codex event types to our event types
    switch (d.event_type) {
      case 'tool_start': {
        const event: Partial<PreToolUseEvent> = {
          ...baseEvent,
          type: 'pre_tool_use',
          tool: d.tool ?? 'unknown',
          toolInput: d.tool_input ?? {},
          toolUseId: randomUUID(),
        }
        return event
      }

      case 'tool_end': {
        const event: Partial<PostToolUseEvent> = {
          ...baseEvent,
          type: 'post_tool_use',
          tool: d.tool ?? 'unknown',
          toolInput: d.tool_input ?? {},
          toolResponse: d.tool_output ?? {},
          toolUseId: randomUUID(), // Note: Can't correlate with pre without tool_use_id
          success: d.success ?? !d.error,
        }
        return event
      }

      case 'response': {
        const event: Partial<StopEvent> = {
          ...baseEvent,
          type: 'stop',
          stopHookActive: false,
          response: d.response ?? d.message,
        }
        return event
      }

      case 'session_start': {
        const event: Partial<SessionStartEvent> = {
          ...baseEvent,
          type: 'session_start',
          source: 'codex',
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

      case 'error':
      case 'message':
      default: {
        const event: Partial<NotificationEvent> = {
          ...baseEvent,
          type: 'notification',
          message: d.message ?? d.error,
          level: d.event_type === 'error' ? 'error' : 'info',
        }
        return event
      }
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
    // Codex config location - may vary by version
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')

    // Check common locations
    // ~/.codex/config.json (older)
    // ~/.config/codex/config.json (XDG)
    if (process.env.XDG_CONFIG_HOME) {
      return join(xdgConfig, 'codex', 'config.json')
    }
    return join(homedir(), '.codex', 'config.json')
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

    // Codex uses a different hook configuration format
    // Set the notify hook command
    settings.notify_command = hookScriptPath

    // Write updated settings
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  },

  async uninstallHooks(): Promise<void> {
    const settingsPath = this.getSettingsPath()

    try {
      const content = await readFile(settingsPath, 'utf8')
      const settings = JSON.parse(content) as Record<string, unknown>

      // Remove notify command
      delete settings.notify_command

      await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
    } catch {
      // Settings file doesn't exist or can't be read - nothing to uninstall
    }
  },

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which codex')
      return true
    } catch {
      return false
    }
  },
}

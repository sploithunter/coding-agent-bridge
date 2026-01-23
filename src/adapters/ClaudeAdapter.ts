/**
 * Claude Code Adapter
 *
 * Adapter for managing Claude Code sessions.
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
 * Default Claude Code flags for internal sessions.
 */
const DEFAULT_FLAGS = {
  'dangerously-skip-permissions': true,
}

/**
 * Claude Code hook names.
 */
const HOOK_NAMES = [
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Notification',
]

/**
 * Adapter for Claude Code CLI.
 */
export const ClaudeAdapter: AgentAdapter = {
  name: 'claude',
  displayName: 'Claude Code',

  buildCommand(options?: AgentCommandOptions): string {
    const flags = { ...DEFAULT_FLAGS, ...options?.flags }
    const flagsStr = Object.entries(flags)
      .filter(([_, value]) => value !== false)
      .map(([key, value]) => {
        if (value === true) return `--${key}`
        return `--${key}=${value}`
      })
      .join(' ')

    return `claude ${flagsStr}`.trim()
  },

  parseHookEvent(hookName: string, data: unknown): Partial<AgentEvent> | null {
    if (!data || typeof data !== 'object') return null

    const d = data as Record<string, unknown>

    // Map hook names to event types
    const typeMap: Record<string, AgentEvent['type']> = {
      PreToolUse: 'pre_tool_use',
      PostToolUse: 'post_tool_use',
      Stop: 'stop',
      SubagentStop: 'subagent_stop',
      SessionStart: 'session_start',
      SessionEnd: 'session_end',
      UserPromptSubmit: 'user_prompt_submit',
      Notification: 'notification',
    }

    const type = typeMap[hookName]
    if (!type) return null

    const event: Partial<AgentEvent> = {
      type,
      agent: 'claude',
      cwd: typeof d.cwd === 'string' ? d.cwd : process.cwd(),
    }

    // Extract session ID
    if (typeof d.session_id === 'string') {
      event.agentSessionId = d.session_id
    }

    // Type-specific fields
    if (type === 'pre_tool_use' || type === 'post_tool_use') {
      const toolData = d as Record<string, unknown>
      if (typeof toolData.tool === 'string') {
        (event as Record<string, unknown>).tool = toolData.tool
      }
      if (toolData.tool_input) {
        (event as Record<string, unknown>).toolInput = toolData.tool_input
      }
      if (typeof toolData.tool_use_id === 'string') {
        (event as Record<string, unknown>).toolUseId = toolData.tool_use_id
      }
      if (type === 'post_tool_use') {
        if (toolData.tool_response) {
          (event as Record<string, unknown>).toolResponse = toolData.tool_response
        }
        (event as Record<string, unknown>).success = toolData.success !== false
      }
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
    // Check for XDG config first, fall back to ~/.claude
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
    const xdgPath = join(xdgConfig, 'claude', 'settings.json')
    const defaultPath = join(homedir(), '.claude', 'settings.json')

    // TODO: Check which exists and return that
    return defaultPath
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
    // TODO: Check if 'claude' command exists in PATH
    return true
  },
}

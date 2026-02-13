/**
 * Claude Code Adapter
 *
 * Adapter for managing Claude Code sessions.
 */

import type {
  AgentAdapter,
  AgentCommandOptions,
  AgentEvent,
  AssistantMessageEvent,
  ContentBlock,
  HookConfig,
  PreToolUseEvent,
  PostToolUseEvent,
  StopEvent,
  SubagentStopEvent,
  SessionStartEvent,
  SessionEndEvent,
  UserPromptSubmitEvent,
  NotificationEvent,
  TerminalInfo,
} from '../types.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile, access } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const execAsync = promisify(exec)

/**
 * Default Claude Code flags for internal sessions.
 */
const DEFAULT_FLAGS: Record<string, boolean | string> = {
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
 * Map Claude hook names to event types.
 */
const HOOK_TYPE_MAP: Record<string, AgentEvent['type']> = {
  PreToolUse: 'pre_tool_use',
  PostToolUse: 'post_tool_use',
  Stop: 'stop',
  SubagentStop: 'subagent_stop',
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'user_prompt_submit',
  Notification: 'notification',
}

/**
 * Claude hook data structure (from stdin).
 */
interface ClaudeHookData {
  session_id?: string
  cwd?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_use_id?: string
  tool_response?: Record<string, unknown>
  error?: string
  stop_hook_active?: boolean
  transcript_path?: string
  source?: string
  message?: string
  level?: string
  prompt?: string
}

/**
 * Transcript entry from Claude Code's JSONL transcript file.
 */
interface ClaudeTranscriptEntry {
  type: string
  message?: {
    id?: string
    content?: Array<{
      type: string
      text?: string
      name?: string
      input?: Record<string, unknown>
      id?: string
    }>
  }
  requestId?: string
}

/**
 * Parse terminal info from environment variables in hook data.
 */
function parseTerminalInfo(data: ClaudeHookData & Record<string, unknown>): TerminalInfo | undefined {
  const tmuxPane = data.tmux_pane as string | undefined
  const tmuxSocket = data.tmux_socket as string | undefined
  const tty = data.tty as string | undefined

  if (tmuxPane || tmuxSocket || tty) {
    return {
      tmuxPane,
      tmuxSocket,
      tty,
    }
  }
  return undefined
}

/**
 * Adapter for Claude Code CLI.
 */
export const ClaudeAdapter: AgentAdapter = {
  name: 'claude',
  displayName: 'Claude Code',

  buildCommand(options?: AgentCommandOptions): string {
    const flags = { ...DEFAULT_FLAGS, ...options?.flags }
    const parts = ['claude']

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

    const d = data as ClaudeHookData & Record<string, unknown>

    // Base event properties
    const baseEvent = {
      id: randomUUID(),
      timestamp: Date.now(),
      type,
      agent: 'claude' as const,
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
          toolResponse: d.tool_response ?? {},
          toolUseId: d.tool_use_id ?? randomUUID(),
          success: !d.error,
        }
        return event
      }

      case 'stop': {
        const event: Partial<StopEvent> = {
          ...baseEvent,
          type: 'stop',
          stopHookActive: d.stop_hook_active ?? false,
        }
        return event
      }

      case 'subagent_stop': {
        const event: Partial<SubagentStopEvent> = {
          ...baseEvent,
          type: 'subagent_stop',
        }
        return event
      }

      case 'session_start': {
        const event: Partial<SessionStartEvent> = {
          ...baseEvent,
          type: 'session_start',
          source: d.source ?? 'unknown',
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

      case 'user_prompt_submit': {
        const event: Partial<UserPromptSubmitEvent> = {
          ...baseEvent,
          type: 'user_prompt_submit',
          prompt: (d.prompt as string | undefined) ?? (d.message as string | undefined),
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
    // Check for XDG config first
    const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
    const xdgPath = join(xdgConfig, 'claude', 'settings.json')
    const defaultPath = join(homedir(), '.claude', 'settings.json')

    // Prefer XDG path if XDG_CONFIG_HOME is set
    if (process.env.XDG_CONFIG_HOME) {
      return xdgPath
    }
    return defaultPath
  },

  async installHooks(hookScriptPath: string): Promise<void> {
    const settingsPath = this.getSettingsPath()

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
      hooks[hookName] = [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: hookScriptPath,
              timeout: 5,
            },
          ],
        },
      ]
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
      await execAsync('which claude')
      return true
    } catch {
      return false
    }
  },

  parseTranscriptEntry(entry: unknown): Partial<AssistantMessageEvent> | null {
    if (!entry || typeof entry !== 'object') return null

    const e = entry as ClaudeTranscriptEntry
    if (e.type !== 'assistant') return null

    const messageContent = e.message?.content
    if (!Array.isArray(messageContent) || messageContent.length === 0) return null

    // Convert Claude content blocks to our ContentBlock format
    const content: ContentBlock[] = []
    for (const block of messageContent) {
      switch (block.type) {
        case 'text':
          content.push({ type: 'text', text: block.text ?? '' })
          break
        case 'thinking':
          content.push({ type: 'thinking', text: block.text ?? '' })
          break
        case 'tool_use':
          content.push({
            type: 'tool_use',
            toolName: block.name,
            toolInput: block.input,
            toolUseId: block.id,
          })
          break
        // Skip other block types (tool_result, etc.)
      }
    }

    if (content.length === 0) return null

    // Detect preamble: all text blocks contain only whitespace
    const textBlocks = content.filter((b) => b.type === 'text')
    const isPreamble =
      textBlocks.length > 0 &&
      content.every((b) => b.type !== 'tool_use') &&
      textBlocks.every((b) => !b.text || b.text.trim() === '')

    return {
      type: 'assistant_message',
      agent: 'claude',
      content,
      requestId: e.requestId ?? e.message?.id,
      isPreamble,
      timestamp: Date.now(),
    }
  },
}

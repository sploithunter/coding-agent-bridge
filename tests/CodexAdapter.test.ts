import { describe, it, expect } from 'vitest'
import { CodexAdapter } from '../src/adapters/CodexAdapter.js'

describe('CodexAdapter', () => {
  describe('name and displayName', () => {
    it('should have correct name', () => {
      expect(CodexAdapter.name).toBe('codex')
    })

    it('should have correct displayName', () => {
      expect(CodexAdapter.displayName).toBe('OpenAI Codex')
    })
  })

  describe('buildCommand', () => {
    it('should build default command with full-auto flag', () => {
      const cmd = CodexAdapter.buildCommand()
      expect(cmd).toContain('codex')
      expect(cmd).toContain('--full-auto')
    })

    it('should allow overriding default flags', () => {
      const cmd = CodexAdapter.buildCommand({
        flags: { 'full-auto': false },
      })
      expect(cmd).toBe('codex')
    })

    it('should add custom flags', () => {
      const cmd = CodexAdapter.buildCommand({
        flags: { 'model': 'gpt-4' },
      })
      expect(cmd).toContain('--model=gpt-4')
    })
  })

  describe('parseHookEvent', () => {
    it('should return null for invalid data', () => {
      expect(CodexAdapter.parseHookEvent('notify', null)).toBeNull()
      expect(CodexAdapter.parseHookEvent('notify', undefined)).toBeNull()
      expect(CodexAdapter.parseHookEvent('notify', 'string')).toBeNull()
    })

    it('should return null for non-notify hook', () => {
      expect(CodexAdapter.parseHookEvent('PreToolUse', {})).toBeNull()
      expect(CodexAdapter.parseHookEvent('Stop', {})).toBeNull()
    })

    it('should parse tool_start event as pre_tool_use', () => {
      const data = {
        thread_id: 'thread-123',
        event_type: 'tool_start',
        cwd: '/home/user/project',
        tool: 'shell',
        tool_input: { command: 'ls' },
      }
      const event = CodexAdapter.parseHookEvent('notify', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('pre_tool_use')
      expect(event?.agent).toBe('codex')
      expect(event?.agentSessionId).toBe('thread-123')
      expect((event as any).tool).toBe('shell')
    })

    it('should parse tool_end event as post_tool_use', () => {
      const data = {
        thread_id: 'thread-123',
        event_type: 'tool_end',
        tool: 'shell',
        tool_output: { result: 'success' },
        success: true,
      }
      const event = CodexAdapter.parseHookEvent('notify', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('post_tool_use')
      expect((event as any).toolResponse).toEqual({ result: 'success' })
      expect((event as any).success).toBe(true)
    })

    it('should parse response event as stop', () => {
      const data = {
        thread_id: 'thread-123',
        event_type: 'response',
        response: 'Done!',
      }
      const event = CodexAdapter.parseHookEvent('notify', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('stop')
      expect((event as any).response).toBe('Done!')
    })

    it('should parse session_start event', () => {
      const data = {
        thread_id: 'thread-123',
        event_type: 'session_start',
        cwd: '/home/user/project',
        tmux_pane: '%1',
      }
      const event = CodexAdapter.parseHookEvent('notify', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('session_start')
      expect((event as any).terminal).toEqual({
        tmuxPane: '%1',
        tmuxSocket: undefined,
        tty: undefined,
      })
    })

    it('should parse session_end event', () => {
      const data = {
        thread_id: 'thread-123',
        event_type: 'session_end',
      }
      const event = CodexAdapter.parseHookEvent('notify', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('session_end')
    })

    it('should parse error event as notification', () => {
      const data = {
        thread_id: 'thread-123',
        event_type: 'error',
        error: 'Something went wrong',
      }
      const event = CodexAdapter.parseHookEvent('notify', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('notification')
      expect((event as any).message).toBe('Something went wrong')
      expect((event as any).level).toBe('error')
    })

    it('should parse message event as notification', () => {
      const data = {
        thread_id: 'thread-123',
        event_type: 'message',
        message: 'Info message',
      }
      const event = CodexAdapter.parseHookEvent('notify', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('notification')
      expect((event as any).message).toBe('Info message')
      expect((event as any).level).toBe('info')
    })

    it('should handle unknown event types as notification', () => {
      const data = {
        thread_id: 'thread-123',
        event_type: 'unknown_type',
        message: 'Some message',
      }
      const event = CodexAdapter.parseHookEvent('notify', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('notification')
    })

    it('should generate unique event IDs', () => {
      const event1 = CodexAdapter.parseHookEvent('notify', { event_type: 'response' })
      const event2 = CodexAdapter.parseHookEvent('notify', { event_type: 'response' })

      expect(event1?.id).toBeDefined()
      expect(event2?.id).toBeDefined()
      expect(event1?.id).not.toBe(event2?.id)
    })
  })

  describe('extractSessionId', () => {
    it('should extract agentSessionId from event', () => {
      const event = { agentSessionId: 'thread-456' }
      expect(CodexAdapter.extractSessionId(event)).toBe('thread-456')
    })

    it('should return undefined if no session ID', () => {
      expect(CodexAdapter.extractSessionId({})).toBeUndefined()
    })
  })

  describe('getHookConfig', () => {
    it('should return hook configuration', () => {
      const config = CodexAdapter.getHookConfig()

      expect(config.hookNames).toEqual(['notify'])
      expect(config.timeout).toBe(5)
      expect(config.settingsPath).toBeDefined()
    })
  })

  describe('getSettingsPath', () => {
    it('should return a path containing .codex', () => {
      const path = CodexAdapter.getSettingsPath()
      expect(path).toContain('.codex')
      expect(path).toContain('config.json')
    })
  })
})

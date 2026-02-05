import { describe, it, expect } from 'vitest'
import { CursorAdapter } from '../src/adapters/CursorAdapter.js'

describe('CursorAdapter', () => {
  describe('name and displayName', () => {
    it('should have correct name', () => {
      expect(CursorAdapter.name).toBe('cursor')
    })

    it('should have correct displayName', () => {
      expect(CursorAdapter.displayName).toBe('Cursor Agent')
    })
  })

  describe('buildCommand', () => {
    it('should build default command with yes flag', () => {
      const cmd = CursorAdapter.buildCommand()
      expect(cmd).toContain('cursor-agent')
      expect(cmd).toContain('--yes')
    })

    it('should allow overriding default flags', () => {
      const cmd = CursorAdapter.buildCommand({
        flags: { 'yes': false },
      })
      expect(cmd).toBe('cursor-agent')
    })

    it('should add custom flags', () => {
      const cmd = CursorAdapter.buildCommand({
        flags: { 'model': 'gpt-4' },
      })
      expect(cmd).toContain('--model=gpt-4')
    })

    it('should handle boolean flags correctly', () => {
      const cmd = CursorAdapter.buildCommand({
        flags: { 'verbose': true, 'quiet': false },
      })
      expect(cmd).toContain('--verbose')
      expect(cmd).not.toContain('--quiet')
    })
  })

  describe('parseHookEvent', () => {
    it('should return null for invalid data', () => {
      expect(CursorAdapter.parseHookEvent('PreToolUse', null)).toBeNull()
      expect(CursorAdapter.parseHookEvent('PreToolUse', undefined)).toBeNull()
      expect(CursorAdapter.parseHookEvent('PreToolUse', 'string')).toBeNull()
    })

    it('should return null for unknown hook name', () => {
      expect(CursorAdapter.parseHookEvent('UnknownHook', {})).toBeNull()
    })

    it('should parse PreToolUse event', () => {
      const data = {
        session_id: 'test-session-123',
        cwd: '/home/user/project',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        tool_use_id: 'tool-123',
      }
      const event = CursorAdapter.parseHookEvent('PreToolUse', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('pre_tool_use')
      expect(event?.agent).toBe('cursor')
      expect(event?.agentSessionId).toBe('test-session-123')
      expect(event?.cwd).toBe('/home/user/project')
      expect((event as any).tool).toBe('Bash')
      expect((event as any).toolInput).toEqual({ command: 'ls -la' })
      expect((event as any).toolUseId).toBe('tool-123')
    })

    it('should parse PostToolUse event', () => {
      const data = {
        session_id: 'test-session-123',
        cwd: '/home/user/project',
        tool_name: 'Read',
        tool_input: { file_path: '/test.txt' },
        tool_response: { content: 'file contents' },
        tool_use_id: 'tool-456',
      }
      const event = CursorAdapter.parseHookEvent('PostToolUse', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('post_tool_use')
      expect((event as any).tool).toBe('Read')
      expect((event as any).toolResponse).toEqual({ content: 'file contents' })
      expect((event as any).success).toBe(true)
    })

    it('should handle tool_output as fallback for tool_response', () => {
      const data = {
        session_id: 'test-session-123',
        tool_name: 'Bash',
        tool_output: { stdout: 'output' },
      }
      const event = CursorAdapter.parseHookEvent('PostToolUse', data)

      expect(event).not.toBeNull()
      expect((event as any).toolResponse).toEqual({ stdout: 'output' })
    })

    it('should mark PostToolUse as failed when error present', () => {
      const data = {
        session_id: 'test-session-123',
        tool_name: 'Bash',
        error: 'Command failed',
      }
      const event = CursorAdapter.parseHookEvent('PostToolUse', data)

      expect(event).not.toBeNull()
      expect((event as any).success).toBe(false)
    })

    it('should respect explicit success field', () => {
      const data = {
        session_id: 'test-session-123',
        tool_name: 'Bash',
        success: true,
        error: 'Some warning', // error present but success explicitly true
      }
      const event = CursorAdapter.parseHookEvent('PostToolUse', data)

      expect(event).not.toBeNull()
      expect((event as any).success).toBe(true)
    })

    it('should parse Stop event', () => {
      const data = {
        session_id: 'test-session-123',
        cwd: '/home/user/project',
      }
      const event = CursorAdapter.parseHookEvent('Stop', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('stop')
      expect((event as any).stopHookActive).toBe(false)
    })

    it('should parse SessionStart event with terminal info', () => {
      const data = {
        session_id: 'test-session-123',
        cwd: '/home/user/project',
        source: 'cli',
        tmux_pane: '%0',
        tmux_socket: '/tmp/tmux-1000/default',
        tty: '/dev/pts/0',
      }
      const event = CursorAdapter.parseHookEvent('SessionStart', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('session_start')
      expect((event as any).source).toBe('cli')
      expect((event as any).terminal).toEqual({
        tmuxPane: '%0',
        tmuxSocket: '/tmp/tmux-1000/default',
        tty: '/dev/pts/0',
      })
    })

    it('should parse SessionStart without terminal info', () => {
      const data = {
        session_id: 'test-session-123',
        source: 'cli',
      }
      const event = CursorAdapter.parseHookEvent('SessionStart', data)

      expect(event).not.toBeNull()
      expect((event as any).terminal).toBeUndefined()
    })

    it('should default source to cursor for SessionStart', () => {
      const data = {
        session_id: 'test-session-123',
      }
      const event = CursorAdapter.parseHookEvent('SessionStart', data)

      expect(event).not.toBeNull()
      expect((event as any).source).toBe('cursor')
    })

    it('should parse SessionEnd event', () => {
      const data = {
        session_id: 'test-session-123',
        cwd: '/home/user/project',
      }
      const event = CursorAdapter.parseHookEvent('SessionEnd', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('session_end')
    })

    it('should parse Notification event', () => {
      const data = {
        session_id: 'test-session-123',
        message: 'Task completed',
        level: 'info',
      }
      const event = CursorAdapter.parseHookEvent('Notification', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('notification')
      expect((event as any).message).toBe('Task completed')
      expect((event as any).level).toBe('info')
    })

    it('should parse all supported hook types', () => {
      const hookTypes = [
        'PreToolUse',
        'PostToolUse',
        'Stop',
        'SessionStart',
        'SessionEnd',
        'Notification',
      ]

      for (const hookType of hookTypes) {
        const event = CursorAdapter.parseHookEvent(hookType, { session_id: 'test' })
        expect(event).not.toBeNull()
        expect(event?.agent).toBe('cursor')
      }
    })

    it('should generate unique event IDs', () => {
      const event1 = CursorAdapter.parseHookEvent('Stop', {})
      const event2 = CursorAdapter.parseHookEvent('Stop', {})

      expect(event1?.id).toBeDefined()
      expect(event2?.id).toBeDefined()
      expect(event1?.id).not.toBe(event2?.id)
    })

    it('should set timestamp', () => {
      const before = Date.now()
      const event = CursorAdapter.parseHookEvent('Stop', {})
      const after = Date.now()

      expect(event?.timestamp).toBeGreaterThanOrEqual(before)
      expect(event?.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('extractSessionId', () => {
    it('should extract agentSessionId from event', () => {
      const event = { agentSessionId: 'test-123' }
      expect(CursorAdapter.extractSessionId(event)).toBe('test-123')
    })

    it('should return undefined if no session ID', () => {
      expect(CursorAdapter.extractSessionId({})).toBeUndefined()
    })
  })

  describe('getHookConfig', () => {
    it('should return hook configuration', () => {
      const config = CursorAdapter.getHookConfig()

      expect(config.hookNames).toContain('PreToolUse')
      expect(config.hookNames).toContain('PostToolUse')
      expect(config.hookNames).toContain('Stop')
      expect(config.hookNames).toContain('SessionStart')
      expect(config.hookNames).toContain('SessionEnd')
      expect(config.hookNames).toContain('Notification')
      expect(config.hookNames).toHaveLength(6)
      expect(config.timeout).toBe(5)
      expect(config.settingsPath).toBeDefined()
    })
  })

  describe('getSettingsPath', () => {
    it('should return a path containing cursor-agent', () => {
      const path = CursorAdapter.getSettingsPath()
      expect(path).toContain('cursor-agent')
      expect(path).toContain('config.json')
    })
  })
})

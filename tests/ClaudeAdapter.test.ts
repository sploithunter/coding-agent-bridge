import { describe, it, expect } from 'vitest'
import { ClaudeAdapter } from '../src/adapters/ClaudeAdapter.js'

describe('ClaudeAdapter', () => {
  describe('name and displayName', () => {
    it('should have correct name', () => {
      expect(ClaudeAdapter.name).toBe('claude')
    })

    it('should have correct displayName', () => {
      expect(ClaudeAdapter.displayName).toBe('Claude Code')
    })
  })

  describe('buildCommand', () => {
    it('should build default command with skip-permissions flag', () => {
      const cmd = ClaudeAdapter.buildCommand()
      expect(cmd).toContain('claude')
      expect(cmd).toContain('--dangerously-skip-permissions')
    })

    it('should allow overriding default flags', () => {
      const cmd = ClaudeAdapter.buildCommand({
        flags: { 'dangerously-skip-permissions': false },
      })
      expect(cmd).toBe('claude')
    })

    it('should add custom flags', () => {
      const cmd = ClaudeAdapter.buildCommand({
        flags: { 'model': 'claude-3-opus' },
      })
      expect(cmd).toContain('--model=claude-3-opus')
    })

    it('should handle boolean flags correctly', () => {
      const cmd = ClaudeAdapter.buildCommand({
        flags: { 'verbose': true, 'quiet': false },
      })
      expect(cmd).toContain('--verbose')
      expect(cmd).not.toContain('--quiet')
    })
  })

  describe('parseHookEvent', () => {
    it('should return null for invalid data', () => {
      expect(ClaudeAdapter.parseHookEvent('PreToolUse', null)).toBeNull()
      expect(ClaudeAdapter.parseHookEvent('PreToolUse', undefined)).toBeNull()
      expect(ClaudeAdapter.parseHookEvent('PreToolUse', 'string')).toBeNull()
    })

    it('should return null for unknown hook name', () => {
      expect(ClaudeAdapter.parseHookEvent('UnknownHook', {})).toBeNull()
    })

    it('should parse PreToolUse event', () => {
      const data = {
        session_id: 'test-session-123',
        cwd: '/home/user/project',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        tool_use_id: 'tool-123',
      }
      const event = ClaudeAdapter.parseHookEvent('PreToolUse', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('pre_tool_use')
      expect(event?.agent).toBe('claude')
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
      const event = ClaudeAdapter.parseHookEvent('PostToolUse', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('post_tool_use')
      expect((event as any).tool).toBe('Read')
      expect((event as any).toolResponse).toEqual({ content: 'file contents' })
      expect((event as any).success).toBe(true)
    })

    it('should mark PostToolUse as failed when error present', () => {
      const data = {
        session_id: 'test-session-123',
        tool_name: 'Bash',
        error: 'Command failed',
      }
      const event = ClaudeAdapter.parseHookEvent('PostToolUse', data)

      expect(event).not.toBeNull()
      expect((event as any).success).toBe(false)
    })

    it('should parse Stop event', () => {
      const data = {
        session_id: 'test-session-123',
        cwd: '/home/user/project',
        stop_hook_active: true,
      }
      const event = ClaudeAdapter.parseHookEvent('Stop', data)

      expect(event).not.toBeNull()
      expect(event?.type).toBe('stop')
      expect((event as any).stopHookActive).toBe(true)
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
      const event = ClaudeAdapter.parseHookEvent('SessionStart', data)

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
      const event = ClaudeAdapter.parseHookEvent('SessionStart', data)

      expect(event).not.toBeNull()
      expect((event as any).terminal).toBeUndefined()
    })

    it('should parse all supported hook types', () => {
      const hookTypes = [
        'PreToolUse',
        'PostToolUse',
        'Stop',
        'SubagentStop',
        'SessionStart',
        'SessionEnd',
        'UserPromptSubmit',
        'Notification',
      ]

      for (const hookType of hookTypes) {
        const event = ClaudeAdapter.parseHookEvent(hookType, { session_id: 'test' })
        expect(event).not.toBeNull()
        expect(event?.agent).toBe('claude')
      }
    })

    it('should generate unique event IDs', () => {
      const event1 = ClaudeAdapter.parseHookEvent('Stop', {})
      const event2 = ClaudeAdapter.parseHookEvent('Stop', {})

      expect(event1?.id).toBeDefined()
      expect(event2?.id).toBeDefined()
      expect(event1?.id).not.toBe(event2?.id)
    })

    it('should set timestamp', () => {
      const before = Date.now()
      const event = ClaudeAdapter.parseHookEvent('Stop', {})
      const after = Date.now()

      expect(event?.timestamp).toBeGreaterThanOrEqual(before)
      expect(event?.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('extractSessionId', () => {
    it('should extract agentSessionId from event', () => {
      const event = { agentSessionId: 'test-123' }
      expect(ClaudeAdapter.extractSessionId(event)).toBe('test-123')
    })

    it('should return undefined if no session ID', () => {
      expect(ClaudeAdapter.extractSessionId({})).toBeUndefined()
    })
  })

  describe('getHookConfig', () => {
    it('should return hook configuration', () => {
      const config = ClaudeAdapter.getHookConfig()

      expect(config.hookNames).toContain('PreToolUse')
      expect(config.hookNames).toContain('PostToolUse')
      expect(config.hookNames).toContain('Stop')
      expect(config.hookNames).toContain('SessionStart')
      expect(config.hookNames).toHaveLength(8)
      expect(config.timeout).toBe(5)
      expect(config.settingsPath).toBeDefined()
    })
  })

  describe('getSettingsPath', () => {
    it('should return a path containing .claude', () => {
      const path = ClaudeAdapter.getSettingsPath()
      expect(path).toContain('.claude')
      expect(path).toContain('settings.json')
    })
  })
})

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

  describe('parseTranscriptEntry', () => {
    it('should return null for non-object input', () => {
      expect(ClaudeAdapter.parseTranscriptEntry!(null)).toBeNull()
      expect(ClaudeAdapter.parseTranscriptEntry!(undefined)).toBeNull()
      expect(ClaudeAdapter.parseTranscriptEntry!('string')).toBeNull()
    })

    it('should return null for non-assistant entries', () => {
      expect(ClaudeAdapter.parseTranscriptEntry!({ type: 'user' })).toBeNull()
      expect(ClaudeAdapter.parseTranscriptEntry!({ type: 'system' })).toBeNull()
    })

    it('should return null for assistant entries with no content', () => {
      expect(ClaudeAdapter.parseTranscriptEntry!({ type: 'assistant', message: {} })).toBeNull()
      expect(ClaudeAdapter.parseTranscriptEntry!({ type: 'assistant', message: { content: [] } })).toBeNull()
    })

    it('should parse text content blocks', () => {
      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-1',
          content: [{ type: 'text', text: 'Hello world' }],
        },
        requestId: 'req-1',
      }

      const event = ClaudeAdapter.parseTranscriptEntry!(entry)
      expect(event).not.toBeNull()
      expect(event?.type).toBe('assistant_message')
      expect(event?.content).toHaveLength(1)
      expect(event?.content?.[0]?.type).toBe('text')
      expect(event?.content?.[0]?.text).toBe('Hello world')
      expect(event?.requestId).toBe('req-1')
      expect(event?.isPreamble).toBe(false)
    })

    it('should parse thinking content blocks', () => {
      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-2',
          content: [
            { type: 'thinking', text: 'Let me consider...' },
            { type: 'text', text: 'My answer.' },
          ],
        },
      }

      const event = ClaudeAdapter.parseTranscriptEntry!(entry)
      expect(event?.content).toHaveLength(2)
      expect(event?.content?.[0]?.type).toBe('thinking')
      expect(event?.content?.[0]?.text).toBe('Let me consider...')
      expect(event?.content?.[1]?.type).toBe('text')
    })

    it('should parse tool_use content blocks', () => {
      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-3',
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 'tu-1' },
          ],
        },
      }

      const event = ClaudeAdapter.parseTranscriptEntry!(entry)
      expect(event?.content).toHaveLength(1)
      expect(event?.content?.[0]?.type).toBe('tool_use')
      expect(event?.content?.[0]?.toolName).toBe('Bash')
      expect(event?.content?.[0]?.toolInput).toEqual({ command: 'ls' })
      expect(event?.content?.[0]?.toolUseId).toBe('tu-1')
      expect(event?.isPreamble).toBe(false)
    })

    it('should detect whitespace-only preamble', () => {
      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-4',
          content: [{ type: 'text', text: '  \n\t  ' }],
        },
      }

      const event = ClaudeAdapter.parseTranscriptEntry!(entry)
      expect(event?.isPreamble).toBe(true)
    })

    it('should not mark non-whitespace text as preamble', () => {
      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-5',
          content: [{ type: 'text', text: 'Some content here' }],
        },
      }

      const event = ClaudeAdapter.parseTranscriptEntry!(entry)
      expect(event?.isPreamble).toBe(false)
    })

    it('should not mark tool_use entries as preamble', () => {
      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-6',
          content: [
            { type: 'text', text: '' },
            { type: 'tool_use', name: 'Read', input: {}, id: 'tu-2' },
          ],
        },
      }

      const event = ClaudeAdapter.parseTranscriptEntry!(entry)
      expect(event?.isPreamble).toBe(false)
    })

    it('should use message.id as requestId fallback', () => {
      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-fallback',
          content: [{ type: 'text', text: 'Hello' }],
        },
        // No requestId field
      }

      const event = ClaudeAdapter.parseTranscriptEntry!(entry)
      expect(event?.requestId).toBe('msg-fallback')
    })

    it('should skip unknown block types', () => {
      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-7',
          content: [
            { type: 'tool_result', content: 'file contents' },
            { type: 'text', text: 'Result above' },
          ],
        },
      }

      const event = ClaudeAdapter.parseTranscriptEntry!(entry)
      // tool_result should be skipped, only text remains
      expect(event?.content).toHaveLength(1)
      expect(event?.content?.[0]?.type).toBe('text')
    })
  })

  describe('parseHookEvent - user_prompt_submit', () => {
    it('should extract prompt field from UserPromptSubmit data', () => {
      const data = {
        session_id: 'test-session',
        cwd: '/tmp',
        prompt: 'Write a function to sort an array',
      }
      const event = ClaudeAdapter.parseHookEvent('UserPromptSubmit', data)
      expect(event).not.toBeNull()
      expect(event?.type).toBe('user_prompt_submit')
      expect((event as any).prompt).toBe('Write a function to sort an array')
    })

    it('should fall back to message field for prompt', () => {
      const data = {
        session_id: 'test-session',
        cwd: '/tmp',
        message: 'Prompt from message field',
      }
      const event = ClaudeAdapter.parseHookEvent('UserPromptSubmit', data)
      expect((event as any).prompt).toBe('Prompt from message field')
    })
  })
})

/**
 * Event Detection Tests
 * 
 * Tests that events from Claude Code hooks are properly detected and parsed,
 * particularly the stop event which is critical for detecting task completion.
 */

import { describe, it, expect } from 'vitest'
import { EventProcessor } from '../src/EventProcessor.js'

describe('Event Detection', () => {
  describe('Claude Code hook events', () => {
    const processor = new EventProcessor()

    it('should detect and parse stop event from hook_event_name', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-session-123',
        hook_event_name: 'Stop',
        stop_hook_active: false,
        cwd: '/tmp/test',
        agent: 'claude',
        tmux_pane: '%123',
      })

      const processed = processor.processLine(rawEvent)

      expect(processed).not.toBeNull()
      expect(processed!.event.type).toBe('stop')
      expect(processed!.event.agent).toBe('claude')
      expect(processed!.agentSessionId).toBe('test-session-123')
    })

    it('should detect and parse session_start event', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-session-456',
        hook_event_name: 'SessionStart',
        source: 'startup',
        cwd: '/tmp/test',
        agent: 'claude',
      })

      const processed = processor.processLine(rawEvent)

      expect(processed).not.toBeNull()
      expect(processed!.event.type).toBe('session_start')
      expect(processed!.event.agent).toBe('claude')
    })

    it('should detect and parse pre_tool_use event', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-session-789',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'echo hello' },
        tool_use_id: 'tool-123',
        cwd: '/tmp/test',
        agent: 'claude',
      })

      const processed = processor.processLine(rawEvent)

      expect(processed).not.toBeNull()
      expect(processed!.event.type).toBe('pre_tool_use')
      expect(processed!.event.agent).toBe('claude')
      if (processed!.event.type === 'pre_tool_use') {
        expect(processed!.event.tool).toBe('Bash')
      }
    })

    it('should detect and parse post_tool_use event', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-session-101',
        hook_event_name: 'PostToolUse',
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.txt', content: 'hello' },
        tool_response: { success: true },
        tool_use_id: 'tool-456',
        cwd: '/tmp/test',
        agent: 'claude',
      })

      const processed = processor.processLine(rawEvent)

      expect(processed).not.toBeNull()
      expect(processed!.event.type).toBe('post_tool_use')
      expect(processed!.event.agent).toBe('claude')
      if (processed!.event.type === 'post_tool_use') {
        expect(processed!.event.tool).toBe('Write')
      }
    })

    it('should detect and parse user_prompt_submit event', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-session-202',
        hook_event_name: 'UserPromptSubmit',
        prompt: 'Hello Claude',
        cwd: '/tmp/test',
        agent: 'claude',
      })

      const processed = processor.processLine(rawEvent)

      expect(processed).not.toBeNull()
      expect(processed!.event.type).toBe('user_prompt_submit')
      expect(processed!.event.agent).toBe('claude')
    })

    it('should detect and parse notification event', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-session-303',
        hook_event_name: 'Notification',
        message: 'Claude is waiting for your input',
        notification_type: 'idle_prompt',
        cwd: '/tmp/test',
        agent: 'claude',
      })

      const processed = processor.processLine(rawEvent)

      expect(processed).not.toBeNull()
      expect(processed!.event.type).toBe('notification')
      expect(processed!.event.agent).toBe('claude')
    })

    it('should detect and parse subagent_stop event', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-session-404',
        hook_event_name: 'SubagentStop',
        agent_id: 'subagent-123',
        cwd: '/tmp/test',
        agent: 'claude',
      })

      const processed = processor.processLine(rawEvent)

      expect(processed).not.toBeNull()
      expect(processed!.event.type).toBe('subagent_stop')
      expect(processed!.event.agent).toBe('claude')
    })

    it('should detect and parse session_end event', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-session-505',
        hook_event_name: 'SessionEnd',
        cwd: '/tmp/test',
        agent: 'claude',
      })

      const processed = processor.processLine(rawEvent)

      expect(processed).not.toBeNull()
      expect(processed!.event.type).toBe('session_end')
      expect(processed!.event.agent).toBe('claude')
    })
  })

  describe('Agent detection', () => {
    const processor = new EventProcessor()

    it('should detect claude from explicit agent field', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-123',
        hook_event_name: 'Stop',
        agent: 'claude',
      })

      const processed = processor.processLine(rawEvent)
      expect(processed).not.toBeNull()
      expect(processed!.agent).toBe('claude')
    })

    it('should detect claude from hook_event_name', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-123',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: {},
      })

      const processed = processor.processLine(rawEvent)
      expect(processed).not.toBeNull()
      expect(processed!.agent).toBe('claude')
    })

    it('should detect claude from claude_session_id field', () => {
      const rawEvent = JSON.stringify({
        claude_session_id: 'claude-123',
        hook_event_name: 'Stop',
      })

      const processed = processor.processLine(rawEvent)
      expect(processed).not.toBeNull()
      expect(processed!.agent).toBe('claude')
    })
  })

  describe('Terminal info extraction', () => {
    const processor = new EventProcessor()

    it('should extract tmux pane info', () => {
      const rawEvent = JSON.stringify({
        session_id: 'test-123',
        hook_event_name: 'Stop',
        agent: 'claude',
        tmux_pane: '%456',
        tmux_socket: '/tmp/tmux-502/default',
        tty: '/dev/ttys001',
      })

      const processed = processor.processLine(rawEvent)
      expect(processed).not.toBeNull()
      expect(processed!.terminal).toBeDefined()
      expect(processed!.terminal!.tmuxPane).toBe('%456')
      expect(processed!.terminal!.tmuxSocket).toBe('/tmp/tmux-502/default')
      expect(processed!.terminal!.tty).toBe('/dev/ttys001')
    })
  })

  describe('Real-world event formats', () => {
    const processor = new EventProcessor()

    it('should parse a real Stop event from Claude Code', () => {
      // This is the actual format from Claude Code hooks
      const rawEvent = JSON.stringify({
        session_id: '573c9cb7-d706-4524-8d30-aa835bf16ac1',
        transcript_path: '/Users/test/.claude/projects/test/573c9cb7.jsonl',
        cwd: '/Users/test/project',
        permission_mode: 'bypassPermissions',
        hook_event_name: 'Stop',
        stop_hook_active: false,
        hook_type: '',
        agent: 'claude',
        tmux_pane: '%587',
        tmux_socket: '/private/tmp/tmux-502/default',
        tty: 'not a tty',
        received_at: 1769199689000,
      })

      const processed = processor.processLine(rawEvent)

      expect(processed).not.toBeNull()
      expect(processed!.event.type).toBe('stop')
      expect(processed!.event.agent).toBe('claude')
      expect(processed!.agentSessionId).toBe('573c9cb7-d706-4524-8d30-aa835bf16ac1')
      expect(processed!.cwd).toBe('/Users/test/project')
    })

    it('should parse a real PreToolUse event from Claude Code', () => {
      const rawEvent = JSON.stringify({
        session_id: '573c9cb7-d706-4524-8d30-aa835bf16ac1',
        transcript_path: '/Users/test/.claude/projects/test/573c9cb7.jsonl',
        cwd: '/Users/test/project',
        permission_mode: 'bypassPermissions',
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: {
          file_path: '/Users/test/project/submission.txt',
          content: 'hello world!',
        },
        tool_use_id: 'toolu_01TurjLgHrp8DvkahrLmHT22',
        hook_type: '',
        agent: 'claude',
        tmux_pane: '%587',
        tmux_socket: '/private/tmp/tmux-502/default',
        tty: 'not a tty',
        received_at: 1769199687000,
      })

      const processed = processor.processLine(rawEvent)

      expect(processed).not.toBeNull()
      expect(processed!.event.type).toBe('pre_tool_use')
      expect(processed!.event.agent).toBe('claude')
      if (processed!.event.type === 'pre_tool_use') {
        expect(processed!.event.tool).toBe('Write')
        expect(processed!.event.toolInput).toEqual({
          file_path: '/Users/test/project/submission.txt',
          content: 'hello world!',
        })
      }
    })
  })
})

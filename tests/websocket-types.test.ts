/**
 * Tests for WebSocket interface types and helpers
 */

import { describe, it, expect } from 'vitest'
import {
  parseMessage,
  createMessage,
  isInitMessage,
  isEventMessage,
  isSessionMessage,
  isHistoryMessage,
  isExtensionMessage,
} from '../src/websocket-types.js'
import type {
  WSInitMessage,
  WSEventMessage,
  WSSessionCreatedMessage,
  WSHistoryMessage,
  WSPingMessage,
  WSExtensionMessage,
  WSAnyMessage,
} from '../src/websocket-types.js'
import type { AgentEvent, Session } from '../src/types.js'

describe('WebSocket Types', () => {
  describe('parseMessage', () => {
    it('should parse valid JSON message', () => {
      const raw = JSON.stringify({ type: 'ping' })
      const result = parseMessage(raw)
      expect(result).toEqual({ type: 'ping' })
    })

    it('should return null for invalid JSON', () => {
      const result = parseMessage('not json')
      expect(result).toBeNull()
    })

    it('should return null for non-object', () => {
      const result = parseMessage('"string"')
      expect(result).toBeNull()
    })

    it('should return null for object without type', () => {
      const result = parseMessage(JSON.stringify({ foo: 'bar' }))
      expect(result).toBeNull()
    })

    it('should parse init message', () => {
      const raw = JSON.stringify({
        type: 'init',
        data: { sessions: [] },
      })
      const result = parseMessage(raw)
      expect(result).toEqual({ type: 'init', data: { sessions: [] } })
    })

    it('should parse event message', () => {
      const event: Partial<AgentEvent> = {
        id: 'evt-1',
        type: 'stop',
        timestamp: Date.now(),
        sessionId: 'sess-1',
        agent: 'claude',
        cwd: '/tmp',
      }
      const raw = JSON.stringify({ type: 'event', data: event })
      const result = parseMessage(raw)
      expect(result?.type).toBe('event')
      expect((result as WSEventMessage).data.type).toBe('stop')
    })
  })

  describe('createMessage', () => {
    it('should create ping message', () => {
      const msg = createMessage<WSPingMessage>('ping')
      expect(msg).toEqual({ type: 'ping' })
    })

    it('should create init message with data', () => {
      const sessions: Session[] = []
      const msg = createMessage<WSInitMessage>('init', { sessions })
      expect(msg).toEqual({ type: 'init', data: { sessions } })
    })

    it('should create event message', () => {
      const event = {
        id: 'evt-1',
        type: 'stop' as const,
        timestamp: Date.now(),
        sessionId: 'sess-1',
        agent: 'claude',
        cwd: '/tmp',
        stopHookActive: false,
      }
      const msg = createMessage<WSEventMessage>('event', event)
      expect(msg.type).toBe('event')
      expect(msg.data.type).toBe('stop')
    })
  })

  describe('type guards', () => {
    describe('isInitMessage', () => {
      it('should return true for init message', () => {
        const msg: WSInitMessage = { type: 'init', data: { sessions: [] } }
        expect(isInitMessage(msg)).toBe(true)
      })

      it('should return false for other messages', () => {
        const msg: WSPingMessage = { type: 'ping' }
        expect(isInitMessage(msg)).toBe(false)
      })
    })

    describe('isEventMessage', () => {
      it('should return true for event message', () => {
        const msg: WSEventMessage = {
          type: 'event',
          data: {
            id: 'evt-1',
            type: 'stop',
            timestamp: Date.now(),
            sessionId: 'sess-1',
            agent: 'claude',
            cwd: '/tmp',
            stopHookActive: false,
          },
        }
        expect(isEventMessage(msg)).toBe(true)
      })

      it('should return false for other messages', () => {
        const msg: WSPingMessage = { type: 'ping' }
        expect(isEventMessage(msg)).toBe(false)
      })
    })

    describe('isSessionMessage', () => {
      it('should return true for session:created', () => {
        const msg: WSSessionCreatedMessage = {
          type: 'session:created',
          data: {
            id: 'sess-1',
            name: 'test',
            type: 'internal',
            agent: 'claude',
            status: 'idle',
            cwd: '/tmp',
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        }
        expect(isSessionMessage(msg)).toBe(true)
      })

      it('should return true for session:updated', () => {
        const msg: WSAnyMessage = {
          type: 'session:updated',
          data: {
            id: 'sess-1',
            name: 'test',
            type: 'internal',
            agent: 'claude',
            status: 'working',
            cwd: '/tmp',
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        }
        expect(isSessionMessage(msg)).toBe(true)
      })

      it('should return true for session:deleted', () => {
        const msg: WSAnyMessage = {
          type: 'session:deleted',
          data: {
            id: 'sess-1',
            name: 'test',
            type: 'internal',
            agent: 'claude',
            status: 'offline',
            cwd: '/tmp',
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        }
        expect(isSessionMessage(msg)).toBe(true)
      })

      it('should return true for session:status', () => {
        const msg: WSAnyMessage = {
          type: 'session:status',
          data: {
            id: 'sess-1',
            name: 'test',
            type: 'internal',
            agent: 'claude',
            status: 'waiting',
            cwd: '/tmp',
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        }
        expect(isSessionMessage(msg)).toBe(true)
      })

      it('should return false for non-session messages', () => {
        const msg: WSPingMessage = { type: 'ping' }
        expect(isSessionMessage(msg)).toBe(false)
      })
    })

    describe('isHistoryMessage', () => {
      it('should return true for history message', () => {
        const msg: WSHistoryMessage = { type: 'history', data: [] }
        expect(isHistoryMessage(msg)).toBe(true)
      })

      it('should return false for other messages', () => {
        const msg: WSPingMessage = { type: 'ping' }
        expect(isHistoryMessage(msg)).toBe(false)
      })
    })

    describe('isExtensionMessage', () => {
      it('should return true for namespaced extension messages', () => {
        const msg: WSExtensionMessage<'cin', 'text_tiles'> = {
          type: 'cin:text_tiles',
          data: [],
        }
        expect(isExtensionMessage(msg)).toBe(true)
      })

      it('should return true for harness extension messages', () => {
        const msg: WSExtensionMessage<'harness', 'test_result'> = {
          type: 'harness:test_result',
          data: { passed: true },
        }
        expect(isExtensionMessage(msg)).toBe(true)
      })

      it('should return false for session: messages (not extensions)', () => {
        const msg: WSSessionCreatedMessage = {
          type: 'session:created',
          data: {
            id: 'sess-1',
            name: 'test',
            type: 'internal',
            agent: 'claude',
            status: 'idle',
            cwd: '/tmp',
            createdAt: Date.now(),
            lastActivity: Date.now(),
          },
        }
        expect(isExtensionMessage(msg)).toBe(false)
      })

      it('should return false for non-namespaced messages', () => {
        const msg: WSPingMessage = { type: 'ping' }
        expect(isExtensionMessage(msg)).toBe(false)
      })
    })
  })

  describe('message structure compliance', () => {
    it('event message follows spec (type + data)', () => {
      const msg: WSEventMessage = {
        type: 'event',
        data: {
          id: 'evt-1',
          type: 'pre_tool_use',
          timestamp: Date.now(),
          sessionId: 'sess-1',
          agent: 'claude',
          cwd: '/tmp',
          tool: 'Read',
          toolInput: { file_path: '/tmp/test.ts' },
          toolUseId: 'tu-1',
        },
      }
      expect(msg.type).toBe('event')
      expect(msg.data).toBeDefined()
      expect(msg.data.type).toBe('pre_tool_use')
    })

    it('init message follows spec (type + data.sessions)', () => {
      const msg: WSInitMessage = {
        type: 'init',
        data: {
          sessions: [
            {
              id: 'sess-1',
              name: 'test',
              type: 'internal',
              agent: 'claude',
              status: 'idle',
              cwd: '/tmp',
              createdAt: Date.now(),
              lastActivity: Date.now(),
            },
          ],
        },
      }
      expect(msg.type).toBe('init')
      expect(msg.data.sessions).toHaveLength(1)
    })

    it('session messages use data not payload', () => {
      const msg: WSSessionCreatedMessage = {
        type: 'session:created',
        data: {
          id: 'sess-1',
          name: 'test',
          type: 'internal',
          agent: 'claude',
          status: 'idle',
          cwd: '/tmp',
          createdAt: Date.now(),
          lastActivity: Date.now(),
        },
      }
      // TypeScript enforces 'data' not 'payload'
      expect('data' in msg).toBe(true)
      expect('payload' in msg).toBe(false)
    })
  })
})

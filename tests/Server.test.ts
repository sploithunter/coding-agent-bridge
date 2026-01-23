/**
 * Unit tests for BridgeServer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BridgeServer } from '../src/Server.js'
import { SessionManager } from '../src/SessionManager.js'
import { ClaudeAdapter } from '../src/adapters/ClaudeAdapter.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, rm } from 'fs/promises'
import { randomUUID } from 'crypto'

describe('BridgeServer', () => {
  let server: BridgeServer
  let manager: SessionManager
  let testDir: string
  let testPort: number

  beforeEach(async () => {
    // Create unique port for each test
    testPort = 4100 + Math.floor(Math.random() * 900)

    // Create temp directory for session persistence
    testDir = join(tmpdir(), `server-test-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })

    manager = new SessionManager({
      sessionsFile: join(testDir, 'sessions.json'),
      defaultAgent: 'claude',
      trackExternalSessions: true,
      debug: false,
    })
    manager.registerAdapter(ClaudeAdapter)

    server = new BridgeServer({
      port: testPort,
      host: '127.0.0.1',
      debug: false,
    })
    server.setSessionManager(manager)
  })

  afterEach(async () => {
    await server.stop()
    await manager.stop()
    await rm(testDir, { recursive: true, force: true })
  })

  describe('constructor', () => {
    it('should create server with default config', () => {
      const s = new BridgeServer()
      expect(s).toBeInstanceOf(BridgeServer)
    })

    it('should create server with custom config', () => {
      const s = new BridgeServer({
        port: 5000,
        host: '0.0.0.0',
        allowedOrigins: ['https://example.com'],
        debug: true,
      })
      expect(s).toBeInstanceOf(BridgeServer)
    })
  })

  describe('start and stop', () => {
    it('should start and emit listening event', async () => {
      const listeningPromise = new Promise<[number, string]>((resolve) => {
        server.once('listening', (port, host) => resolve([port, host]))
      })

      await server.start()
      const [port, host] = await listeningPromise

      expect(port).toBe(testPort)
      expect(host).toBe('127.0.0.1')
    })

    it('should stop and emit close event', async () => {
      await server.start()

      const closePromise = new Promise<void>((resolve) => {
        server.once('close', resolve)
      })

      await server.stop()
      await closePromise

      expect(true).toBe(true)
    })

    it('should be idempotent when starting twice', async () => {
      await server.start()
      await server.start() // Should not throw

      expect(true).toBe(true)
    })
  })

  describe('HTTP endpoints', { timeout: 10000 }, () => {
    beforeEach(async () => {
      await server.start()
    })

    it('should respond to health check', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/health`)
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.status).toBe('ok')
      expect(data.sessions).toBe(0)
    })

    it('should list sessions', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/sessions`)
      expect(res.status).toBe(200)

      const sessions = await res.json()
      expect(Array.isArray(sessions)).toBe(true)
    })

    it('should handle CORS preflight', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/sessions`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:3000',
        },
      })
      expect(res.status).toBe(204)
    })

    it('should return 404 for unknown routes', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/unknown`)
      expect(res.status).toBe(404)

      const data = await res.json()
      expect(data.error).toBe('Not found')
    })

    describe('session CRUD', () => {
      it('should create session (without tmux)', async () => {
        // This will fail without tmux, but should return proper error
        const res = await fetch(`http://127.0.0.1:${testPort}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd: '/tmp' }),
        })

        // Will fail without tmux (either 201 success or 400 error)
        expect(res.status === 201 || res.status === 400).toBe(true)
      })

      it('should get session by ID', async () => {
        // Create external session first
        const session = manager.findOrCreateSession('test-agent', 'claude', '/tmp')

        const res = await fetch(`http://127.0.0.1:${testPort}/sessions/${session.id}`)
        expect(res.status).toBe(200)

        const data = await res.json()
        expect(data.id).toBe(session.id)
      })

      it('should return 404 for non-existent session', async () => {
        const res = await fetch(`http://127.0.0.1:${testPort}/sessions/nonexistent`)
        expect(res.status).toBe(404)
      })

      it('should update session', async () => {
        const session = manager.findOrCreateSession('test-agent', 'claude', '/tmp')

        const res = await fetch(`http://127.0.0.1:${testPort}/sessions/${session.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'new-name' }),
        })
        expect(res.status).toBe(200)

        const data = await res.json()
        expect(data.name).toBe('new-name')
      })

      it('should delete session', async () => {
        const session = manager.findOrCreateSession('test-agent', 'claude', '/tmp')

        const res = await fetch(`http://127.0.0.1:${testPort}/sessions/${session.id}`, {
          method: 'DELETE',
        })
        expect(res.status).toBe(200)

        const data = await res.json()
        expect(data.success).toBe(true)

        // Verify deleted
        expect(manager.getSession(session.id)).toBeUndefined()
      })
    })

    describe('session actions', () => {
      it('should fail to send prompt to external session without terminal', async () => {
        const session = manager.findOrCreateSession('test-agent', 'claude', '/tmp')

        const res = await fetch(
          `http://127.0.0.1:${testPort}/sessions/${session.id}/prompt`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'hello' }),
          }
        )
        expect(res.status).toBe(400)

        const data = await res.json()
        expect(data.error).toContain('terminal')
      })

      it('should return error for missing prompt', async () => {
        const session = manager.findOrCreateSession('test-agent', 'claude', '/tmp')

        const res = await fetch(
          `http://127.0.0.1:${testPort}/sessions/${session.id}/prompt`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }
        )
        expect(res.status).toBe(400)

        const data = await res.json()
        expect(data.error).toContain('prompt')
      })
    })

    describe('event endpoint', () => {
      it('should accept event POST', async () => {
        const res = await fetch(`http://127.0.0.1:${testPort}/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'stop',
            id: 'test-event',
            timestamp: Date.now(),
            agent: 'claude',
            cwd: '/tmp',
          }),
        })
        expect(res.status).toBe(200)

        const data = await res.json()
        expect(data.success).toBe(true)
      })

      it('should reject invalid event', async () => {
        const res = await fetch(`http://127.0.0.1:${testPort}/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not json',
        })
        expect(res.status).toBe(400)
      })
    })
  })

  describe('broadcast', () => {
    it('should track client count', async () => {
      await server.start()

      expect(server.getClientCount()).toBe(0)
    })
  })

  describe('session filters', () => {
    beforeEach(async () => {
      await server.start()

      // Create some sessions
      manager.findOrCreateSession('claude-1', 'claude', '/tmp/claude')
      // Note: Can't easily create internal sessions without tmux
    })

    it('should filter by type', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/sessions?type=external`)
      expect(res.status).toBe(200)

      const sessions = await res.json()
      expect(sessions.every((s: any) => s.type === 'external')).toBe(true)
    })

    it('should filter by agent', async () => {
      const res = await fetch(`http://127.0.0.1:${testPort}/sessions?agent=claude`)
      expect(res.status).toBe(200)

      const sessions = await res.json()
      expect(sessions.every((s: any) => s.agent === 'claude')).toBe(true)
    })
  })
})

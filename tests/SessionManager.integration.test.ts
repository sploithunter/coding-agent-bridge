/**
 * Integration tests for SessionManager with real tmux
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { SessionManager, SessionManagerConfig } from '../src/SessionManager.js'
import { TmuxExecutor } from '../src/TmuxExecutor.js'
import { ClaudeAdapter } from '../src/adapters/ClaudeAdapter.js'
import { CodexAdapter } from '../src/adapters/CodexAdapter.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, rm } from 'fs/promises'
import { randomUUID } from 'crypto'

describe('SessionManager Integration', () => {
  let manager: SessionManager
  let tmux: TmuxExecutor
  let testDir: string
  let config: SessionManagerConfig
  let tmuxAvailable: boolean

  beforeAll(async () => {
    tmux = new TmuxExecutor()
    tmuxAvailable = await tmux.isAvailable()
    if (!tmuxAvailable) {
      console.warn('tmux not available, skipping integration tests')
    }
  })

  beforeEach(async () => {
    testDir = join(tmpdir(), `session-manager-int-test-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })

    config = {
      sessionsFile: join(testDir, 'sessions.json'),
      defaultAgent: 'claude',
      workingTimeoutMs: 5000, // Short timeout for testing
      offlineCleanupMs: 3600000,
      staleCleanupMs: 7 * 24 * 3600000,
      trackExternalSessions: true,
      debug: false,
    }

    manager = new SessionManager(config)
    manager.registerAdapter(ClaudeAdapter)
    manager.registerAdapter(CodexAdapter)
  })

  afterEach(async () => {
    // Stop manager (this also cleans up health checks)
    await manager.stop()

    // Clean up any sessions we created
    for (const session of manager.listSessions()) {
      if (session.type === 'internal' && session.tmuxSession) {
        await tmux.killSession(session.tmuxSession).catch(() => {})
      }
    }

    // Clean up temp directory
    await rm(testDir, { recursive: true, force: true })
  })

  describe('createSession', { timeout: 15000 }, () => {
    it('should create a real tmux session', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      const session = await manager.createSession({
        name: 'test-session',
        cwd: '/tmp',
      })

      expect(session.type).toBe('internal')
      expect(session.name).toBe('test-session')
      expect(session.cwd).toBe('/tmp')
      expect(session.status).toBe('working')
      expect(session.tmuxSession).toBeDefined()
      expect(session.tmuxSession).toMatch(/^cab-/)

      // Verify tmux session exists
      const exists = await tmux.sessionExists(session.tmuxSession!)
      expect(exists).toBe(true)
    })

    it('should use default agent', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      const session = await manager.createSession({ cwd: '/tmp' })

      expect(session.agent).toBe('claude')
    })

    it('should create codex session', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      const session = await manager.createSession({
        cwd: '/tmp',
        agent: 'codex',
      })

      expect(session.agent).toBe('codex')
    })

    it('should emit session:created event', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      let emittedSession: any
      manager.on('session:created', (s) => {
        emittedSession = s
      })

      const session = await manager.createSession({ cwd: '/tmp' })

      expect(emittedSession).toBe(session)
    })

    it('should throw for unknown agent', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      await expect(
        manager.createSession({ agent: 'unknown' as any })
      ).rejects.toThrow(/no adapter/i)
    })
  })

  describe('deleteSession with tmux', { timeout: 15000 }, () => {
    it('should kill tmux session when deleting internal session', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      const session = await manager.createSession({ cwd: '/tmp' })
      const tmuxName = session.tmuxSession!

      // Verify exists
      expect(await tmux.sessionExists(tmuxName)).toBe(true)

      // Delete
      await manager.deleteSession(session.id)

      // Verify gone
      expect(await tmux.sessionExists(tmuxName)).toBe(false)
    })
  })

  describe('sendPrompt', { timeout: 15000 }, () => {
    it('should send prompt to internal session', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      const session = await manager.createSession({ cwd: '/tmp' })

      const result = await manager.sendPrompt(session.id, 'echo hello')

      expect(result.ok).toBe(true)
    })

    it('should fail for unknown session', async () => {
      const result = await manager.sendPrompt('unknown-id', 'test')

      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should fail for external session without terminal', async () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      const result = await manager.sendPrompt(session.id, 'test')

      expect(result.ok).toBe(false)
      expect(result.error).toContain('terminal')
    })
  })

  describe('cancel', { timeout: 15000 }, () => {
    it('should send Ctrl+C to session', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      const session = await manager.createSession({ cwd: '/tmp' })

      const result = await manager.cancel(session.id)

      expect(result).toBe(true)
    })

    it('should fail for external session', async () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      const result = await manager.cancel(session.id)

      expect(result).toBe(false)
    })
  })

  describe('restart', { timeout: 15000 }, () => {
    it('should restart offline internal session', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      const session = await manager.createSession({ cwd: '/tmp' })
      const oldTmuxName = session.tmuxSession!

      // Kill the tmux session to make it offline
      await tmux.killSession(oldTmuxName)
      manager.updateSessionStatus(session, 'offline')

      // Restart
      const restarted = await manager.restart(session.id)

      expect(restarted).toBeDefined()
      expect(restarted?.status).toBe('working')
      expect(restarted?.tmuxSession).toBeDefined()
      expect(restarted?.tmuxSession).not.toBe(oldTmuxName)

      // New session should exist
      expect(await tmux.sessionExists(restarted!.tmuxSession!)).toBe(true)
    })

    it('should return undefined for external session', async () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      const result = await manager.restart(session.id)

      expect(result).toBeUndefined()
    })

    it('should return undefined for non-offline session', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      const session = await manager.createSession({ cwd: '/tmp' })
      expect(session.status).toBe('working')

      const result = await manager.restart(session.id)

      expect(result).toBeUndefined()
    })
  })

  describe('session linking with internal sessions', { timeout: 15000 }, () => {
    it('should link agent session to recently created internal session', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      // Create internal session
      const internal = await manager.createSession({
        cwd: '/tmp',
        name: 'my-session',
      })

      expect(internal.agentSessionId).toBeUndefined()

      // Simulate agent session start event
      const linked = manager.findOrCreateSession('agent-123', 'claude', '/tmp')

      // Should link to internal session
      expect(linked.id).toBe(internal.id)
      expect(linked.agentSessionId).toBe('agent-123')
      expect(linked.type).toBe('internal')
    })

    it('should not link if cwd does not match', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      // Create internal session with specific cwd
      const internal = await manager.createSession({
        cwd: '/tmp/project-a',
        name: 'project-a',
      })

      // Agent starts with different cwd
      const external = manager.findOrCreateSession('agent-123', 'claude', '/tmp/project-b')

      // Should create new external session
      expect(external.id).not.toBe(internal.id)
      expect(external.type).toBe('external')
    })
  })

  describe('health checks', { timeout: 20000 }, () => {
    it('should detect when tmux session dies', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      // Start manager with health checks
      await manager.start()

      const session = await manager.createSession({ cwd: '/tmp' })
      expect(session.status).toBe('working')

      // Kill the tmux session
      await tmux.killSession(session.tmuxSession!)

      // Wait for health check (runs every 10 seconds, but we can trigger manually)
      // For testing, we'll access the private method
      await (manager as any).checkTmuxHealth()

      expect(session.status).toBe('offline')
    })

    it('should mark stuck working sessions as idle', async () => {
      if (!tmuxAvailable) {
        console.log('Skipping: tmux not available')
        return
      }

      // Use a very short timeout for testing
      const shortConfig = { ...config, workingTimeoutMs: 100 }
      const shortManager = new SessionManager(shortConfig)
      shortManager.registerAdapter(ClaudeAdapter)

      const session = await shortManager.createSession({ cwd: '/tmp' })
      expect(session.status).toBe('working')

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Trigger check
      ;(shortManager as any).checkWorkingTimeout()

      expect(session.status).toBe('idle')

      // Cleanup
      if (session.tmuxSession) {
        await tmux.killSession(session.tmuxSession)
      }
      await shortManager.stop()
    })
  })
})

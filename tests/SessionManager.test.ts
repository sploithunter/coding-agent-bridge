/**
 * Unit tests for SessionManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SessionManager, SessionManagerConfig } from '../src/SessionManager.js'
import { ClaudeAdapter } from '../src/adapters/ClaudeAdapter.js'
import { CodexAdapter } from '../src/adapters/CodexAdapter.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, rm, writeFile, readFile } from 'fs/promises'
import { randomUUID } from 'crypto'

describe('SessionManager', () => {
  let manager: SessionManager
  let testDir: string
  let config: SessionManagerConfig

  beforeEach(async () => {
    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `session-manager-test-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })

    config = {
      sessionsFile: join(testDir, 'sessions.json'),
      defaultAgent: 'claude',
      workingTimeoutMs: 120000,
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
    await manager.stop()
    // Clean up temp directory
    await rm(testDir, { recursive: true, force: true })
  })

  describe('adapter registration', () => {
    it('should register adapters', () => {
      expect(manager.getAdapter('claude')).toBe(ClaudeAdapter)
      expect(manager.getAdapter('codex')).toBe(CodexAdapter)
    })

    it('should return undefined for unknown adapter', () => {
      expect(manager.getAdapter('unknown')).toBeUndefined()
    })
  })

  describe('listSessions', () => {
    it('should return empty array when no sessions', () => {
      const sessions = manager.listSessions()
      expect(sessions).toEqual([])
    })

    it('should filter by type', async () => {
      // Create an external session via findOrCreate
      manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      const all = manager.listSessions()
      expect(all.length).toBe(1)

      const external = manager.listSessions({ type: 'external' })
      expect(external.length).toBe(1)

      const internal = manager.listSessions({ type: 'internal' })
      expect(internal.length).toBe(0)
    })

    it('should filter by agent', async () => {
      manager.findOrCreateSession('claude-1', 'claude', '/tmp/claude')
      manager.findOrCreateSession('codex-1', 'codex', '/tmp/codex')

      const claude = manager.listSessions({ agent: 'claude' })
      expect(claude.length).toBe(1)
      expect(claude[0]?.agent).toBe('claude')

      const codex = manager.listSessions({ agent: 'codex' })
      expect(codex.length).toBe(1)
      expect(codex[0]?.agent).toBe('codex')
    })

    it('should filter by status', async () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      expect(session.status).toBe('working')

      const working = manager.listSessions({ status: 'working' })
      expect(working.length).toBe(1)

      const idle = manager.listSessions({ status: 'idle' })
      expect(idle.length).toBe(0)
    })

    it('should filter by multiple statuses', async () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      manager.updateSessionStatus(session, 'idle')

      const workingOrIdle = manager.listSessions({ statuses: ['working', 'idle'] })
      expect(workingOrIdle.length).toBe(1)

      const offlineOnly = manager.listSessions({ statuses: ['offline'] })
      expect(offlineOnly.length).toBe(0)
    })
  })

  describe('getSession', () => {
    it('should get session by ID', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      const found = manager.getSession(session.id)
      expect(found).toBe(session)
    })

    it('should return undefined for unknown ID', () => {
      expect(manager.getSession('unknown-id')).toBeUndefined()
    })
  })

  describe('updateSession', () => {
    it('should update session name', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      const updated = manager.updateSession(session.id, { name: 'new-name' })

      expect(updated?.name).toBe('new-name')
      expect(manager.getSession(session.id)?.name).toBe('new-name')
    })

    it('should emit session:updated event', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      const listener = vi.fn()
      manager.on('session:updated', listener)

      manager.updateSession(session.id, { name: 'new-name' })

      expect(listener).toHaveBeenCalledWith(session, { name: 'new-name' })
    })

    it('should not emit event if no changes', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      const listener = vi.fn()
      manager.on('session:updated', listener)

      manager.updateSession(session.id, { name: session.name })

      expect(listener).not.toHaveBeenCalled()
    })

    it('should return undefined for unknown session', () => {
      const result = manager.updateSession('unknown-id', { name: 'test' })
      expect(result).toBeUndefined()
    })
  })

  describe('deleteSession', () => {
    it('should delete external session', async () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      expect(manager.listSessions().length).toBe(1)

      const result = await manager.deleteSession(session.id)
      expect(result).toBe(true)
      expect(manager.listSessions().length).toBe(0)
    })

    it('should emit session:deleted event', async () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      const listener = vi.fn()
      manager.on('session:deleted', listener)

      await manager.deleteSession(session.id)

      expect(listener).toHaveBeenCalledWith(session)
    })

    it('should return false for unknown session', async () => {
      const result = await manager.deleteSession('unknown-id')
      expect(result).toBe(false)
    })

    it('should remove from agent mapping', async () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      expect(manager.getSessionByAgentId('agent-1')).toBe(session)

      await manager.deleteSession(session.id)

      expect(manager.getSessionByAgentId('agent-1')).toBeUndefined()
    })
  })

  describe('findOrCreateSession (session linking)', () => {
    it('should create new external session', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/home/user/project')

      expect(session.type).toBe('external')
      expect(session.agent).toBe('claude')
      expect(session.agentSessionId).toBe('agent-1')
      expect(session.cwd).toBe('/home/user/project')
      expect(session.name).toBe('project') // basename of cwd
    })

    it('should return existing session for same agent ID', () => {
      const session1 = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      const session2 = manager.findOrCreateSession('agent-1', 'claude', '/other/path')

      expect(session1.id).toBe(session2.id)
    })

    it('should create separate sessions for different agent IDs', () => {
      const session1 = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      const session2 = manager.findOrCreateSession('agent-2', 'claude', '/tmp')

      expect(session1.id).not.toBe(session2.id)
    })

    it('should update terminal info on existing session', () => {
      const session1 = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      expect(session1.terminal).toBeUndefined()

      const terminal = { tmuxPane: '%0', tmuxSocket: '/tmp/tmux' }
      const session2 = manager.findOrCreateSession('agent-1', 'claude', '/tmp', terminal)

      expect(session2.terminal).toEqual(terminal)
      expect(session1.terminal).toEqual(terminal) // Same object
    })

    it('should emit session:created event for new session', () => {
      const listener = vi.fn()
      manager.on('session:created', listener)

      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      expect(listener).toHaveBeenCalledWith(session)
    })

    it('should not emit event for existing session', () => {
      manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      const listener = vi.fn()
      manager.on('session:created', listener)

      manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      expect(listener).not.toHaveBeenCalled()
    })

    it('should not match internal session of a different agent type (issue #32)', async () => {
      // Simulate an internal Claude session by writing it directly to the sessions file
      // (we can't create internal sessions without tmux, so we load from persisted state)
      const internalSessionId = 'internal-claude-id'
      const sharedCwd = '/tmp/project'
      const sessionsData = {
        sessions: [
          {
            id: internalSessionId,
            name: 'project',
            type: 'internal',
            agent: 'claude',
            status: 'working',
            cwd: sharedCwd,
            createdAt: Date.now(), // Recent enough to match the 5-min window
            lastActivity: Date.now(),
            tmuxSession: 'cab-test1234',
            // No agentSessionId — this is the unlinked internal session
          },
        ],
        agentToManagedMap: [],
        sessionCounter: 0,
      }

      await writeFile(config.sessionsFile, JSON.stringify(sessionsData), 'utf8')

      // Reload manager with the persisted internal session
      const manager2 = new SessionManager(config)
      manager2.registerAdapter(ClaudeAdapter)
      manager2.registerAdapter(CodexAdapter)
      await manager2.load()

      // The loaded internal session is marked offline; set it back to working
      // and restore createdAt so it falls within the 5-minute recency window
      const internalSession = manager2.getSession(internalSessionId)!
      internalSession.status = 'working'
      internalSession.createdAt = Date.now()

      // Now process a Codex hook event in the same CWD
      const result = manager2.findOrCreateSession(
        'codex-session-1',
        'codex',
        sharedCwd
      )

      // The Codex event must NOT hijack the Claude internal session
      expect(result.id).not.toBe(internalSessionId)
      expect(result.agent).toBe('codex')
      expect(result.agentSessionId).toBe('codex-session-1')

      // The Claude internal session must remain unlinked
      expect(internalSession.agentSessionId).toBeUndefined()

      await manager2.stop()
    })
  })

  describe('getSessionByAgentId', () => {
    it('should find session by agent ID', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      const found = manager.getSessionByAgentId('agent-1')
      expect(found?.id).toBe(session.id)
    })

    it('should return undefined for unknown agent ID', () => {
      expect(manager.getSessionByAgentId('unknown')).toBeUndefined()
    })
  })

  describe('updateSessionStatus', () => {
    it('should update status', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      expect(session.status).toBe('working')

      manager.updateSessionStatus(session, 'idle')

      expect(session.status).toBe('idle')
    })

    it('should emit session:status event', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      const listener = vi.fn()
      manager.on('session:status', listener)

      manager.updateSessionStatus(session, 'idle')

      expect(listener).toHaveBeenCalledWith(session, 'working', 'idle')
    })

    it('should not emit event if status unchanged', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      const listener = vi.fn()
      manager.on('session:status', listener)

      manager.updateSessionStatus(session, 'working') // Same status

      expect(listener).not.toHaveBeenCalled()
    })

    it('should update lastActivity', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      const before = session.lastActivity

      manager.updateSessionStatus(session, 'idle')

      expect(session.lastActivity).toBeGreaterThanOrEqual(before)
    })

    it('should clear currentTool when not working', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      session.currentTool = 'Bash'

      manager.updateSessionStatus(session, 'idle')

      expect(session.currentTool).toBeUndefined()
    })
  })

  describe('updateSessionTool', () => {
    it('should update current tool', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      manager.updateSessionTool(session, 'Bash')

      expect(session.currentTool).toBe('Bash')
    })

    it('should clear tool when undefined', () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp')
      session.currentTool = 'Bash'

      manager.updateSessionTool(session, undefined)

      expect(session.currentTool).toBeUndefined()
    })
  })

  describe('persistence', () => {
    it('should save and load sessions', async () => {
      const session = manager.findOrCreateSession('agent-1', 'claude', '/tmp/test')
      manager.updateSession(session.id, { name: 'test-session' })

      await manager.forceSave()

      // Create new manager and load
      const manager2 = new SessionManager(config)
      manager2.registerAdapter(ClaudeAdapter)
      await manager2.load()

      const loaded = manager2.getSession(session.id)
      expect(loaded).toBeDefined()
      expect(loaded?.name).toBe('test-session')
      expect(loaded?.cwd).toBe('/tmp/test')
      expect(loaded?.agent).toBe('claude')

      await manager2.stop()
    })

    it('should save and load agent mappings', async () => {
      manager.findOrCreateSession('agent-1', 'claude', '/tmp')

      await manager.forceSave()

      const manager2 = new SessionManager(config)
      manager2.registerAdapter(ClaudeAdapter)
      await manager2.load()

      const found = manager2.getSessionByAgentId('agent-1')
      expect(found).toBeDefined()

      await manager2.stop()
    })

    it('should mark internal sessions as offline on load', async () => {
      // We can't easily create an internal session without tmux,
      // so we'll manually write the sessions file
      const sessionsData = {
        sessions: [
          {
            id: 'test-id',
            name: 'test',
            type: 'internal',
            agent: 'claude',
            status: 'working',
            cwd: '/tmp',
            createdAt: Date.now(),
            lastActivity: Date.now(),
            tmuxSession: 'cab-test',
          },
        ],
        agentToManagedMap: [],
        sessionCounter: 0,
      }

      await writeFile(config.sessionsFile, JSON.stringify(sessionsData), 'utf8')

      const manager2 = new SessionManager(config)
      await manager2.load()

      const session = manager2.getSession('test-id')
      expect(session?.status).toBe('offline')

      await manager2.stop()
    })

    it('should handle missing sessions file', async () => {
      const manager2 = new SessionManager(config)
      await manager2.load() // Should not throw

      expect(manager2.listSessions()).toEqual([])

      await manager2.stop()
    })
  })

  describe('external session tracking config', () => {
    it('should not persist sessions when tracking disabled', () => {
      const noTrackConfig = { ...config, trackExternalSessions: false }
      const noTrackManager = new SessionManager(noTrackConfig)
      noTrackManager.registerAdapter(ClaudeAdapter)

      const session = noTrackManager.findOrCreateSession('agent-1', 'claude', '/tmp')

      // Session is returned but not stored
      expect(session.type).toBe('external')
      expect(noTrackManager.listSessions().length).toBe(0)
    })
  })
})

/**
 * SessionManager - Session CRUD, state machine, and persistence
 *
 * Manages both internal sessions (created via tmux) and external sessions
 * (detected via hooks). Handles session linking, state transitions, and
 * automatic health checks.
 */

import { EventEmitter } from 'events'
import { readFile, writeFile, mkdir, realpath } from 'fs/promises'
import { realpathSync } from 'fs'
import { dirname, basename } from 'path'
import { randomUUID } from 'crypto'
import type {
  Session,
  SessionStatus,
  SessionType,
  CreateSessionOptions,
  SessionFilter,
  AgentType,
  AgentEvent,
  AssistantMessageEvent,
  TerminalInfo,
  AgentAdapter,
} from './types.js'
import { TmuxExecutor } from './TmuxExecutor.js'
import { TranscriptWatcher } from './TranscriptWatcher.js'

// =============================================================================
// Types
// =============================================================================

export interface SessionManagerConfig {
  /** Path to sessions.json file */
  sessionsFile: string
  /** Default agent type */
  defaultAgent: AgentType
  /** Timeout (ms) before marking working sessions as idle */
  workingTimeoutMs: number
  /** Time (ms) before cleaning up offline internal sessions */
  offlineCleanupMs: number
  /** Time (ms) before cleaning up stale sessions */
  staleCleanupMs: number
  /** Whether to track external sessions */
  trackExternalSessions: boolean
  /** Enable debug logging */
  debug?: boolean
  /** Spawn visible terminal windows by default (Linux only) */
  spawnTerminalByDefault?: boolean
}

export interface SessionManagerEvents {
  'session:created': (session: Session) => void
  'session:updated': (session: Session, changes: Partial<Session>) => void
  'session:deleted': (session: Session) => void
  'session:status': (session: Session, from: SessionStatus, to: SessionStatus) => void
  event: (event: AgentEvent) => void
  error: (error: Error) => void
}

interface PersistedState {
  sessions: Session[]
  agentToManagedMap: [string, string][]
  sessionCounter: number
}

// =============================================================================
// SessionManager
// =============================================================================

export class SessionManager extends EventEmitter {
  private sessions: Map<string, Session> = new Map()
  private agentToManagedMap: Map<string, string> = new Map()
  private transcriptWatchers: Map<string, TranscriptWatcher> = new Map()
  private sessionCounter = 0
  private adapters: Map<string, AgentAdapter> = new Map()
  private tmux: TmuxExecutor
  private config: SessionManagerConfig
  private healthCheckInterval?: NodeJS.Timeout
  private workingTimeoutInterval?: NodeJS.Timeout
  private cleanupInterval?: NodeJS.Timeout
  private dirty = false

  constructor(config: SessionManagerConfig) {
    super()
    this.config = config
    this.tmux = new TmuxExecutor({ debug: config.debug })
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the session manager (load state, start health checks).
   */
  async start(): Promise<void> {
    await this.load()
    this.startHealthChecks()
  }

  /**
   * Stop the session manager (save state, stop health checks, stop watchers).
   */
  async stop(): Promise<void> {
    this.stopHealthChecks()

    // Stop all transcript watchers
    for (const [sessionId, watcher] of this.transcriptWatchers) {
      await watcher.stop()
      this.transcriptWatchers.delete(sessionId)
    }

    await this.save()
  }

  /**
   * Register an agent adapter.
   */
  registerAdapter(adapter: AgentAdapter): void {
    this.adapters.set(adapter.name, adapter)
  }

  /**
   * Get an agent adapter by name.
   */
  getAdapter(name: string): AgentAdapter | undefined {
    return this.adapters.get(name)
  }

  // ===========================================================================
  // Session CRUD
  // ===========================================================================

  /**
   * Create a new internal session.
   */
  async createSession(options: CreateSessionOptions = {}): Promise<Session> {
    const agent = options.agent ?? this.config.defaultAgent
    const adapter = this.adapters.get(agent)

    if (!adapter) {
      throw new Error(`No adapter registered for agent: ${agent}`)
    }

    // Generate IDs
    const id = randomUUID()
    const shortId = id.slice(0, 8)
    const tmuxSessionName = `cab-${shortId}` // cab = coding-agent-bridge

    // Determine working directory (resolve symlinks for consistent matching)
    const rawCwd = options.cwd ?? process.env.HOME ?? '/tmp'
    const cwd = await realpath(rawCwd).catch(() => rawCwd)

    // Determine session name
    const name = options.name ?? basename(cwd) ?? `session-${++this.sessionCounter}`

    // Build the agent command
    const command = adapter.buildCommand(options)

    // Create the tmux session
    await this.tmux.createSession(tmuxSessionName, {
      cwd,
      command,
    })

    // Spawn visible terminal if requested
    const shouldSpawnTerminal = options.spawnTerminal ?? this.config.spawnTerminalByDefault ?? false
    if (shouldSpawnTerminal && process.platform === 'linux') {
      try {
        await this.tmux.spawnVisibleTerminal(tmuxSessionName)
      } catch (err) {
        // Log error but don't fail session creation
        if (this.config.debug) {
          console.error('[SessionManager] Failed to spawn terminal:', err)
        }
      }
    }

    // Create the session object
    const session: Session = {
      id,
      name,
      type: 'internal',
      agent,
      status: 'working', // Agent is starting up
      cwd,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      tmuxSession: tmuxSessionName,
    }

    // Store the session
    this.sessions.set(id, session)
    this.markDirty()

    // Emit event
    this.emit('session:created', session)

    return session
  }

  /**
   * Get a session by ID.
   */
  getSession(id: string): Session | undefined {
    return this.sessions.get(id)
  }

  /**
   * List all sessions, optionally filtered.
   */
  listSessions(filter?: SessionFilter): Session[] {
    let sessions = Array.from(this.sessions.values())

    if (filter) {
      if (filter.type) {
        sessions = sessions.filter((s) => s.type === filter.type)
      }
      if (filter.agent) {
        sessions = sessions.filter((s) => s.agent === filter.agent)
      }
      if (filter.status) {
        sessions = sessions.filter((s) => s.status === filter.status)
      }
      if (filter.statuses) {
        sessions = sessions.filter((s) => filter.statuses!.includes(s.status))
      }
    }

    return sessions
  }

  /**
   * Update a session's properties.
   */
  updateSession(id: string, updates: Partial<Pick<Session, 'name'>>): Session | undefined {
    const session = this.sessions.get(id)
    if (!session) return undefined

    const changes: Partial<Session> = {}

    if (updates.name !== undefined && updates.name !== session.name) {
      changes.name = updates.name
      session.name = updates.name
    }

    if (Object.keys(changes).length > 0) {
      this.markDirty()
      this.emit('session:updated', session, changes)
    }

    return session
  }

  /**
   * Delete a session.
   */
  async deleteSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id)
    if (!session) return false

    // Kill tmux session if internal
    if (session.type === 'internal' && session.tmuxSession) {
      await this.tmux.killSession(session.tmuxSession).catch(() => {
        // Ignore errors - session may already be dead
      })
    }

    // Stop transcript watcher
    await this.stopTranscriptWatcher(id)

    // Remove from maps
    this.sessions.delete(id)

    // Remove from agent mapping
    for (const [agentId, managedId] of this.agentToManagedMap) {
      if (managedId === id) {
        this.agentToManagedMap.delete(agentId)
      }
    }

    this.markDirty()
    this.emit('session:deleted', session)

    return true
  }

  // ===========================================================================
  // Session Control
  // ===========================================================================

  /**
   * Send a prompt to a session (internal sessions only).
   */
  async sendPrompt(
    id: string,
    prompt: string
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.sessions.get(id)

    if (!session) {
      return { ok: false, error: 'Session not found' }
    }

    if (session.type === 'external') {
      // For external sessions, check if we have terminal info
      if (session.terminal?.tmuxPane && session.terminal?.tmuxSocket) {
        await this.tmux.pasteBuffer({
          target: session.terminal.tmuxPane,
          text: prompt,
          isPaneId: true,
          socket: session.terminal.tmuxSocket,
        })
        return { ok: true }
      }
      return { ok: false, error: 'External session has no terminal info' }
    }

    if (!session.tmuxSession) {
      return { ok: false, error: 'Session has no tmux session' }
    }

    if (session.status === 'offline') {
      return { ok: false, error: 'Session is offline' }
    }

    await this.tmux.pasteBuffer({
      target: session.tmuxSession,
      text: prompt,
    })

    // Update activity and status
    this.updateSessionStatus(session, 'working')

    return { ok: true }
  }

  /**
   * Cancel (Ctrl+C) a session (internal sessions only).
   */
  async cancel(id: string): Promise<boolean> {
    const session = this.sessions.get(id)

    if (!session) return false
    if (session.type === 'external') return false
    if (!session.tmuxSession) return false

    await this.tmux.sendCtrlC(session.tmuxSession)
    return true
  }

  /**
   * Restart an offline session.
   */
  async restart(id: string): Promise<Session | undefined> {
    const session = this.sessions.get(id)

    if (!session) return undefined
    if (session.type === 'external') return undefined
    if (session.status !== 'offline') return undefined

    const adapter = this.adapters.get(session.agent)
    if (!adapter) return undefined

    // Kill old tmux session if it somehow still exists
    if (session.tmuxSession) {
      await this.tmux.killSession(session.tmuxSession).catch(() => {})
    }

    // Generate new tmux session name
    const shortId = session.id.slice(0, 8)
    const tmuxSessionName = `cab-${shortId}-${Date.now()}`

    // Build the agent command
    const command = adapter.buildCommand()

    // Create new tmux session
    await this.tmux.createSession(tmuxSessionName, {
      cwd: session.cwd,
      command,
    })

    // Update session
    session.tmuxSession = tmuxSessionName
    session.agentSessionId = undefined // Clear old agent session ID
    this.updateSessionStatus(session, 'working')

    // Clear old agent mapping
    for (const [agentId, managedId] of this.agentToManagedMap) {
      if (managedId === session.id) {
        this.agentToManagedMap.delete(agentId)
      }
    }

    this.markDirty()

    return session
  }

  // ===========================================================================
  // Session Linking
  // ===========================================================================

  /**
   * Find or create a session for an agent session ID.
   * Used when processing events from hooks.
   */
  findOrCreateSession(
    agentSessionId: string,
    agent: AgentType,
    cwd: string,
    terminal?: TerminalInfo,
    transcriptPath?: string
  ): Session {
    // Resolve symlinks for consistent CWD matching (e.g., /tmp -> /private/tmp on macOS)
    try { cwd = realpathSync(cwd) } catch { /* use original if resolve fails */ }

    // Check if we already have a mapping
    const existingId = this.agentToManagedMap.get(agentSessionId)
    if (existingId) {
      const session = this.sessions.get(existingId)
      if (session) {
        // Update terminal info if provided
        if (terminal) {
          session.terminal = terminal
        }
        // Start transcript watcher if we have a new path
        if (transcriptPath && !session.transcriptPath) {
          session.transcriptPath = transcriptPath
          this.startTranscriptWatcher(session)
        }
        return session
      }
    }

    // Try to find an internal session with matching cwd that was recently created
    // and doesn't have an agent session ID yet. Window is generous (5 min) because
    // agents can take a while to initialize before firing their first event.
    const recentThreshold = Date.now() - 300000
    for (const session of this.sessions.values()) {
      if (
        session.type === 'internal' &&
        !session.agentSessionId &&
        session.cwd === cwd &&
        session.createdAt > recentThreshold
      ) {
        // Link this session
        session.agentSessionId = agentSessionId
        this.agentToManagedMap.set(agentSessionId, session.id)
        if (terminal) {
          session.terminal = terminal
        }
        if (transcriptPath) {
          session.transcriptPath = transcriptPath
          this.startTranscriptWatcher(session)
        }
        this.markDirty()
        return session
      }
    }

    // No match - create external session if tracking is enabled
    if (!this.config.trackExternalSessions) {
      // Return a temporary session object (not persisted)
      const tempSession: Session = {
        id: randomUUID(),
        name: basename(cwd) || 'external',
        type: 'external',
        agent,
        status: 'working',
        cwd,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        agentSessionId,
        terminal,
        transcriptPath,
      }
      if (transcriptPath) {
        this.startTranscriptWatcher(tempSession)
      }
      return tempSession
    }

    // Create external session
    const id = randomUUID()
    const session: Session = {
      id,
      name: basename(cwd) || `external-${++this.sessionCounter}`,
      type: 'external',
      agent,
      status: 'working',
      cwd,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      agentSessionId,
      terminal,
      transcriptPath,
    }

    this.sessions.set(id, session)
    this.agentToManagedMap.set(agentSessionId, id)
    this.markDirty()
    this.emit('session:created', session)

    if (transcriptPath) {
      this.startTranscriptWatcher(session)
    }

    return session
  }

  /**
   * Get a session by agent session ID.
   */
  getSessionByAgentId(agentSessionId: string): Session | undefined {
    const managedId = this.agentToManagedMap.get(agentSessionId)
    if (managedId) {
      return this.sessions.get(managedId)
    }
    return undefined
  }

  // ===========================================================================
  // Status Updates
  // ===========================================================================

  /**
   * Update a session's status.
   */
  updateSessionStatus(session: Session, newStatus: SessionStatus): void {
    if (session.status === newStatus) {
      session.lastActivity = Date.now()
      return
    }

    const oldStatus = session.status
    session.status = newStatus
    session.lastActivity = Date.now()

    if (newStatus !== 'working') {
      session.currentTool = undefined
    }

    this.markDirty()
    this.emit('session:status', session, oldStatus, newStatus)
  }

  /**
   * Update a session's current tool.
   */
  updateSessionTool(session: Session, tool: string | undefined): void {
    session.currentTool = tool
    session.lastActivity = Date.now()
    this.markDirty()
  }

  // ===========================================================================
  // Transcript Watchers
  // ===========================================================================

  /**
   * Start a transcript watcher for a session.
   */
  private startTranscriptWatcher(session: Session): void {
    if (!session.transcriptPath) return
    if (this.transcriptWatchers.has(session.id)) return

    const adapter = this.adapters.get(session.agent)
    if (!adapter?.parseTranscriptEntry) return

    const watcher = new TranscriptWatcher(session.transcriptPath, adapter, {
      debug: this.config.debug,
    })

    watcher.on('message', (partial: Partial<AssistantMessageEvent>) => {
      // Complete the event with session info
      const event: AssistantMessageEvent = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        timestamp: partial.timestamp ?? Date.now(),
        type: 'assistant_message',
        sessionId: session.id,
        agentSessionId: session.agentSessionId,
        agent: session.agent,
        cwd: session.cwd,
        content: partial.content ?? [],
        requestId: partial.requestId,
        isPreamble: partial.isPreamble ?? false,
      }

      session.lastActivity = Date.now()
      this.emit('event', event)
    })

    watcher.on('error', (err: Error) => {
      this.emit('error', err)
    })

    this.transcriptWatchers.set(session.id, watcher)
    watcher.start().catch((err: unknown) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    })
  }

  /**
   * Stop a transcript watcher for a session.
   */
  private async stopTranscriptWatcher(sessionId: string): Promise<void> {
    const watcher = this.transcriptWatchers.get(sessionId)
    if (watcher) {
      await watcher.stop()
      this.transcriptWatchers.delete(sessionId)
    }
  }

  // ===========================================================================
  // Health Checks
  // ===========================================================================

  private startHealthChecks(): void {
    // Check tmux session health every 10 seconds
    this.healthCheckInterval = setInterval(() => {
      this.checkTmuxHealth().catch((err) => {
        this.emit('error', err)
      })
    }, 10000)

    // Check working timeout every 10 seconds
    this.workingTimeoutInterval = setInterval(() => {
      this.checkWorkingTimeout()
    }, 10000)

    // Cleanup stale sessions every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSessions().catch((err) => {
        this.emit('error', err)
      })
    }, 60000)
  }

  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = undefined
    }
    if (this.workingTimeoutInterval) {
      clearInterval(this.workingTimeoutInterval)
      this.workingTimeoutInterval = undefined
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }
  }

  /**
   * Check if tmux sessions are still alive.
   */
  private async checkTmuxHealth(): Promise<void> {
    const tmuxSessions = await this.tmux.listSessions()
    const tmuxNames = new Set(tmuxSessions.map((s) => s.name))

    for (const session of this.sessions.values()) {
      if (session.type !== 'internal') continue
      if (!session.tmuxSession) continue

      const isAlive = tmuxNames.has(session.tmuxSession)

      if (!isAlive && session.status !== 'offline') {
        this.updateSessionStatus(session, 'offline')
      } else if (isAlive && session.status === 'offline') {
        this.updateSessionStatus(session, 'idle')
      }
    }
  }

  /**
   * Check for sessions stuck in working state.
   */
  private checkWorkingTimeout(): void {
    const timeout = this.config.workingTimeoutMs
    const now = Date.now()

    for (const session of this.sessions.values()) {
      if (session.status === 'working') {
        const elapsed = now - session.lastActivity
        if (elapsed > timeout) {
          this.updateSessionStatus(session, 'idle')
        }
      }
    }
  }

  /**
   * Cleanup stale sessions.
   */
  private async cleanupStaleSessions(): Promise<void> {
    const now = Date.now()
    const toDelete: string[] = []

    for (const session of this.sessions.values()) {
      // Internal offline sessions: cleanup after offlineCleanupMs
      if (session.type === 'internal' && session.status === 'offline') {
        const elapsed = now - session.lastActivity
        if (elapsed > this.config.offlineCleanupMs) {
          toDelete.push(session.id)
        }
      }

      // All sessions: cleanup after staleCleanupMs
      const elapsed = now - session.lastActivity
      if (elapsed > this.config.staleCleanupMs) {
        toDelete.push(session.id)
      }
    }

    for (const id of toDelete) {
      await this.deleteSession(id)
    }
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private markDirty(): void {
    this.dirty = true
  }

  /**
   * Load sessions from disk.
   */
  async load(): Promise<void> {
    try {
      const content = await readFile(this.config.sessionsFile, 'utf8')
      const state: PersistedState = JSON.parse(content)

      this.sessions.clear()
      this.agentToManagedMap.clear()

      for (const session of state.sessions) {
        // Mark all internal sessions as offline on load
        // (we don't know if tmux is still running)
        if (session.type === 'internal') {
          session.status = 'offline'
          session.terminal = undefined
        }
        this.sessions.set(session.id, session)
      }

      for (const [agentId, managedId] of state.agentToManagedMap) {
        this.agentToManagedMap.set(agentId, managedId)
      }

      this.sessionCounter = state.sessionCounter ?? 0
      this.dirty = false
    } catch (err) {
      // File doesn't exist or invalid - start fresh
      if (this.config.debug) {
        console.log('[SessionManager] No existing sessions file, starting fresh')
      }
    }
  }

  /**
   * Save sessions to disk.
   */
  async save(): Promise<void> {
    if (!this.dirty) return

    const state: PersistedState = {
      sessions: Array.from(this.sessions.values()),
      agentToManagedMap: Array.from(this.agentToManagedMap.entries()),
      sessionCounter: this.sessionCounter,
    }

    // Ensure directory exists
    await mkdir(dirname(this.config.sessionsFile), { recursive: true })

    await writeFile(this.config.sessionsFile, JSON.stringify(state, null, 2), 'utf8')
    this.dirty = false
  }

  /**
   * Force save (for shutdown).
   */
  async forceSave(): Promise<void> {
    this.dirty = true
    await this.save()
  }
}

/**
 * Create a SessionManager instance.
 */
export function createSessionManager(config: SessionManagerConfig): SessionManager {
  return new SessionManager(config)
}

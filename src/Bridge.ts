/**
 * Bridge - Main API that wires together all components
 *
 * Creates and orchestrates SessionManager, EventProcessor, FileWatcher,
 * and BridgeServer to provide a unified interface for managing AI coding
 * assistant sessions.
 */

import { EventEmitter } from 'events'
import { join } from 'path'
import { homedir } from 'os'
import { mkdir } from 'fs/promises'
import type {
  Bridge,
  BridgeConfig,
  BridgeEvents,
  ResolvedConfig,
  Session,
  CreateSessionOptions,
  SessionFilter,
  SessionStatus,
  AgentAdapter,
  AgentType,
  AgentEvent,
  ImageInput,
  SendResult,
} from './types.js'
import { SessionManager } from './SessionManager.js'
import { EventProcessor } from './EventProcessor.js'
import { FileWatcher } from './FileWatcher.js'
import { BridgeServer } from './Server.js'
import { ClaudeAdapter } from './adapters/ClaudeAdapter.js'
import { CodexAdapter } from './adapters/CodexAdapter.js'

function resolveConfig(config?: BridgeConfig): ResolvedConfig {
  const dataDir = config?.dataDir ?? join(homedir(), '.coding-agent-bridge')
  return {
    dataDir,
    port: config?.port ?? 4003,
    defaultAgent: config?.defaultAgent ?? 'claude',
    agents: config?.agents ?? ['claude', 'codex'],
    trackExternalSessions: config?.trackExternalSessions ?? true,
    workingTimeoutMs: config?.workingTimeoutMs ?? 120000,
    cleanupOfflineAfterMs: config?.cleanupOfflineAfterMs ?? 7 * 24 * 60 * 60 * 1000,
    maxEvents: config?.maxEvents ?? 1000,
    debug: config?.debug ?? false,
    paths: {
      eventsFile: join(dataDir, 'events.jsonl'),
      sessionsFile: join(dataDir, 'sessions.json'),
      hooksDir: join(dataDir, 'hooks'),
    },
  }
}

class BridgeImpl extends EventEmitter implements Bridge {
  readonly config: ResolvedConfig
  private sessionManager: SessionManager
  private eventProcessor: EventProcessor
  private fileWatcher: FileWatcher
  private server: BridgeServer
  private adapters: Map<string, AgentAdapter> = new Map()
  private running = false

  constructor(config?: BridgeConfig) {
    super()
    this.config = resolveConfig(config)

    this.sessionManager = new SessionManager({
      sessionsFile: this.config.paths.sessionsFile,
      defaultAgent: this.config.defaultAgent,
      workingTimeoutMs: this.config.workingTimeoutMs,
      offlineCleanupMs: this.config.cleanupOfflineAfterMs,
      staleCleanupMs: this.config.cleanupOfflineAfterMs * 2,
      trackExternalSessions: this.config.trackExternalSessions,
      debug: this.config.debug,
    })

    this.eventProcessor = new EventProcessor({
      debug: this.config.debug,
    })

    this.fileWatcher = new FileWatcher(this.config.paths.eventsFile, {
      debug: this.config.debug,
    })

    this.server = new BridgeServer({
      port: this.config.port,
      debug: this.config.debug,
    })

    // Register default adapters
    for (const name of this.config.agents) {
      if (name === 'claude') {
        this.registerAgent(ClaudeAdapter)
      } else if (name === 'codex') {
        this.registerAgent(CodexAdapter)
      }
    }

    this.wireComponents()
  }

  private wireComponents(): void {
    // FileWatcher -> EventProcessor
    this.fileWatcher.on('line', (line: string) => {
      this.eventProcessor.processLine(line)
    })

    // EventProcessor -> SessionManager (link sessions and update status)
    this.eventProcessor.on('event', (processed) => {
      const session = this.sessionManager.findOrCreateSession(
        processed.agentSessionId,
        processed.agent,
        processed.cwd ?? process.cwd(),
        processed.terminal,
        processed.transcriptPath,
      )

      // Enrich event with bridge session ID
      processed.event.sessionId = session.id

      // Update session status based on event type
      switch (processed.event.type) {
        case 'pre_tool_use':
          this.sessionManager.updateSessionStatus(session, 'working')
          this.sessionManager.updateSessionTool(session, (processed.event as any).tool)
          break
        case 'post_tool_use':
          this.sessionManager.updateSessionTool(session, undefined)
          break
        case 'stop':
        case 'subagent_stop':
          this.sessionManager.updateSessionStatus(session, 'idle')
          break
        case 'user_prompt_submit':
          this.sessionManager.updateSessionStatus(session, 'working')
          break
        case 'session_end':
          this.sessionManager.updateSessionStatus(session, 'offline')
          break
        case 'session_start':
          this.sessionManager.updateSessionStatus(session, 'working')
          break
      }

      // Broadcast event via server
      this.server.broadcast(processed.event)
    })

    // SessionManager events -> Bridge events
    this.sessionManager.on('session:created', (session: Session) => {
      this.emit('session:created', session)
      this.server.broadcastSessionUpdate(session, 'created')
    })
    this.sessionManager.on('session:updated', (session: Session, changes: Partial<Session>) => {
      this.emit('session:updated', session, changes)
      this.server.broadcastSessionUpdate(session, 'updated')
    })
    this.sessionManager.on('session:deleted', (session: Session) => {
      this.emit('session:deleted', session)
      this.server.broadcastSessionUpdate(session, 'deleted')
    })
    this.sessionManager.on('session:status', (session: Session, from: SessionStatus, to: SessionStatus) => {
      this.emit('session:status', session, from, to)
      this.server.broadcastSessionUpdate(session, 'status')
    })
    this.sessionManager.on('event', (event: AgentEvent) => {
      this.emit('event', event)
      this.server.broadcast(event)
    })
    this.sessionManager.on('error', (error: Error) => {
      this.emit('error', error)
    })

    // Wire server to session manager
    this.server.setSessionManager(this.sessionManager)
  }

  // === Lifecycle ===

  async start(): Promise<void> {
    if (this.running) return

    // Ensure data directory exists
    await mkdir(this.config.dataDir, { recursive: true })

    await this.sessionManager.start()
    await this.fileWatcher.start()
    this.running = true
  }

  async stop(): Promise<void> {
    if (!this.running) return

    await this.fileWatcher.stop()
    await this.sessionManager.stop()
    await this.server.stop()
    this.running = false
  }

  isRunning(): boolean {
    return this.running
  }

  // === Sessions ===

  async createSession(options?: CreateSessionOptions): Promise<Session> {
    return this.sessionManager.createSession(options)
  }

  getSession(id: string): Session | undefined {
    return this.sessionManager.getSession(id)
  }

  listSessions(filter?: SessionFilter): Session[] {
    return this.sessionManager.listSessions(filter)
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.sessionManager.deleteSession(id)
  }

  updateSession(id: string, updates: Partial<Pick<Session, 'name'>>): Session | undefined {
    return this.sessionManager.updateSession(id, updates)
  }

  // === Session Control ===

  async sendPrompt(id: string, prompt: string, _images?: ImageInput[]): Promise<SendResult> {
    return this.sessionManager.sendPrompt(id, prompt)
  }

  async cancel(id: string): Promise<boolean> {
    return this.sessionManager.cancel(id)
  }

  async restart(id: string): Promise<Session> {
    const session = await this.sessionManager.restart(id)
    if (!session) {
      throw new Error(`Cannot restart session ${id}: not found, not internal, or not offline`)
    }
    return session
  }

  // === Agents ===

  registerAgent(adapter: AgentAdapter): void {
    this.adapters.set(adapter.name, adapter)
    this.sessionManager.registerAdapter(adapter)
    this.eventProcessor.registerAdapter(adapter)
  }

  getAgent(name: AgentType): AgentAdapter | undefined {
    return this.adapters.get(name)
  }

  listAgents(): AgentAdapter[] {
    return Array.from(this.adapters.values())
  }

  // === Server ===

  async listen(port?: number): Promise<void> {
    if (port !== undefined) {
      // Create a new server with the specified port
      await this.server.stop()
      this.server = new BridgeServer({
        port,
        debug: this.config.debug,
      })
      this.server.setSessionManager(this.sessionManager)
    }
    await this.server.start()
  }

  async close(): Promise<void> {
    await this.server.stop()
  }

  // === Events (override to return this for chaining) ===

  override on<K extends keyof BridgeEvents>(event: K, handler: BridgeEvents[K]): this {
    return super.on(event, handler as (...args: any[]) => void) as this
  }

  override off<K extends keyof BridgeEvents>(event: K, handler: BridgeEvents[K]): this {
    return super.off(event, handler as (...args: any[]) => void) as this
  }

  override once<K extends keyof BridgeEvents>(event: K, handler: BridgeEvents[K]): this {
    return super.once(event, handler as (...args: any[]) => void) as this
  }
}

/**
 * Create a new bridge instance.
 *
 * @param config - Bridge configuration options
 * @returns A new Bridge instance
 */
export function createBridge(config?: BridgeConfig): Bridge {
  return new BridgeImpl(config)
}

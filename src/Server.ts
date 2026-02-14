/**
 * Server - HTTP and WebSocket server for the bridge
 *
 * Provides REST API for session management and WebSocket for real-time events.
 */

import { EventEmitter } from 'events'
import { createServer as createHttpServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import type { AgentEvent, Session, CreateSessionOptions, SessionFilter } from './types.js'
import type { SessionManager } from './SessionManager.js'
import type { ProcessedEvent } from './EventProcessor.js'

export interface ServerConfig {
  /** Port to listen on. Default: 4003 */
  port?: number
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string
  /** Allowed origins for CORS. Default: ['http://localhost:*', 'https://localhost:*'] */
  allowedOrigins?: string[]
  /** Enable debug logging */
  debug?: boolean
}

export interface ServerEvents {
  listening: [port: number, host: string]
  error: [error: Error]
  connection: [ws: WebSocket]
  close: []
}

/**
 * HTTP response helpers
 */
function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  })
  res.end(JSON.stringify(data))
}

function sendError(res: ServerResponse, message: string, status = 400): void {
  sendJson(res, { error: message }, status)
}

/**
 * Parse JSON body from request
 */
async function parseBody<T>(req: IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      // Limit body size to 10MB
      if (body.length > 10 * 1024 * 1024) {
        resolve(null)
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T)
      } catch {
        resolve(null)
      }
    })
  })
}

/**
 * Match origin against allowed patterns
 */
function matchOrigin(origin: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    // Convert pattern to regex
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*') +
        '$'
    )
    if (regex.test(origin)) {
      return true
    }
  }
  return false
}

/** Callback type for processing raw events from POST /event */
export type EventProcessorCallback = (rawEvent: unknown) => AgentEvent | null

export class BridgeServer extends EventEmitter {
  private config: Required<ServerConfig>
  private httpServer: HttpServer | null = null
  private wss: WebSocketServer | null = null
  private clients: Set<WebSocket> = new Set()
  private sessionManager: SessionManager | null = null
  private eventProcessor: EventProcessorCallback | null = null

  constructor(config: ServerConfig = {}) {
    super()
    this.config = {
      port: config.port ?? 4003,
      host: config.host ?? '127.0.0.1',
      allowedOrigins: config.allowedOrigins ?? [
        'http://localhost:*',
        'https://localhost:*',
        'http://127.0.0.1:*',
        'https://127.0.0.1:*',
      ],
      debug: config.debug ?? false,
    }
  }

  /**
   * Set the session manager for the server
   */
  setSessionManager(manager: SessionManager): void {
    this.sessionManager = manager
  }

  /**
   * Set the event processor callback for transforming raw POST /event data
   */
  setEventProcessor(processor: EventProcessorCallback): void {
    this.eventProcessor = processor
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.httpServer) {
      return
    }

    this.httpServer = createHttpServer((req, res) => {
      this.handleRequest(req, res)
    })

    // Set up WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer as HttpServer })

    this.wss.on('connection', (ws, req) => {
      this.handleWebSocketConnection(ws, req)
    })

    // Start listening
    return new Promise((resolve, reject) => {
      this.httpServer!.once('error', reject)
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        this.debug('Server listening on', this.config.host, ':', this.config.port)
        this.emit('listening', this.config.port, this.config.host)
        resolve()
      })
    })
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    // Close all WebSocket connections
    for (const client of this.clients) {
      client.close()
    }
    this.clients.clear()

    // Close WebSocket server
    if (this.wss) {
      this.wss.close()
      this.wss = null
    }

    // Close HTTP server
    if (this.httpServer) {
      return new Promise((resolve) => {
        this.httpServer!.close(() => {
          this.httpServer = null
          this.emit('close')
          resolve()
        })
      })
    }
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(event: AgentEvent | ProcessedEvent): void {
    // If it's a ProcessedEvent, extract the actual event
    // ProcessedEvent has { event: AgentEvent, agentSessionId, ... }
    const eventData = 'event' in event && 'agentSessionId' in event
      ? (event as ProcessedEvent).event
      : event

    const message = JSON.stringify({
      type: 'event',
      data: eventData,
    })

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    }
  }

  /**
   * Broadcast a session update to all connected clients
   */
  broadcastSessionUpdate(session: Session, updateType: 'created' | 'updated' | 'deleted' | 'status'): void {
    const message = JSON.stringify({
      type: `session:${updateType}`,
      data: session,
    })

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    }
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * Handle HTTP request
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method?.toUpperCase() || 'GET'

    // CORS handling
    const origin = req.headers.origin
    if (origin && matchOrigin(origin, this.config.allowedOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      res.setHeader('Access-Control-Max-Age', '86400')
    }

    // Handle preflight
    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      let url: URL
      try {
        url = new URL(req.url || '/', `http://${req.headers.host}`)
      } catch {
        return sendError(res, 'Invalid request URL', 400)
      }
      const pathname = url.pathname

      this.debug(method, pathname)
      // Health check
      if (pathname === '/health' && method === 'GET') {
        return sendJson(res, {
          status: 'ok',
          clients: this.clients.size,
          sessions: this.sessionManager?.listSessions().length ?? 0,
        })
      }

      // Sessions API
      if (pathname === '/sessions') {
        if (method === 'GET') {
          return this.handleListSessions(req, res, url)
        }
        if (method === 'POST') {
          return this.handleCreateSession(req, res)
        }
      }

      // Session by ID
      const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/)
      if (sessionMatch && sessionMatch[1]) {
        const sessionId = decodeURIComponent(sessionMatch[1])
        if (method === 'GET') {
          return this.handleGetSession(res, sessionId)
        }
        if (method === 'PATCH') {
          return this.handleUpdateSession(req, res, sessionId)
        }
        if (method === 'DELETE') {
          return this.handleDeleteSession(res, sessionId)
        }
      }

      // Session actions
      const actionMatch = pathname.match(/^\/sessions\/([^/]+)\/([^/]+)$/)
      if (actionMatch && actionMatch[1] && actionMatch[2]) {
        const sessionId = decodeURIComponent(actionMatch[1])
        const action = actionMatch[2]

        if (action === 'prompt' && method === 'POST') {
          return this.handleSendPrompt(req, res, sessionId)
        }
        if (action === 'cancel' && method === 'POST') {
          return this.handleCancelSession(res, sessionId)
        }
        if (action === 'restart' && method === 'POST') {
          return this.handleRestartSession(res, sessionId)
        }
      }

      // Event endpoint (for hook callbacks)
      if (pathname === '/event' && method === 'POST') {
        return this.handleEventPost(req, res)
      }

      // Not found
      sendError(res, 'Not found', 404)
    } catch (err) {
      this.debug('Error handling request:', err)
      sendError(res, 'Internal server error', 500)
    }
  }

  /**
   * Handle WebSocket connection
   */
  private handleWebSocketConnection(ws: WebSocket, req: IncomingMessage): void {
    // Validate origin
    const origin = req.headers.origin
    if (origin && !matchOrigin(origin, this.config.allowedOrigins)) {
      this.debug('Rejected WebSocket from origin:', origin)
      ws.close(4003, 'Origin not allowed')
      return
    }

    this.debug('WebSocket connected')
    this.clients.add(ws)
    this.emit('connection', ws)

    // Send current sessions on connect (per WEBSOCKET_INTERFACE.md spec)
    if (this.sessionManager) {
      const sessions = this.sessionManager.listSessions()
      ws.send(
        JSON.stringify({
          type: 'init',
          data: { sessions },
        })
      )
    }

    ws.on('close', () => {
      this.debug('WebSocket disconnected')
      this.clients.delete(ws)
    })

    ws.on('error', (err) => {
      this.debug('WebSocket error:', err)
      this.clients.delete(ws)
    })

    ws.on('message', (data) => {
      this.handleWebSocketMessage(ws, data)
    })
  }

  /**
   * Handle WebSocket message
   */
  private handleWebSocketMessage(ws: WebSocket, data: unknown): void {
    try {
      const message = JSON.parse(String(data)) as { type: string; [key: string]: unknown }

      // Handle ping
      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }))
        return
      }

      // Other message types can be added here
      this.debug('Received WebSocket message:', message.type)
    } catch (err) {
      this.debug('Invalid WebSocket message:', err)
    }
  }

  // =========================================================================
  // Session API handlers
  // =========================================================================

  private handleListSessions(req: IncomingMessage, res: ServerResponse, url: URL): void {
    if (!this.sessionManager) {
      return sendError(res, 'Session manager not configured', 500)
    }

    const filter: SessionFilter = {}

    const type = url.searchParams.get('type')
    if (type === 'internal' || type === 'external') {
      filter.type = type
    }

    const agent = url.searchParams.get('agent')
    if (agent) {
      filter.agent = agent as any
    }

    const status = url.searchParams.get('status')
    if (status) {
      filter.status = status as any
    }

    const sessions = this.sessionManager.listSessions(filter)
    sendJson(res, sessions)
  }

  private async handleCreateSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.sessionManager) {
      return sendError(res, 'Session manager not configured', 500)
    }

    const body = await parseBody<CreateSessionOptions>(req)
    if (!body) {
      return sendError(res, 'Invalid request body')
    }

    try {
      const session = await this.sessionManager.createSession(body)
      sendJson(res, session, 201)
    } catch (err) {
      sendError(res, (err as Error).message)
    }
  }

  private handleGetSession(res: ServerResponse, sessionId: string): void {
    if (!this.sessionManager) {
      return sendError(res, 'Session manager not configured', 500)
    }

    const session = this.sessionManager.getSession(sessionId)
    if (!session) {
      return sendError(res, 'Session not found', 404)
    }

    sendJson(res, session)
  }

  private async handleUpdateSession(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string
  ): Promise<void> {
    if (!this.sessionManager) {
      return sendError(res, 'Session manager not configured', 500)
    }

    const body = await parseBody<{ name?: string }>(req)
    if (!body) {
      return sendError(res, 'Invalid request body')
    }

    const session = this.sessionManager.updateSession(sessionId, body)
    if (!session) {
      return sendError(res, 'Session not found', 404)
    }

    sendJson(res, session)
  }

  private async handleDeleteSession(res: ServerResponse, sessionId: string): Promise<void> {
    if (!this.sessionManager) {
      return sendError(res, 'Session manager not configured', 500)
    }

    const deleted = await this.sessionManager.deleteSession(sessionId)
    if (!deleted) {
      return sendError(res, 'Session not found', 404)
    }

    sendJson(res, { success: true })
  }

  private async handleSendPrompt(
    req: IncomingMessage,
    res: ServerResponse,
    sessionId: string
  ): Promise<void> {
    if (!this.sessionManager) {
      return sendError(res, 'Session manager not configured', 500)
    }

    const body = await parseBody<{ prompt: string }>(req)
    if (!body || !body.prompt) {
      return sendError(res, 'Missing prompt in request body')
    }

    // Note: Image support can be added later when SessionManager supports it
    const result = await this.sessionManager.sendPrompt(sessionId, body.prompt)
    if (!result.ok) {
      return sendError(res, result.error || 'Failed to send prompt')
    }

    sendJson(res, { success: true })
  }

  private async handleCancelSession(res: ServerResponse, sessionId: string): Promise<void> {
    if (!this.sessionManager) {
      return sendError(res, 'Session manager not configured', 500)
    }

    const cancelled = await this.sessionManager.cancel(sessionId)
    if (!cancelled) {
      return sendError(res, 'Failed to cancel session')
    }

    sendJson(res, { success: true })
  }

  private async handleRestartSession(res: ServerResponse, sessionId: string): Promise<void> {
    if (!this.sessionManager) {
      return sendError(res, 'Session manager not configured', 500)
    }

    const session = await this.sessionManager.restart(sessionId)
    if (!session) {
      return sendError(res, 'Failed to restart session')
    }

    sendJson(res, session)
  }

  private async handleEventPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await parseBody<Record<string, unknown>>(req)
    if (!body) {
      return sendError(res, 'Invalid event data')
    }

    // If we have an event processor, transform the raw event
    // Otherwise broadcast the raw data as-is
    if (this.eventProcessor) {
      const processed = this.eventProcessor(body)
      if (processed) {
        this.broadcast(processed)
      } else {
        this.debug('Event processor returned null for:', JSON.stringify(body).substring(0, 100))
      }
    } else {
      // Broadcast raw event (legacy behavior)
      this.broadcast(body as unknown as AgentEvent)
    }

    sendJson(res, { success: true })
  }

  private debug(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[BridgeServer]', ...args)
    }
  }
}

/**
 * Create a new server instance
 */
export function createServer(config?: ServerConfig): BridgeServer {
  return new BridgeServer(config)
}

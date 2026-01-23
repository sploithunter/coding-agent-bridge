/**
 * WebSocket Interface Types
 *
 * Standard types for WebSocket communication between coding agent bridges
 * and their clients. See WEBSOCKET_INTERFACE.md for the full specification.
 *
 * @module websocket-types
 */

import type { AgentEvent, Session, EventType } from './types.js'

// =============================================================================
// Base Message Type
// =============================================================================

/**
 * Base WebSocket message envelope.
 * All messages conform to this structure.
 */
export interface WSMessage<T extends string = string, D = unknown> {
  /** Message type identifier */
  type: T
  /** Message payload */
  data?: D
}

// =============================================================================
// Server → Client Messages
// =============================================================================

/**
 * Initial state sent on WebSocket connection.
 */
export interface WSInitData {
  sessions: Session[]
}

export interface WSInitMessage extends WSMessage<'init', WSInitData> {
  type: 'init'
  data: WSInitData
}

/**
 * Agent event broadcast.
 */
export interface WSEventMessage extends WSMessage<'event', AgentEvent> {
  type: 'event'
  data: AgentEvent
}

/**
 * Session created notification.
 */
export interface WSSessionCreatedMessage extends WSMessage<'session:created', Session> {
  type: 'session:created'
  data: Session
}

/**
 * Session updated notification.
 */
export interface WSSessionUpdatedMessage extends WSMessage<'session:updated', Session> {
  type: 'session:updated'
  data: Session
}

/**
 * Session deleted notification.
 */
export interface WSSessionDeletedMessage extends WSMessage<'session:deleted', Session> {
  type: 'session:deleted'
  data: Session
}

/**
 * Session status changed notification.
 */
export interface WSSessionStatusMessage extends WSMessage<'session:status', Session> {
  type: 'session:status'
  data: Session
}

/**
 * Event history response.
 */
export interface WSHistoryMessage extends WSMessage<'history', AgentEvent[]> {
  type: 'history'
  data: AgentEvent[]
}

/**
 * Pong response to ping.
 */
export interface WSPongMessage extends WSMessage<'pong', undefined> {
  type: 'pong'
}

// =============================================================================
// Client → Server Messages
// =============================================================================

/**
 * Ping keep-alive.
 */
export interface WSPingMessage extends WSMessage<'ping', undefined> {
  type: 'ping'
}

/**
 * Request event history.
 */
export interface WSGetHistoryData {
  /** Max events to return (default: 100) */
  limit?: number
  /** Filter by session ID */
  sessionId?: string
}

export interface WSGetHistoryMessage extends WSMessage<'get_history', WSGetHistoryData> {
  type: 'get_history'
  data?: WSGetHistoryData
}

/**
 * Subscribe to specific events/sessions.
 */
export interface WSSubscribeData {
  /** Session IDs to subscribe to (empty = all) */
  sessions?: string[]
  /** Event types to subscribe to (empty = all) */
  eventTypes?: EventType[]
}

export interface WSSubscribeMessage extends WSMessage<'subscribe', WSSubscribeData> {
  type: 'subscribe'
  data?: WSSubscribeData
}

// =============================================================================
// Union Types
// =============================================================================

/**
 * All server → client message types.
 */
export type WSServerMessage =
  | WSInitMessage
  | WSEventMessage
  | WSSessionCreatedMessage
  | WSSessionUpdatedMessage
  | WSSessionDeletedMessage
  | WSSessionStatusMessage
  | WSHistoryMessage
  | WSPongMessage

/**
 * All client → server message types.
 */
export type WSClientMessage =
  | WSPingMessage
  | WSGetHistoryMessage
  | WSSubscribeMessage

/**
 * All WebSocket message types.
 */
export type WSAnyMessage = WSServerMessage | WSClientMessage

// =============================================================================
// Extension Types
// =============================================================================

/**
 * Extension message for implementation-specific features.
 * Use namespaced types: 'cin:feature', 'harness:feature', etc.
 */
export interface WSExtensionMessage<
  N extends string = string,
  F extends string = string,
  D = unknown
> extends WSMessage<`${N}:${F}`, D> {
  type: `${N}:${F}`
  data?: D
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a message is an init message.
 */
export function isInitMessage(msg: WSAnyMessage): msg is WSInitMessage {
  return msg.type === 'init'
}

/**
 * Check if a message is an event message.
 */
export function isEventMessage(msg: WSAnyMessage): msg is WSEventMessage {
  return msg.type === 'event'
}

/**
 * Check if a message is a session-related message.
 */
export function isSessionMessage(
  msg: WSAnyMessage
): msg is WSSessionCreatedMessage | WSSessionUpdatedMessage | WSSessionDeletedMessage | WSSessionStatusMessage {
  return msg.type.startsWith('session:')
}

/**
 * Check if a message is a history message.
 */
export function isHistoryMessage(msg: WSAnyMessage): msg is WSHistoryMessage {
  return msg.type === 'history'
}

/**
 * Check if a message is an extension message.
 */
export function isExtensionMessage(msg: WSMessage): msg is WSExtensionMessage {
  return msg.type.includes(':') && !msg.type.startsWith('session:')
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a typed WebSocket message.
 */
export function createMessage<T extends WSAnyMessage>(
  type: T['type'],
  data?: T extends WSMessage<string, infer D> ? D : never
): T {
  return { type, data } as T
}

/**
 * Parse a raw WebSocket message with type safety.
 */
export function parseMessage(raw: string): WSAnyMessage | null {
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.type === 'string') {
      return parsed as WSAnyMessage
    }
    return null
  } catch {
    return null
  }
}

/**
 * Regression tests for createBridge (issue #15)
 *
 * Verifies that createBridge returns a functional Bridge instance
 * instead of throwing "not yet implemented".
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createBridge } from '../src/index.js'
import type { Bridge } from '../src/types.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

describe('createBridge', () => {
  let bridge: Bridge | undefined

  afterEach(async () => {
    if (bridge) {
      await bridge.stop().catch(() => {})
      bridge = undefined
    }
  })

  it('should not throw when called (regression for #15)', () => {
    expect(() => {
      bridge = createBridge()
    }).not.toThrow()
  })

  it('should return a Bridge instance with all required methods', () => {
    bridge = createBridge()

    // Lifecycle
    expect(typeof bridge.start).toBe('function')
    expect(typeof bridge.stop).toBe('function')
    expect(typeof bridge.isRunning).toBe('function')

    // Sessions
    expect(typeof bridge.createSession).toBe('function')
    expect(typeof bridge.getSession).toBe('function')
    expect(typeof bridge.listSessions).toBe('function')
    expect(typeof bridge.deleteSession).toBe('function')
    expect(typeof bridge.updateSession).toBe('function')

    // Session control
    expect(typeof bridge.sendPrompt).toBe('function')
    expect(typeof bridge.cancel).toBe('function')
    expect(typeof bridge.restart).toBe('function')

    // Agents
    expect(typeof bridge.registerAgent).toBe('function')
    expect(typeof bridge.getAgent).toBe('function')
    expect(typeof bridge.listAgents).toBe('function')

    // Server
    expect(typeof bridge.listen).toBe('function')
    expect(typeof bridge.close).toBe('function')

    // Events
    expect(typeof bridge.on).toBe('function')
    expect(typeof bridge.off).toBe('function')
    expect(typeof bridge.once).toBe('function')

    // Config
    expect(bridge.config).toBeDefined()
  })

  it('should accept custom config', () => {
    const dataDir = join(tmpdir(), `bridge-test-${randomUUID()}`)
    bridge = createBridge({
      dataDir,
      port: 5555,
      defaultAgent: 'claude',
      debug: false,
    })

    expect(bridge.config.dataDir).toBe(dataDir)
    expect(bridge.config.port).toBe(5555)
    expect(bridge.config.defaultAgent).toBe('claude')
  })

  it('should apply default config when called with no arguments', () => {
    bridge = createBridge()

    expect(bridge.config.port).toBe(4003)
    expect(bridge.config.defaultAgent).toBe('claude')
    expect(bridge.config.trackExternalSessions).toBe(true)
    expect(bridge.config.maxEvents).toBe(1000)
  })

  it('should register default adapters', () => {
    bridge = createBridge()

    expect(bridge.getAgent('claude')).toBeDefined()
    expect(bridge.getAgent('codex')).toBeDefined()
    expect(bridge.listAgents().length).toBeGreaterThanOrEqual(2)
  })

  it('should not be running before start() is called', () => {
    bridge = createBridge()
    expect(bridge.isRunning()).toBe(false)
  })

  it('should start and stop without errors', async () => {
    const dataDir = join(tmpdir(), `bridge-test-${randomUUID()}`)
    bridge = createBridge({ dataDir, debug: false })

    await bridge.start()
    expect(bridge.isRunning()).toBe(true)

    await bridge.stop()
    expect(bridge.isRunning()).toBe(false)
  })

  it('should return empty session list initially', async () => {
    const dataDir = join(tmpdir(), `bridge-test-${randomUUID()}`)
    bridge = createBridge({ dataDir, debug: false })

    await bridge.start()
    expect(bridge.listSessions()).toEqual([])
  })

  it('should support event subscription', () => {
    bridge = createBridge()

    const handler = () => {}
    // Should not throw
    bridge.on('event', handler)
    bridge.off('event', handler)
  })
})

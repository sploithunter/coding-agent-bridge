/**
 * Integration tests for TmuxExecutor
 *
 * These tests require tmux to be installed and running.
 * They create real tmux sessions and verify the executor works correctly.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { TmuxExecutor } from '../src/TmuxExecutor.js'

describe('TmuxExecutor Integration', () => {
  let executor: TmuxExecutor
  let createdSessions: string[] = []

  beforeAll(async () => {
    executor = new TmuxExecutor({ debug: false })

    // Check if tmux is available
    const available = await executor.isAvailable()
    if (!available) {
      console.warn('tmux not available, skipping integration tests')
    }
  })

  afterEach(async () => {
    // Clean up any sessions created during tests
    for (const session of createdSessions) {
      try {
        await executor.killSession(session)
      } catch {
        // Ignore errors during cleanup
      }
    }
    createdSessions = []
  })

  afterAll(async () => {
    // Final cleanup
    for (const session of createdSessions) {
      try {
        await executor.killSession(session)
      } catch {
        // Ignore
      }
    }
  })

  describe('isAvailable', () => {
    it('should detect tmux availability', async () => {
      const available = await executor.isAvailable()
      // This test passes regardless - it just checks the method works
      expect(typeof available).toBe('boolean')
    })
  })

  describe('session operations', { timeout: 10000 }, () => {
    it('should create and kill a session', async () => {
      const available = await executor.isAvailable()
      if (!available) {
        console.log('Skipping: tmux not available')
        return
      }

      const sessionName = `test-${Date.now()}`
      createdSessions.push(sessionName)

      // Create session
      await executor.createSession(sessionName)

      // Verify it exists
      const exists = await executor.sessionExists(sessionName)
      expect(exists).toBe(true)

      // Kill session
      const killed = await executor.killSession(sessionName)
      expect(killed).toBe(true)

      // Verify it's gone
      const stillExists = await executor.sessionExists(sessionName)
      expect(stillExists).toBe(false)
    })

    it('should create session with working directory', async () => {
      const available = await executor.isAvailable()
      if (!available) {
        console.log('Skipping: tmux not available')
        return
      }

      const sessionName = `test-cwd-${Date.now()}`
      createdSessions.push(sessionName)

      await executor.createSession(sessionName, {
        cwd: '/tmp',
      })

      const exists = await executor.sessionExists(sessionName)
      expect(exists).toBe(true)
    })

    it('should create session with command', async () => {
      const available = await executor.isAvailable()
      if (!available) {
        console.log('Skipping: tmux not available')
        return
      }

      const sessionName = `test-cmd-${Date.now()}`
      createdSessions.push(sessionName)

      await executor.createSession(sessionName, {
        command: 'echo "hello"',
      })

      const exists = await executor.sessionExists(sessionName)
      expect(exists).toBe(true)
    })

    it('should fail to create duplicate session', async () => {
      const available = await executor.isAvailable()
      if (!available) {
        console.log('Skipping: tmux not available')
        return
      }

      const sessionName = `test-dup-${Date.now()}`
      createdSessions.push(sessionName)

      await executor.createSession(sessionName)

      await expect(executor.createSession(sessionName)).rejects.toThrow(/already exists/)
    })

    it('should list sessions', async () => {
      const available = await executor.isAvailable()
      if (!available) {
        console.log('Skipping: tmux not available')
        return
      }

      const sessionName = `test-list-${Date.now()}`
      createdSessions.push(sessionName)

      await executor.createSession(sessionName)

      const sessions = await executor.listSessions()
      const found = sessions.find((s) => s.name === sessionName)
      expect(found).toBeDefined()
      expect(found?.windows).toBeGreaterThanOrEqual(1)
    })
  })

  describe('sendKeys and pasteBuffer', { timeout: 10000 }, () => {
    it('should send keys to a session', async () => {
      const available = await executor.isAvailable()
      if (!available) {
        console.log('Skipping: tmux not available')
        return
      }

      const sessionName = `test-keys-${Date.now()}`
      createdSessions.push(sessionName)

      await executor.createSession(sessionName)

      // Send some keys (won't error if session exists)
      await executor.sendKeys({
        target: sessionName,
        keys: 'echo test',
      })

      // Just verify it doesn't throw
      expect(true).toBe(true)
    })

    it('should paste text via buffer', async () => {
      const available = await executor.isAvailable()
      if (!available) {
        console.log('Skipping: tmux not available')
        return
      }

      const sessionName = `test-paste-${Date.now()}`
      createdSessions.push(sessionName)

      await executor.createSession(sessionName)

      // Paste some text
      await executor.pasteBuffer({
        target: sessionName,
        text: 'hello world',
        sendEnter: false,
      })

      // Just verify it doesn't throw
      expect(true).toBe(true)
    })

    it('should send Ctrl+C', async () => {
      const available = await executor.isAvailable()
      if (!available) {
        console.log('Skipping: tmux not available')
        return
      }

      const sessionName = `test-ctrlc-${Date.now()}`
      createdSessions.push(sessionName)

      await executor.createSession(sessionName)

      // Send Ctrl+C
      await executor.sendCtrlC(sessionName)

      // Just verify it doesn't throw
      expect(true).toBe(true)
    })
  })

  describe('capturePane', { timeout: 10000 }, () => {
    it('should capture pane content', async () => {
      const available = await executor.isAvailable()
      if (!available) {
        console.log('Skipping: tmux not available')
        return
      }

      const sessionName = `test-capture-${Date.now()}`
      createdSessions.push(sessionName)

      await executor.createSession(sessionName)

      // Send a command that produces output
      await executor.sendKeys({
        target: sessionName,
        keys: 'echo "CAPTURE_TEST_OUTPUT"',
      })
      await executor.sendKeys({
        target: sessionName,
        keys: 'Enter',
      })

      // Wait a bit for the command to execute
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Capture the pane
      const content = await executor.capturePane(sessionName)

      // The content should contain our test string
      expect(content).toContain('CAPTURE_TEST_OUTPUT')
    })
  })
})

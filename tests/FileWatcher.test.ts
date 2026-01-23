/**
 * Unit tests for FileWatcher
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FileWatcher } from '../src/FileWatcher.js'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdir, rm, writeFile, appendFile } from 'fs/promises'
import { randomUUID } from 'crypto'

describe('FileWatcher', () => {
  let testDir: string
  let testFile: string
  let watcher: FileWatcher

  beforeEach(async () => {
    testDir = join(tmpdir(), `filewatcher-test-${randomUUID()}`)
    await mkdir(testDir, { recursive: true })
    testFile = join(testDir, 'events.jsonl')
  })

  afterEach(async () => {
    if (watcher) {
      await watcher.stop()
    }
    await rm(testDir, { recursive: true, force: true })
  })

  describe('constructor', () => {
    it('should create watcher with default options', () => {
      watcher = new FileWatcher(testFile)
      expect(watcher.filePath).toBe(testFile)
    })

    it('should create watcher with custom options', () => {
      watcher = new FileWatcher(testFile, {
        pollIntervalMs: 500,
        processExisting: true,
        debug: true,
      })
      expect(watcher.filePath).toBe(testFile)
    })
  })

  describe('start', () => {
    it('should emit ready event', async () => {
      watcher = new FileWatcher(testFile)
      const readyPromise = new Promise<void>((resolve) => {
        watcher.once('ready', resolve)
      })

      await watcher.start()
      await readyPromise

      expect(true).toBe(true)
    })

    it('should start from end of file by default', async () => {
      // Write some existing content
      await writeFile(testFile, 'existing line\n')

      watcher = new FileWatcher(testFile)
      const lines: string[] = []
      watcher.on('line', (line) => lines.push(line))

      await watcher.start()

      // Wait a bit for any potential processing
      await new Promise((r) => setTimeout(r, 100))

      // Should not have processed existing content
      expect(lines.length).toBe(0)
    })

    it('should process existing content when processExisting is true', async () => {
      // Write some existing content
      await writeFile(testFile, 'line1\nline2\n')

      watcher = new FileWatcher(testFile, { processExisting: true })
      const lines: string[] = []
      watcher.on('line', (line) => lines.push(line))

      await watcher.start()

      // Wait for processing
      await new Promise((r) => setTimeout(r, 200))

      expect(lines).toContain('line1')
      expect(lines).toContain('line2')
    })

    it('should handle non-existent file', async () => {
      const nonExistent = join(testDir, 'nonexistent.jsonl')
      watcher = new FileWatcher(nonExistent)

      // Should not throw
      await watcher.start()

      expect(watcher.getPosition()).toBe(0)
    })
  })

  describe('watching for changes', () => {
    it('should emit line event for new lines', async () => {
      // Create empty file
      await writeFile(testFile, '')

      watcher = new FileWatcher(testFile)
      const lines: string[] = []
      watcher.on('line', (line) => lines.push(line))

      await watcher.start()

      // Append new content
      await appendFile(testFile, '{"event": "test1"}\n')

      // Wait for detection (polling fallback)
      await new Promise((r) => setTimeout(r, 1500))

      expect(lines).toContain('{"event": "test1"}')
    })

    it('should emit multiple line events', async () => {
      await writeFile(testFile, '')

      watcher = new FileWatcher(testFile, { pollIntervalMs: 100 })
      const lines: string[] = []
      watcher.on('line', (line) => lines.push(line))

      await watcher.start()

      // Append multiple lines
      await appendFile(testFile, 'line1\nline2\nline3\n')

      // Wait for detection
      await new Promise((r) => setTimeout(r, 500))

      expect(lines.length).toBe(3)
      expect(lines).toContain('line1')
      expect(lines).toContain('line2')
      expect(lines).toContain('line3')
    })

    it('should handle incomplete lines', async () => {
      await writeFile(testFile, '')

      watcher = new FileWatcher(testFile, { pollIntervalMs: 100 })
      const lines: string[] = []
      watcher.on('line', (line) => lines.push(line))

      await watcher.start()

      // Append incomplete line
      await appendFile(testFile, 'incomplete')

      await new Promise((r) => setTimeout(r, 200))

      // Should not emit yet
      expect(lines.length).toBe(0)

      // Complete the line
      await appendFile(testFile, ' line\n')

      await new Promise((r) => setTimeout(r, 200))

      expect(lines).toContain('incomplete line')
    })
  })

  describe('stop', () => {
    it('should emit close event', async () => {
      watcher = new FileWatcher(testFile)
      await watcher.start()

      const closePromise = new Promise<void>((resolve) => {
        watcher.once('close', resolve)
      })

      await watcher.stop()
      await closePromise

      expect(true).toBe(true)
    })

    it('should stop emitting events after stop', async () => {
      await writeFile(testFile, '')

      watcher = new FileWatcher(testFile, { pollIntervalMs: 100 })
      const lines: string[] = []
      watcher.on('line', (line) => lines.push(line))

      await watcher.start()
      await watcher.stop()

      // Append content after stop
      await appendFile(testFile, 'should not see this\n')

      await new Promise((r) => setTimeout(r, 300))

      expect(lines.length).toBe(0)
    })
  })

  describe('getPosition', () => {
    it('should return current file position', async () => {
      await writeFile(testFile, 'line1\nline2\n')

      watcher = new FileWatcher(testFile)
      await watcher.start()

      // Position should be at end
      expect(watcher.getPosition()).toBe(12) // "line1\nline2\n" = 12 bytes
    })

    it('should return 0 for processExisting before read', async () => {
      await writeFile(testFile, 'content')

      watcher = new FileWatcher(testFile, { processExisting: true })

      // Before starting, position should be 0
      expect(watcher.getPosition()).toBe(0)
    })
  })

  describe('triggerRead', () => {
    it('should manually trigger a read', async () => {
      await writeFile(testFile, '')

      watcher = new FileWatcher(testFile, { pollIntervalMs: 10000 }) // Long poll interval
      const lines: string[] = []
      watcher.on('line', (line) => lines.push(line))

      await watcher.start()

      // Append content
      await appendFile(testFile, 'manual trigger\n')

      // Manually trigger read
      await watcher.triggerRead()

      expect(lines).toContain('manual trigger')
    })
  })

  describe('error handling', () => {
    it('should emit error events', async () => {
      watcher = new FileWatcher(testFile)
      await watcher.start()

      const errorPromise = new Promise<Error>((resolve) => {
        watcher.once('error', resolve)
      })

      // Manually emit error to test handler
      watcher.emit('error', new Error('test error'))

      const error = await errorPromise
      expect(error.message).toBe('test error')
    })
  })
})

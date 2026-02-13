/**
 * Unit tests for TranscriptWatcher
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TranscriptWatcher } from '../src/TranscriptWatcher.js'
import { ClaudeAdapter } from '../src/adapters/ClaudeAdapter.js'
import { CodexAdapter } from '../src/adapters/CodexAdapter.js'
import { writeFileSync, mkdirSync, appendFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

describe('TranscriptWatcher', () => {
  let tempDir: string
  let transcriptFile: string
  let watcher: TranscriptWatcher

  beforeEach(() => {
    tempDir = join(tmpdir(), `transcript-test-${randomUUID().slice(0, 8)}`)
    mkdirSync(tempDir, { recursive: true })
    transcriptFile = join(tempDir, 'transcript.jsonl')
    // Create the file so FileWatcher can open it
    writeFileSync(transcriptFile, '')
  })

  afterEach(async () => {
    if (watcher) {
      await watcher.stop()
    }
    try {
      if (existsSync(transcriptFile)) {
        unlinkSync(transcriptFile)
      }
    } catch { /* ignore */ }
  })

  describe('constructor', () => {
    it('should create watcher with file path and adapter', () => {
      watcher = new TranscriptWatcher(transcriptFile, ClaudeAdapter)
      expect(watcher).toBeInstanceOf(TranscriptWatcher)
      expect(watcher.filePath).toBe(transcriptFile)
    })
  })

  describe('message events', () => {
    it('should emit message event for assistant transcript entries', async () => {
      watcher = new TranscriptWatcher(transcriptFile, ClaudeAdapter)
      await watcher.start()

      const messagePromise = new Promise<Record<string, unknown>>((resolve) => {
        watcher.on('message', (event) => {
          resolve(event as unknown as Record<string, unknown>)
        })
      })

      // Append an assistant entry
      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-123',
          content: [
            { type: 'text', text: 'Hello, world!' },
          ],
        },
        requestId: 'req-001',
      }
      appendFileSync(transcriptFile, JSON.stringify(entry) + '\n')

      // Wait for event with timeout
      const event = await Promise.race([
        messagePromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])

      expect(event).not.toBeNull()
      expect(event?.type).toBe('assistant_message')
      expect(event?.content).toHaveLength(1)
      expect((event?.content as Array<Record<string, unknown>>)?.[0]?.text).toBe('Hello, world!')
    })

    it('should skip non-assistant entries', async () => {
      watcher = new TranscriptWatcher(transcriptFile, ClaudeAdapter)
      await watcher.start()

      const messageHandler = vi.fn()
      watcher.on('message', messageHandler)

      // Append non-assistant entries
      const entries = [
        { type: 'user', message: { content: 'Hello' } },
        { type: 'system', message: { content: 'System prompt' } },
        { type: 'progress', content: 'Loading...' },
      ]

      for (const entry of entries) {
        appendFileSync(transcriptFile, JSON.stringify(entry) + '\n')
      }

      // Wait a bit for processing
      await new Promise((resolve) => setTimeout(resolve, 2000))

      expect(messageHandler).not.toHaveBeenCalled()
    })

    it('should deduplicate by requestId', async () => {
      watcher = new TranscriptWatcher(transcriptFile, ClaudeAdapter)
      await watcher.start()

      const messages: unknown[] = []
      watcher.on('message', (event) => {
        messages.push(event)
      })

      // Append the same requestId twice
      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-dup',
          content: [{ type: 'text', text: 'Duplicate' }],
        },
        requestId: 'req-dup',
      }

      appendFileSync(transcriptFile, JSON.stringify(entry) + '\n')
      appendFileSync(transcriptFile, JSON.stringify(entry) + '\n')

      await new Promise((resolve) => setTimeout(resolve, 2000))

      expect(messages.length).toBe(1)
    })

    it('should handle entries with thinking blocks', async () => {
      watcher = new TranscriptWatcher(transcriptFile, ClaudeAdapter)
      await watcher.start()

      const messagePromise = new Promise<Record<string, unknown>>((resolve) => {
        watcher.on('message', (event) => {
          resolve(event as unknown as Record<string, unknown>)
        })
      })

      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-think',
          content: [
            { type: 'thinking', text: 'Let me think about this...' },
            { type: 'text', text: 'Here is my answer.' },
          ],
        },
        requestId: 'req-think',
      }
      appendFileSync(transcriptFile, JSON.stringify(entry) + '\n')

      const event = await Promise.race([
        messagePromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])

      expect(event).not.toBeNull()
      const content = event?.content as Array<Record<string, unknown>>
      expect(content).toHaveLength(2)
      expect(content?.[0]?.type).toBe('thinking')
      expect(content?.[1]?.type).toBe('text')
    })

    it('should handle entries with tool_use blocks', async () => {
      watcher = new TranscriptWatcher(transcriptFile, ClaudeAdapter)
      await watcher.start()

      const messagePromise = new Promise<Record<string, unknown>>((resolve) => {
        watcher.on('message', (event) => {
          resolve(event as unknown as Record<string, unknown>)
        })
      })

      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-tool',
          content: [
            { type: 'text', text: 'Let me read that file.' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/test.txt' }, id: 'tu-123' },
          ],
        },
        requestId: 'req-tool',
      }
      appendFileSync(transcriptFile, JSON.stringify(entry) + '\n')

      const event = await Promise.race([
        messagePromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])

      expect(event).not.toBeNull()
      const content = event?.content as Array<Record<string, unknown>>
      expect(content).toHaveLength(2)
      expect(content?.[1]?.type).toBe('tool_use')
      expect(content?.[1]?.toolName).toBe('Read')
      expect(content?.[1]?.toolUseId).toBe('tu-123')
    })
  })

  describe('with Codex adapter', () => {
    it('should not emit events since Codex parseTranscriptEntry returns null', async () => {
      watcher = new TranscriptWatcher(transcriptFile, CodexAdapter)
      await watcher.start()

      const messageHandler = vi.fn()
      watcher.on('message', messageHandler)

      const entry = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello' }] },
      }
      appendFileSync(transcriptFile, JSON.stringify(entry) + '\n')

      await new Promise((resolve) => setTimeout(resolve, 2000))

      expect(messageHandler).not.toHaveBeenCalled()
    })
  })

  describe('preamble detection', () => {
    it('should detect whitespace-only text as preamble', async () => {
      watcher = new TranscriptWatcher(transcriptFile, ClaudeAdapter)
      await watcher.start()

      const messagePromise = new Promise<Record<string, unknown>>((resolve) => {
        watcher.on('message', (event) => {
          resolve(event as unknown as Record<string, unknown>)
        })
      })

      const entry = {
        type: 'assistant',
        message: {
          id: 'msg-pre',
          content: [{ type: 'text', text: '   \n  ' }],
        },
        requestId: 'req-pre',
      }
      appendFileSync(transcriptFile, JSON.stringify(entry) + '\n')

      const event = await Promise.race([
        messagePromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ])

      expect(event).not.toBeNull()
      expect(event?.isPreamble).toBe(true)
    })
  })
})

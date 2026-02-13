/**
 * TranscriptWatcher - Watches agent transcript JSONL files for assistant messages
 *
 * Composes FileWatcher internally to tail transcript files. Parses each line as JSON,
 * filters to assistant entries, and delegates to the adapter's parseTranscriptEntry()
 * for agent-specific parsing.
 */

import { EventEmitter } from 'events'
import { FileWatcher } from './FileWatcher.js'
import type { AgentAdapter, AssistantMessageEvent } from './types.js'

export interface TranscriptWatcherOptions {
  /** Enable debug logging */
  debug?: boolean
}

export interface TranscriptWatcherEvents {
  message: [event: Partial<AssistantMessageEvent>]
  error: [error: Error]
  close: []
}

export class TranscriptWatcher extends EventEmitter {
  readonly filePath: string
  private fileWatcher: FileWatcher
  private adapter: AgentAdapter
  private seenRequestIds: Set<string> = new Set()
  private options: Required<TranscriptWatcherOptions>
  private closed = false

  constructor(
    filePath: string,
    adapter: AgentAdapter,
    options: TranscriptWatcherOptions = {}
  ) {
    super()
    this.filePath = filePath
    this.adapter = adapter
    this.options = {
      debug: options.debug ?? false,
    }

    // Compose FileWatcher - start from end of file (no history replay)
    this.fileWatcher = new FileWatcher(filePath, {
      processExisting: false,
      debug: options.debug,
    })

    // Listen for new lines
    this.fileWatcher.on('line', (line: string) => {
      this.processLine(line)
    })

    this.fileWatcher.on('error', (err: Error) => {
      this.emit('error', err)
    })

    this.fileWatcher.on('close', () => {
      this.emit('close')
    })
  }

  /**
   * Start watching the transcript file.
   */
  async start(): Promise<void> {
    if (this.closed) return
    this.debug('Starting transcript watcher for:', this.filePath)
    await this.fileWatcher.start()
  }

  /**
   * Stop watching the transcript file.
   */
  async stop(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.debug('Stopping transcript watcher')
    await this.fileWatcher.stop()
  }

  /**
   * Process a single line from the transcript file.
   */
  private processLine(line: string): void {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>

      // Only process assistant entries
      if (entry.type !== 'assistant') {
        return
      }

      // Delegate to adapter's parseTranscriptEntry if available
      if (!this.adapter.parseTranscriptEntry) {
        return
      }

      const event = this.adapter.parseTranscriptEntry(entry)
      if (!event) {
        return
      }

      // Deduplicate by requestId
      if (event.requestId) {
        if (this.seenRequestIds.has(event.requestId)) {
          this.debug('Skipping duplicate requestId:', event.requestId)
          return
        }
        this.seenRequestIds.add(event.requestId)
      }

      this.debug('Emitting assistant message event')
      this.emit('message', event)
    } catch {
      // Skip unparseable lines silently - transcript may contain non-JSON lines
    }
  }

  private debug(...args: unknown[]): void {
    if (this.options.debug) {
      console.log('[TranscriptWatcher]', ...args)
    }
  }
}

/**
 * Create a new TranscriptWatcher instance.
 */
export function createTranscriptWatcher(
  filePath: string,
  adapter: AgentAdapter,
  options?: TranscriptWatcherOptions
): TranscriptWatcher {
  return new TranscriptWatcher(filePath, adapter, options)
}

/**
 * FileWatcher - Watches events.jsonl for new events
 *
 * Uses fs.watch() to detect changes and reads new lines appended to the file.
 * Provides an EventEmitter interface for reacting to new events.
 */

import { EventEmitter } from 'events'
import { watch, FSWatcher, statSync, readFileSync, existsSync } from 'fs'
import { open, FileHandle } from 'fs/promises'

export interface FileWatcherOptions {
  /** Polling interval in ms for file size check fallback */
  pollIntervalMs?: number
  /** Whether to process existing events on start */
  processExisting?: boolean
  /** Enable debug logging */
  debug?: boolean
}

export interface FileWatcherEvents {
  line: [line: string]
  error: [error: Error]
  ready: []
  close: []
}

export class FileWatcher extends EventEmitter {
  readonly filePath: string
  private options: Required<FileWatcherOptions>
  private watcher: FSWatcher | null = null
  private fileHandle: FileHandle | null = null
  private position: number = 0
  private pollTimer: NodeJS.Timeout | null = null
  private isProcessing: boolean = false
  private buffer: string = ''
  private closed: boolean = false

  constructor(filePath: string, options: FileWatcherOptions = {}) {
    super()
    this.filePath = filePath
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? 1000,
      processExisting: options.processExisting ?? false,
      debug: options.debug ?? false,
    }
  }

  /**
   * Start watching the file for changes
   */
  async start(): Promise<void> {
    if (this.watcher || this.closed) {
      return
    }

    this.debug('Starting file watcher for:', this.filePath)

    // Initialize position
    if (existsSync(this.filePath)) {
      const stats = statSync(this.filePath)

      if (this.options.processExisting) {
        // Start from beginning to process existing events
        this.position = 0
      } else {
        // Start from end to only get new events
        this.position = stats.size
      }

      this.debug('Initial position:', this.position, 'file size:', stats.size)
    } else {
      this.position = 0
      this.debug('File does not exist yet, will watch for creation')
    }

    // Open file handle for reading
    await this.ensureFileHandle()

    // Start fs.watch
    try {
      this.watcher = watch(this.filePath, (eventType) => {
        if (eventType === 'change') {
          this.scheduleRead()
        }
      })

      this.watcher.on('error', (err) => {
        this.debug('Watcher error:', err.message)
        this.emit('error', err)
        // Try to recover by restarting
        this.restartWatcher()
      })
    } catch (err) {
      // File might not exist yet, use polling
      this.debug('Could not watch file, using polling:', (err as Error).message)
    }

    // Also use polling as fallback (some systems don't fire watch events reliably)
    this.pollTimer = setInterval(() => {
      this.scheduleRead()
    }, this.options.pollIntervalMs)

    // Process existing events if requested
    if (this.options.processExisting && existsSync(this.filePath)) {
      await this.readNewLines()
    }

    this.emit('ready')
  }

  /**
   * Stop watching the file
   */
  async stop(): Promise<void> {
    if (this.closed) {
      return
    }

    this.closed = true
    this.debug('Stopping file watcher')

    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }

    if (this.fileHandle) {
      await this.fileHandle.close()
      this.fileHandle = null
    }

    this.emit('close')
  }

  /**
   * Get current file position
   */
  getPosition(): number {
    return this.position
  }

  /**
   * Manually trigger a read (useful for testing)
   */
  async triggerRead(): Promise<void> {
    await this.readNewLines()
  }

  private async ensureFileHandle(): Promise<void> {
    if (this.fileHandle) {
      return
    }

    if (!existsSync(this.filePath)) {
      return
    }

    try {
      this.fileHandle = await open(this.filePath, 'r')
      this.debug('Opened file handle')
    } catch (err) {
      this.debug('Could not open file:', (err as Error).message)
    }
  }

  private scheduleRead(): void {
    // Debounce reads
    if (!this.isProcessing) {
      this.isProcessing = true
      setImmediate(async () => {
        try {
          await this.readNewLines()
        } finally {
          this.isProcessing = false
        }
      })
    }
  }

  private async readNewLines(): Promise<void> {
    if (this.closed) {
      return
    }

    // Ensure we have a file handle
    await this.ensureFileHandle()

    if (!this.fileHandle) {
      // File doesn't exist yet
      return
    }

    try {
      // Get current file size
      const stats = await this.fileHandle.stat()
      const fileSize = stats.size

      if (fileSize <= this.position) {
        // No new data (or file was truncated)
        if (fileSize < this.position) {
          // File was truncated/rotated, reset position
          this.debug('File was truncated, resetting position')
          this.position = 0
          this.buffer = ''
        }
        return
      }

      // Read new data
      const bytesToRead = fileSize - this.position
      const buffer = Buffer.alloc(bytesToRead)

      const { bytesRead } = await this.fileHandle.read(
        buffer,
        0,
        bytesToRead,
        this.position
      )

      if (bytesRead > 0) {
        this.position += bytesRead
        const chunk = buffer.toString('utf8', 0, bytesRead)
        this.processChunk(chunk)
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error.code === 'ENOENT') {
        // File was deleted, reset
        this.debug('File was deleted, resetting')
        this.position = 0
        this.buffer = ''
        if (this.fileHandle) {
          await this.fileHandle.close()
          this.fileHandle = null
        }
      } else {
        this.emit('error', err as Error)
      }
    }
  }

  private processChunk(chunk: string): void {
    // Add to buffer
    this.buffer += chunk

    // Process complete lines
    const lines = this.buffer.split('\n')

    // Keep incomplete last line in buffer
    this.buffer = lines.pop() || ''

    // Emit complete lines
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        this.debug('Emitting line:', trimmed.substring(0, 100))
        this.emit('line', trimmed)
      }
    }
  }

  private restartWatcher(): void {
    if (this.closed) {
      return
    }

    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }

    // Try to restart after a short delay
    setTimeout(() => {
      if (this.closed) {
        return
      }

      try {
        this.watcher = watch(this.filePath, (eventType) => {
          if (eventType === 'change') {
            this.scheduleRead()
          }
        })

        this.watcher.on('error', (err) => {
          this.debug('Watcher error:', err.message)
          this.emit('error', err)
          this.restartWatcher()
        })

        this.debug('Watcher restarted')
      } catch (err) {
        this.debug('Could not restart watcher:', (err as Error).message)
      }
    }, 1000)
  }

  private debug(...args: unknown[]): void {
    if (this.options.debug) {
      console.log('[FileWatcher]', ...args)
    }
  }
}

/**
 * Create a new FileWatcher instance
 */
export function createFileWatcher(
  filePath: string,
  options?: FileWatcherOptions
): FileWatcher {
  return new FileWatcher(filePath, options)
}

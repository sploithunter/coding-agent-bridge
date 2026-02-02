/**
 * TmuxExecutor - Safe tmux command execution
 *
 * Provides a secure interface for executing tmux commands with proper
 * validation to prevent command injection attacks.
 */

import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

const execAsync = promisify(exec)

// =============================================================================
// Validation
// =============================================================================

/**
 * Characters that are dangerous in shell commands.
 */
const DANGEROUS_CHARS = /[;&|`$(){}[\]<>\\'"!#*?\n\r]/

/**
 * Valid tmux session name pattern.
 */
const VALID_SESSION_NAME = /^[a-zA-Z0-9_-]+$/

/**
 * Valid tmux pane ID pattern.
 */
const VALID_PANE_ID = /^%\d+$/

/**
 * Validate a tmux session name.
 * @throws Error if the name contains invalid characters
 */
export function validateSessionName(name: string): void {
  if (!name || !VALID_SESSION_NAME.test(name)) {
    throw new Error(
      `Invalid session name: "${name}". Only alphanumeric, underscore, and hyphen allowed.`
    )
  }
}

/**
 * Validate a directory path for safety.
 * @throws Error if the path contains dangerous characters
 */
export function validatePath(path: string): void {
  if (!path) {
    throw new Error('Path cannot be empty')
  }
  if (DANGEROUS_CHARS.test(path)) {
    throw new Error(
      `Invalid path: "${path}". Contains potentially dangerous characters.`
    )
  }
}

/**
 * Validate a tmux pane ID.
 * @throws Error if the pane ID is invalid
 */
export function validatePaneId(paneId: string): void {
  if (!paneId || !VALID_PANE_ID.test(paneId)) {
    throw new Error(
      `Invalid pane ID: "${paneId}". Must be in format %N (e.g., %0, %1).`
    )
  }
}

// =============================================================================
// Types
// =============================================================================

export interface TmuxSession {
  name: string
  windows: number
  created: Date
  attached: boolean
}

export interface TmuxExecutorOptions {
  /** Enable debug logging */
  debug?: boolean
  /** Custom logger */
  logger?: (message: string) => void
  /** Default terminal emulator for spawning visible terminals (auto-detect if not specified) */
  terminalEmulator?: string
}

export interface SendKeysOptions {
  /** Target session or pane */
  target: string
  /** Keys to send */
  keys: string
  /** Whether target is a pane ID (requires socket) */
  isPaneId?: boolean
  /** tmux socket path (required for pane IDs) */
  socket?: string
}

export interface PasteBufferOptions {
  /** Target session or pane */
  target: string
  /** Text to paste */
  text: string
  /** Whether target is a pane ID */
  isPaneId?: boolean
  /** tmux socket path (required for pane IDs) */
  socket?: string
  /** Whether to send Enter after pasting */
  sendEnter?: boolean
}

// =============================================================================
// TmuxExecutor Class
// =============================================================================

/**
 * Safe executor for tmux commands.
 */
export class TmuxExecutor {
  private debug: boolean
  private log: (message: string) => void
  private terminalEmulator?: string

  constructor(options: TmuxExecutorOptions = {}) {
    this.debug = options.debug ?? false
    this.log = options.logger ?? ((msg) => console.log(`[TmuxExecutor] ${msg}`))
    this.terminalEmulator = options.terminalEmulator
  }

  /**
   * Check if tmux is available on the system.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which tmux')
      return true
    } catch {
      return false
    }
  }

  /**
   * List all tmux sessions.
   */
  async listSessions(): Promise<TmuxSession[]> {
    try {
      const { stdout } = await execAsync(
        'tmux list-sessions -F "#{session_name}|#{session_windows}|#{session_created}|#{session_attached}"'
      )

      return stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const [name, windows, created, attached] = line.split('|')
          return {
            name: name ?? '',
            windows: parseInt(windows ?? '0', 10),
            created: new Date(parseInt(created ?? '0', 10) * 1000),
            attached: attached === '1',
          }
        })
    } catch (error) {
      // No sessions or tmux not running
      if (this.debug) {
        this.log(`listSessions error: ${error}`)
      }
      return []
    }
  }

  /**
   * Check if a session exists.
   */
  async sessionExists(name: string): Promise<boolean> {
    validateSessionName(name)
    try {
      await execAsync(`tmux has-session -t ${name}`)
      return true
    } catch {
      return false
    }
  }

  /**
   * Create a new tmux session.
   *
   * Uses a two-step approach:
   * 1. Create empty session with `new-session`
   * 2. Send command with `send-keys`
   *
   * This keeps the session alive even if the command exits.
   */
  async createSession(
    name: string,
    options: {
      cwd?: string
      command?: string
      width?: number
      height?: number
    } = {}
  ): Promise<void> {
    validateSessionName(name)
    if (options.cwd) {
      validatePath(options.cwd)
    }

    // Check if session already exists
    if (await this.sessionExists(name)) {
      throw new Error(`Session "${name}" already exists`)
    }

    // Build the new-session command
    const args = ['new-session', '-d', '-s', name]

    if (options.cwd) {
      args.push('-c', options.cwd)
    }

    if (options.width && options.height) {
      args.push('-x', String(options.width), '-y', String(options.height))
    }

    if (this.debug) {
      this.log(`Creating session: tmux ${args.join(' ')}`)
    }

    // Create the session
    await this.execTmux(args)

    // If a command was provided, send it
    if (options.command) {
      // Small delay to ensure session is ready
      await this.sleep(100)
      await this.sendKeys({
        target: name,
        keys: options.command,
      })
      await this.sendKeys({
        target: name,
        keys: 'Enter',
      })
    }
  }

  /**
   * Kill a tmux session.
   */
  async killSession(name: string): Promise<boolean> {
    validateSessionName(name)

    if (!(await this.sessionExists(name))) {
      return false
    }

    try {
      await this.execTmux(['kill-session', '-t', name])
      return true
    } catch (error) {
      if (this.debug) {
        this.log(`killSession error: ${error}`)
      }
      return false
    }
  }

  /**
   * Send keys to a session or pane.
   */
  async sendKeys(options: SendKeysOptions): Promise<void> {
    const { target, keys, isPaneId, socket } = options

    if (isPaneId) {
      validatePaneId(target)
      if (!socket) {
        throw new Error('Socket path required for pane targets')
      }
    } else {
      validateSessionName(target)
    }

    const args: string[] = []

    if (socket && isPaneId) {
      args.push('-S', socket)
    }

    args.push('send-keys', '-t', target, keys)

    if (this.debug) {
      this.log(`Sending keys: tmux ${args.join(' ')}`)
    }

    await this.execTmux(args)
  }

  /**
   * Send text via paste buffer.
   *
   * This is the safe way to send multi-line or complex text to a session.
   * Uses a temporary file to avoid shell escaping issues.
   */
  async pasteBuffer(options: PasteBufferOptions): Promise<void> {
    const { target, text, isPaneId, socket, sendEnter = true } = options

    if (isPaneId) {
      validatePaneId(target)
      if (!socket) {
        throw new Error('Socket path required for pane targets')
      }
    } else {
      validateSessionName(target)
    }

    // Create a unique temporary file
    const tmpDir = await mkdtemp(join(tmpdir(), 'tmux-bridge-'))
    const tmpFile = join(tmpDir, `prompt-${randomBytes(8).toString('hex')}.txt`)

    try {
      // Write text to temp file
      await writeFile(tmpFile, text, 'utf8')

      // Load into tmux paste buffer
      const loadArgs: string[] = []
      if (socket && isPaneId) {
        loadArgs.push('-S', socket)
      }
      loadArgs.push('load-buffer', tmpFile)

      if (this.debug) {
        this.log(`Loading buffer: tmux ${loadArgs.join(' ')}`)
      }

      await this.execTmux(loadArgs)

      // Paste to target
      const pasteArgs: string[] = []
      if (socket && isPaneId) {
        pasteArgs.push('-S', socket)
      }
      pasteArgs.push('paste-buffer', '-t', target)

      if (this.debug) {
        this.log(`Pasting buffer: tmux ${pasteArgs.join(' ')}`)
      }

      await this.execTmux(pasteArgs)

      // Send Enter if requested
      if (sendEnter) {
        // Wait longer for Claude Code to process the paste, especially for long prompts
        // 100ms was too short and caused race conditions where Enter was sent before
        // the terminal processed the pasted text
        await this.sleep(500)
        await this.sendKeys({
          target,
          keys: 'Enter',
          isPaneId,
          socket,
        })
      }
    } finally {
      // Clean up temp file
      try {
        await unlink(tmpFile)
        // Try to remove the temp directory too
        await unlink(tmpDir).catch(() => {})
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Send Ctrl+C to cancel current operation.
   */
  async sendCtrlC(target: string, isPaneId = false, socket?: string): Promise<void> {
    await this.sendKeys({
      target,
      keys: 'C-c',
      isPaneId,
      socket,
    })
  }

  /**
   * Capture pane content.
   */
  async capturePane(
    target: string,
    options: {
      start?: number
      end?: number
      isPaneId?: boolean
      socket?: string
    } = {}
  ): Promise<string> {
    const { start = -100, end, isPaneId, socket } = options

    if (isPaneId) {
      validatePaneId(target)
    } else {
      validateSessionName(target)
    }

    const args: string[] = []

    if (socket && isPaneId) {
      args.push('-S', socket)
    }

    args.push('capture-pane', '-t', target, '-p', '-S', String(start))

    if (end !== undefined) {
      args.push('-E', String(end))
    }

    const { stdout } = await this.execTmux(args, true)
    return stdout
  }

  /**
   * Execute a tmux command safely.
   */
  private async execTmux(
    args: string[],
    captureOutput = false
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tmux', args, {
        stdio: captureOutput ? 'pipe' : ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('error', (error) => {
        reject(new Error(`Failed to execute tmux: ${error.message}`))
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr })
        } else {
          reject(new Error(`tmux exited with code ${code}: ${stderr}`))
        }
      })
    })
  }

  /**
   * Sleep for a given number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Detect available terminal emulator on Linux.
   */
  async detectTerminalEmulator(): Promise<string | null> {
    if (this.terminalEmulator) {
      return this.terminalEmulator
    }

    // Try common Linux terminal emulators in order of preference
    const terminals = [
      'gnome-terminal',
      'konsole',
      'xfce4-terminal',
      'xterm',
      'alacritty',
      'kitty',
      'terminator',
    ]

    for (const terminal of terminals) {
      try {
        await execAsync(`which ${terminal}`)
        if (this.debug) {
          this.log(`Detected terminal emulator: ${terminal}`)
        }
        return terminal
      } catch {
        // Terminal not found, try next
      }
    }

    return null
  }

  /**
   * Spawn a visible terminal window attached to a tmux session.
   * Linux only - spawns a new terminal emulator window.
   */
  async spawnVisibleTerminal(sessionName: string): Promise<void> {
    validateSessionName(sessionName)

    // Only works on Linux
    if (process.platform !== 'linux') {
      if (this.debug) {
        this.log('spawnVisibleTerminal only supported on Linux')
      }
      return
    }

    const terminal = await this.detectTerminalEmulator()
    if (!terminal) {
      throw new Error('No terminal emulator found. Install gnome-terminal, xterm, or similar.')
    }

    const args: string[] = []
    const attachCommand = `tmux attach -t ${sessionName}`

    // Build terminal-specific command
    switch (terminal) {
      case 'gnome-terminal':
        args.push('--', 'bash', '-c', attachCommand)
        break
      case 'konsole':
        args.push('-e', attachCommand)
        break
      case 'xfce4-terminal':
        args.push('-e', attachCommand)
        break
      case 'xterm':
        args.push('-e', attachCommand)
        break
      case 'alacritty':
        args.push('-e', 'bash', '-c', attachCommand)
        break
      case 'kitty':
        args.push('bash', '-c', attachCommand)
        break
      case 'terminator':
        args.push('-e', attachCommand)
        break
      default:
        // Generic approach
        args.push('-e', attachCommand)
    }

    if (this.debug) {
      this.log(`Spawning terminal: ${terminal} ${args.join(' ')}`)
    }

    // Spawn the terminal (detached, don't wait for it)
    spawn(terminal, args, {
      detached: true,
      stdio: 'ignore',
    }).unref()

    // Give terminal time to open
    await this.sleep(500)
  }
}

/**
 * Create a TmuxExecutor instance.
 */
export function createTmuxExecutor(options?: TmuxExecutorOptions): TmuxExecutor {
  return new TmuxExecutor(options)
}

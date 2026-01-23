/**
 * HookInstaller - Install and uninstall hooks for supported agents
 *
 * Manages hook script installation and agent settings configuration.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile, mkdir, copyFile, access, chmod } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { ClaudeAdapter } from './adapters/ClaudeAdapter.js'
import { CodexAdapter } from './adapters/CodexAdapter.js'
import type { AgentAdapter, AgentType } from './types.js'

const execAsync = promisify(exec)

export interface HookInstallerConfig {
  /** Data directory for hook scripts. Default: ~/.coding-agent-bridge */
  dataDir?: string
  /** Enable debug logging */
  debug?: boolean
}

export interface DependencyCheck {
  name: string
  available: boolean
  version?: string
  path?: string
}

export interface InstallResult {
  success: boolean
  agent: AgentType
  message: string
}

/**
 * Default adapters
 */
const ADAPTERS: Record<string, AgentAdapter> = {
  claude: ClaudeAdapter,
  codex: CodexAdapter,
}

export class HookInstaller {
  private config: Required<HookInstallerConfig>

  constructor(config: HookInstallerConfig = {}) {
    this.config = {
      dataDir: config.dataDir ?? join(homedir(), '.coding-agent-bridge'),
      debug: config.debug ?? false,
    }
  }

  /**
   * Check if required dependencies are available
   */
  async checkDependencies(): Promise<DependencyCheck[]> {
    const checks: DependencyCheck[] = []

    // Check tmux
    checks.push(await this.checkCommand('tmux', ['tmux', '-V']))

    // Check jq (used in hook scripts)
    checks.push(await this.checkCommand('jq', ['jq', '--version']))

    // Check curl (used in hook scripts)
    checks.push(await this.checkCommand('curl', ['curl', '--version']))

    return checks
  }

  /**
   * Check if a command is available
   */
  private async checkCommand(
    name: string,
    versionCmd: string[]
  ): Promise<DependencyCheck> {
    try {
      const { stdout } = await execAsync(versionCmd.join(' '))
      const version = stdout.split('\n')[0]?.trim()

      // Get path
      const { stdout: pathOut } = await execAsync(`which ${name}`)
      const path = pathOut.trim()

      return { name, available: true, version, path }
    } catch {
      return { name, available: false }
    }
  }

  /**
   * Install hooks for all supported agents
   */
  async installAll(): Promise<InstallResult[]> {
    const results: InstallResult[] = []

    // First, ensure the hook script is in place
    await this.ensureHookScript()

    // Install for each adapter
    for (const [agent, adapter] of Object.entries(ADAPTERS)) {
      try {
        await this.installForAgent(adapter)
        results.push({
          success: true,
          agent: agent as AgentType,
          message: `Hooks installed for ${adapter.displayName}`,
        })
      } catch (err) {
        results.push({
          success: false,
          agent: agent as AgentType,
          message: `Failed to install hooks for ${adapter.displayName}: ${(err as Error).message}`,
        })
      }
    }

    return results
  }

  /**
   * Install hooks for a specific agent
   */
  async install(agent: AgentType): Promise<InstallResult> {
    const adapter = ADAPTERS[agent]
    if (!adapter) {
      return {
        success: false,
        agent,
        message: `Unknown agent: ${agent}`,
      }
    }

    try {
      await this.ensureHookScript()
      await this.installForAgent(adapter)
      return {
        success: true,
        agent,
        message: `Hooks installed for ${adapter.displayName}`,
      }
    } catch (err) {
      return {
        success: false,
        agent,
        message: `Failed to install hooks: ${(err as Error).message}`,
      }
    }
  }

  /**
   * Uninstall hooks for all agents
   */
  async uninstallAll(): Promise<InstallResult[]> {
    const results: InstallResult[] = []

    for (const [agent, adapter] of Object.entries(ADAPTERS)) {
      try {
        await adapter.uninstallHooks()
        results.push({
          success: true,
          agent: agent as AgentType,
          message: `Hooks uninstalled for ${adapter.displayName}`,
        })
      } catch (err) {
        results.push({
          success: false,
          agent: agent as AgentType,
          message: `Failed to uninstall hooks for ${adapter.displayName}: ${(err as Error).message}`,
        })
      }
    }

    return results
  }

  /**
   * Uninstall hooks for a specific agent
   */
  async uninstall(agent: AgentType): Promise<InstallResult> {
    const adapter = ADAPTERS[agent]
    if (!adapter) {
      return {
        success: false,
        agent,
        message: `Unknown agent: ${agent}`,
      }
    }

    try {
      await adapter.uninstallHooks()
      return {
        success: true,
        agent,
        message: `Hooks uninstalled for ${adapter.displayName}`,
      }
    } catch (err) {
      return {
        success: false,
        agent,
        message: `Failed to uninstall hooks: ${(err as Error).message}`,
      }
    }
  }

  /**
   * Get installation status for all agents
   */
  async getStatus(): Promise<
    Array<{
      agent: AgentType
      installed: boolean
      settingsPath: string
      settingsExists: boolean
    }>
  > {
    const results = []

    for (const [agent, adapter] of Object.entries(ADAPTERS)) {
      const settingsPath = adapter.getSettingsPath()
      const settingsExists = existsSync(settingsPath)

      let installed = false
      if (settingsExists) {
        try {
          const content = await readFile(settingsPath, 'utf8')
          const hookScript = this.getHookScriptPath()
          installed = content.includes(hookScript) || content.includes('coding-agent-hook')
        } catch {
          installed = false
        }
      }

      results.push({
        agent: agent as AgentType,
        installed,
        settingsPath,
        settingsExists,
      })
    }

    return results
  }

  /**
   * Get the path to the hook script
   */
  getHookScriptPath(): string {
    return join(this.config.dataDir, 'hooks', 'coding-agent-hook.sh')
  }

  /**
   * Get the events file path
   */
  getEventsFilePath(): string {
    return join(this.config.dataDir, 'data', 'events.jsonl')
  }

  /**
   * Ensure the hook script is installed
   */
  private async ensureHookScript(): Promise<void> {
    const hookPath = this.getHookScriptPath()
    const hookDir = dirname(hookPath)

    // Create hooks directory
    await mkdir(hookDir, { recursive: true })

    // Create data directory
    const dataDir = join(this.config.dataDir, 'data')
    await mkdir(dataDir, { recursive: true })

    // Check if we have a source hook script in our package
    // For now, generate it inline
    const hookScript = this.generateHookScript()

    await writeFile(hookPath, hookScript, { mode: 0o755 })
    this.debug('Hook script written to:', hookPath)
  }

  /**
   * Install hooks for a specific adapter
   */
  private async installForAgent(adapter: AgentAdapter): Promise<void> {
    const hookPath = this.getHookScriptPath()
    await adapter.installHooks(hookPath)
    this.debug('Hooks installed for:', adapter.displayName)
  }

  /**
   * Generate the hook script content
   */
  private generateHookScript(): string {
    const eventsFile = this.getEventsFilePath()

    return `#!/bin/bash
# coding-agent-hook.sh
# Universal hook script for Claude Code, Codex, and other AI coding assistants
# Generated by coding-agent-bridge

set -e

# Configuration
EVENTS_FILE="${eventsFile}"
SERVER_URL="\${CODING_AGENT_BRIDGE_URL:-http://127.0.0.1:4003}"
DEBUG="\${CODING_AGENT_BRIDGE_DEBUG:-}"

# Ensure events directory exists
mkdir -p "\$(dirname "\$EVENTS_FILE")"

# Read stdin (hook data from agent)
INPUT=\$(cat)

# Detect which agent is calling
detect_agent() {
  # Claude Code sets CLAUDE_CODE_ENTRYPOINT
  if [[ -n "\$CLAUDE_CODE_ENTRYPOINT" ]]; then
    echo "claude"
    return
  fi

  # Check for Codex indicators
  if echo "\$INPUT" | jq -e '.thread_id' > /dev/null 2>&1; then
    echo "codex"
    return
  fi

  # Default to claude
  echo "claude"
}

AGENT=\$(detect_agent)

# Get hook type (passed as argument or from environment)
HOOK_TYPE="\${1:-\$HOOK_TYPE}"

# Capture terminal info
TMUX_PANE_ID="\${TMUX_PANE:-}"
TMUX_SOCKET_PATH=""
if [[ -n "\$TMUX" ]]; then
  TMUX_SOCKET_PATH="\$(echo "\$TMUX" | cut -d',' -f1)"
fi
TTY_DEVICE="\$(tty 2>/dev/null || echo '')"

# Build enriched event
build_event() {
  local event
  event=\$(echo "\$INPUT" | jq -c --arg hook "\$HOOK_TYPE" --arg agent "\$AGENT" \\
    --arg tmux_pane "\$TMUX_PANE_ID" \\
    --arg tmux_socket "\$TMUX_SOCKET_PATH" \\
    --arg tty "\$TTY_DEVICE" \\
    --arg ts "\$(date +%s)000" \\
    '. + {
      hook_type: \$hook,
      agent: \$agent,
      tmux_pane: (if \$tmux_pane != "" then \$tmux_pane else null end),
      tmux_socket: (if \$tmux_socket != "" then \$tmux_socket else null end),
      tty: (if \$tty != "" then \$tty else null end),
      received_at: (\$ts | tonumber)
    }')
  echo "\$event"
}

EVENT=\$(build_event)

# Append to events file
echo "\$EVENT" >> "\$EVENTS_FILE"

# Debug output
if [[ -n "\$DEBUG" ]]; then
  echo "[coding-agent-hook] Agent: \$AGENT, Hook: \$HOOK_TYPE" >&2
fi

# Try to POST to server (non-blocking, ignore failures)
if command -v curl &> /dev/null; then
  curl -s -X POST -H "Content-Type: application/json" \\
    -d "\$EVENT" "\$SERVER_URL/event" \\
    --connect-timeout 1 --max-time 2 > /dev/null 2>&1 &
fi

# Pass through for Claude hooks that expect output
if [[ "\$AGENT" == "claude" ]]; then
  echo "\$INPUT"
fi
`
  }

  private debug(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[HookInstaller]', ...args)
    }
  }
}

/**
 * Create a new HookInstaller instance
 */
export function createHookInstaller(config?: HookInstallerConfig): HookInstaller {
  return new HookInstaller(config)
}

/**
 * Quick setup function
 */
export async function setupHooks(config?: HookInstallerConfig): Promise<InstallResult[]> {
  const installer = new HookInstaller(config)
  return installer.installAll()
}

/**
 * Quick uninstall function
 */
export async function uninstallHooks(config?: HookInstallerConfig): Promise<InstallResult[]> {
  const installer = new HookInstaller(config)
  return installer.uninstallAll()
}

/**
 * Quick dependency check function
 */
export async function checkDependencies(
  config?: HookInstallerConfig
): Promise<DependencyCheck[]> {
  const installer = new HookInstaller(config)
  return installer.checkDependencies()
}

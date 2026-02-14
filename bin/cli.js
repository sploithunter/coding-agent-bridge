#!/usr/bin/env node

/**
 * coding-agent-bridge CLI
 *
 * Commands:
 *   setup    - Install hooks for all supported agents
 *   uninstall - Remove hooks from all agents
 *   doctor   - Check dependencies and installation status
 *   server   - Start the bridge server
 */

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { homedir } from 'os'

// Get package directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const packageDir = dirname(__dirname)

// Parse command line arguments
const args = process.argv.slice(2)
const command = args[0]
const flags = args.slice(1)

// Parse flags
const options = {
  debug: flags.includes('--debug') || flags.includes('-d'),
  help: flags.includes('--help') || flags.includes('-h'),
  port: getFlag(flags, '--port', '-p'),
  host: getFlag(flags, '--host'),
  dataDir: getFlag(flags, '--data-dir'),
  agent: getFlag(flags, '--agent', '-a'),
}

function getFlag(flags, long, short) {
  const idx = flags.findIndex(f => f.startsWith(long + '=') || f === long || (short && (f.startsWith(short + '=') || f === short)))
  if (idx === -1) return undefined

  const flag = flags[idx]
  if (flag.includes('=')) {
    return flag.split('=')[1]
  }
  // Value is next argument
  return flags[idx + 1]
}

// Colors (ANSI escape codes)
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

const c = colors

function log(msg) {
  console.log(msg)
}

function success(msg) {
  log(`${c.green}✓${c.reset} ${msg}`)
}

function error(msg) {
  log(`${c.red}✗${c.reset} ${msg}`)
}

function warn(msg) {
  log(`${c.yellow}!${c.reset} ${msg}`)
}

function info(msg) {
  log(`${c.blue}ℹ${c.reset} ${msg}`)
}

function header(msg) {
  log(`\n${c.bold}${msg}${c.reset}`)
}

// Help text
function showHelp() {
  log(`
${c.bold}coding-agent-bridge${c.reset} - Manage AI coding assistant sessions via tmux

${c.bold}Usage:${c.reset}
  coding-agent-bridge <command> [options]

${c.bold}Commands:${c.reset}
  ${c.cyan}setup${c.reset}      Install hooks for supported agents (Claude, Codex)
  ${c.cyan}uninstall${c.reset}  Remove hooks from all agents
  ${c.cyan}doctor${c.reset}     Check dependencies and installation status
  ${c.cyan}server${c.reset}     Start the bridge server

${c.bold}Options:${c.reset}
  -h, --help       Show this help message
  -d, --debug      Enable debug output
  --port <port>    Server port (default: 4003)
  --host <host>    Server host (default: 127.0.0.1)
  --data-dir <dir> Data directory (default: ~/.coding-agent-bridge)
  --agent <name>   Target specific agent (claude, codex)

${c.bold}Examples:${c.reset}
  ${c.dim}# Install hooks for all agents${c.reset}
  coding-agent-bridge setup

  ${c.dim}# Install hooks for Claude only${c.reset}
  coding-agent-bridge setup --agent claude

  ${c.dim}# Check installation status${c.reset}
  coding-agent-bridge doctor

  ${c.dim}# Start server on custom port${c.reset}
  coding-agent-bridge server --port 5000
`)
}

// Main entry point
async function main() {
  if (options.help || !command) {
    showHelp()
    process.exit(command ? 0 : 1)
  }

  try {
    // Dynamically import to allow for ES modules
    const { HookInstaller } = await import(join(packageDir, 'dist', 'HookInstaller.js'))
    const { BridgeServer } = await import(join(packageDir, 'dist', 'Server.js'))
    const { SessionManager } = await import(join(packageDir, 'dist', 'SessionManager.js'))
    const { FileWatcher } = await import(join(packageDir, 'dist', 'FileWatcher.js'))
    const { EventProcessor } = await import(join(packageDir, 'dist', 'EventProcessor.js'))
    const { ClaudeAdapter } = await import(join(packageDir, 'dist', 'adapters', 'ClaudeAdapter.js'))
    const { CodexAdapter } = await import(join(packageDir, 'dist', 'adapters', 'CodexAdapter.js'))
    const { OpenClawAdapter } = await import(join(packageDir, 'dist', 'adapters', 'OpenClawAdapter.js'))

    const dataDir = options.dataDir || join(homedir(), '.coding-agent-bridge')
    const installer = new HookInstaller({ dataDir, debug: options.debug })

    switch (command) {
      case 'setup':
        await runSetup(installer)
        break

      case 'uninstall':
        await runUninstall(installer)
        break

      case 'doctor':
        await runDoctor(installer)
        break

      case 'server':
        await runServer({
          BridgeServer,
          SessionManager,
          FileWatcher,
          EventProcessor,
          ClaudeAdapter,
          CodexAdapter,
          OpenClawAdapter,
          installer,
          dataDir,
        })
        break

      default:
        error(`Unknown command: ${command}`)
        showHelp()
        process.exit(1)
    }
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      error('Package not built. Run: npm run build')
      if (options.debug) {
        console.error(err)
      }
      process.exit(1)
    }
    error(err.message)
    if (options.debug) {
      console.error(err)
    }
    process.exit(1)
  }
}

async function runSetup(installer) {
  header('Setting up coding-agent-bridge')

  // Check dependencies first
  log('\nChecking dependencies...')
  const deps = await installer.checkDependencies()
  let allDepsOk = true

  for (const dep of deps) {
    if (dep.available) {
      success(`${dep.name}: ${dep.version || 'available'}`)
    } else {
      error(`${dep.name}: not found`)
      allDepsOk = false
    }
  }

  if (!allDepsOk) {
    warn('\nSome dependencies are missing. Installation may not work correctly.')
  }

  // Install hooks
  log('\nInstalling hooks...')

  if (options.agent) {
    const result = await installer.install(options.agent)
    if (result.success) {
      success(result.message)
    } else {
      error(result.message)
    }
  } else {
    const results = await installer.installAll()
    for (const result of results) {
      if (result.success) {
        success(result.message)
      } else {
        error(result.message)
      }
    }
  }

  log('\n' + c.green + 'Setup complete!' + c.reset)
  info('Run "coding-agent-bridge doctor" to verify installation')
}

async function runUninstall(installer) {
  header('Uninstalling coding-agent-bridge hooks')

  if (options.agent) {
    const result = await installer.uninstall(options.agent)
    if (result.success) {
      success(result.message)
    } else {
      error(result.message)
    }
  } else {
    const results = await installer.uninstallAll()
    for (const result of results) {
      if (result.success) {
        success(result.message)
      } else {
        error(result.message)
      }
    }
  }

  log('\n' + c.green + 'Uninstall complete!' + c.reset)
}

async function runDoctor(installer) {
  header('coding-agent-bridge Doctor')

  // Check dependencies
  log('\n' + c.bold + 'Dependencies:' + c.reset)
  const deps = await installer.checkDependencies()
  let allDepsOk = true

  for (const dep of deps) {
    if (dep.available) {
      success(`${dep.name}: ${c.dim}${dep.version || 'available'}${c.reset}`)
      if (dep.path && options.debug) {
        log(`   ${c.dim}${dep.path}${c.reset}`)
      }
    } else {
      error(`${dep.name}: ${c.dim}not found${c.reset}`)
      allDepsOk = false
    }
  }

  // Check hook status
  log('\n' + c.bold + 'Agent Hooks:' + c.reset)
  const status = await installer.getStatus()

  for (const s of status) {
    const statusIcon = s.installed ? c.green + '✓' : c.yellow + '○'
    const statusText = s.installed ? 'installed' : 'not installed'
    log(`${statusIcon}${c.reset} ${s.agent}: ${c.dim}${statusText}${c.reset}`)

    if (options.debug) {
      log(`   Settings: ${s.settingsPath}`)
      log(`   Exists: ${s.settingsExists}`)
    }
  }

  // Check data files
  log('\n' + c.bold + 'Data Files:' + c.reset)
  const hookScript = installer.getHookScriptPath()
  const eventsFile = installer.getEventsFilePath()

  const fs = await import('fs')

  if (fs.existsSync(hookScript)) {
    success(`Hook script: ${c.dim}${hookScript}${c.reset}`)
  } else {
    warn(`Hook script: ${c.dim}not found${c.reset}`)
  }

  if (fs.existsSync(eventsFile)) {
    const stats = fs.statSync(eventsFile)
    const size = (stats.size / 1024).toFixed(1)
    success(`Events file: ${c.dim}${eventsFile} (${size} KB)${c.reset}`)
  } else {
    info(`Events file: ${c.dim}will be created on first event${c.reset}`)
  }

  // Summary
  log('')
  if (allDepsOk && status.some(s => s.installed)) {
    log(c.green + 'Everything looks good!' + c.reset)
  } else if (!allDepsOk) {
    warn('Some dependencies are missing. Install them and run setup again.')
  } else {
    info('Run "coding-agent-bridge setup" to install hooks.')
  }
}

async function runServer(ctx) {
  const {
    BridgeServer,
    SessionManager,
    FileWatcher,
    EventProcessor,
    ClaudeAdapter,
    CodexAdapter,
    OpenClawAdapter,
    installer,
    dataDir,
  } = ctx

  const port = parseInt(options.port || '4003', 10)
  const host = options.host || '127.0.0.1'

  header('Starting coding-agent-bridge server')
  log(`${c.dim}Port: ${port}, Host: ${host}${c.reset}`)

  // Create session manager
  const manager = new SessionManager({
    sessionsFile: join(dataDir, 'data', 'sessions.json'),
    defaultAgent: 'claude',
    trackExternalSessions: true,
    debug: options.debug,
  })
  manager.registerAdapter(ClaudeAdapter)
  manager.registerAdapter(CodexAdapter)
  manager.registerAdapter(OpenClawAdapter)

  // Create event processor
  const processor = new EventProcessor({ debug: options.debug })

  // Create file watcher
  const eventsFile = installer.getEventsFilePath()
  const watcher = new FileWatcher(eventsFile, {
    processExisting: false,
    debug: options.debug,
  })

  // Create server
  const server = new BridgeServer({
    port,
    host,
    debug: options.debug,
  })
  server.setSessionManager(manager)

  // Set up event processor for POST /event endpoint
  // This transforms raw hook events to the standard AgentEvent format
  server.setEventProcessor((rawEvent) => {
    // Process the raw event (same as FileWatcher path)
    const processed = processor.processLine(JSON.stringify(rawEvent))
    return processed ? processed.event : null
  })

  // Wire up events
  watcher.on('line', (line) => {
    const processed = processor.processLine(line)
    if (processed) {
      // Find or create session (links agentSessionId to internal sessions)
      const session = manager.findOrCreateSession(
        processed.agentSessionId,
        processed.event.agent || 'claude',
        processed.event.cwd,
        processed.terminal
      )
      if (session) {
        // Enrich event with bridge session ID for client correlation
        processed.event.sessionId = session.id

        if (processed.event.type === 'stop' || processed.event.type === 'session_end') {
          manager.updateSessionStatus(session, 'idle')
        } else if (processed.event.type === 'pre_tool_use' || processed.event.type === 'user_prompt_submit') {
          manager.updateSessionStatus(session, 'working')
          if (processed.event.type === 'pre_tool_use') {
            manager.updateSessionTool(session, processed.event.tool)
          }
        } else if (processed.event.type === 'post_tool_use') {
          manager.updateSessionTool(session, undefined)
        }
      }

      // Broadcast to clients
      server.broadcast(processed)
    }
  })

  // Subscribe to session events for broadcasting
  manager.on('session:created', (session) => {
    server.broadcastSessionUpdate(session, 'created')
  })
  manager.on('session:updated', (session) => {
    server.broadcastSessionUpdate(session, 'updated')
  })
  manager.on('session:deleted', (session) => {
    server.broadcastSessionUpdate(session, 'deleted')
  })
  manager.on('session:status', (session) => {
    server.broadcastSessionUpdate(session, 'status')
  })

  // Start everything
  await manager.load()
  await manager.start()
  await watcher.start()
  await server.start()

  success(`Server running at http://${host}:${port}`)
  info('Press Ctrl+C to stop')

  // Handle shutdown
  const shutdown = async () => {
    log('\nShutting down...')
    await server.stop()
    await watcher.stop()
    await manager.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// Run main
main()

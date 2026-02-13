/**
 * E2E Integration Test: Spawn a real Claude Code session and verify
 * that TranscriptWatcher captures assistant messages from the transcript.
 *
 * Usage: npx tsx tests/integration-transcript-e2e.ts
 */

import { TmuxExecutor } from '../src/TmuxExecutor.js'
import { TranscriptWatcher } from '../src/TranscriptWatcher.js'
import { ClaudeAdapter } from '../src/adapters/ClaudeAdapter.js'
import type { AssistantMessageEvent } from '../src/types.js'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const TMUX_SESSION = 'cab-e2e-test'
const PROMPT = 'Say exactly: "Hello from E2E test" and nothing else. Do not use any tools.'
const TIMEOUT_MS = 45_000

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('=== E2E Transcript Integration Test ===\n')

  const tmux = new TmuxExecutor()

  // Determine the Claude projects dir for this cwd
  const cwd = process.cwd()
  const projectSlug = cwd.replace(/\//g, '-')
  const claudeProjectDir = join(homedir(), '.claude', 'projects', projectSlug)
  console.log(`Project dir: ${claudeProjectDir}`)

  // Record existing transcript files BEFORE spawning
  const existingFiles = new Set<string>()
  if (existsSync(claudeProjectDir)) {
    for (const f of readdirSync(claudeProjectDir)) {
      if (f.endsWith('.jsonl')) {
        existingFiles.add(f)
      }
    }
  }
  console.log(`Existing transcript files: ${existingFiles.size}`)

  // Kill any leftover session
  try { await tmux.killSession(TMUX_SESSION) } catch { /* ignore */ }

  // Spawn Claude Code in tmux
  console.log(`\nSpawning Claude Code in tmux session: ${TMUX_SESSION}`)
  await tmux.createSession(TMUX_SESSION, {
    cwd,
    command: 'claude --dangerously-skip-permissions',
  })
  console.log('Session created. Waiting for Claude to initialize...')
  await sleep(8000)

  // Send prompt
  console.log(`Sending prompt: "${PROMPT}"`)
  await tmux.pasteBuffer({
    target: TMUX_SESSION,
    text: PROMPT,
  })

  // Wait for a NEW transcript file to appear (not one of the pre-existing ones)
  console.log('\nWaiting for new transcript file...')
  let transcriptPath: string | null = null
  const transcriptDeadline = Date.now() + 30_000
  while (Date.now() < transcriptDeadline) {
    if (existsSync(claudeProjectDir)) {
      for (const f of readdirSync(claudeProjectDir)) {
        if (f.endsWith('.jsonl') && !existingFiles.has(f)) {
          transcriptPath = join(claudeProjectDir, f)
          break
        }
      }
    }
    if (transcriptPath) break
    await sleep(1000)
  }

  if (!transcriptPath) {
    // Fallback: find the most recently modified file
    console.log('No NEW file found. Checking most recently modified...')
    if (existsSync(claudeProjectDir)) {
      const files = readdirSync(claudeProjectDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({
          name: f,
          path: join(claudeProjectDir, f),
          mtime: statSync(join(claudeProjectDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime)

      if (files[0]) {
        transcriptPath = files[0].path
        console.log(`Using most recent: ${files[0].name} (may be our own session)`)
      }
    }
  }

  if (!transcriptPath) {
    console.error('ERROR: No transcript file found')
    await cleanup(tmux)
    process.exit(1)
  }

  console.log(`Transcript: ${transcriptPath}`)

  // Start TranscriptWatcher on the new file
  const transcriptWatcher = new TranscriptWatcher(transcriptPath, ClaudeAdapter, { debug: true })
  const assistantMessages: Partial<AssistantMessageEvent>[] = []

  transcriptWatcher.on('message', (event: Partial<AssistantMessageEvent>) => {
    assistantMessages.push(event)
    const textContent = event.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .substring(0, 200)
    console.log(`\n  >>> [Assistant Message] isPreamble=${event.isPreamble} requestId=${event.requestId?.substring(0, 20)}`)
    console.log(`  >>> text: "${textContent}"`)
  })

  await transcriptWatcher.start()
  console.log('TranscriptWatcher started. Waiting for response...\n')

  // Wait for a non-preamble assistant message
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const realMessages = assistantMessages.filter((m) => !m.isPreamble)
    if (realMessages.length > 0) break
    await sleep(1000)
  }

  // Capture tmux pane
  console.log('\n--- Tmux pane content ---')
  try {
    const content = await tmux.capturePane(TMUX_SESSION)
    console.log(content.substring(0, 1000))
  } catch {
    console.log('(could not capture pane)')
  }

  // Report results
  console.log('\n=== Results ===\n')
  console.log(`Total assistant messages: ${assistantMessages.length}`)
  for (const m of assistantMessages) {
    const blocks = m.content ?? []
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join(' ')
    console.log(`  - isPreamble=${m.isPreamble}, blocks=${blocks.length}, text="${text.substring(0, 200)}"`)
  }

  const realMessages = assistantMessages.filter((m) => !m.isPreamble)
  if (realMessages.length > 0) {
    console.log('\n✅ SUCCESS: TranscriptWatcher captured assistant messages!')
    const firstReal = realMessages[0]!
    const text = firstReal.content?.filter((b) => b.type === 'text').map((b) => b.text).join(' ')
    console.log(`   First message: "${text}"`)
  } else {
    console.log('\n❌ FAIL: No assistant messages captured')
  }

  // Cleanup
  await transcriptWatcher.stop()
  await cleanup(tmux)
}

async function cleanup(tmux: TmuxExecutor) {
  try {
    await tmux.sendCtrlC(TMUX_SESSION)
    await sleep(1000)
    await tmux.killSession(TMUX_SESSION)
  } catch { /* ignore */ }
  console.log('\nCleaned up.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

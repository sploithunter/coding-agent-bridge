/**
 * E2E Integration Test: Verify TranscriptWatcher captures tool_use blocks.
 *
 * Usage: npx tsx tests/integration-transcript-tools-e2e.ts
 */

import { TmuxExecutor } from '../src/TmuxExecutor.js'
import { TranscriptWatcher } from '../src/TranscriptWatcher.js'
import { ClaudeAdapter } from '../src/adapters/ClaudeAdapter.js'
import type { AssistantMessageEvent } from '../src/types.js'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const TMUX_SESSION = 'cab-e2e-tools'
const PROMPT = 'Read the file /tmp/cab-e2e-test.txt and tell me what it says.'
const TIMEOUT_MS = 45_000

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  console.log('=== E2E Transcript Tool Use Test ===\n')

  const tmux = new TmuxExecutor()
  const cwd = process.cwd()
  const projectSlug = cwd.replace(/\//g, '-')
  const claudeProjectDir = join(homedir(), '.claude', 'projects', projectSlug)

  // Create a test file for Claude to read
  const { writeFileSync } = await import('fs')
  writeFileSync('/tmp/cab-e2e-test.txt', 'The magic word is: BANANA\n')

  // Record existing files
  const existingFiles = new Set<string>()
  if (existsSync(claudeProjectDir)) {
    for (const f of readdirSync(claudeProjectDir)) {
      if (f.endsWith('.jsonl')) existingFiles.add(f)
    }
  }

  // Kill leftover
  try { await tmux.killSession(TMUX_SESSION) } catch { /* ignore */ }

  // Spawn Claude
  console.log(`Spawning Claude Code in: ${TMUX_SESSION}`)
  await tmux.createSession(TMUX_SESSION, {
    cwd,
    command: 'claude --dangerously-skip-permissions',
  })
  await sleep(8000)

  // Send prompt that will trigger tool use
  console.log(`Sending prompt: "${PROMPT}"`)
  await tmux.pasteBuffer({ target: TMUX_SESSION, text: PROMPT })

  // Wait for new transcript
  console.log('Waiting for new transcript...')
  let transcriptPath: string | null = null
  const tDeadline = Date.now() + 30_000
  while (Date.now() < tDeadline) {
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
    console.error('ERROR: No transcript file found')
    await cleanup(tmux)
    process.exit(1)
  }
  console.log(`Transcript: ${transcriptPath}`)

  // Start watcher
  const watcher = new TranscriptWatcher(transcriptPath, ClaudeAdapter)
  const messages: Partial<AssistantMessageEvent>[] = []

  watcher.on('message', (event: Partial<AssistantMessageEvent>) => {
    messages.push(event)
    const blocks = event.content ?? []
    const textBlocks = blocks.filter((b) => b.type === 'text')
    const toolBlocks = blocks.filter((b) => b.type === 'tool_use')
    const thinkBlocks = blocks.filter((b) => b.type === 'thinking')

    console.log(`\n  >>> Message #${messages.length}: isPreamble=${event.isPreamble}, blocks=${blocks.length}`)
    if (thinkBlocks.length > 0) {
      console.log(`      thinking: ${thinkBlocks.length} block(s), "${thinkBlocks[0]!.text?.substring(0, 80)}..."`)
    }
    for (const tb of textBlocks) {
      console.log(`      text: "${tb.text?.substring(0, 100)}"`)
    }
    for (const tb of toolBlocks) {
      console.log(`      tool_use: ${tb.toolName} (id=${tb.toolUseId?.substring(0, 16)})`)
    }
  })

  await watcher.start()
  console.log('Watching for messages...\n')

  // Wait until we get at least 2 messages (one with tool_use, one with text response)
  // or timeout
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const hasToolUse = messages.some((m) =>
      m.content?.some((b) => b.type === 'tool_use')
    )
    const hasTextAfterTool = messages.filter((m) => !m.isPreamble).length >= 2
    if (hasToolUse && hasTextAfterTool) break
    // Also stop early if we see a text response mentioning BANANA
    const hasBanana = messages.some((m) =>
      m.content?.some((b) => b.type === 'text' && b.text?.includes('BANANA'))
    )
    if (hasBanana) break
    await sleep(1000)
  }

  // Capture tmux pane
  console.log('\n--- Tmux pane content ---')
  try {
    const content = await tmux.capturePane(TMUX_SESSION)
    console.log(content.substring(0, 1000))
  } catch { console.log('(could not capture)') }

  // Results
  console.log('\n=== Results ===\n')
  console.log(`Total messages: ${messages.length}`)

  const toolMessages = messages.filter((m) => m.content?.some((b) => b.type === 'tool_use'))
  const textMessages = messages.filter((m) => !m.isPreamble && m.content?.some((b) => b.type === 'text'))
  const thinkMessages = messages.filter((m) => m.content?.some((b) => b.type === 'thinking'))

  console.log(`  With tool_use blocks: ${toolMessages.length}`)
  console.log(`  With text blocks (non-preamble): ${textMessages.length}`)
  console.log(`  With thinking blocks: ${thinkMessages.length}`)

  if (toolMessages.length > 0) {
    console.log('\n✅ SUCCESS: Captured tool_use blocks')
    const tools = toolMessages.flatMap((m) =>
      (m.content ?? []).filter((b) => b.type === 'tool_use').map((b) => b.toolName)
    )
    console.log(`   Tools used: ${tools.join(', ')}`)
  } else {
    console.log('\n❌ FAIL: No tool_use blocks captured')
  }

  const bananaMsg = messages.find((m) =>
    m.content?.some((b) => b.type === 'text' && b.text?.includes('BANANA'))
  )
  if (bananaMsg) {
    console.log('✅ SUCCESS: Claude read the file and mentioned BANANA')
  }

  await watcher.stop()
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

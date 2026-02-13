/**
 * Quick script to parse a transcript file through ClaudeAdapter.parseTranscriptEntry
 * Usage: npx tsx tests/parse-transcript.ts <path-to-transcript.jsonl>
 */

import { ClaudeAdapter } from '../src/adapters/ClaudeAdapter.js'
import { readFileSync } from 'fs'

const transcriptPath = process.argv[2]
if (!transcriptPath) {
  console.error('Usage: npx tsx tests/parse-transcript.ts <path>')
  process.exit(1)
}

const lines = readFileSync(transcriptPath, 'utf8').trim().split('\n')
let msgNum = 0

for (const line of lines) {
  try {
    const entry = JSON.parse(line)
    if (entry.type !== 'assistant') continue

    const event = ClaudeAdapter.parseTranscriptEntry!(entry)
    if (!event) continue

    msgNum++
    const blocks = event.content ?? []
    const textBlocks = blocks.filter((b) => b.type === 'text')
    const toolBlocks = blocks.filter((b) => b.type === 'tool_use')
    const thinkBlocks = blocks.filter((b) => b.type === 'thinking')

    console.log('─'.repeat(80))
    console.log(
      `Message #${msgNum} | isPreamble=${event.isPreamble} | requestId=${(event.requestId ?? '?').substring(0, 24)} | blocks=${blocks.length}`
    )
    if (thinkBlocks.length > 0) {
      console.log(`  [thinking] ${thinkBlocks.map((b) => b.text?.substring(0, 120)).join('...')}`)
    }
    for (const t of textBlocks) {
      console.log(`  [text] ${(t.text ?? '').substring(0, 300)}`)
    }
    for (const t of toolBlocks) {
      console.log(`  [tool_use] ${t.toolName} (id=${t.toolUseId?.substring(0, 24)})`)
    }
  } catch {
    // skip unparseable lines
  }
}

console.log('─'.repeat(80))
console.log(`\nTotal assistant messages parsed: ${msgNum}`)

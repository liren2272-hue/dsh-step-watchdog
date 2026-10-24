// Inspect actual event type vocabulary and how 'compaction'/'watchdog' appear.
process.noAsar = true
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'

const SESS_ROOT = 'C:/Users/15940/.dsh/sessions/--C-Users-15940-Documents-deepseek-harness-default-workspace--'
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function decompressAll(buf) {
  const chunks = []
  let off = 0
  while (off + 4 <= buf.length) {
    if (!buf.subarray(off, off + 4).equals(MAGIC)) break
    let out
    try { out = zlib.zstdDecompressSync(buf.subarray(off)) } catch { break }
    chunks.push(out)
    let next = -1
    for (let i = off + 4; i + 4 <= buf.length; i++) {
      if (buf.subarray(i, i + 4).equals(MAGIC)) { next = i; break }
    }
    if (next === -1) break
    off = next
  }
  return Buffer.concat(chunks).toString('utf8')
}

const id = process.argv[2]
const text = decompressAll(readFileSync(join(SESS_ROOT, id, 'session.v4.jsonl.zstd')))
const lines = text.split('\n').filter(Boolean)

// 1. distinct top-level type values
const types = {}
for (const line of lines) {
  let ev
  try { ev = JSON.parse(line) } catch { continue }
  const t = ev?.type || '(none)'
  types[t] = (types[t] || 0) + 1
}
console.log('DISTINCT top-level types:', JSON.stringify(types, null, 0))

// 2. For lines mentioning 'compaction' or 'step-watchdog', show type + first 200 chars of line
console.log('\nLINES mentioning compaction/watchdog (type + snippet):')
for (const line of lines) {
  if (line.includes('compaction') || line.includes('step-watchdog')) {
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const t = ev?.type || '(none)'
    // Only show non-message/result (i.e., candidate real events) first
    const isQuoted = ['assistant/message', 'tool/result', 'user/message', 'chunk'].includes(t)
    const snippet = line.slice(0, 220).replace(/\n/g, ' ')
    console.log(`  ${isQuoted ? 'QUOTED' : 'EVENT '} type=${t} :: ${snippet}`)
  }
}

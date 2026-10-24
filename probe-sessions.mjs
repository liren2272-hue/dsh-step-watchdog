// Probe recent DSH session logs for watchdog behaviour signatures.
process.noAsar = true
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import zlib from 'node:zlib'

const SESS_ROOT = 'C:/Users/15940/.dsh/sessions/--C-Users-15940-Documents-deepseek-harness-default-workspace--'

// Multi-frame zstd: frames start with magic 0x28 0xB5 0x2F 0xFD.
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
function decompressAll(buf) {
  const chunks = []
  let off = 0
  while (off + 4 <= buf.length) {
    if (!buf.subarray(off, off + 4).equals(MAGIC)) break
    // Read frame content size from header (bytes 6..13, little-endian, if flag set)
    // Simpler: try decompress from off; zstd frame knows its own length.
    let out
    try {
      out = zlib.zstdDecompressSync(buf.subarray(off))
    } catch (e) {
      break
    }
    // Determine consumed bytes: we need the frame length. zstdDecompressSync
    // consumes only the first frame; we must find where it ends.
    // Use zstd magic search to find next frame start.
    chunks.push(out)
    // Find next magic after off
    let next = -1
    for (let i = off + 4; i + 4 <= buf.length; i++) {
      if (buf.subarray(i, i + 4).equals(MAGIC)) { next = i; break }
    }
    if (next === -1) break
    off = next
  }
  return Buffer.concat(chunks).toString('utf8')
}

// Signatures that PROVE the NEW code is loaded (old code never emits these):
const NEW_SIGS = [
  'tolerated: compaction is exempt from the stall clock',
  'spent ', 'ms inside compaction; interrupting turn',
  '手动切换到其它模型',
  '你已经把本会话切到',
  '最近一次请求使用的模型是',
  'compaction ran', 'ms on', 'and did not complete',
]
// Signatures that PROVE the OLD abort happened (compaction aborted -> [object Object]):
const OLD_SIGS = [
  '"error":"[object Object]"',
  '[object Object]',
]

function scanFile(path) {
  let raw
  try { raw = readFileSync(path) } catch { return null }
  let text
  try { text = decompressAll(raw) } catch { return null }
  const lines = text.split('\n')
  const hits = { new: [], old: [], compactionEvents: 0, turnEvents: 0, watchdog: 0, selection: [] }
  for (const line of lines) {
    if (!line.trim()) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const t = ev?.type || ev?.event?.type || ''
    if (t === 'compaction/start' || t === 'compaction/end' || t === 'compaction/prune') hits.compactionEvents++
    if (t === 'turn/start' || t === 'turn/end') hits.turnEvents++
    if (t === 'model/selection') hits.selection.push(ev?.data?.provider + '/' + ev?.data?.model)
    const s = line
    if (s.includes('step-watchdog:')) hits.watchdog++
    for (const sig of NEW_SIGS) if (s.includes(sig)) hits.new.push(sig)
    for (const sig of OLD_SIGS) if (s.includes(sig)) hits.old.push(sig)
  }
  return hits
}

const dirs = readdirSync(SESS_ROOT)
  .map((d) => ({ d, p: join(SESS_ROOT, d) }))
  .filter((x) => statSync(x.p).isDirectory())
  .sort((a, b) => statSync(b.p).mtimeMs - statSync(a.p).mtimeMs)

console.log('Most recent sessions (top 8):')
for (const { d, p } of dirs.slice(0, 8)) {
  const mtime = statSync(p).mtime.toISOString()
  const logPath = join(p, 'session.v4.jsonl.zstd')
  const hits = scanFile(logPath)
  if (!hits) { console.log(`  ${d}  (${mtime})  no log`); continue }
  const newUniq = [...new Set(hits.new)]
  const oldUniq = [...new Set(hits.old)]
  console.log(`  ${d}  (${mtime})`)
  console.log(`     compactionEvts=${hits.compactionEvents} turnEvts=${hits.turnEvents} watchdogLines=${hits.watchdog} selection=${JSON.stringify(hits.selection)}`)
  if (newUniq.length) console.log(`     NEW-CODE SIGS: ${JSON.stringify(newUniq)}`)
  if (oldUniq.length) console.log(`     OLD-CODE SIGS: ${JSON.stringify(oldUniq)}`)
}

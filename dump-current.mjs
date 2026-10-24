// Dump watchdog + compaction timeline for specific sessions.
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

// target sessions from argv
const targets = process.argv.slice(2)
for (const id of targets) {
  const logPath = join(SESS_ROOT, id, 'session.v4.jsonl.zstd')
  let text
  try { text = decompressAll(readFileSync(logPath)) } catch (e) { console.log(id, 'read fail', e.message); continue }
  const lines = text.split('\n').filter(Boolean)
  console.log(`\n===== ${id}  (${lines.length} lines) =====`)
  let compactStart = null
  for (const line of lines) {
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const t = ev?.type || ev?.event?.type || ''
    const ts = ev?.at || ev?.timestamp || ''
    if (t === 'compaction/start') { compactStart = ts }
    if (t === 'compaction/end') {
      const started = compactStart ? new Date(compactStart).getTime() : null
      const ended = ts ? new Date(ts).getTime() : null
      const dur = started && ended ? ((ended - started) / 1000).toFixed(1) + 's' : '?'
      console.log(`[C] ${ts} ${t} dur≈${dur} error=${JSON.stringify(ev?.data?.error)}`)
      compactStart = null
    }
    if (t === 'model/selection') {
      console.log(`[SEL] ${ts} -> ${ev?.data?.provider}/${ev?.data?.model}`)
    }
    const s = line
    if (s.includes('step-watchdog:')) {
      // print just the human-meaningful tail
      const idx = s.indexOf('step-watchdog:')
      console.log(`[WD] ${ts} ${s.slice(idx)}`)
    }
  }
}

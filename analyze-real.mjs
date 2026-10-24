// Distinguish REAL runtime watchdog/compaction events from quoted test output.
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

// A "real runtime event" is a top-level log/event line whose msg is NOT wrapped
// inside a tool/result or assistant/message. We classify each JSON line.
function classify(line) {
  let ev
  try { ev = JSON.parse(line) } catch { return null }
  const type = ev?.type || ''
  // Real harness log line (cordis logger emits these):
  if (type === 'log' || type === 'event') {
    const inner = ev?.event || ev
    const msg = ev?.msg || inner?.msg || ''
    const etype = inner?.type || ev?.event?.type || ''
    if (msg.includes('step-watchdog:') || msg.includes('compaction')) {
      return { kind: 'REAL_LOG', msg, etype, at: ev?.at || inner?.at || ev?.timestamp }
    }
    return null
  }
  // Assistant/tool content — quoted, not runtime proof:
  if (type === 'assistant/message' || type === 'tool/result' || type === 'user/message') {
    return null
  }
  return null
}

function analyze(id) {
  const logPath = join(SESS_ROOT, id, 'session.v4.jsonl.zstd')
  let text
  try { text = decompressAll(readFileSync(logPath)) } catch (e) { return { err: e.message } }
  const lines = text.split('\n').filter(Boolean)
  const real = []
  const compactionEnd = []
  let compactStartTs = null
  for (const line of lines) {
    const c = classify(line)
    if (c) real.push(c)
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const t = ev?.type || ev?.event?.type || ''
    if (t === 'compaction/start') compactStartTs = ev?.at || ev?.timestamp
    if (t === 'compaction/end') {
      const started = compactStartTs ? new Date(compactStartTs).getTime() : null
      const ended = (ev?.at || ev?.timestamp) ? new Date(ev.at || ev.timestamp).getTime() : null
      const dur = started && ended ? Math.round((ended - started) / 1000) + 's' : '?'
      compactionEnd.push({ dur, error: JSON.stringify(ev?.data?.error ?? ev?.error ?? null), at: ev?.at || ev?.timestamp })
      compactStartTs = null
    }
  }
  return { total: lines.length, real, compactionEnd }
}

for (const id of process.argv.slice(2)) {
  const r = analyze(id)
  if (r.err) { console.log(id, 'ERR', r.err); continue }
  console.log(`\n===== ${id}  lines=${r.total} =====`)
  console.log(`  REAL runtime watchdog/compaction log lines: ${r.real.length}`)
  for (const x of r.real) console.log(`    [${x.kind}] ${x.at} :: ${x.msg.slice(0, 160)}`)
  console.log(`  compaction/end events: ${r.compactionEnd.length}`)
  for (const x of r.compactionEnd) console.log(`    dur=${x.dur} error=${x.error}`)
}

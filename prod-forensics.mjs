// Forensic read of the production session: model route vs user selection,
// compaction outcomes, and whether the turn was aborted by the (old) watchdog.
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

const selections = []      // user-driven model/selection
const requestHeaders = []   // actual routed provider/model
const compactions = []      // compaction start/end with durations + errors
let compStart = null
let turnEnds = []

for (const line of lines) {
  let ev
  try { ev = JSON.parse(line) } catch { continue }
  const t = ev?.type || ev?.event?.type || ''
  const at = ev?.at ?? ev?.timestamp ?? ev?.time ?? null
  if (t === 'model/selection') selections.push({ at, route: `${ev?.data?.provider}/${ev?.data?.model}` })
  if (t === 'request/header') requestHeaders.push({ at, route: `${ev?.data?.header?.config?.provider}/${ev?.data?.header?.config?.model}` })
  if (t === 'compaction/start') compStart = { at }
  if (t === 'compaction/end') {
    const started = compStart?.at ? new Date(compStart.at).getTime() : null
    const ended = at ? new Date(at).getTime() : null
    const dur = started && ended ? Math.round((ended - started) / 1000) : null
    compactions.push({ dur, error: ev?.data?.error ?? ev?.error ?? null, raw: JSON.stringify(ev).slice(0, 400) })
    compStart = null
  }
  if (t === 'turn/end') turnEnds.push({ at, cause: ev?.data?.cause ?? ev?.cause ?? null, raw: JSON.stringify(ev).slice(0, 300) })
}

console.log(`SESSION ${id}`)
console.log('--- model/selection (what the human asked for) ---')
for (const s of selections) console.log(`  ${s.at}  -> ${s.route}`)
console.log('--- request/header (what actually went out) ---')
for (const s of requestHeaders) console.log(`  ${s.at}  -> ${s.route}`)
console.log('--- compaction outcomes ---')
for (const c of compactions) console.log(`  dur=${c.dur}s error=${JSON.stringify(c.error)}`)
if (compactions.length === 0) console.log('  (none)')
console.log('--- turn/end causes ---')
for (const t of turnEnds) console.log(`  ${t.at} cause=${JSON.stringify(t.cause)}  ${t.raw}`)
if (turnEnds.length === 0) console.log('  (none)')

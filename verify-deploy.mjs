/**
 * Deployment check for the step-watchdog fix.
 *
 * The plugin is `link:`-ed and loaded from disk at process start — there is NO
 * hot-reload. So the only reliable liveness signal is:
 *   latest desktop-restart timestamp  vs  index.js last-modified time.
 * If the newest restart is AFTER the fix was written, the running process loads
 * the new module. If it's BEFORE, the old code is still live.
 *
 * Usage:  ELECTRON_RUN_AS_NODE=1 "D:/Program Files/Deepseek/DeepSeek Harness.exe" verify-deploy.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const restartDir = 'C:/Users/15940/.dsh/desktop-restart'
const indexFile = 'C:/Users/15940/Documents/deepseek-harness/default-workspace/dsh-step-watchdog/index.js'

function newestRestart() {
  if (!fs.existsSync(restartDir)) return null
  const logs = fs
    .readdirSync(restartDir)
    .filter((f) => /^restart-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.log$/.test(f))
    .sort()
  if (logs.length === 0) return null
  const name = logs[logs.length - 1]
  const m = name.match(/restart-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.log/)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  // The desktop-restart log filenames carry UTC timestamps (the log body uses
  // `Z` suffixes). Parse as UTC, not local, or the comparison is off by +08:00.
  const ts = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
  return { name, ts }
}

function mtime(file) {
  return fs.existsSync(file) ? fs.statSync(file).mtime : null
}

const restart = newestRestart()
const fix = mtime(indexFile)

if (!restart || !fix) {
  console.log('MISSING INPUTS: restart log or index.js not found')
  process.exit(2)
}

const restartMs = restart.ts.getTime()
const fixMs = fix.getTime()
const deployed = restartMs > fixMs

console.log('fix written :', fix.toISOString())
console.log('latest restart:', restart.ts.toISOString(), `( ${restart.name} )`)
console.log('gap          :', ((restartMs - fixMs) / 1000 / 60).toFixed(1), 'minutes (restart minus fix)')
console.log('')
if (deployed) {
  console.log('DEPLOYED ✓  the running DSH reloaded AFTER the fix was written.')
  console.log('            A long compaction should now log "... compacted in Nms ... (tolerated: ...)"')
  console.log('            instead of being killed at 60s.')
  process.exit(0)
} else {
  console.log('STALE ✗  latest restart PREDATES the fix (by', ((-(restartMs - fixMs)) / 1000 / 60).toFixed(1), 'minutes).')
  console.log('         the running DSH still executes the OLD watchdog — restart it to load the fix.')
  process.exit(1)
}

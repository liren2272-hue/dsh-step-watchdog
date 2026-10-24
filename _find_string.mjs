// Walk the virtual asar FS (noAsar OFF) to locate a CJK string.
import fs from 'node:fs'
import path from 'node:path'

// process.noAsar must stay false so app.asar/... virtual paths open.
const ROOT = 'D:/Program Files/Deepseek/resources/app.asar'
const NEEDLES = ['已完成', '用时', 'completed in', 'elapsed', '耗时', '已停止', '已中断']
const SKIP_DIR = new Set(['.git', 'node_modules/.cache'])

function walk(dir, hits, depth) {
  if (depth > 12) return
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) }
  catch { return }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      walk(full, hits, depth + 1)
    } else if (/\.(js|mjs|cjs|ts|json|vue|html|tsx|jsx)$/.test(e.name)) {
      let text
      try { text = fs.readFileSync(full, 'utf8') } catch { continue }
      if (text.length > 3_000_000) continue
      for (const needle of NEEDLES) {
        if (text.includes(needle)) {
          hits.push({ file: full.replace(ROOT, '<app.asar>'), needle })
          break
        }
      }
    }
  }
}

const hits = []
walk(ROOT, hits, 0)
console.log('matches:', hits.length)
for (const h of hits.slice(0, 300)) console.log(h.needle.padEnd(8), h.file)

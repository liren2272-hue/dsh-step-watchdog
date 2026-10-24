import fs from 'node:fs'
const F = 'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'
const t = fs.readFileSync(F, 'utf8')

// Full function containing the label at @322952
const i = 322952
// find function start (nearest 'function ' or '=> {' before)
let s = i
while (s > 0 && !/function\s+\w+\s*\(/.test(t.slice(s - 60, s))) s -= 40
console.log('=== function start ~', s, '===')
console.log(t.slice(Math.max(0, s - 60), i + 500).replace(/\s+/g, ' '))

// Where does `duration` come from? search assignments/declarations near here
console.log('\n=== duration declarations in file ===')
const re = /duration\s*[:=]/g
let m, n = 0
const seen = new Set()
while ((m = re.exec(t)) !== null && n < 40) {
  const a = Math.max(0, m.index - 90), b = Math.min(t.length, m.index + 90)
  const frag = t.slice(a, b).replace(/\s+/g, ' ')
  const k = frag.slice(0, 50)
  if (seen.has(k)) { continue }
  seen.add(k)
  console.log(`@${m.index}:`, frag)
  n++
}

// Any wall-clock / timestamp on turn or step nodes?
console.log('\n=== turn/step timestamp fields ===')
for (const kw of ['endedAt', 'finishedAt', 'completedAt', 'turn.at', 'node.at', 'data.at', 'summary.at', 'wallClock', 'wallclock', 'localTime', 'clockAt']) {
  const c = (t.match(new RegExp(kw, 'g')) || []).length
  if (c) console.log(kw.padEnd(14), c)
}

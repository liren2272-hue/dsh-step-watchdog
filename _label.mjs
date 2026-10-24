import fs from 'node:fs'
const F = 'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'
const t = fs.readFileSync(F, 'utf8')

// Big window around @196861 (the title/label render)
const i = 196861
console.log('=== around 196861 ===')
console.log(t.slice(i - 500, i + 700).replace(/\s+/g, ' '))

// Find non-locale usages of `took` (template usage, not the locale JSON blob)
console.log('\n=== usages of turnProcess.took in code ===')
const re = /turnProcess\.took/g
let m, n = 0
while ((m = re.exec(t)) !== null && n < 10) {
  const s = Math.max(0, m.index - 150), e = Math.min(t.length, m.index + 200)
  const frag = t.slice(s, e).replace(/\s+/g, ' ')
  // skip the locale blob (long runs of CJK)
  if (/[\u4e00-\u9fff]{10,}/.test(frag.slice(0, 120))) { continue }
  console.log(`\n@${m.index}:`, frag)
  n++
}

// Where is `label` built with duration?
console.log('\n=== occurrences of "took" as a variable / formatDuration ===')
const re2 = /t\(`?["']?message\.turnProcess\.took|formatDuration|formatElapsed|formatTime/g
let m2
const uniq = new Set()
while ((m2 = re2.exec(t)) !== null) {
  const s = Math.max(0, m2.index - 120), e = Math.min(t.length, m2.index + 220)
  const frag = t.slice(s, e).replace(/\s+/g, ' ')
  const key = frag.slice(0, 60)
  if (uniq.has(key)) continue
  uniq.add(key)
  console.log(`\n@${m2.index}:`, frag)
}

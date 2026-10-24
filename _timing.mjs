import fs from 'node:fs'
const F = 'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'
const t = fs.readFileSync(F, 'utf8')

// Look at the component around 322952 (the took/label render) — 400 chars before/after
const i = 322952
console.log('=== context around took label @322952 ===')
console.log(t.slice(i - 400, i + 400).replace(/\s+/g, ' '))

// Search timing-related fields in the chat client
console.log('\n=== timestamp/at/start/end fields ===')
for (const kw of ['startedAt', 'endedAt', 'endAt', 'turnStart', 'startTime', 'ended', 'clock', 'Date.now', 'new Date', 'toLocaleTimeString', 'summary.at', 'data.at']) {
  const re = new RegExp(kw, 'g')
  const c = (t.match(re) || []).length
  if (c) console.log(kw.padEnd(16), c)
}

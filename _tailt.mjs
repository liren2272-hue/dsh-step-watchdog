import fs from 'node:fs'
const dir = 'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai'
function walk(d, acc) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = d + '/' + e.name
    if (e.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
}
const files = []
for (const m of fs.readdirSync(dir)) {
  const p = dir + '/' + m
  if (fs.statSync(p).isDirectory()) walk(p, files)
}
// Search all client.js for someone injecting into conversation.chat.turnTail
console.log('=== who injects into conversation.chat.turnTail (across modules) ===')
for (const f of files) {
  if (!/client\.js$/.test(f)) continue
  const t = fs.readFileSync(f, 'utf8')
  const idx = t.indexOf('conversation.chat.turnTail')
  if (idx < 0) continue
  // find nearest 'slots.register' or 'slots.inject' that targets turnTail with a factory
  const re = /slots\.(inject|register)\(\s*["'`]conversation\.chat\.turnTail["'`]/g
  let m
  while ((m = re.exec(t)) !== null) {
    const s = Math.max(0, m.index - 50), e = Math.min(t.length, m.index + 500)
    console.log(`\n[${f.split('\\').slice(-3).join('/')}] @${m.index}:`, t.slice(s, e).replace(/\s+/g, ' '))
  }
}

// In chat client, how does an occupant get `t`? Look at renderSlot impl / how props include t
console.log('\n=== renderSlot signature / how t is provided ===')
const chat = files.find(f => /dsh-client-ui-chat[\\/]lib[\\/]client\.js$/.test(f))
const ct = fs.readFileSync(chat, 'utf8')
const r = ct.indexOf('function renderSlot')
console.log('renderSlot @', r, ct.slice(r, r + 400).replace(/\s+/g, ' '))
// find slots.register with a component that destructures {turn, t}
const r2 = ct.indexOf('assistant-actions')
console.log('\nassistant-actions ctx:', ct.slice(r2 - 300, r2 + 200).replace(/\s+/g, ' '))

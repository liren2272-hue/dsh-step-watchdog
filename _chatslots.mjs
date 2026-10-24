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
const chat = files.find(f => /dsh-client-ui-chat[\\/]lib[\\/]client\.js$/.test(f))
console.log('chat client:', chat)
const t = fs.readFileSync(chat, 'utf8')

console.log('\n=== slot strings in chat client ===')
const re = /['"`](conversation\.[a-zA-Z0-9_.]+|main\.[a-zA-Z0-9_.]+)['"`]/g
let m; const set = new Set()
while ((m = re.exec(t)) !== null) set.add(m[1])
for (const s of [...set].sort()) console.log(' ', s)

console.log('\n=== slots.register ===')
const re2 = /slots\.register\(\s*\{[^}]*name:\s*['"`]([^'"`]+)['"`]/g
while ((m = re2.exec(t)) !== null) console.log(' register:', m[1])
console.log('=== slots.inject ===')
const re3 = /slots\.inject\(\s*['"`]([^'"`]+)['"`]/g
while ((m = re3.exec(t)) !== null) console.log(' inject:', m[1])

// how is TurnProcessNodeView rendered — find the node slot or wrapper
console.log('\n=== TurnProcessNodeView usage ===')
const idx = t.indexOf('TurnProcessNodeView')
console.log('first @', idx)
console.log(t.slice(idx - 200, idx + 400).replace(/\s+/g, ' '))

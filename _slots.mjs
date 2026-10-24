import fs from 'node:fs'
const dir = 'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai'
// find conversation client lib
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
const conv = files.find(f => /dsh-client-ui-conversation[\\/]lib[\\/]client\.js$/.test(f))
console.log('conv client:', conv)
const t = fs.readFileSync(conv, 'utf8')

// all slot names referenced in conversation client
console.log('\n=== slot strings in conversation client ===')
const re = /['"`](conversation\.[a-zA-Z0-9_.]+)['"`]/g
let m; const set = new Set()
while ((m = re.exec(t)) !== null) set.add(m[1])
for (const s of [...set].sort()) console.log(' ', s)

// how is TurnProcessNodeView used / what slot wraps nodes
console.log('\n=== slots.register in conversation client ===')
const re2 = /slots\.register\(\s*\{[^}]*name:\s*['"`]([^'"`]+)['"`]/g
while ((m = re2.exec(t)) !== null) console.log(' register:', m[1])
const re3 = /slots\.inject\(\s*['"`]([^'"`]+)['"`]/g
while ((m = re3.exec(t)) !== null) console.log(' inject:', m[1])

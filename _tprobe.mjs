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
// find slots framework that provides t to registered components
for (const f of files) {
  if (!/client\.js$/.test(f)) continue
  const t = fs.readFileSync(f, 'utf8')
  // search for locale injection into component props
  if (/useTranslation|createTranslator|locale\b.*\bt\b|\bt:\s*|\.t\(/.test(t) && /slots\.register/.test(t)) {
    // find a snippet about providing t
    const i = t.indexOf('locale')
    if (i >= 0) {
      const frag = t.slice(i, i + 200).replace(/\s+/g, ' ')
      if (/t\b/.test(frag)) { console.log(`\n[${f.split('\\').slice(-2).join('/')}] @${i}:`, frag) }
    }
  }
}
// Specifically look at how renderSlot passes t in chat client
const chat = files.find(f => /dsh-client-ui-chat[\\/]lib[\\/]client\.js$/.test(f))
const ct = fs.readFileSync(chat, 'utf8')
// find definition of renderSlot
let idx = ct.indexOf('renderSlot')
while (idx >= 0 && idx < ct.length) {
  const frag = ct.slice(idx, idx + 300).replace(/\s+/g, ' ')
  if (/function renderSlot|const renderSlot|renderSlot =/.test(frag) || frag.includes('locale')) {
    console.log('\n[chat] renderSlot @', idx, ':', frag)
  }
  idx = ct.indexOf('renderSlot', idx + 1)
  if (idx > 500000) break
}

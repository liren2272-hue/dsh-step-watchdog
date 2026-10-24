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
// Find slots framework that injects t. Look in dsh-client-ui-renderer and dsh-client-locale
for (const f of files) {
  if (!/client\.js$/.test(f)) continue
  const t = fs.readFileSync(f, 'utf8')
  // how does renderSlot provide t? Look for 't' being passed as prop in slot render
  if (/locale/.test(t) && /slots\.register|renderSlot/.test(t)) {
    const idx = t.indexOf('function renderSlot')
    if (idx >= 0) { console.log(`\n[${f.split('\\').slice(-2).join('/')}] renderSlot:`, t.slice(idx, idx+500).replace(/\s+/g,' ')); }
  }
}
// Does ScheduleTurnCard use t? and how is it registered with locale -> t
const sched = files.find(f => /dsh-client-ui-schedule[\\/]lib[\\/]client\.js$/.test(f))
const st = fs.readFileSync(sched, 'utf8')
const i = st.indexOf('ScheduleTurnCard(props)')
console.log('\n=== ScheduleTurnCard body head ===')
console.log(st.slice(i, i+600).replace(/\s+/g,' '))
// search for useTranslation or t in schedule
const j = st.indexOf('useTranslation')
console.log('\nuseTranslation @', j, j>=0?st.slice(j-80,j+120).replace(/\s+/g,' '):'(none)')

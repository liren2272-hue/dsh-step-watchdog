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
// How is NS (locale namespace) defined in chat client & how locale json filename maps
const chat = files.find(f => /dsh-client-ui-chat[\\/]lib[\\/]client\.js$/.test(f))
const ct = fs.readFileSync(chat, 'utf8')
console.log('=== NS definition in chat client ===')
const m = ct.match(/const NS\s*=\s*["'`]([^"'`]+)["'`]/)
console.log(m ? m[0] : 'NS not found by simple match')
// locale imports
const re = /locale[/\\][\w.-]+\.json|i18n|createI18n|loadLocale|locale:\s*\w+/g
let mm; const set = new Set()
while ((mm = re.exec(ct)) !== null) set.add(mm[0])
console.log([...set].slice(0,20).join('\n'))

// How a turnTail occupant component receives t — find ScheduleTurnCard signature
const sched = files.find(f => /dsh-client-ui-schedule[\\/]lib[\\/]client\.js$/.test(f))
const st = fs.readFileSync(sched, 'utf8')
const i = st.indexOf('function ScheduleTurnCard')
console.log('\n=== ScheduleTurnCard signature ===')
console.log(i>=0 ? st.slice(i, i+200).replace(/\s+/g,' ') : 'not found as function decl')
// search for ({ turn, t }) pattern among turnTail components
const re2 = /\(\{\s*turn[^}]*\}\)/g
let m2; const out=[]
while ((m2=re2.exec(st))!==null && out.length<5){ out.push(st.slice(m2.index-80,m2.index+120).replace(/\s+/g,' ')) }
console.log(out.join('\n---\n'))

// Confirm turn.end.time type: search comment/usage again
console.log('\n=== turn.end.time usage sample ===')
const k = ct.indexOf('turn.end.time')
console.log(ct.slice(k-120, k+120).replace(/\s+/g,' '))

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
// Find shipped package.json with dsh.client
console.log('=== package.json with dsh.client ===')
for (const f of files) {
  if (!/package\.json$/.test(f)) continue
  let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { continue }
  if (j.dsh && j.dsh.client) {
    console.log('\n', f.split('\\').slice(-3).join('/'))
    console.log('  name:', j.name)
    console.log('  dsh:', JSON.stringify(j.dsh))
  }
}
// Who provides the 'slots' service in client runtime? search client.js for service('slots') / provide('slots')
console.log('\n=== providers of slots service ===')
for (const f of files) {
  if (!/client\.js$/.test(f)) continue
  const t = fs.readFileSync(f, 'utf8')
  if (/service\(\s*["'`]slots["'`]|provide\(\s*["'`]slots["'`]|["'`]slots["'`]\s*:\s*\{|inject:\s*\[[^\]]*slots/.test(t)) {
    const m = t.match(/.{0,40}["'`]slots["'`].{0,60}/)
    console.log(' ', f.split('\\').slice(-2).join('/'), '->', m ? m[0].replace(/\s+/g,' ') : '')
  }
}

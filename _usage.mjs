// Find every usage of turnProcess.* in the chat client (outside the locale blob).
import fs from 'node:fs'
const F = 'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'
const t = fs.readFileSync(F, 'utf8')
const needle = 'turnProcess'
let i = 0, n = 0
const seen = new Set()
while ((i = t.indexOf(needle, i)) !== -1 && n < 30) {
  const s = Math.max(0, i - 120), e = Math.min(t.length, i + 160)
  const frag = t.slice(s, e).replace(/\s+/g, ' ')
  // skip the giant locale JSON blob (it contains the key once as a long run)
  if (frag.length > 260 && frag.includes('message.turnProcess.took') && /[\u4e00-\u9fff]{6,}/.test(frag.slice(0, 80))) { i += needle.length; continue }
  const key = frag.slice(0, 80)
  if (seen.has(key)) { i += needle.length; continue }
  seen.add(key)
  console.log(`\n@${i}:`, frag)
  i += needle.length; n++
}
console.log('\ntotal turnProcess occurrences:', (t.match(/turnProcess/g) || []).length)

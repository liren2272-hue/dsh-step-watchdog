// Print context around '用时' / '已完成' in the most likely UI client files.
import fs from 'node:fs'

const FILES = [
  'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js',
  'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
  'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js',
  'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/locale/zh.json',
]

function ctx(file, needle, span = 220) {
  let t
  try { t = fs.readFileSync(file, 'utf8') } catch { return }
  let i = 0
  let n = 0
  while ((i = t.indexOf(needle, i)) !== -1 && n < 4) {
    const s = Math.max(0, i - span)
    const e = Math.min(t.length, i + needle.length + span)
    console.log(`\n--- ${file.split('lib/').pop()} @${i} ---`)
    console.log(t.slice(s, e).replace(/\s+/g, ' '))
    i += needle.length
    n++
  }
}

for (const f of FILES) {
  console.log('\n########', f.split('node_modules/').pop())
  ctx(f, '用时')
  ctx(f, '已完成')
  ctx(f, '耗时')
}

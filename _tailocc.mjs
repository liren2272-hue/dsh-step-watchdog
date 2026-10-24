import fs from 'node:fs'
const F = 'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'
const t = fs.readFileSync(F, 'utf8')

// Find registrations into conversation.chat.turnTail (list slot) and show the component
console.log('=== registrations into conversation.chat.turnTail ===')
const re = /conversation\.chat\.turnTail/g
let m, n = 0
while ((m = re.exec(t)) !== null && n < 25) {
  // show 600 chars before to capture slots.inject/slots.register and factory
  const s = Math.max(0, m.index - 350), e = Math.min(t.length, m.index + 250)
  const frag = t.slice(s, e).replace(/\s+/g, ' ')
  console.log(`\n--- @${m.index} ---\n${frag}`)
  n++
}

// How does a component get `t`? Search for a turnTail occupant that formats time
console.log('\n=== example: search "t(" usage near turnTail occupants ===')
// find a component function used as turnTail child
const re2 = /function (\w+)\(\{[^}]*turn[^\}]*\}\)/g
let m2
while ((m2 = re2.exec(t)) !== null) {
  const frag = t.slice(m2.index, m2.index + 300).replace(/\s+/g, ' ')
  if (/turnTail|t\(|time|format/.test(frag)) {
    console.log(`\n@${m2.index} ${m2[1]}:`, frag)
  }
}

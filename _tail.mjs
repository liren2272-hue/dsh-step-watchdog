import fs from 'node:fs'
const F = 'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'
const t = fs.readFileSync(F, 'utf8')

// All occurrences of turnTail
console.log('=== turnTail occurrences ===')
const re = /turnTail/g
let m, n = 0
while ((m = re.exec(t)) !== null && n < 20) {
  const s = Math.max(0, m.index - 200), e = Math.min(t.length, m.index + 300)
  console.log(`\n@${m.index}:`, t.slice(s, e).replace(/\s+/g, ' '))
  n++
}

// How does a slot.register occupant get its props? Look at the SlotContext / node shape for conversation.chat.node/turnTail
console.log('\n=== slot.register for turnTail specifically ===')
const re2 = /slots\.register\(\s*\{[^}]*turnTail[^}]*\}/g
let m2
while ((m2 = re2.exec(t)) !== null) {
  console.log(t.slice(m2.index, m2.index + 400).replace(/\s+/g, ' '))
}

// Find a turnTail slot factory definition to learn props
console.log('\n=== turnTail slot definition (factory) ===')
const def = t.indexOf('"conversation.chat.turnTail"')
console.log('def @', def, t.slice(def - 100, def + 300).replace(/\s+/g, ' '))

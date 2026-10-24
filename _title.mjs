import fs from 'node:fs'
const F = 'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js'
const t = fs.readFileSync(F, 'utf8')
const i = t.indexOf('function processTitle')
console.log('processTitle @', i)
console.log(t.slice(i, i + 900).replace(/\s+/g, ' '))

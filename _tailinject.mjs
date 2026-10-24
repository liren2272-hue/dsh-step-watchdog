import fs from 'node:fs'
const base = 'D:/Program Files/Deepseek/resources/app.asar/dsh/node_modules/@deepseek-ai'
for (const name of ['dsh-client-ui-plan','dsh-client-ui-schedule','dsh-client-ui-deliverables']) {
  const p = `${base}/${name}/package.json`
  if (!fs.existsSync(p)) { console.log(name, 'MISSING'); continue }
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  console.log('\n', name)
  console.log('  main:', j.main, '| exports:', JSON.stringify(j.exports))
  console.log('  dsh.client:', JSON.stringify(j.dsh && j.dsh.client))
}
// also confirm the slot is provided by dsh-client-ui-chat
const chatPkg = `${base}/dsh-client-ui-chat/package.json`
console.log('\n chat:', JSON.parse(fs.readFileSync(chatPkg,'utf8')).name, JSON.stringify(JSON.parse(fs.readFileSync(chatPkg,'utf8')).dsh))

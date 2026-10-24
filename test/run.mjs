/**
 * Behaviour tests for the step watchdog. Runs offline against a fake ctx.
 * Usage: node test/run.mjs
 */
import assert from 'node:assert/strict'
import { createHarness } from './harness.mjs'
import { apply } from '../index.js'

// A controllable clock: the plugin reads Date.now(), so override it.
let clock = 1_700_000_000_000
const realNow = Date.now
Date.now = () => clock
const advance = (ms) => { clock += ms }

const scenarios = []
const scenario = (name, fn) => scenarios.push({ name, fn })

async function boot(config) {
  const h = createHarness()
  apply(h.ctx, config)
  return h
}

const sessionEvent = (session, type, extra = {}) => ({ type, data: extra })
const sess = (id) => ({ id })
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r))
}

scenario('a running agent that keeps making progress is never interrupted', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })

  for (let i = 0; i < 30; i += 1) {
    advance(10_000)
    h.emit('session/event', sess('s1'), sessionEvent(null, 'assistant/message'))
    h.tick()
  }
  assert.equal(a.cancels.length, 0, 'no cancel while progress continues')
  assert.equal(a.followups.length, 0)
})

scenario('60s of silence on a running agent cancels the turn and re-drives it', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000, graceMs: 20_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })

  advance(59_000)
  h.tick()
  assert.equal(a.cancels.length, 0, 'not yet at the threshold')

  advance(6_000)
  h.tick()
  assert.equal(a.cancels.length, 1, 'cancel fired past the threshold')
  assert.equal(a.cancels[0].kind, 'hook')
  assert.match(a.cancels[0].reason, /no observable progress/)
  // The fake agent settles synchronously on cancel, so the restart completes.
  await settle()
  assert.equal(a.followups.length, 1, 'one re-drive message')
  assert.equal(a.followups[0].content[0].type, 'text')
  assert.equal(a.followups[0].source.kind, 'step-watchdog')
  // The loop appends this object to the durable surface verbatim, so it must
  // already be a complete message: a missing role corrupts the stored session.
  assert.equal(a.followups[0].role, 'user', 're-drive message must carry role "user"')
  assert.match(
    a.followups[0].id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    're-drive message needs a UUID id',
  )
})

scenario('the cancel keeps the inbox so the rescue message survives', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })

  advance(61_000)
  h.tick()
  assert.equal(a.cancels.length, 1)
  // Without keepInbox the driver clears next-turn, which swallows exactly the
  // message a human sends to rescue the turn ("continue with this model").
  assert.deepEqual(
    a.cancelOptions[0],
    { keepInbox: true },
    'cancel must keep pending inbox input',
  )
})

scenario('an idle agent is never touched', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000 })
  const a = h.agent('s1', 'idle')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })
  a.status = 'idle'
  h.emit('agent/status', { agent: a, status: 'idle' })
  advance(600_000)
  h.tick()
  assert.equal(a.cancels.length, 0)
})

scenario('a tool exceeding the explicit hang ceiling is interrupted', async () => {
  const h = await boot({ stallMs: 60_000, inflightToolGraceMs: 120_000, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })
  h.emit('session/event', sess('s1'), sessionEvent(null, 'tool/call', { callId: 'c1', name: 'pwsh' }))

  advance(100_000)
  h.tick()
  assert.equal(a.cancels.length, 0, 'a tool still running at 100s is within the 120s ceiling')

  advance(90_000)
  h.tick()
  assert.equal(a.cancels.length, 1, 'the 120s ceiling is absolute, so it fires past it')
})

scenario('a long in-flight tool is tolerated and never interrupted (inflightToolGraceMs 0)', async () => {
  const h = await boot({ stallMs: 60_000, inflightToolGraceMs: 0, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })
  h.emit('session/event', sess('s1'), sessionEvent(null, 'tool/call', { callId: 'c1', name: 'extract' }))

  // Far longer than stallMs; a genuine long task must survive.
  for (let i = 0; i < 12; i += 1) {
    advance(60_000)
    h.tick()
  }
  assert.equal(a.cancels.length, 0, 'an in-flight tool running for 12m is never interrupted')

  // When the tool finally returns, the agent is no longer "working on a tool".
  h.emit('session/event', sess('s1'), sessionEvent(null, 'tool/result', { callId: 'c1' }))
  // Now if the model stalls with no tool pending, the watchdog still fires.
  advance(61_000)
  h.tick()
  assert.equal(a.cancels.length, 1, 'a real model stall (no in-flight tool) is still caught')
})

scenario('a stuck agent is restarted at most maxRestartsPerTurn times', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000, maxRestartsPerTurn: 2 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })

  for (let i = 0; i < 6; i += 1) {
    advance(61_000)
    h.tick()
    await settle()
  }
  assert.equal(a.cancels.length, 2, 'budget stops further cancels')
  assert.equal(a.followups.length, 2)
  assert.ok(
    h.ctx.logger.warns.some((m) => m.includes('gave up')),
    'gives up loudly: ' + JSON.stringify(h.ctx.logger.warns),
  )
  assert.ok(
    h.ctx.logger.warns.some((m) => m.includes('needs a different model')),
    'the give-up line names the remedy',
  )
})

scenario('a turn that ends on its own re-arms the restart budget', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000, maxRestartsPerTurn: 1 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })

  advance(61_000)
  h.tick()
  await settle()
  assert.equal(a.cancels.length, 1)

  // The turn ends and a new one begins.
  h.emit('session/event', sess('s1'), sessionEvent(null, 'turn/end', { turn: 1 }))
  h.emit('session/event', sess('s1'), sessionEvent(null, 'turn/start', { turn: 2 }))
  advance(61_000)
  h.tick()
  await settle()
  assert.equal(a.cancels.length, 2, 'a fresh turn gets a fresh budget')
})

scenario('stream chunks count as progress', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })
  for (let i = 0; i < 20; i += 1) {
    advance(30_000)
    h.emit('agent/assistant-stream', { agent: a, frame: { type: 'chunk' } })
    h.tick()
  }
  assert.equal(a.cancels.length, 0)
})

scenario('waiting on a human pauses the clock', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })

  let release
  const pending = new Promise((r) => { release = r })
  const answer = h.waterfall('approval/request', { agent: a }, () => pending)
  advance(600_000)
  h.tick()
  assert.equal(a.cancels.length, 0, 'no cancel while an approval is pending')
  release('allow')
  await answer
  advance(61_000)
  h.tick()
  assert.equal(a.cancels.length, 1, 'the clock resumes after the human answers')
})

scenario('a tool that ignores the abort is abandoned, not retried forever', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000, graceMs: 20_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  //cancel is a no-op: the turn never settles.
  a.cancel = () => { a.cancels.push({ kind: 'hook' }) }
  h.emit('agent/status', { agent: a, status: 'running' })

  advance(61_000)
  h.tick()
  assert.equal(a.cancels.length, 1)
  h.fireTimeouts() // grace window elapses
  await settle()
  assert.equal(a.followups.length, 0, 'no re-drive while still running')
  advance(600_000)
  h.tick()
  assert.equal(a.cancels.length, 1, 'no repeated cancels after giving up')
  assert.ok(h.ctx.logger.warns.some((m) => m.includes('gave up')))
})

/**
 * Compaction regression: the whole point of the fix. An automatic compaction
 * runs inside `agent/pre-step` and emits nothing until it ends, so it used to
 * look identical to a hung model and was cut at stallMs.
 */
scenario('a long compaction is tolerated and never counts as a model stall', async () => {
  const h = await boot({ stallMs: 60_000, compactionMs: 300_000, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })

  h.emit('session/event', sess('s1'), sessionEvent(null, 'compaction/start', { compactionId: 'c1' }))
  // Well past stallMs, still under the ceiling: this is the case that used to
  // be killed as a "model stall" and abort the summarization stream.
  for (let i = 0; i < 8; i += 1) {
    advance(30_000)
    h.tick()
  }
  assert.equal(a.cancels.length, 0, 'compaction is exempt from the stall clock')

  h.emit('session/event', sess('s1'), sessionEvent(null, 'compaction/end', { compactionId: 'c1' }))
  // The turn is healthy again; the model should now get its own window.
  advance(61_000)
  h.tick()
  assert.equal(a.cancels.length, 1, 'a real model stall after compaction is still caught')
  await settle()
  assert.equal(a.followups.length, 1, 're-drive still happens')
})

scenario('a compaction past compactionMs is interrupted as a compaction stall', async () => {
  const h = await boot({ stallMs: 60_000, compactionMs: 120_000, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })
  h.emit('session/event', sess('s1'), sessionEvent(null, 'compaction/start', { compactionId: 'c1' }))

  advance(100_000)
  h.tick()
  assert.equal(a.cancels.length, 0, 'under the compaction ceiling')

  advance(40_000)
  h.tick()
  assert.equal(a.cancels.length, 1, 'the compaction ceiling is absolute')
  await settle()
  assert.equal(a.followups.length, 1)
  assert.match(
    a.followups[0].content[0].text,
    /上下文压缩/,
    'the re-drive message names compaction as the cause',
  )
})

scenario('compactionMs 0 never interrupts a compaction', async () => {
  const h = await boot({ stallMs: 60_000, compactionMs: 0, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })
  h.emit('session/event', sess('s1'), sessionEvent(null, 'compaction/start', { compactionId: 'c1' }))

  for (let i = 0; i < 40; i += 1) {
    advance(60_000)
    h.tick()
  }
  assert.equal(a.cancels.length, 0, '0 disables the ceiling entirely')
})

scenario('an interrupted re-drive tells the human to switch models', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000, remindSwitchAfter: 1 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  // The last issued request used buddy/hy3…
  a.session.headerConfig = { provider: 'buddy', model: 'hy3' }
  h.emit('agent/status', { agent: a, status: 'running' })
  // …and the human has since selected qodercn/dfmodel, which was never consumed.
  h.emit('session/event', sess('s1'), sessionEvent(null, 'model/selection', {
    provider: 'qodercn', model: 'dfmodel',
  }))

  advance(61_000)
  h.tick()
  await settle()

  const text = a.followups[0].content[0].text
  assert.match(text, /qodercn\/dfmodel/, 'names the model the human selected')
  assert.match(text, /buddy\/hy3/, 'names the route the last request actually used')
  assert.match(text, /切换/, 'tells the human to switch')
  assert.match(text, /第 1 次中断/, 'counts the interrupt')
})

scenario('the switch reminder can be disabled', async () => {
  const h = await boot({ stallMs: 60_000, tickMs: 5_000, remindSwitchAfter: 99 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  a.session.headerConfig = { provider: 'buddy', model: 'hy3' }
  h.emit('agent/status', { agent: a, status: 'running' })

  advance(61_000)
  h.tick()
  await settle()
  const text = a.followups[0].content[0].text
  assert.ok(!text.includes('第 1 次中断'), 'no per-interrupt advice before the threshold')
})

/**
 * The `[object Object]` symptom: a cancelled compaction is recorded by
 * `errorChain()` as `String(plainObject)`, which hid the real cause behind an
 * unreadable literal. The watchdog must name it instead of echoing it.
 */
scenario('a cancelled compaction is reported as an abort, not as [object Object]', async () => {
  const h = await boot({ stallMs: 60_000, compactionMs: 120_000, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  a.session.headerConfig = { provider: 'buddy', model: 'hy3' }
  h.emit('agent/status', { agent: a, status: 'running' })

  h.emit('session/event', sess('s1'), sessionEvent(null, 'compaction/start', { compactionId: 'c1' }))
  advance(130_000)
  h.tick()                                   // watchdog cancels the compaction
  h.emit('session/event', sess('s1'), sessionEvent(null, 'compaction/end', {
    compactionId: 'c1', error: '[object Object]',
  }))

  const warns = h.ctx.logger.warns.join('\n')
  assert.match(warns, /aborted by this watchdog/, 'names the real cause')
  assert.match(warns, /buddy\/hy3/, 'names the route compaction was pinned to')
  assert.ok(!/did not complete: \[object Object\]/.test(warns), 'never echoes the unreadable literal')
})

scenario('three lost compactions in a row are called out once', async () => {
  const h = await boot({ stallMs: 600_000, compactionMs: 0, tickMs: 5_000 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  a.session.headerConfig = { provider: 'buddy', model: 'hy3' }
  h.emit('agent/status', { agent: a, status: 'running' })

  for (let i = 0; i < 4; i += 1) {
    h.emit('session/event', sess('s1'), sessionEvent(null, 'compaction/start', { compactionId: `c${i}` }))
    advance(1_000)
    h.emit('session/event', sess('s1'), sessionEvent(null, 'compaction/end', {
      compactionId: `c${i}`, error: 'quota exceeded',
    }))
  }
  const hits = h.ctx.logger.warns.filter((m) => m.includes('3 compactions in a row'))
  assert.equal(hits.length, 1, 'warns exactly once at the third loss')
})

let failures = 0
for (const { name, fn } of scenarios) {
  try {
    await fn()
    console.log('ok   -', name)
  } catch (error) {
    failures += 1
    console.log('FAIL -', name, '\n     ', error.message)
  }
}
Date.now = realNow
console.log(failures === 0 ? `\nall ${scenarios.length} scenarios passed` : `\n${failures} failing`)
process.exit(failures === 0 ? 0 : 1)

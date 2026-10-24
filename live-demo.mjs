/**
 * Live, real-wall-clock demonstration of the step watchdog's compaction fix.
 *
 * Unlike test/run.mjs (which freezes Date.now), this script drives the REAL
 * apply() with the genuine system clock and a real setInterval ticker, so a
 * multi-second compaction runs against real elapsed time. Two cases:
 *
 *   1. TOLERANCE  — compaction longer than stallMs but under compactionMs is
 *                   exempt from the stall clock: zero interrupts, and the
 *                   watchdog logs "compacted in Nms (tolerated)".
 *   2. CEILING     — compaction exceeding compactionMs is interrupted and the
 *                   re-drive names compaction as the cause.
 *
 * Usage: ELECTRON_RUN_AS_NODE=1 "<harness exe>" live-demo.mjs
 */
import assert from 'node:assert/strict'
import { createHarness } from './test/harness.mjs'
import { apply } from './index.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SESS = { id: 's1' }

async function toleranceCase() {
  console.log('\n=== CASE 1: long compaction is tolerated (real time) ===')
  const h = createHarness()
  // stallMs 2s, compaction ceiling 15s — a 12s real compaction must survive.
  apply(h.ctx, { stallMs: 2_000, compactionMs: 15_000, tickMs: 1_000, graceMs: 2_000, maxRestartsPerTurn: 1, remindSwitchAfter: 1 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })

  const ticker = setInterval(() => h.tick(), 1_000)

  console.log('  t=0     agent running, compaction/start')
  h.emit('session/event', SESS, { type: 'compaction/start', data: { compactionId: 'c1' } })

  const waitMs = 12_000
  await sleep(waitMs)
  console.log(`  t=12s   cancels during compaction = ${a.cancels.length} (expect 0)`)
  assert.equal(a.cancels.length, 0, 'a 12s compaction must NOT be interrupted (exempt from stall clock)')

  console.log('  t=12s   compaction/end (clean finish)')
  h.emit('session/event', SESS, { type: 'compaction/end', data: { compactionId: 'c1' } })
  await sleep(300)
  clearInterval(ticker)

  const tolerated = h.ctx.logger.infos.find((m) => /compacted in .* \(tolerated/.test(m))
  console.log('  tolerated log:', tolerated ?? '(none)')
  assert.ok(tolerated, 'watchdog must log the tolerated completion')
  assert.ok(/tolerated: compaction is exempt from the stall clock/.test(tolerated))
  console.log('  PASS: compaction tolerated, no interrupt, completion logged')
}

async function ceilingCase() {
  console.log('\n=== CASE 2: compaction past the ceiling is interrupted ===')
  const h = createHarness()
  // ceiling 8s: a 10s real compaction must be cut and re-driven.
  apply(h.ctx, { stallMs: 2_000, compactionMs: 8_000, tickMs: 1_000, graceMs: 2_000, maxRestartsPerTurn: 1, remindSwitchAfter: 1 })
  const a = h.agent('s1', 'running')
  h.ctx.agentsMap.set('s1', a)
  h.emit('agent/status', { agent: a, status: 'running' })

  const ticker = setInterval(() => h.tick(), 1_000)

  console.log('  t=0     agent running, compaction/start')
  h.emit('session/event', SESS, { type: 'compaction/start', data: { compactionId: 'c2' } })

  await sleep(10_000)
  console.log(`  t=10s   cancels = ${a.cancels.length} (expect 1)`)
  assert.equal(a.cancels.length, 1, 'a 10s compaction must be interrupted past the 8s ceiling')
  await sleep(300)
  clearInterval(ticker)

  const text = a.followups[0]?.content?.[0]?.text ?? ''
  console.log('  re-drive names compaction:', /上下文压缩/.test(text))
  assert.ok(/上下文压缩/.test(text), 're-drive message must name compaction as the cause')
  console.log('  PASS: over-ceiling compaction interrupted with compaction-cause re-drive')
}

const start = Date.now()
await toleranceCase()
await ceilingCase()
const elapsed = ((Date.now() - start) / 1000).toFixed(1)
console.log(`\nALL LIVE CASES PASSED in ${elapsed}s real time (real clock, real module).`)
process.exit(0)

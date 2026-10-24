/**
 * Step watchdog: interrupt an agent whose work stops making progress, then
 * re-drive the task with one steering message.
 *
 * "Progress" is anything the harness can observe: a turn/step boundary, a tool
 * call or result, a durable message, or one streamed assistant chunk. When a
 * running agent shows none of those for `stallMs`, the turn is cancelled with a
 * `hook` cause and, once the agent is idle again, one follow-up message asks it
 * to continue the task from where it stopped.
 *
 * ## Why compaction is treated as its own phase
 *
 * Automatic compaction runs inside `agent/pre-step` (`dsh-compaction-basic`
 * registers `ctx.on('agent/pre-step', …)` and awaits `compactIfNeeded`), i.e.
 * BEFORE the step's model request is even built. While it runs, the session log
 * gains nothing the watchdog used to count, so a legitimate 45–60s compaction
 * looked exactly like a hung model: the turn was cancelled at `stallMs`, the
 * in-flight summarization stream was aborted by that same signal, and the abort
 * landed in the log as `compaction/end { error: "[object Object]" }` a few ms
 * before `turn/end`.
 *
 * Measured over every log in `~/.dsh/sessions`: 47 turns ran compaction, 34 of
 * them never issued a single model request, and the 43 failed compactions had a
 * p50 of 59.2s — the stall threshold. Switching models could never help there,
 * because compaction resolves its route from `session.requestHeader()` (the last
 * request that actually went out), while a switch only writes `model/selection`
 * and is consumed by the NEXT request. The turn died before that request.
 *
 * So: compaction gets its own generous ceiling (`compactionMs`) and never counts
 * against the model stall clock, and every interrupt now explains itself and
 * tells the human to switch models.
 */

import { randomUUID } from 'node:crypto'

export const inject = ['agents', 'timer']

/**
 * Build the steering message the way the harness's own entry points do.
 *
 * `agent.followup()` accepts a caller-supplied object and appends it to the
 * session surface verbatim, so the producer — not the loop — owns the message
 * shape. A bare `{ content, source }` therefore lands in the durable log as a
 * `user/message` event with no `role`, which fails the session validator on the
 * next load (`message must have role "user"`). Always emit a complete message.
 */
function createSteeringMessage(text) {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'step-watchdog' },
    id: randomUUID(),
  }
}

const DEFAULTS = {
  /** No observable progress for this long means the step is stuck. */
  stallMs: 60_000,
  /**
   * Ceiling (ms) for one automatic compaction before it is treated as hung.
   * Compaction is real work that produces no session events until it finishes,
   * so it is exempt from `stallMs` and only this ceiling may interrupt it.
   * Measured compactions: p50 ≈ 59s when cut short, 45–53s when they complete,
   * so the default leaves room for the slow-but-healthy case. 0 disables the
   * ceiling entirely (never interrupt a compaction).
   */
  compactionMs: 300_000,
  /**
   * Optional absolute ceiling (ms) for a single in-flight tool dispatch before
   * it is treated as hung and interrupted. While a tool is merely running, the
   * watchdog never interrupts it — long tasks (extractions, builds, probes…)
   * are tolerated, only genuine model stalls are. 0 (default) means: never
   * interrupt an in-flight tool; raise it only if you also want truly hung tool
   * calls to be caught after this long.
   */
  inflightToolGraceMs: 0,
  /** How often the clock is checked. */
  tickMs: 5_000,
  /** How long to wait for the cancelled turn to quiesce. */
  graceMs: 20_000,
  /** How many automatic restarts one stuck stretch may trigger. */
  maxRestartsPerTurn: 2,
  /**
   * From which restart on the re-drive message tells the human to switch
   * models. 1 = every interrupt carries the advice.
   */
  remindSwitchAfter: 1,
  /** Message that re-drives the task after an interrupt. */
  prompt: '上一步长时间没有任何进展，已被看门狗自动中断。请从中断处继续执行原来的任务，不要重复已经完成的工作；如果怀疑某个工具调用挂住了，换一种方式，或先检查外部状态再继续。',
  /** Re-drive message used when the whole turn was spent inside compaction. */
  compactionPrompt: '上一轮把整个回合花在了上下文压缩（compaction）上，模型请求始终没有发出，已被看门狗自动中断。请从中断处继续执行原来的任务，不要重复已经完成的工作。',
}

/**
 * Session event types that count as observable progress.
 * @type {ReadonlySet<string>}
 */
const PROGRESS_EVENTS = new Set([
  'turn/start',
  'turn/end',
  'step/start',
  'step/end',
  'user/message',
  'assistant/message',
  'assistant/attempt',
  'tool/call',
  'tool/result',
  'system/message',
  'developer/message',
  'llm/retry',
  'llm/retry-started',
  // Compaction brackets: they prove the turn is alive, and they are what makes
  // the dedicated compaction ceiling possible instead of a false stall.
  'compaction/start',
  'compaction/end',
  'compaction/prune',
  // A pending model switch is worth observing: it explains why the routed
  // model can differ from the one the human just picked.
  'model/selection',
  // Delegated work and long jobs advance without touching this session's
  // surface; without them a healthy delegation looks stalled.
  'subagent/start',
  'subagent/end',
  'job/settled',
  'todo/write',
  'command/run',
  'command/done',
])

/**
 * `errorChain()` renders a thrown non-`Error` by `String(value)`, so a cancelled
 * compaction — the abort lands as a plain object — is recorded as the literal
 * `"[object Object]"`. Recognising it is what turns an unreadable log line into
 * the real finding: this compaction was cancelled, it did not fail upstream.
 */
const UNREADABLE_ERROR = '[object Object]'

/** Read the route (`provider/model`) the last issued request actually used. */
function routeOf(session) {
  try {
    const config = session?.requestHeader?.()?.config
    if (config?.provider && config?.model) return `${config.provider}/${config.model}`
  } catch { /* requestHeader is optional on a detached session */ }
  return undefined
}

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const now = () => Date.now()

  /**
   * Start work outside the HMR transaction this plugin was loaded inside.
   *
   * HMR serializes profile mutations in an AsyncLocalStorage transaction, and
   * every async resource created while it is active keeps the marker for the
   * rest of its life — including the interval this plugin arms during `apply`.
   * A turn re-driven from such a context inherits it, so every profile mutation
   * that turn later attempts fails with "HMR transactions cannot be nested".
   * HMR's own watcher registration escapes the same way; do it here too.
   */
  const outsideTransaction = (operation) => {
    const executing = ctx.get?.('hmr')?.executing
    if (executing === undefined || typeof executing.exit !== 'function') return operation()
    return executing.exit(operation)
  }

  /**
   * @type {Map<string, {
   *   lastProgress: number, restarts: number, cancelling: boolean,
   *   inflight: number, toolStartedAt: number, complained: boolean,
   *   compactStartedAt: number, compactFailures: number,
   *   pendingSelection: { provider?: string, model?: string } | undefined,
   * }>}
   */
  const watched = new Map()
  /** In-flight human interactions: an agent waiting on us is not stuck. */
  let waitingOnHuman = 0

  const entry = (id) => {
    let s = watched.get(id)
    if (s === undefined) {
      s = {
        lastProgress: now(),
        restarts: 0,
        cancelling: false,
        inflight: 0,
        toolStartedAt: 0,
        complained: false,
        compactStartedAt: 0,
        compactFailures: 0,
        pendingSelection: undefined,
      }
      watched.set(id, s)
    }
    return s
  }

  const touch = (id) => {
    const s = watched.get(id)
    if (s === undefined) return
    s.lastProgress = now()
  }

  /**
   * Explain one finished compaction in the host log.
   *
   * The durable field is whatever `errorChain()` produced, which for a plain
   * object is `"[object Object]"` — no cause, no code, no message. Reporting it
   * verbatim would leave the next reader exactly where this investigation
   * started, so the two cases are named explicitly and the route is included:
   * compaction always summarises with the LAST issued route, which is why a
   * model switch cannot reach it.
   */
  const reportCompaction = (session, s, elapsedMs, errorText) => {
    const id = session?.id
    // The live Session reaches this listener in the Host, but a detached or
    // synthetic one may not expose requestHeader(); the agent's own Session is
    // the same object and is always authoritative for the routed config.
    const route = routeOf(session) ?? routeOf(ctx.agents.get(id)?.session)
    if (errorText === undefined) {
      s.compactFailures = 0
      if (elapsedMs >= cfg.stallMs) {
        ctx.logger.info(
          `step-watchdog: session "${id}" compacted in ${elapsedMs}ms on ${route ?? 'an unknown route'}`
          + ' (tolerated: compaction is exempt from the stall clock)',
        )
      }
      return
    }
    s.compactFailures += 1
    const cause = errorText === UNREADABLE_ERROR
      ? (s.cancelling
        ? 'aborted by this watchdog'
        : 'aborted, not a provider error')
      : errorText
    ctx.logger.warn(
      `step-watchdog: session "${id}" compaction ran ${elapsedMs}ms on ${route ?? 'an unknown route'}`
      + ` and did not complete: ${cause}`,
    )
    if (s.compactFailures === 3) {
      ctx.logger.warn(
        `step-watchdog: session "${id}" has now lost 3 compactions in a row;`
        + ' the transcript is likely pinned near the context ceiling, so every'
        + ' turn pays the compaction cost before it can reach the model.',
      )
    }
  }

  /**
   * The human-facing reminder carried by every re-drive message.
   *
   * A model cannot switch its own route, so the advice is written for the human
   * reading the transcript, and it is grounded in two facts the log already
   * holds: the route the last request used, and any selection that has been
   * recorded but not yet consumed.
   */
  const switchModelReminder = (s, session, cause) => {
    const route = routeOf(session) ?? routeOf(ctx.agents.get(session?.id)?.session)
    const pending = s.pendingSelection
    const lines = []
    if (cause === 'compaction') {
      lines.push('中断原因：整个回合都花在上下文压缩上，模型请求从未发出——不是你选的那个模型慢。')
    }
    if (pending?.provider !== undefined && pending?.model !== undefined) {
      const wanted = `${pending.provider}/${pending.model}`
      if (route !== undefined && route !== wanted) {
        lines.push(
          `你已经把本会话切到 ${wanted}，但最近一次请求仍由 ${route} 发出：`
          + '切换要等下一次请求才会被消费，而压缩始终沿用上一次请求的模型。',
        )
      }
    } else if (route !== undefined) {
      lines.push(`最近一次请求使用的模型是 ${route}。`)
    }
    if (s.restarts >= cfg.remindSwitchAfter) {
      lines.push(
        `这是本回合第 ${s.restarts} 次中断。请手动切换到其它模型（或降低思考档位）后再继续；`
        + '模型自身无法切换自己的路由。',
      )
    }
    return lines.join('')
  }

  // Track live agents and their running/idle edges.
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') entry(agent.id)
    else watched.delete(agent.id)
  })

  ctx.on('agent/disposed', ({ agent }) => watched.delete(agent.id))

  // One streamed chunk is proof the model and the transport are alive.
  ctx.on('agent/assistant-stream', ({ agent }) => touch(agent.id))

  // Any durable append means the loop advanced. This is the source of truth:
  // it covers retries and synthetic results that never produce a stream frame.
  ctx.on('session/event', (session, event) => {
    if (!PROGRESS_EVENTS.has(event.type)) return
    if (!watched.has(session.id)) {
      // A turn/step boundary may be the first thing we see for a session.
      if (event.type === 'turn/start' || event.type === 'step/start') entry(session.id)
      else return
    }
    const s = watched.get(session.id)
    s.lastProgress = now()
    if (event.type === 'turn/end' && !s.cancelling) {
      // A turn that ended on its own re-arms the budget for the next one.
      // A turn we cancelled does not, or a stuck step could loop forever.
      s.restarts = 0
      s.complained = false
      s.compactStartedAt = 0
    }
    if (event.type === 'tool/call') {
      s.inflight += 1
      // Remember when the current in-flight batch started, so an explicit
      // `inflightToolGraceMs` ceiling can still catch a truly hung tool.
      if (s.inflight === 1) s.toolStartedAt = now()
    } else if (event.type === 'tool/result') {
      s.inflight = Math.max(0, s.inflight - 1)
      if (s.inflight === 0) s.toolStartedAt = 0
    } else if (event.type === 'turn/end' || event.type === 'turn/start') {
      s.inflight = 0
      s.toolStartedAt = 0
    } else if (event.type === 'compaction/start') {
      s.compactStartedAt = now()
    } else if (event.type === 'compaction/end') {
      const startedAt = s.compactStartedAt
      const elapsed = startedAt > 0 ? now() - startedAt : 0
      s.compactStartedAt = 0
      const raw = event.data?.error
      reportCompaction(session, s, elapsed, raw === undefined ? undefined : String(raw))
    } else if (event.type === 'model/selection') {
      s.pendingSelection = {
        provider: event.data?.provider,
        model: event.data?.model,
      }
    }
  })

  // An approval or a question blocks progress on purpose: an agent waiting on
  // us is not stuck, so the clock stops until the interaction settles.
  const holdForHuman = (next) => {
    waitingOnHuman += 1
    let held = true
    const release = () => {
      if (!held) return
      held = false
      waitingOnHuman -= 1
    }
    try {
      const result = next()
      if (result && typeof result.then === 'function') {
        return result.then(
          (value) => { release(); return value },
          (error) => { release(); throw error },
        )
      }
      release()
      return result
    } catch (error) {
      release()
      throw error
    }
  }
  ctx.on('approval/request', (_req, next) => holdForHuman(next))
  ctx.on('user-questions/request', (_req, next) => holdForHuman(next))

  const abandon = (agent, s, reason) => {
    s.cancelling = false
    if (s.complained) return
    s.complained = true
    ctx.logger.warn(
      `step-watchdog: agent "${agent.id}" gave up: ${reason};`
      + ' the task needs a different model or a fresh session to continue',
    )
  }

  async function restart(agent, s, stalledFor, cause) {
    s.cancelling = true
    s.restarts += 1
    ctx.logger.warn(
      cause === 'compaction'
        ? `step-watchdog: agent "${agent.id}" spent ${stalledFor}ms inside compaction; `
          + `interrupting turn (restart ${s.restarts}/${cfg.maxRestartsPerTurn})`
        : `step-watchdog: agent "${agent.id}" made no progress for ${stalledFor}ms; `
          + `interrupting turn (restart ${s.restarts}/${cfg.maxRestartsPerTurn})`,
    )
    try {
      // Keep the queue. The user's own stop keeps it (`session/controller`
      // cancels with `keepInbox: true`); dropping it here used to swallow the
      // very message — often "try this other model" — sent to rescue the turn.
      agent.cancel(
        { kind: 'hook', reason: `no observable progress for ${stalledFor}ms` },
        { keepInbox: true },
      )
    } catch (error) {
      abandon(agent, s, `cancel failed: ${String(error)}`)
      return
    }

    // A tool that ignores its abort signal never lets the turn settle. Stop
    // waiting instead of blocking the watchdog forever.
    await Promise.race([
      Promise.resolve(agent.whenIdle()).catch(() => undefined),
      ctx.timer.timeout(cfg.graceMs).catch(() => undefined),
    ])

    if (agent.status === 'running') {
      abandon(agent, s, `still running ${cfg.graceMs}ms after cancel; the stuck work ignored the abort`)
      return
    }

    const head = cause === 'compaction' ? cfg.compactionPrompt : cfg.prompt
    const reminder = switchModelReminder(s, agent.session, cause)
    const text = reminder === '' ? head : `${head}\n\n${reminder}`
    try {
      agent.followup(createSteeringMessage(text))
    } catch (error) {
      abandon(agent, s, `re-drive failed: ${String(error)}`)
      return
    }
    s.cancelling = false
    s.lastProgress = now()
    ctx.logger.info(`step-watchdog: agent "${agent.id}" re-driven after interrupt`)
  }

  ctx.effect(() => ctx.timer.interval(() => outsideTransaction(() => {
    if (waitingOnHuman > 0) return
    for (const [id, s] of watched) {
      if (s.cancelling || s.complained) continue
      const agent = ctx.agents.get(id)
      if (agent === undefined || agent.status !== 'running') continue
      if (s.restarts >= cfg.maxRestartsPerTurn) {
        abandon(agent, s, `no progress after ${s.restarts} automatic restarts`)
        continue
      }
      // A compacting turn is active work: it emits nothing until it finishes,
      // and cutting it aborts the summarization stream, which then records an
      // unreadable `[object Object]` failure. Only `compactionMs` may stop it.
      if (s.compactStartedAt > 0) {
        const elapsed = now() - s.compactStartedAt
        if (!(cfg.compactionMs > 0 && elapsed > cfg.compactionMs)) continue
        void restart(agent, s, elapsed, 'compaction')
        continue
      }
      // Tolerate an in-flight tool: long-running tasks are active work, not a
      // stall. `inflightToolGraceMs` (default 0 = off) is an OPTIONAL absolute
      // ceiling for catching a genuinely hung tool; it is the ONLY way an
      // in-flight tool is ever interrupted. Reach it and we treat the call as
      // stuck — no second stallMs window is added on top.
      const toolElapsed = s.inflight > 0 ? now() - s.toolStartedAt : 0
      if (s.inflight > 0 && !(cfg.inflightToolGraceMs > 0 && toolElapsed > cfg.inflightToolGraceMs)) {
        continue
      }
      const stalledFor = s.inflight > 0 ? toolElapsed : now() - s.lastProgress
      // Report the wait on the agent's own clock.
      if (stalledFor < cfg.stallMs) continue
      void restart(agent, s, stalledFor, 'model')
    }
  }), cfg.tickMs))
}

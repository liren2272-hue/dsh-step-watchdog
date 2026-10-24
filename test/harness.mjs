/**
 * Offline harness for the step watchdog: a fake Cordis `ctx` that drives the
 * plugin's apply() with the listener/event surface it actually uses, so the
 * watchdog logic can be exercised without a running DSH host.
 */

export function createHarness(config) {
  const listeners = new Map() // name -> [{fn, opts}]
  const timers = [] // {delay, fn, disposed}

  const addListener = (name, fn, opts) => {
    if (!listeners.has(name)) listeners.set(name, [])
    listeners.get(name).push({ fn, opts })
  }

  const agent = (id, status = 'idle') => {
    const a = {
      id,
      status,
      cancels: [],
      cancelOptions: [],
      followups: [],
      idleWaiters: [],
      session: {
        id,
        // Mirrors the real Session: the routed config of the LAST issued request.
        headerConfig: undefined,
        requestHeader() {
          return a.session.headerConfig === undefined
            ? undefined
            : { config: a.session.headerConfig }
        },
      },
      cancel(cause, options) {
        a.cancels.push(cause)
        a.cancelOptions.push(options)
        // Mirrors the real driver: a cancel makes the turn settle.
        if (a.status !== 'running') return
        a.status = 'idle'
        for (const w of a.idleWaiters.splice(0)) w()
      },
      whenIdle() {
        if (a.status !== 'running') return Promise.resolve()
        return new Promise((resolve) => a.idleWaiters.push(resolve))
      },
      followup(msg) {
        a.followups.push(msg)
        // Mirrors the real driver: an admitted message re-opens a turn.
        a.status = 'running'
      },
    }
    return a
  }

  const ctx = {
    logger: {
      warns: [],
      infos: [],
      warn(m) { ctx.logger.warns.push(String(m)); console.log('[warn]', m) },
      info(m) { ctx.logger.infos.push(String(m)); console.log('[info]', m) },
      error(m) { ctx.logger.warns.push(String(m)); console.log('[error]', m) },
      debug() {},
    },
    on(name, fn, opts) { addListener(name, fn, opts); return () => {} },
    effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
    get() { return undefined },
    timer: {
      timeout(delay) {
        // Manual clock: only fires when the harness advances time.
        return new Promise((resolve, reject) => {
          timers.push({ delay, resolve, reject, kind: 'timeout' })
        })
      },
      interval(fn, delay) {
        timers.push({ delay, fn, kind: 'interval' })
        return () => {}
      },
    },
    agents: new Map(), // id -> agent
  }
  ctx.agents.get = (id) => ctx.agentsMap?.get(id)
  ctx.agentsMap = new Map()

  const emit = (name, ...args) => {
    const fns = listeners.get(name) ?? []
    const results = []
    for (const { fn } of fns) results.push(fn(...args))
    return results
  }

  const waterfall = (name, payload, next) => {
    const fns = listeners.get(name) ?? []
    if (fns.length === 0) return Promise.resolve(next())
    // Only one listener per name in this harness; wrap `next` once.
    return Promise.resolve(fns[0].fn(payload, next))
  }

  const tick = () => {
    for (const t of timers) if (t.kind === 'interval') t.fn()
  }

  const fireTimeouts = () => {
    for (const t of timers) if (t.kind === 'timeout') t.resolve()
  }

  const settleTimeouts = () => {
    for (const t of timers) if (t.kind === 'timeout') t.reject(new Error('disposed'))
    timers.length = 0
  }

  return { ctx, agent, emit, waterfall, tick, fireTimeouts, settleTimeouts, listeners, config }
}

export function makeNow() {
  let t = 1_700_000_000_000
  return {
    now: () => t,
    advance(ms) { t += ms },
    set(ms) { t = ms },
  }
}

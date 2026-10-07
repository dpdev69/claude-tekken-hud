import { mock, test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseDebt, parseMix } from './register'

// The engine fills scroll and view; the band reads neither.
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100 } as never

const USAGE = {
  startedAt: 0,
  context: { window: 200000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 63, resetsAt: '2026-10-07T23:57:00Z' },
    { kind: 'seven_day', percentUsed: 95 },
  ],
}

test('versus row, stamina with final round, and each agent with its duty', async ($, on) => {
  on('agent.list', () => ({
    value: [
      { id: 'a1', type: 'Explore', status: 'running', description: 'scan' },
      { id: 'a2', type: 'Explore', status: 'running', description: 'scan more' },
    ],
  }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }) as never)
  on('clock.now', () => ({ value: Date.parse('2026-10-07T20:00:00Z') }) as never)

  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'tekken-hud', surface, component: 'AbovePrompt', props: PROPS })

    if (surface === 'desktop') {
      const src = String((await ui.find({ type: 'Svg' }))?.props.source)
      for (const bit of ['3:57', 'FINAL ROUND', 'OPUS-5-5', 'scan more']) expect(src).toContain(bit)
    } else {
      expect((await ui.find({ key: 'versus' }))?.text).toContain('3:57')
      expect((await ui.find({ key: 'stamina' }))?.text).toContain('FINAL ROUND')
      expect((await ui.find({ key: 'run-a2' }))?.text).toContain('scan more')
    }
    await ui.unmount()
  }
})

test('a spawn stores its resolved model under its agent id', async ($, on) => {
  let written: unknown
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
  on('state.get', () => ({ value: { value: {}, version: 0 } }) as never)
  on('state.set', (_$, e) => {
    written = e.value
    return { value: { isSet: true, version: 1 } } as never
  })

  await $.agent.spawn({ prompt: 'check the build' } as never)

  expect(written).toEqual({ 'agent-1': 'claude-haiku-5-5' })
})

test('debt and spend parsing keep bad output out of the band', async () => {
  expect(parseDebt('my-app\n7\n')).toEqual({ name: 'my-app', count: '7' })
  expect(parseDebt('my-app\n')).toBeUndefined()
  expect(parseDebt('')).toBeUndefined()

  const day = { daily: [{ modelBreakdowns: [{ modelName: 'claude-haiku-5-5', cost: 1 }, { modelName: 'claude-opus-5-5', cost: 3 }] }] }
  expect(parseMix(JSON.stringify(day))).toEqual([
    { model: 'claude-opus-5-5', cost: 3 },
    { model: 'claude-haiku-5-5', cost: 1 },
  ])
  expect(parseMix('npx: command not found')).toBeUndefined()
})

test('a workflow shows its name, phase pips and running agents', async ($, on) => {
  const state: Record<string, unknown> = {}
  on('state.get', (_$, e: any) => ({ value: { value: state[e.key], version: 0 } }) as never)
  on('state.set', (_$, e: any) => {
    state[e.key] = e.value
    return { value: { isSet: true, version: 1 } } as never
  })
  on('clock.now', () => ({ value: 1_000_000 }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }) as never)
  on('tool.call', () => ({ result: { status: 'async_launched', taskId: 't', runId: 'wf_1', workflowName: 'tekken-hud-review' } }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${++n}` }))

  const script = "export const meta = { name: 'tekken-hud-review', description: 'x', phases: [{ title: 'Review' }, { title: 'Verify' }] }"
  await $.tool.call({ tool: 'Workflow', script } as never)
  for (const label of ['review:runtime', 'review:repo']) {
    await $.agent.spawn({ prompt: 'p', description: label, workflow: { runId: 'wf_1', agentIndex: n + 1 } } as never)
  }

  const ui = await $.ui.mount({ plugin: 'tekken-hud', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const src = String((await ui.find({ type: 'Svg' }))?.props.source)
  for (const bit of ['TEKKEN-HUD-REVIEW', '2 AGENTS', 'REVIEW', 'VERIFY', 'REVIEW:RUNTIME', 'REVIEW:REPO']) expect(src).toContain(bit)
  await ui.unmount()
})

// Answers git, the debt count and ccusage beneath the plugin, tallying each kind of run.
function world(on: On) {
  const state: Record<string, unknown> = {}
  const ran = { debt: 0, mix: 0, revParse: 0 }
  on('state.get', (_$, e: any) => ({ value: { value: state[e.key], version: 0 } }) as never)
  on('state.set', (_$, e: any) => {
    state[e.key] = e.value
    return { value: { isSet: true, version: 1 } } as never
  })
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('process.run', (_$, e: any) => {
    const sh = String(e.argv[2])
    const kind = sh.includes('git grep') ? 'debt' : sh.includes('ccusage') ? 'mix' : 'revParse'
    ran[kind]++
    const stdout = { debt: 'repo\n3\n', mix: '{"daily":[]}', revParse: '/repo\n' }[kind]
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false } } as never
  })
  return { state, ran }
}

test('only a file-changing tool re-counts the debt; spend runs once a minute', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { ran } = world(on)
  const turn = async () => {
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't' } as never)
    await clock.settle()
  }

  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never) // new project: one rev-parse, one count
  await clock.settle()
  expect(ran).toEqual({ debt: 1, mix: 1, revParse: 1 })

  await $.tool.call({ tool: 'Read', file_path: '/repo/b.ts' } as never) // same folder: cached root
  await turn()
  expect(ran).toEqual({ debt: 1, mix: 1, revParse: 1 })

  await $.tool.call({ tool: 'Write', file_path: '/repo/x.ts', content: '' } as never)
  await turn()
  expect(ran).toEqual({ debt: 2, mix: 1, revParse: 1 })

  await clock.advance(60_000)
  await turn()
  expect(ran).toEqual({ debt: 2, mix: 2, revParse: 1 })
})

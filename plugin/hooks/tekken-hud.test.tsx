import { test, expect } from 'claude-code/testing'

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

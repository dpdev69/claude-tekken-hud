import { test, expect } from 'claude-code/testing'

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

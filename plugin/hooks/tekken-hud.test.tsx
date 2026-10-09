import { mock, test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

import { baseName, dayStamp, debtOf, dirOf, grepArgv, mixArgvs, parseMix, searchPath, sumGrep } from './register'

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
  expect(sumGrep('a.ts:3\nsrc/b.py:4\n')).toBe(7)
  expect(sumGrep('C:/Users/x/proj/a.ts:2\r\nb.ts:5\r\n')).toBe(7)
  expect(debtOf(0, 'a.ts:3\n')).toBe('3')
  expect(debtOf(1, '')).toBe('0') // no match is a count of none
  expect(debtOf(128, '')).toBeUndefined()

  const day = { daily: [{ modelBreakdowns: [{ modelName: 'claude-haiku-5-5', cost: 1 }, { modelName: 'claude-opus-5-5', cost: 3 }] }] }
  expect(parseMix(JSON.stringify(day))).toEqual([
    { model: 'claude-opus-5-5', cost: 3 },
    { model: 'claude-haiku-5-5', cost: 1 },
  ])
  expect(parseMix('npx: command not found')).toBeUndefined()
})

test('paths, days and commands on either platform', async () => {
  expect(dirOf('C:\\Users\\x\\proj\\src\\a.ts')).toBe('C:\\Users\\x\\proj\\src')
  expect(dirOf('/repo/src/a.ts')).toBe('/repo/src')
  expect(dirOf('a.ts')).toBe('')
  expect(baseName('C:/Users/x/proj')).toBe('proj')
  expect(baseName('C:\\Users\\x\\proj\\')).toBe('proj')
  expect(baseName('/home/x/my-app')).toBe('my-app')
  expect(dayStamp(new Date(2026, 0, 5, 23, 59).getTime())).toBe('20260105')

  expect(searchPath(false, '/usr/bin')).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin')
  expect(searchPath(true, 'C:\\Windows', { APPDATA: 'C:\\A', ProgramFiles: 'C:\\P' })).toBe(
    'C:\\Windows;C:\\A\\npm;C:\\P\\nodejs;C:\\P\\Git\\cmd',
  )

  expect(grepArgv(true)).toEqual(['git', 'grep', '--untracked', '-I', '-c', '-E', '(#|//|/[*]) ?ponytail:'])
  expect(grepArgv(false)).toContain('--no-index')
  expect(mixArgvs(false, '20261009')[0]).toEqual(['ccusage', 'daily', '--json', '--breakdown', '--since', '20261009'])
  expect(mixArgvs(true, '20261009')).toEqual([
    ['cmd.exe', '/d', '/s', '/c', 'ccusage daily --json --breakdown --since 20261009'],
    ['cmd.exe', '/d', '/s', '/c', 'npx -y ccusage@20.0.26 daily --json --breakdown --since 20261009'],
  ])
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
    const argv: string[] = e.argv
    const kind = argv.includes('grep') ? 'debt' : argv.join(' ').includes('ccusage') ? 'mix' : 'revParse'
    ran[kind]++
    const stdout = { debt: 'a.ts:1\nb.ts:2\n', mix: '{"daily":[]}', revParse: '/repo\n' }[kind]
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false } } as never
  })
  return { state, ran }
}

test('only a file-changing tool re-counts the debt; spend runs once a minute', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const { ran, state } = world(on)
  const turn = async () => {
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't' } as never)
    await clock.settle()
  }

  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never) // new project: one rev-parse, one count
  await clock.settle()
  expect(ran).toEqual({ debt: 1, mix: 1, revParse: 1 })
  expect(state.project).toBe('repo')
  expect(state.debt).toBe('3')

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

test('on Windows the spend runs through cmd.exe, falling back to npx, with npm shims on the PATH', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { OS: 'Windows_NT', PATH: 'C:\\Windows', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' })
  const runs: { argv: string[]; env?: Record<string, string>; cwd?: string }[] = []
  const state: Record<string, unknown> = {}
  on('state.get', (_$, e: any) => ({ value: { value: state[e.key], version: 0 } }) as never)
  on('state.set', (_$, e: any) => {
    state[e.key] = e.value
    return { value: { isSet: true, version: 1 } } as never
  })
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('process.run', (_$, e: any) => {
    runs.push({ argv: e.argv, env: e.init?.env, cwd: e.init?.cwd })
    const line = e.argv.join(' ')
    // ccusage is not installed: cmd.exe says so and exits 1.
    const stdout = line.includes('rev-parse') ? 'C:/Users/x/proj\r\n' : line.includes('npx') ? '{"daily":[]}' : line.includes('grep') ? 'src/a.ts:2\r\n' : ''
    return { value: { exitCode: line.includes('cmd.exe /d /s /c ccusage') ? 1 : 0, stdout, stderr: '', isStdoutTruncated: false } } as never
  })

  await $.tool.call({ tool: 'Read', file_path: 'C:\\Users\\x\\proj\\src\\a.ts' } as never)
  await clock.settle()

  expect(runs[0]?.argv).toEqual(['git', '-C', 'C:\\Users\\x\\proj\\src', 'rev-parse', '--show-toplevel'])
  expect(runs.find(r => r.argv.includes('grep'))?.cwd).toBe('C:/Users/x/proj')
  expect(state.project).toBe('proj')
  expect(state.debt).toBe('2')
  const mixes = runs.filter(r => r.argv[0] === 'cmd.exe').map(r => r.argv[4])
  expect(mixes).toEqual(['ccusage daily --json --breakdown --since ' + dayStamp(1_000_000), 'npx -y ccusage@20.0.26 daily --json --breakdown --since ' + dayStamp(1_000_000)])
  for (const r of runs) expect(r.env?.PATH).toBe('C:\\Windows;C:\\Users\\x\\AppData\\Roaming\\npm')
})

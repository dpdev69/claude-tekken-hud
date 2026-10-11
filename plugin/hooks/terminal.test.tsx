import { test, expect } from 'claude-code/testing'
import type { On } from 'claude-code'

// The terminal surface of the band: agents (and workflow agents) laid out in fixed-width columns inside a
// wrapping Box. The expectations below restate the column rule independently of panel.ts.

const GAP = 3
const LEAST = 30

type Cfg = {
  extra?: { id: string; duty?: string; name?: string; type?: string; status?: string }[]
  isWorking?: boolean
  main?: string
}

const USAGE = { startedAt: 0, context: { window: 200000, percent: 42 }, rateLimits: [] }

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-5']
const short = (m: string) => m.replace(/^claude-/, '')

// Every model an agent id was spawned with (ids a1..a30 cycle through MODELS); ids u* were never spawned.
const modelOf = (id: string) => (id.startsWith('a') ? MODELS[(Number(id.slice(1)) - 1) % MODELS.length]! : 'model ?')

const LONG = 'W5-4 Opus: robustness + consolidation across the whole repo'
const SHORT = ['scan', 'lint', 'build', 'test', 'grep', 'docs', 'fmt']

const duty = (kind: 'short' | 'long' | 'mixed', i: number) =>
  kind === 'short' ? SHORT[i % SHORT.length]! : kind === 'long' ? `${LONG} #${i}` : i % 2 ? `${LONG} #${i}` : SHORT[i % SHORT.length]!

const mkExtra = (n: number, kind: 'short' | 'long' | 'mixed') =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, duty: duty(kind, i) }))

// The rule, restated: a row `width` wide with `gap` between n cells.
const cellOf = (width: number, n: number) => (width - GAP * (n - 1)) / n
const expectCols = (widths: number[], width: number, least = LEAST) => {
  const fits = (n: number) => widths.length >= n && widths.every(w => w <= cellOf(width, n))
  if (fits(3)) return 3
  if (fits(2)) return 2
  return widths.length > 3 && cellOf(width, 2) >= least ? 2 : 1
}
const bodyOf = (bodyColumns: number | undefined) => Math.max(20, bodyColumns || 80)

// Everything a test needs from a mounted band: set up the mocks once, then render any scene many times.
async function boot($: any, on: On, wfLabels: string[] = [], now = 1_000_000) {
  const state: Record<string, unknown> = {}
  const cur: { agents: any[]; model: string } = { agents: [], model: 'claude-opus-5-5' }
  on('state.get', (_$, e: any) => ({ value: { value: state[e.key], version: 0 } }) as never)
  on('state.set', (_$, e: any) => {
    state[e.key] = e.value
    return { value: { isSet: true, version: 1 } } as never
  })
  on('clock.now', () => ({ value: now }) as never)
  on('agent.list', () => ({ value: cur.agents }) as never)
  on('session.model', () => ({ value: cur.model }))
  on('session.usage', () => ({ value: USAGE }) as never)
  on('tool.call', () => ({ result: { status: 'async_launched', taskId: 't', runId: 'wf_1', workflowName: 'big-flow' } }) as never)
  const queue: { agentId: string; model: string }[] = []
  on('agent.spawn', () => queue.shift() as never)

  // Plain agents a1..a30 get their model recorded, as when this plugin saw them spawn.
  for (let i = 1; i <= 30; i++) {
    queue.push({ agentId: `a${i}`, model: modelOf(`a${i}`) })
    await $.agent.spawn({ prompt: 'p' } as never)
  }

  if (wfLabels.length) {
    const script = "export const meta = { name: 'big-flow', description: 'x', phases: [{ title: 'Review' }, { title: 'Verify' }] }"
    await $.tool.call({ tool: 'Workflow', script } as never)
    for (const [i, label] of wfLabels.entries()) {
      queue.push({ agentId: `w${i + 1}`, model: MODELS[i % MODELS.length]! })
      await $.agent.spawn({ prompt: 'p', description: label, workflow: { runId: 'wf_1', agentIndex: i + 1 } } as never)
    }
  }

  return {
    async render(cfg: Cfg = {}, bodyColumns?: number | undefined, surface: 'terminal' | 'desktop' = 'terminal') {
      cur.model = cfg.main ?? 'claude-opus-5-5'
      cur.agents = (cfg.extra ?? []).map(a => ({
        id: a.id,
        type: a.type ?? 'Explore',
        status: a.status ?? 'running',
        description: a.duty ?? '',
        ...(a.name !== undefined && { name: a.name }),
      }))
      const props = { hasSurvey: false, isWorking: cfg.isWorking ?? false, maxRows: 8, bodyColumns } as never
      return $.ui.mount({ plugin: 'tekken-hud', surface, component: 'AbovePrompt', props })
    },
  }
}

type Node = { type: string; key?: string; props: Record<string, any>; text?: string; children?: Node[] }

const boxesOf = async (ui: any, prefix: string): Promise<Node[]> =>
  ((await ui.findAll({ type: 'Box' })) as Node[]).filter(n => typeof n.key === 'string' && n.key.startsWith(prefix))

// The invariants of a column layout: `n` boxes of one width fill rows of exactly `cols`, and a cell under
// `LEAST` is only allowed when every item fits whole.
function checkLayout(widthsOfBoxes: number[], itemWidths: number[], rowWidth: number, cols: number) {
  expect(widthsOfBoxes.length).toBe(itemWidths.length)
  const w = widthsOfBoxes[0]!
  for (const x of widthsOfBoxes) expect(x).toBe(w)
  expect(w).toBeGreaterThanOrEqual(1)
  expect(w).toBe(Math.floor(cellOf(rowWidth, cols)))
  expect(cols * w + (cols - 1) * GAP).toBeLessThanOrEqual(rowWidth)
  // The wrapping box seats floor((row + gap) / (w + gap)) boxes a row: that must be exactly `cols`.
  expect(Math.floor((rowWidth + GAP) / (w + GAP))).toBe(cols)
  if (cols >= 2 && w < LEAST) expect(itemWidths.every(i => i <= w)).toBe(true)
}

const WIDTHS: (number | undefined)[] = [0, undefined, 20, 40, 59, 60, 80, 100, 120, 200, 500]
const COUNTS = [0, 1, 2, 3, 4, 8, 20]
const KINDS = ['short', 'long', 'mixed'] as const

// The width each item asks for: a glyph, a space, the model, a space, the duty (3 + model + duty).
const itemWidths = (main: string, extra: ReturnType<typeof mkExtra>) => [
  3 + short(main).length + 'this chat'.length,
  ...extra.map(a => 3 + short(modelOf(a.id)).length + a.duty!.length),
]

for (const bc of WIDTHS) {
  test(`terminal agent columns at bodyColumns=${bc}: every count and duty length keeps one width and exact rows`, async ($, on) => {
    const b = await boot($, on)
    const row = bodyOf(bc)

    for (const n of COUNTS) {
      for (const kind of KINDS) {
        if (n === 0 && kind !== 'short') continue
        const extra = mkExtra(n, kind)
        const ui = await b.render({ extra }, bc)
        const boxes = await boxesOf(ui, 'run-')
        const items = itemWidths('claude-opus-5-5', extra)
        const cols = expectCols(items, row)

        expect(boxes.map(x => x.key)).toEqual(['run-main', ...extra.map(a => `run-${a.id}`)])
        checkLayout(boxes.map(x => x.props.width), items, row, cols)

        const wrap = (await ui.find({ key: 'agents' })) as Node
        expect(wrap.props.flexWrap).toBe('wrap')
        expect(wrap.props.columnGap).toBe(GAP)
        await ui.unmount()
      }
    }
  })
}

test('main only: one item is a single full-width column', async ($, on) => {
  const b = await boot($, on)
  for (const bc of [20, 40, 80, 100, 500]) {
    const ui = await b.render({}, bc)
    const boxes = await boxesOf(ui, 'run-')
    expect(boxes.map(x => x.key)).toEqual(['run-main'])
    expect(boxes[0]!.props.width).toBe(bc)
    await ui.unmount()
  }
})

test('falsy bodyColumns fall back to 80, and anything under 20 is raised to 20', async ($, on) => {
  const b = await boot($, on)
  const extra = mkExtra(1, 'short')
  const widthAt = async (bc: number | undefined) => {
    const ui = await b.render({ extra }, bc)
    const w = (await boxesOf(ui, 'run-')).map(x => x.props.width)
    await ui.unmount()
    return w
  }

  // Two short items fit two to a row: floor((80 - 3) / 2) = 38.
  expect(await widthAt(0)).toEqual([38, 38])
  expect(await widthAt(undefined)).toEqual([38, 38])
  expect(await widthAt(80)).toEqual([38, 38])
  // Floor of 20: (20 - 3) / 2 = 8.5 -> only fits two when both items are <= 8.5, which they are not.
  expect(await widthAt(5)).toEqual(await widthAt(20))
  expect(await widthAt(1)).toEqual(await widthAt(20))
  expect(await widthAt(-10)).toEqual(await widthAt(20))
})

test('representative column counts', async ($, on) => {
  const b = await boot($, on)
  const widthAt = async (extra: ReturnType<typeof mkExtra>, bc: number) => {
    const ui = await b.render({ extra }, bc)
    const w = (await boxesOf(ui, 'run-')).map(x => x.props.width)
    await ui.unmount()
    return w
  }
  const colsOf = (w: number[], bc: number) => Math.floor((bc + GAP) / (w[0]! + GAP))

  // 3 short agents (4 items) at 100 columns: items ~ 20-28 wide, a third of 100 is 31 -> 3 a row.
  let w = await widthAt(mkExtra(3, 'short'), 100)
  expect(w.length).toBe(4)
  expect(colsOf(w, 100)).toBe(3)
  expect(w[0]).toBe(Math.floor(cellOf(100, 3)))

  // 9 long agents at 100: more than three items, half a row is 48 >= 30 -> pairs.
  w = await widthAt(mkExtra(9, 'long'), 100)
  expect(colsOf(w, 100)).toBe(2)
  expect(w[0]).toBe(48)

  // 9 long agents at 50: half a row is 23.5 < 30 -> one column.
  w = await widthAt(mkExtra(9, 'long'), 50)
  expect(colsOf(w, 50)).toBe(1)
  expect(w[0]).toBe(50)

  // 2 long at 100 (3 items): the long ones do not fit a half (48), so one column.
  w = await widthAt(mkExtra(2, 'long'), 100)
  expect(colsOf(w, 100)).toBe(1)
  expect(w[0]).toBe(100)

  // 2 long at 500: each fits a third of 500 (165) -> 3 a row; with 1 long (2 items) -> 2 a row.
  w = await widthAt(mkExtra(2, 'long'), 500)
  expect(colsOf(w, 500)).toBe(3)
  w = await widthAt(mkExtra(1, 'long'), 500)
  expect(colsOf(w, 500)).toBe(2)

  // 1 long at 100 (2 items): not a half -> single column.
  w = await widthAt(mkExtra(1, 'long'), 100)
  expect(colsOf(w, 100)).toBe(1)

  // 4 short at 40: items ~ 20-28 do not fit a third (11) or half (18.5); 5 items, half 18.5 < 30 -> 1.
  w = await widthAt(mkExtra(4, 'short'), 40)
  expect(colsOf(w, 40)).toBe(1)

  // 20 mixed at 59: half is 28 < 30 -> single column; at 60 half is 28.5 -> still 1; at 63 it is 30 -> pairs.
  expect(colsOf(await widthAt(mkExtra(20, 'mixed'), 59), 59)).toBe(1)
  expect(colsOf(await widthAt(mkExtra(20, 'mixed'), 60), 60)).toBe(1)
  expect(colsOf(await widthAt(mkExtra(20, 'mixed'), 63), 63)).toBe(2)
})

test('empty description falls back to the agent name, then its type', async ($, on) => {
  const b = await boot($, on)
  const ui = await b.render({
    extra: [
      { id: 'a1', duty: '', name: 'reviewer', type: 'Explore' },
      { id: 'a2', duty: '', type: 'general-purpose' },
      { id: 'a3', duty: 'real duty', name: 'ignored' },
    ],
  }, 200)

  expect(((await ui.find({ key: 'run-a1' })) as Node).text).toContain('reviewer')
  expect(((await ui.find({ key: 'run-a2' })) as Node).text).toContain('general-purpose')
  const third = ((await ui.find({ key: 'run-a3' })) as Node).text
  expect(third).toContain('real duty')
  expect(third).not.toContain('ignored')

  const boxes = await boxesOf(ui, 'run-')
  const items = [
    3 + 'opus-5-5'.length + 'this chat'.length,
    3 + short(modelOf('a1')).length + 'reviewer'.length,
    3 + short(modelOf('a2')).length + 'general-purpose'.length,
    3 + short(modelOf('a3')).length + 'real duty'.length,
  ]
  checkLayout(boxes.map(x => x.props.width), items, 200, expectCols(items, 200))
  await ui.unmount()
})

test('an agent with an unknown model shows "model ?" and sizes by it', async ($, on) => {
  const b = await boot($, on)
  const extra = [{ id: 'u1', duty: 'mystery' }, { id: 'u2', duty: 'unknown too' }]
  const ui = await b.render({ extra }, 100)

  const text = ((await ui.find({ key: 'run-u1' })) as Node).text
  expect(text).toContain('model ?')
  expect(text).toContain('mystery')

  const items = [3 + 'opus-5-5'.length + 'this chat'.length, 3 + 'model ?'.length + 'mystery'.length, 3 + 'model ?'.length + 'unknown too'.length]
  const boxes = await boxesOf(ui, 'run-')
  checkLayout(boxes.map(x => x.props.width), items, 100, expectCols(items, 100))
  await ui.unmount()
})

test('model names are shown without the claude- prefix and the duty is the description', async ($, on) => {
  const b = await boot($, on)
  const ui = await b.render({ main: 'claude-sonnet-5-5', extra: [{ id: 'a2', duty: 'scan more' }] }, 100)
  const main = ((await ui.find({ key: 'run-main' })) as Node).text
  expect(main).toContain('sonnet-5-5')
  expect(main).toContain('this chat')
  expect(main).not.toContain('claude-')
  expect(((await ui.find({ key: 'run-a2' })) as Node).text).toContain('scan more')
  await ui.unmount()
})

test('keys stay stable and the other rows still answer to their keys', async ($, on) => {
  const b = await boot($, on)
  const ui = await b.render({ extra: mkExtra(3, 'mixed') }, 100)

  for (const key of ['versus', 'stamina', 'agents', 'run-main', 'run-a1', 'run-a2', 'run-a3']) {
    expect(await ui.find({ key })).toBeTruthy()
  }
  expect(await ui.find({ key: 'run-a4' })).toBeFalsy()
  expect(((await ui.find({ key: 'versus' })) as Node).text).toContain('p1')
  expect(((await ui.find({ key: 'stamina' })) as Node).text).toContain('7d stamina')
  await ui.unmount()
})

test('the main agent shows ● while the chat works and ○ when idle', async ($, on) => {
  const b = await boot($, on)

  for (const [isWorking, glyph, other] of [[true, '●', '○'], [false, '○', '●']] as const) {
    const ui = await b.render({ isWorking }, 100)
    const text = ((await ui.find({ key: 'run-main' })) as Node).text
    expect(text).toContain(glyph)
    expect(text).not.toContain(other)
    await ui.unmount()
  }
})

test('running agents show ● and waiting or pending ones ○, whatever the main agent does', async ($, on) => {
  const b = await boot($, on)
  const extra = [
    { id: 'a1', duty: 'going', status: 'running' },
    { id: 'a2', duty: 'idle', status: 'waiting' },
    { id: 'a3', duty: 'queued', status: 'pending' },
  ]

  for (const isWorking of [true, false]) {
    const ui = await b.render({ extra, isWorking }, 120)
    const glyphOf = async (key: string) => ((await ui.find({ key })) as Node).text
    expect(await glyphOf('run-main')).toContain(isWorking ? '●' : '○')
    expect(await glyphOf('run-a1')).toContain('●')
    for (const key of ['run-a2', 'run-a3']) {
      const t = await glyphOf(key)
      expect(t).toContain('○')
      expect(t).not.toContain('●')
    }
    await ui.unmount()
  }
})

test('agents that are done are not listed', async ($, on) => {
  const b = await boot($, on)
  const ui = await b.render({
    extra: [
      { id: 'a1', duty: 'live', status: 'running' },
      { id: 'a2', duty: 'gone', status: 'completed' },
      { id: 'a3', duty: 'dead', status: 'failed' },
    ],
  }, 100)
  expect((await boxesOf(ui, 'run-')).map(x => x.key)).toEqual(['run-main', 'run-a1'])
  await ui.unmount()
})

// ---------------------------------------------------------------------------------------------------------------
// Workflows in the terminal

const WF_LABELS = (n: number, long = false) =>
  Array.from({ length: n }, (_, i) => (long ? `review:${LONG} ${i}` : i % 2 ? `verify:repo${i}` : `review:runtime${i}`))

// The workflow agent keys are w1..wN; the first four live ones are shown (SHOWN), the rest are "+N more".
const wfItems = (labels: string[]) =>
  labels.slice(0, 4).map((label, i) => 3 + label.length + `${short(MODELS[i % MODELS.length]!)} · 0s`.length)

const WF_CASES = [[1, false], [2, false], [3, false], [4, false], [4, true], [7, false], [12, true]] as const

for (const [n, long] of WF_CASES) {
  test(`workflow with ${n} ${long ? 'long' : 'short'} agents obeys the column rule over bodyColumns-2 at every width`, async ($, on) => {
    const labels = WF_LABELS(n, long)
    const b = await boot($, on, labels)
    const items = wfItems(labels)

    for (const bc of WIDTHS) {
      const row = bodyOf(bc) - 2
      const ui = await b.render({}, bc)
      const boxes = await boxesOf(ui, 'wfa-')

      expect(boxes.map(x => x.key)).toEqual(items.map((_, i) => `wfa-w${i + 1}`))
      checkLayout(boxes.map(x => x.props.width), items, row, expectCols(items, row))

      const wrap = ((await ui.findAll({ type: 'Box' })) as Node[]).find(x => x.props.paddingLeft === 2)!
      expect(wrap.props.flexWrap).toBe('wrap')

      const more = n - 4
      const text = JSON.stringify(await ui.findAll({ type: 'Text' }))
      if (more > 0) expect(text).toContain(`+${more} more`)
      else expect(text).not.toContain(' more')
      await ui.unmount()
    }
  })
}

test('a workflow in the terminal: name, counts, phases, and its own wrapping box with paddingLeft 2', async ($, on) => {
  const labels = WF_LABELS(3)
  const b = await boot($, on, labels)
  const ui = await b.render({ extra: mkExtra(2, 'short') }, 100)

  const run = (await ui.find({ key: 'wf-wf_1' })) as Node
  expect(run).toBeTruthy()
  expect(run.text).toContain('big-flow')
  expect(run.text).toContain('3 agents')
  for (const label of labels) expect(run.text).toContain(label)

  const wrap = ((await ui.findAll({ type: 'Box' })) as Node[]).find(n => n.props.paddingLeft === 2)!
  expect(wrap.props.flexWrap).toBe('wrap')
  expect(wrap.props.columnGap).toBe(GAP)

  // The plain agents above it are untouched by the workflow.
  const plain = await boxesOf(ui, 'run-')
  expect(plain.map(x => x.key)).toEqual(['run-main', 'run-a1', 'run-a2'])
  const items = itemWidths('claude-opus-5-5', mkExtra(2, 'short'))
  checkLayout(plain.map(x => x.props.width), items, 100, expectCols(items, 100))
  await ui.unmount()
})

test('workflow agents with the same widths as plain ones are laid out in a 2-narrower row', async ($, on) => {
  // Three short workflow labels at exactly the edge: a third of (bc - 2) vs a third of bc can differ.
  const labels = ['a:x', 'b:y', 'c:z']
  const b = await boot($, on, labels)
  const items = wfItems(labels)
  const need = Math.max(...items) * 3 + 2 * GAP // exactly fits three across

  const fit = await b.render({}, need + 2)
  const wide = (await boxesOf(fit, 'wfa-')).map(x => x.props.width)
  expect(wide).toEqual(items.map(() => Math.floor(cellOf(need, 3))))
  await fit.unmount()

  const tight = await b.render({}, need + 1) // one column short of three across
  const w = (await boxesOf(tight, 'wfa-')).map(x => x.props.width)
  expect(Math.floor((need - 1 + GAP) / (w[0]! + GAP))).toBeLessThan(3)
  await tight.unmount()
})

test('+N more counts the live workflow agents past the four shown', async ($, on) => {
  const b = await boot($, on, WF_LABELS(9))
  const ui = await b.render({}, 100)
  expect((await boxesOf(ui, 'wfa-')).length).toBe(4)
  expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).toContain('+5 more')
  await ui.unmount()
})

// ---------------------------------------------------------------------------------------------------------------

test('the desktop surface still draws an Svg for the same inputs', async ($, on) => {
  const b = await boot($, on)
  for (const bc of [0, 20, 100, 500]) {
    for (const n of [0, 1, 3, 8]) {
      const extra = mkExtra(n, 'mixed')
      const ui = await b.render({ extra, isWorking: true }, bc, 'desktop')
      const svg = (await ui.find({ type: 'Svg' })) as Node
      expect(svg).toBeTruthy()
      const src = String(svg.props.source)
      expect(src).toContain('<svg')
      expect(src).toContain('OPUS-5-5')
      expect(src).toContain('this chat')
      // The terminal's column boxes are not part of the desktop tree.
      expect(await ui.find({ key: 'agents' })).toBeFalsy()
      expect(await boxesOf(ui, 'run-')).toEqual([])
      await ui.unmount()
    }
  }
})

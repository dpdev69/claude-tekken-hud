import { test, expect } from 'claude-code/testing'

import { cell, columns, cut, panel, span } from './panel'
import type { Agent, Panel, Run } from './panel'

// Pure tests of the band's column layout: `cell`, `columns` and the SVG `panel` draws from them. No engine needed;
// the SVG is parsed back with regexes into plates (x, y, width, text) and checked against the grid's rules.

// ── builders ────────────────────────────────────────────────────────────────

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'

const base = (over: Partial<Panel> = {}): Panel => ({ name: 'p1', ctx: 10, five: 20, resets: '', debt: '0', week: 30, costs: [], agents: [], ...over })
const agents = (duties: string[], model = OPUS): Agent[] => duties.map((duty, i) => ({ key: `a${i}`, model, duty, isRunning: true }))
const COSTS = [
  { model: OPUS, cost: 3 },
  { model: SONNET, cost: 1 },
]
const run = (n: number, label = 'review:a', over: Partial<Run> = {}): Run => ({
  key: 'wf_1',
  name: 'review',
  secs: 75,
  count: n,
  phases: [
    { name: 'Review', done: 1, total: 3 },
    { name: 'Verify', done: 0, total: 2 },
  ],
  agents: Array.from({ length: n }, (_, i) => ({ key: `w${i}`, label, model: SONNET, secs: 5 + i })),
  more: 0,
  ...over,
})

// Duties whose plate (opus, 8-char model name) is 34 + 83.2 + 12 + 7.4 * len + 24 wide: 16 chars still fit a third of
// the 850 grid (275.33), 17 do not; 35 still fit a half (419), 36 do not.
const D16 = 'x'.repeat(16)
const D17 = 'x'.repeat(17)
const D35 = 'x'.repeat(35)
const D36 = 'x'.repeat(36)
const LONG = 'W5-4 Opus: robustness + consolidation across the whole repo'

// ── parsing ─────────────────────────────────────────────────────────────────

type Plate = { kind: 'agent' | 'head' | 'wf'; x: number; y: number; w: number; textLength?: number; main: string; side: string; stripe: string; isFaded: boolean }

const unesc = (s: string) => s.replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))

function parse(svg: string) {
  const re = /<g transform="translate\((-?[\d.]+),(-?[\d.]+)\)">\s*<polygon points="8,0 ([\d.]+),0 [\d.]+,18 0,18" fill="#1b1b1b" stroke="(#[0-9a-f]+)"[\s\S]*?\n<\/g>/g
  let seenHead = false
  const plates: Plate[] = [...svg.matchAll(re)].map(m => {
    const block = m[0]
    const kind = m[4] === '#f5c542' ? 'head' : seenHead ? 'wf' : 'agent'
    if (kind === 'head') seenHead = true
    const text = block.match(/<text [^>]*>([\s\S]*?)<\/text>/)?.[1] ?? ''
    const stripe = block.match(/<polygon points="8,0 26,0 18,18 0,18" fill="(#[0-9A-Fa-f]+)"( fill-opacity="0\.35")?/)
    const tl = block.match(/textLength="([\d.]+)"/)?.[1]
    return {
      kind,
      x: Number(m[1]),
      y: Number(m[2]),
      w: Number(m[3]),
      textLength: tl === undefined ? undefined : Number(tl),
      main: text.split('<tspan')[0] ?? '',
      side: text.match(/<tspan class="pd" dx="12">([\s\S]*?)<\/tspan>/)?.[1] ?? '',
      stripe: stripe?.[1] ?? '',
      isFaded: Boolean(stripe?.[2]),
    }
  })
  const [, height, scaled] = svg.match(/viewBox="0 0 1000 (\d+)" width="4000" height="(\d+)"/) ?? []
  const more = [...svg.matchAll(/<text x="204" y="([\d.]+)" class="l">\+(\d+) more<\/text>/g)].map(m => ({ y: Number(m[1]) - 13.5, n: Number(m[2]) }))
  return { plates, height: Number(height), scaled: Number(scaled), more }
}

const le = (a: number, b: number) => expect(a <= b).toBe(true)
const count = (svg: string, needle: string) => svg.split(needle).length - 1

// Distinct rows' plate counts, top to bottom.
const shape = (plates: Plate[]) => {
  const rows = new Map<number, number>()
  for (const p of plates) rows.set(p.y, (rows.get(p.y) ?? 0) + 1)
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n)
}
const xs = (plates: Plate[], y: number) => plates.filter(p => p.y === y).map(p => p.x)

// ── invariants ──────────────────────────────────────────────────────────────

const ok = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg)
}

// Everything that must hold for any panel, whatever its agents. Returns the parsed SVG for scenario-specific checks.
function check(name: string, p: Panel) {
  const svg = panel(p)
  const g = parse(svg)
  const at = (what: string) => `${name}: ${what}`
  const runs = p.runs ?? []
  const below = p.costs.length > 0 ? 110 : 84

  // Every plate was found.
  const nAgents = p.agents.length
  ok(g.plates.filter(x => x.kind === 'agent').length === nAgents, at(`agent plates ${g.plates.filter(x => x.kind === 'agent').length} != ${nAgents}`))
  ok(g.plates.filter(x => x.kind === 'head').length === runs.length, at('workflow heads'))
  ok(g.plates.filter(x => x.kind === 'wf').length === runs.reduce((n, r) => n + r.agents.length, 0), at('workflow agent plates'))

  // The agents: rows start at `below`, step by 24, are full but the last, at most three wide.
  const agentPlates = g.plates.filter(x => x.kind === 'agent')
  const cols = nAgents ? agentPlates.filter(x => x.y === below).length : 1
  ok(cols >= 1 && cols <= 3, at(`columns ${cols}`))
  agentPlates.forEach((pl, i) => {
    ok(pl.y === below + Math.floor(i / cols) * 24, at(`agent ${i} at y ${pl.y}, wanted row ${Math.floor(i / cols)} of ${cols}`))
    ok(pl.x >= 150, at(`agent ${i} left of the grid: ${pl.x}`))
  })

  // The workflows follow, run after run: head, then its plates in columns, then "+N more".
  let y = below + Math.ceil(nAgents / cols) * 24
  const heads = g.plates.filter(x => x.kind === 'head')
  const wfs = g.plates.filter(x => x.kind === 'wf')
  let wi = 0
  runs.forEach((r, ri) => {
    ok(heads[ri]!.y === y, at(`run ${ri} head at ${heads[ri]!.y}, wanted ${y}`))
    ok(heads[ri]!.x === 150, at(`run ${ri} head x ${heads[ri]!.x}`))
    y += 24
    const mine = wfs.slice(wi, wi + r.agents.length)
    wi += r.agents.length
    const wcols = r.agents.length ? mine.filter(x => x.y === y).length : 1
    ok(wcols >= 1 && wcols <= 3, at(`run ${ri} columns ${wcols}`))
    mine.forEach((pl, i) => {
      ok(pl.y === y + Math.floor(i / wcols) * 24, at(`run ${ri} plate ${i} at y ${pl.y}, wanted row ${Math.floor(i / wcols)} of ${wcols}`))
      ok(pl.x >= 170, at(`run ${ri} plate ${i} left of its grid: ${pl.x}`))
    })
    y += Math.ceil(r.agents.length / wcols) * 24
    if (r.more > 0) {
      ok(g.more.some(m => m.y === y && m.n === r.more), at(`run ${ri} "+${r.more} more" at ${y}; saw ${JSON.stringify(g.more)}`))
      y += 24
    }
  })
  ok(g.more.length === runs.filter(r => r.more > 0).length, at('"+N more" count'))

  // The viewBox ends where the last row does.
  ok(g.height === y, at(`height ${g.height}, wanted ${y}`))
  ok(g.scaled === 4 * y, at(`scaled height ${g.scaled}`))

  // All row ys are `below` + 24k with no gaps.
  const ys = [...new Set([...g.plates.map(x => x.y), ...g.more.map(m => m.y)])].sort((a, b) => a - b)
  ys.forEach((v, i) => ok(v === below + i * 24, at(`row ${i} at y ${v}, wanted ${below + i * 24}`)))
  if (ys.length) ok(y === ys[ys.length - 1]! + 24, at('height is the last row + 24'))

  // Nothing leaves the grid, and plates in a row never overlap.
  for (const pl of g.plates) {
    ok(pl.x + pl.w <= 1000, at(`${pl.kind} plate at ${pl.x} is ${pl.w} wide: right edge ${pl.x + pl.w} > 1000`))
    ok(pl.w > 0, at('plate width'))
  }
  for (const row of ys) {
    const inRow = g.plates.filter(x => x.y === row).sort((a, b) => a.x - b.x)
    for (let i = 1; i < inRow.length; i++) {
      ok(inRow[i]!.x >= inRow[i - 1]!.x + inRow[i - 1]!.w, at(`row ${row}: plate at ${inRow[i]!.x} overlaps the one at ${inRow[i - 1]!.x} (${inRow[i - 1]!.w} wide)`))
    }
  }

  // The text is told to span its plate's inside, never less than 10.
  for (const pl of g.plates) {
    ok(pl.textLength !== undefined && pl.textLength >= 10, at(`textLength ${pl.textLength}`))
    ok(Math.abs(pl.textLength! - Math.max(10, pl.w - 48)) < 1e-6, at(`textLength ${pl.textLength} for a ${pl.w} plate`))
  }

  // Tags.
  ok(count(svg, '>RUNNING</text>') === (nAgents ? 1 : 0), at(`RUNNING x${count(svg, '>RUNNING</text>')}`))
  ok(count(svg, '>WORKFLOW</text>') === runs.length, at('WORKFLOW tags'))
  ok(count(svg, '>TODAY $') === (p.costs.length ? 1 : 0), at('TODAY tag'))

  // Escaping: any ampersand starts an entity we wrote, nothing raw reaches the markup, no junk numbers.
  ok(!/&(?!#\d+;)/.test(svg), at('a raw ampersand'))
  ok(!/<script|<img|<iframe|onload=|onerror=/i.test(svg), at('raw markup'))
  for (const junk of ['NaN', 'undefined', 'Infinity', '[object']) ok(!svg.includes(junk), at(`"${junk}" in the SVG`))

  // Waiting agents are faded, running ones are not.
  ok(count(svg, 'fill-opacity="0.35"') === p.agents.filter(a => !a.isRunning).length, at('faded plates'))
  agentPlates.forEach((pl, i) => ok(pl.isFaded === !p.agents[i]!.isRunning, at(`agent ${i} fade`)))

  // Each agent's duty is whole, or cut with an ellipsis; in three columns nothing is cut.
  agentPlates.forEach((pl, i) => {
    const a = p.agents[i]!
    ok(unesc(pl.main) === (a.model === undefined ? 'model ?' : a.model.replace(/^claude-/, '')).toUpperCase(), at(`agent ${i} name "${pl.main}"`))
    const duty = unesc(pl.side)
    const isWhole = duty === a.duty
    ok(isWhole || (duty.endsWith('…') && a.duty.startsWith(duty.slice(0, -1)) && duty.length < a.duty.length), at(`agent ${i} duty "${duty}" is not "${a.duty}" or a cut of it`))
    if (cols === 3) ok(isWhole, at(`agent ${i} cut in three columns: "${duty}"`))
  })
  // Same for the workflow labels.
  let k = 0
  runs.forEach(r =>
    r.agents.forEach(a => {
      const pl = wfs[k++]!
      const label = unesc(pl.main)
      const up = a.label.toUpperCase()
      ok(label === up || (label.endsWith('…') && up.startsWith(label.slice(0, -1)) && label.length < up.length), at(`label "${label}" is not "${up}" or a cut of it`))
      ok(span(label) <= 40, at(`label longer than 40: ${span(label)}`))
      ok(unesc(pl.side).startsWith(a.model.replace(/^claude-/, '').toUpperCase()), at(`wf meta "${pl.side}"`))
    }),
  )

  return { svg, ...g, below, cols }
}

// ── cell and columns ────────────────────────────────────────────────────────

test('cell: one column is the whole width, others split what the gaps leave', () => {
  expect(cell(850, 12, 1)).toBe(850)
  expect(cell(850, 12, 2)).toBe(419)
  expect(cell(850, 12, 3)).toBe((850 - 24) / 3)
  expect(cell(830, 12, 2)).toBe(409)
  expect(cell(830, 12, 3)).toBe((830 - 24) / 3)
  expect(cell(100, 0, 4)).toBe(25)
  expect(cell(0, 12, 1)).toBe(0)
  // The gaps are subtracted exactly once per join: n cells and n-1 gaps fill the width.
  for (const n of [1, 2, 3, 4, 5]) expect(Math.abs(cell(850, 12, n) * n + 12 * (n - 1) - 850) < 1e-9).toBe(true)
  // Terminal units (characters) work the same way.
  expect(cell(100, 2, 3)).toBe(32)
  expect(cell(100, 2, 2)).toBe(49)
})

test('columns: no items, one item, and two items', () => {
  expect(columns([], 850, 12)).toBe(1)
  expect(columns([], 850, 12, 1000)).toBe(1)
  for (const w of [0, 1, 275, 300, 419, 420, 850, 99999]) expect(columns([w], 850, 12)).toBe(1)
  expect(columns([100, 100], 850, 12)).toBe(2) // each fits a half; two items never make three
  expect(columns([419, 419], 850, 12)).toBe(2)
  expect(columns([100, 420], 850, 12)).toBe(1)
  expect(columns([420, 100], 850, 12)).toBe(1)
  expect(columns([500, 500], 850, 12, 0)).toBe(1) // two long ones are not forced into pairs
  expect(columns([500, 500], 850, 12, 1)).toBe(1)
})

test('columns: three items fit three, two or one', () => {
  expect(columns([100, 100, 100], 850, 12)).toBe(3)
  expect(columns([275, 275, 275], 850, 12)).toBe(3)
  expect(columns([276, 100, 100], 850, 12)).toBe(2)
  expect(columns([100, 100, 276], 850, 12)).toBe(2)
  expect(columns([419, 419, 419], 850, 12)).toBe(2)
  expect(columns([100, 100, 420], 850, 12)).toBe(1) // three items are not "past three": a long one forces a single column
  expect(columns([500, 500, 500], 850, 12)).toBe(1)
  expect(columns([500, 500, 500], 850, 12, 0)).toBe(1)
})

test('columns: past three items they pair up unconditionally, three when all fit a third', () => {
  expect(columns([100, 100, 100, 100], 850, 12)).toBe(3)
  expect(columns([275, 275, 275, 275], 850, 12)).toBe(3)
  expect(columns([276, 100, 100, 100], 850, 12)).toBe(2)
  expect(columns([500, 500, 500, 500], 850, 12)).toBe(2)
  expect(columns([420, 100, 100, 100], 850, 12)).toBe(2)
  expect(columns([1, 1, 1, 1, 1, 1, 1, 1, 1, 9999], 850, 12)).toBe(2) // one huge item among many
  expect(columns(Array(30).fill(10), 850, 12)).toBe(3)
  expect(columns(Array(30).fill(10_000), 850, 12)).toBe(2)
})

test('columns: a width equal to the cell fits; a hair over does not', () => {
  const third = cell(850, 12, 3)
  const half = cell(850, 12, 2)
  expect(columns([third, third, third], 850, 12)).toBe(3)
  expect(columns([third + 1e-9, third, third], 850, 12)).toBe(2)
  expect(columns([third, third, third, third], 850, 12)).toBe(3)
  expect(columns([third + 1e-9, third, third, third], 850, 12)).toBe(2)
  expect(columns([half, half], 850, 12)).toBe(2)
  expect(columns([half + 1e-9, half], 850, 12)).toBe(1)
  expect(columns([half, half, half], 850, 12)).toBe(2)
  expect(columns([half + 1e-9, half, half], 850, 12)).toBe(1)
  // Same boundaries on the workflow grid.
  expect(columns([cell(830, 12, 3), 1, 1], 830, 12)).toBe(3)
  expect(columns([cell(830, 12, 3) + 0.01, 1, 1], 830, 12)).toBe(2)
  expect(columns([cell(830, 12, 2) + 0.01, 1, 1], 830, 12)).toBe(1)
  // And in characters.
  expect(columns([32, 32, 32], 100, 2)).toBe(3)
  expect(columns([33, 32, 32], 100, 2)).toBe(2)
  expect(columns([49, 49], 100, 2)).toBe(2)
  expect(columns([50, 49], 100, 2)).toBe(1)
})

test('columns: `least` only gates the unconditional pairing past three items', () => {
  const half = cell(850, 12, 2)
  const wide = [500, 500, 500, 500]
  expect(columns(wide, 850, 12, 0)).toBe(2)
  expect(columns(wide, 850, 12, half)).toBe(2) // half a row is exactly `least`: enough
  expect(columns(wide, 850, 12, half + 1e-9)).toBe(1) // half a row under `least`: one column
  expect(columns(wide, 850, 12, 10_000)).toBe(1)
  // Items that fit are never held back by it.
  expect(columns([10, 10], 850, 12, 10_000)).toBe(2)
  expect(columns([10, 10, 10], 850, 12, 10_000)).toBe(3)
  expect(columns([10, 10, 10, 10], 850, 12, 10_000)).toBe(3)
  expect(columns([400, 400, 400], 850, 12, 10_000)).toBe(2)
  // Three long items are not "past three": `least` does not matter either way.
  expect(columns([500, 500, 500], 850, 12, 0)).toBe(1)
  // The terminal's case: a narrow terminal keeps long lines to one column.
  expect(columns([60, 60, 60, 60], 40, 2, 20)).toBe(1)
  expect(columns([60, 60, 60, 60], 80, 2, 20)).toBe(2)
})

test('columns: huge, zero and negative widths', () => {
  expect(columns([1e9, 1e9], 850, 12)).toBe(1)
  expect(columns([1e9, 1e9, 1e9], 850, 12)).toBe(1)
  expect(columns([1e9, 1e9, 1e9, 1e9], 850, 12)).toBe(2)
  expect(columns([Infinity, Infinity, Infinity, Infinity, Infinity], 850, 12)).toBe(2)
  expect(columns([Infinity, 1, 1], 850, 12)).toBe(1)
  expect(columns([0, 0, 0], 850, 12)).toBe(3)
  expect(columns([-5, -5, -5, -5], 850, 12)).toBe(3)
  expect(columns([Number.MAX_VALUE, 1, 1, 1, 1, 1], 850, 12)).toBe(2)
  // A grid too narrow for the gaps: the cells are negative, nothing fits, and the pairing past three items is gated by `least`.
  expect(columns([1, 1, 1], 10, 12)).toBe(1)
  expect(columns([1, 1, 1, 1], 10, 12)).toBe(1) // half a row is -1: under the default `least` of 0
  expect(columns([1, 1, 1, 1], 10, 12, -5)).toBe(2)
})

// ── panel: nameplates ───────────────────────────────────────────────────────

test('panel: one agent is just the main plate in one row, with the RUNNING tag', () => {
  const r = check('1 agent', base({ agents: agents(['this chat']) }))
  expect(shape(r.plates)).toEqual([1])
  expect(r.plates[0]!.x).toBe(150)
  expect(r.plates[0]!.y).toBe(84)
  expect(r.height).toBe(108)
  expect(r.svg).toContain('>OPUS-5-5<tspan class="pd" dx="12">this chat</tspan>')
  expect(count(r.svg, '>RUNNING</text>')).toBe(1)
})

test('panel: no agents draws no plates, no RUNNING tag, and ends at the first row', () => {
  const r = check('0 agents', base())
  expect(r.plates).toEqual([])
  expect(r.height).toBe(84)
  expect(check('0 agents with costs', base({ costs: COSTS })).height).toBe(110)
})

test('panel: two short agents share a row, two long ones stack', () => {
  const short = check('2 short', base({ agents: agents(['this chat', 'scan']) }))
  expect(shape(short.plates)).toEqual([2])
  expect(xs(short.plates, 84)).toEqual([150, 581])
  expect(short.height).toBe(108)

  const long = check('2 long', base({ agents: agents(['this chat', LONG]) }))
  expect(shape(long.plates)).toEqual([1, 1])
  expect(long.height).toBe(132)
  // Alone in its row the long plate is not cut to a half: it has the room.
  le(cell(850, 12, 2) + 1, long.plates[1]!.w)
  expect(unesc(long.plates[1]!.side)).toBe(LONG.length <= 90 ? LONG : `${LONG.slice(0, 89)}…`)
})

test('panel: three short agents fill one row of three', () => {
  const r = check('3 short', base({ agents: agents(['this chat', 'scan', 'lint']) }))
  expect(shape(r.plates)).toEqual([3])
  expect(xs(r.plates, 84)).toEqual([150, 437, 725])
  expect(r.height).toBe(108)
})

test('panel: four short agents are 3 + 1, four long ones 2 x 2', () => {
  const short = check('4 short', base({ agents: agents(['this chat', 'scan', 'lint', 'scan more']) }))
  expect(shape(short.plates)).toEqual([3, 1])
  expect(xs(short.plates, 108)).toEqual([150])
  expect(short.height).toBe(132)

  const long = check('4 long', base({ agents: agents(['this chat', LONG, LONG, LONG]) }))
  expect(shape(long.plates)).toEqual([2, 2])
  expect(xs(long.plates, 84)).toEqual([150, 581])
  expect(xs(long.plates, 108)).toEqual([150, 581])
  expect(long.height).toBe(132)
  // Long duties are cut to the column with an ellipsis, and the cut plates fill it.
  expect(unesc(long.plates[1]!.side)).toBe('W5-4 Opus: robustness + consolidat…')
  expect(long.plates[1]!.w).toBe(412)
})

test('panel: the third-of-a-row threshold is 16 characters of duty for opus', () => {
  const fit = check('3 at 16', base({ agents: agents(['a', D16, D16]) }))
  expect(shape(fit.plates)).toEqual([3])
  const over = check('3 with one at 17', base({ agents: agents(['a', D17, D16]) }))
  expect(shape(over.plates)).toEqual([2, 1])
  // Past three items the same duty keeps three columns while all fit, two when one does not.
  expect(shape(check('4 at 16', base({ agents: agents(['a', D16, D16, D16]) })).plates)).toEqual([3, 1])
  expect(shape(check('4 with one at 17', base({ agents: agents(['a', D17, D16, D16]) })).plates)).toEqual([2, 2])
})

test('panel: the half-of-a-row threshold is 35 characters; beyond it, three or fewer items stack', () => {
  expect(shape(check('2 at 35', base({ agents: agents(['a', D35]) })).plates)).toEqual([2])
  expect(shape(check('2 with one at 36', base({ agents: agents(['a', D36]) })).plates)).toEqual([1, 1])
  expect(shape(check('3 at 35', base({ agents: agents(['a', D35, D35]) })).plates)).toEqual([2, 1])
  expect(shape(check('3 with one at 36', base({ agents: agents(['a', D36, 'b']) })).plates)).toEqual([1, 1, 1])
  // Past three the same 36 pairs up and is cut to the column: 34 characters and an ellipsis.
  const r = check('4 with one at 36', base({ agents: agents(['a', D36, 'b', 'c']) }))
  expect(shape(r.plates)).toEqual([2, 2])
  expect(unesc(r.plates[1]!.side)).toBe(`${'x'.repeat(34)}…`)
  expect(r.plates[1]!.w).toBe(412)
})

test('panel: a busy session of nine mixes models, waiting agents and long duties', () => {
  const duties = [
    'this chat',
    'W5-1 Opus: app onboarding',
    'W5-2 Opus: CLI parity',
    'W5-3 Opus: hooks audit',
    LONG,
    'Explore: find usages of panel()',
    'lint',
    'scan more',
    'verify build output',
  ]
  const list = agents(duties).map((a, i) => ({ ...a, model: [OPUS, SONNET, 'claude-haiku-5-5', 'claude-fable-5-5'][i % 4]!, isRunning: i % 3 !== 2 }))
  const r = check('9 busy', base({ agents: list, costs: COSTS }))
  expect(shape(r.plates)).toEqual([2, 2, 2, 2, 1])
  expect(r.height).toBe(110 + 5 * 24)
  expect(count(r.svg, 'fill-opacity="0.35"')).toBe(3)
  expect(r.plates.map(p => p.stripe)).toEqual(['#D97757', '#6A9BCC', '#7FA65A', '#B18AE0', '#D97757', '#6A9BCC', '#7FA65A', '#B18AE0', '#D97757'])
})

test('panel: twenty agents stay in columns of three or two, never wider', () => {
  const small = check('20 short', base({ agents: agents(Array.from({ length: 20 }, (_, i) => `task ${i}`)) }))
  expect(shape(small.plates)).toEqual([3, 3, 3, 3, 3, 3, 2])
  expect(small.height).toBe(84 + 7 * 24)

  const big = check('20 long', base({ agents: agents(Array.from({ length: 20 }, () => LONG)), costs: COSTS }))
  expect(shape(big.plates)).toEqual(Array(10).fill(2))
  expect(big.height).toBe(110 + 10 * 24)

  const mixed = check('20 with one that is just over a third', base({ agents: agents(Array.from({ length: 20 }, (_, i) => (i === 7 ? D17 : 'task'))) }))
  expect(shape(mixed.plates)).toEqual(Array(10).fill(2))
})

test('panel: short agents with one very long one drop to two columns past three items, else one', () => {
  const veryLong = 'y'.repeat(300)
  // 2 and 3 items: the long one cannot be cut to a column, so everything stacks.
  expect(shape(check('main + long', base({ agents: agents(['this chat', veryLong]) })).plates)).toEqual([1, 1])
  expect(shape(check('main + short + long', base({ agents: agents(['this chat', 'scan', veryLong]) })).plates)).toEqual([1, 1, 1])
  // 4 and more: pairs, the long duty cut to the column.
  const four = check('main + 2 short + long', base({ agents: agents(['this chat', 'scan', 'lint', veryLong]) }))
  expect(shape(four.plates)).toEqual([2, 2])
  expect(unesc(four.plates[3]!.side)).toBe(`${'y'.repeat(34)}…`)
  le(four.plates[3]!.x + four.plates[3]!.w, 1000)
  expect(shape(check('main + 8 short + long', base({ agents: agents(['m', ...Array(8).fill('s'), veryLong]) })).plates)).toEqual([2, 2, 2, 2, 2])
  // One item alone: cut at 90 characters, not to a column.
  const one = check('one very long', base({ agents: agents([veryLong]) }))
  expect(unesc(one.plates[0]!.side)).toBe(`${'y'.repeat(89)}…`)
  expect(one.plates[0]!.w).toBe(819)
})

test('panel: an empty duty still draws a plate', () => {
  const r = check('empty duty', base({ agents: agents(['']) }))
  expect(r.svg).toContain('<tspan class="pd" dx="12"></tspan>')
  expect(r.plates[0]!.w).toBe(153)
  expect(shape(check('3 empty', base({ agents: agents(['', '', '']) })).plates)).toEqual([3])
  expect(shape(check('mixed empty', base({ agents: agents(['', 'scan', '', LONG]) })).plates)).toEqual([2, 2])
})

test('panel: unicode and emoji duties are drawn as they are', () => {
  const duties = ['この変更をレビュー', '🚀 deploy', 'café ☕ résumé', '中文任务 ✅']
  const r = check('unicode', base({ agents: agents(duties) }))
  for (const d of duties) expect(r.svg).toContain(d)
  const solo = check('emoji only', base({ agents: agents(['🔥']) }))
  expect(solo.svg).toContain('🔥')
  // Wide characters are not counted double (the plate is an estimate and textLength squeezes the text), but nothing leaves the grid.
  const wide = check('wide', base({ agents: agents(['日本語'.repeat(20)]) }))
  le(wide.plates[0]!.x + wide.plates[0]!.w, 1000)
})

test('span counts wide characters and emoji as two, a whole emoji sequence as one grapheme', () => {
  expect(span('')).toBe(0)
  expect(span('scan')).toBe(4)
  expect(span('日本語')).toBe(6)
  expect(span('한국')).toBe(4)
  expect(span('🚀')).toBe(2)
  expect(span('👩‍👩‍👧‍👦')).toBe(2)
  expect(span('café')).toBe(4)
  expect(span('e\u0301')).toBe(1)
})

test('cut keeps text within n narrow characters, never splitting a grapheme', () => {
  expect(cut('scan', 4)).toBe('scan')
  expect(cut('scanner', 5)).toBe('scan…')
  expect(cut('日本語のタスク', 7)).toBe('日本語…')
  expect(cut('👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦', 4)).toBe('👩‍👩‍👧‍👦…')
  expect(cut('👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦', 5)).toBe('👩‍👩‍👧‍👦👩‍👩‍👧‍👦…')
  expect(cut('cafe\u0301s', 5)).toBe('cafe\u0301s')
  expect(cut('cafe\u0301s and more', 5)).toBe('cafe\u0301…')
  for (const s of ['日本語のタスクを実行する', '🧑‍💻 pair 👩‍👩‍👧‍👦 family', 'x'.repeat(50)]) {
    for (let n = 2; n < 30; n++) expect(span(cut(s, n))).toBeLessThanOrEqual(n)
  }
})

test('panel: a cut never splits an emoji into a lone surrogate', () => {
  const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
  const run = { key: 'r', name: '🚀'.repeat(30), secs: 5, count: 1, phases: [], agents: [{ key: 'w', label: '🔥'.repeat(60), model: OPUS, secs: 1 }], more: 0 }
  for (const p of [
    base({ agents: agents(['🚀'.repeat(100)]) }),
    base({ agents: agents(['x' + '🚀'.repeat(60), '🎯'.repeat(40), 'a', 'b']) }),
    base({ agents: agents(['scan']), runs: [run] }),
  ]) {
    const r = check('emoji cut', p)
    expect(r.svg).toContain('…')
    expect(lone.test(r.svg)).toBe(false)
  }
})

test('panel: duties with < > & and " stay escaped', () => {
  const nasty = '<script>alert("x")</script> & <b>"q"</b>'
  const r = check('nasty duty', base({ agents: agents([nasty, 'a & b', '"quoted"', '<<<>>>']) }))
  expect(r.svg).not.toContain('<script')
  expect(r.svg).not.toContain('<b>')
  expect(r.svg).not.toContain('alert("x")')
  expect(r.svg).toContain('&#60;')
  expect(r.svg).toContain('&#62;')
  expect(r.svg).toContain('&#38;')
  expect(r.svg).toContain('&#34;')
  expect(r.svg).toContain('a &#38; b')
  // A cut never lands inside an entity: the escape happens after the cut.
  const cutOne = check('escaped and cut', base({ agents: agents(['m', '<'.repeat(100)]) }))
  expect(unesc(cutOne.plates[1]!.side)).toBe(`${'<'.repeat(89)}…`)
  // Entities written in the duty are text, not markup: their ampersand is escaped.
  expect(check('entity', base({ agents: agents(['&lt;b&gt;']) })).svg).toContain('&#38;lt;b&#38;gt;')
})

test('panel: the title, debt, model names and workflow text are escaped too', () => {
  const svg = panel(
    base({
      name: '<img src=x onerror=1>&"',
      debt: '<9>',
      agents: [{ key: 'a', model: 'claude-<b>-1', duty: 'd', isRunning: true }],
      runs: [run(1, 'label <i>&"', { name: '<script>x</script>' })],
    }),
  )
  expect(svg).not.toContain('<img')
  expect(svg).not.toContain('<script')
  expect(svg).not.toContain('<b>')
  expect(svg).not.toContain('<i>')
  expect(/&(?!#\d+;)/.test(svg)).toBe(false)
  check('escaped chrome', base({ name: '<x>', agents: agents(['d']), runs: [run(2, 'a<b>&c"d')] }))
})

test('panel: an unknown model reads MODEL ? and takes the default color', () => {
  const noModel = { key: 'a', model: undefined as never, duty: 'who', isRunning: true }
  const r = check('unknown model', base({ agents: [noModel] }))
  expect(r.svg).toContain('>MODEL ?<tspan')
  expect(r.plates[0]!.stripe).toBe('#D97757')

  const odd = check('unrecognised model', base({ agents: agents(['d'], 'claude-mystery-9') }))
  expect(odd.svg).toContain('>MYSTERY-9<tspan')
  expect(odd.plates[0]!.stripe).toBe('#D97757')

  const blank = check('blank model', base({ agents: agents(['d'], '') }))
  expect(blank.plates[0]!.stripe).toBe('#D97757')
  // A model name without the claude- prefix is shown whole.
  expect(check('bare model', base({ agents: agents(['d'], 'gpt-x') })).svg).toContain('>GPT-X<tspan')
  // Several unknown ones lay out like any others.
  expect(shape(check('3 unknown', base({ agents: [noModel, noModel, noModel] })).plates)).toEqual([3])
})

test('panel: a very long model name squeezes into its plate and never leaves the grid', () => {
  const name = `claude-${'x'.repeat(80)}`
  const one = check('long model alone', base({ agents: agents(['duty'], name) }))
  expect(one.plates[0]!.w).toBe(850)
  const many = check('long model x5', base({ agents: agents(Array(5).fill('duties'), name) }))
  expect(shape(many.plates)).toEqual([2, 2, 1])
  for (const p of many.plates) expect(unesc(p.side)).toBe('dut…')
})

test('panel: waiting agents keep fill-opacity 0.35 on their stripe, running ones have none', () => {
  const list = agents(['a', 'b', 'c', 'd', 'e']).map((a, i) => ({ ...a, isRunning: i % 2 === 0 }))
  const r = check('waiting', base({ agents: list }))
  expect(r.plates.map(p => p.isFaded)).toEqual([false, true, false, true, false])
  expect(count(r.svg, 'fill-opacity="0.35"')).toBe(2)
  const allWaiting = check('all waiting', base({ agents: agents(['a', 'b']).map(a => ({ ...a, isRunning: false })) }))
  expect(count(allWaiting.svg, 'fill-opacity="0.35"')).toBe(2)
  // The stripe color survives fading.
  expect(allWaiting.plates[0]!.stripe).toBe('#D97757')
  expect(count(check('all running', base({ agents: agents(['a', 'b']) })).svg, 'fill-opacity="0.35"')).toBe(0)
})

test('panel: with spend rows the plates sit 26 lower than without', () => {
  const list = agents(['this chat', 'scan', 'lint', 'scan more', LONG])
  const runs = [run(4, 'review:a', { more: 2 })]
  const plain = check('no costs', base({ agents: list, runs }))
  const priced = check('with costs', base({ agents: list, runs, costs: COSTS }))
  expect(plain.below).toBe(84)
  expect(priced.below).toBe(110)
  expect(plain.plates[0]!.y).toBe(84)
  expect(priced.plates[0]!.y).toBe(110)
  expect(priced.height - plain.height).toBe(26)
  expect(priced.plates.map(p => p.y - 26)).toEqual(plain.plates.map(p => p.y))
  expect(priced.plates.map(p => p.x)).toEqual(plain.plates.map(p => p.x))
  expect(priced.more.map(m => m.y - 26)).toEqual(plain.more.map(m => m.y))
  expect(plain.svg).not.toContain('>TODAY')
  expect(priced.svg).toContain('>TODAY $4.00<')
  // A spend row of zero cost divides by nothing and says so without NaN.
  const zero = check('zero costs', base({ agents: agents(['a']), costs: [{ model: OPUS, cost: 0 }] }))
  expect(zero.below).toBe(110)
  expect(zero.svg).toContain('>TODAY $0.00<')
})

// ── panel: workflows ────────────────────────────────────────────────────────

test('panel: a run with no agents is a head plate and nothing else', () => {
  const r = check('run of 0', base({ agents: agents(['this chat']), runs: [run(0)] }))
  expect(r.plates.map(p => p.kind)).toEqual(['agent', 'head'])
  expect(r.plates[1]!.y).toBe(108)
  expect(r.height).toBe(132)
  expect(count(r.svg, '>WORKFLOW</text>')).toBe(1)
  expect(r.svg).toContain('REVIEW · 1:15 · 0 AGENTS')
})

test('panel: a run of one agent puts its plate under the head, at x=170', () => {
  const r = check('run of 1', base({ agents: agents(['this chat']), runs: [run(1)] }))
  expect(r.plates.map(p => p.kind)).toEqual(['agent', 'head', 'wf'])
  expect(r.plates[1]!.y).toBe(108)
  expect(r.plates[2]!.x).toBe(170)
  expect(r.plates[2]!.y).toBe(132)
  expect(r.height).toBe(156)
  expect(r.svg).toContain('REVIEW · 1:15 · 1 AGENT<')
  expect(r.svg).not.toContain('1 AGENTS')
})

test('panel: the workflow head starts at the row after the last agent row, whatever the agent layout', () => {
  for (const n of [1, 2, 3, 4, 5, 9]) {
    const r = check(`head after ${n}`, base({ agents: agents(Array.from({ length: n }, (_, i) => `t${i}`)), runs: [run(2)] }))
    const lastAgentY = Math.max(...r.plates.filter(p => p.kind === 'agent').map(p => p.y))
    expect(r.plates.find(p => p.kind === 'head')!.y).toBe(lastAgentY + 24)
  }
  // With nothing above it, the head is the first row.
  const bare = check('head first', base({ runs: [run(2)] }))
  expect(bare.plates[0]!.kind).toBe('head')
  expect(bare.plates[0]!.y).toBe(84)
})

test('panel: four short workflow agents are 3 + 1, four long ones 2 x 2, two long ones stack', () => {
  const short = check('wf 4 short', base({ agents: agents(['m']), runs: [run(4, 'review:a')] }))
  const wf = short.plates.filter(p => p.kind === 'wf')
  expect(shape(wf)).toEqual([3, 1])
  expect(wf.slice(0, 3).map(p => p.x)).toEqual([170, 451, 731])
  expect(wf[3]!.x).toBe(170)

  const long = check('wf 4 long', base({ agents: agents(['m']), runs: [run(4, 'review:runtime-and-repo-wide-consolidation-pass')] }))
  const lw = long.plates.filter(p => p.kind === 'wf')
  expect(shape(lw)).toEqual([2, 2])
  expect(lw.slice(0, 2).map(p => p.x)).toEqual([170, 591])
  expect(lw[0]!.w).toBe(399)
  expect(unesc(lw[0]!.main)).toBe('REVIEW:RUNTIME-AND-R…')

  const two = check('wf 2 long', base({ agents: agents(['m']), runs: [run(2, 'review:runtime-and-repo-wide-consolidation-pass-long')] }))
  expect(shape(two.plates.filter(p => p.kind === 'wf'))).toEqual([1, 1])
})

test('panel: a workflow label is cut with an ellipsis at 40 characters, or at what its column leaves', () => {
  const label = 'review:' + 'z'.repeat(60)
  const solo = check('wf long label alone', base({ runs: [run(1, label)] }))
  const text = unesc(solo.plates[1]!.main)
  expect(text).toBe(`${label.toUpperCase().slice(0, 39)}…`)
  expect(text.length).toBe(40)

  const exact = check('wf label of exactly 40', base({ runs: [run(1, 'q'.repeat(40))] }))
  expect(unesc(exact.plates[1]!.main)).toBe('Q'.repeat(40))
  const over = check('wf label of 41', base({ runs: [run(1, 'q'.repeat(41))] }))
  expect(unesc(over.plates[1]!.main)).toBe(`${'Q'.repeat(39)}…`)

  const paired = check('wf long labels in pairs', base({ runs: [run(4, label)] }))
  const pm = unesc(paired.plates[1]!.main)
  expect(pm.endsWith('…')).toBe(true)
  expect(pm.length).toBe(21)
  expect(paired.plates[1]!.w).toBe(399)
})

test('panel: "+N more" sits under the last workflow row and counts into the height', () => {
  const r = check('wf more', base({ agents: agents(['m']), runs: [run(4, 'review:a', { more: 3, count: 7 })] }))
  expect(r.more).toEqual([{ y: 180, n: 3 }])
  expect(r.height).toBe(204)
  expect(r.svg).toContain('>+3 more</text>')
  // A run with none left over has no such line; neither does a negative count.
  expect(check('wf no more', base({ runs: [run(2)] })).more).toEqual([])
  expect(check('wf negative more', base({ runs: [run(2, 'a', { more: -4 })] })).more).toEqual([])
  // More with no agents shown still gets its line under the head.
  const bare = check('wf only more', base({ runs: [run(0, 'a', { more: 9, count: 9 })] }))
  expect(bare.more).toEqual([{ y: 108, n: 9 }])
  expect(bare.height).toBe(132)
})

test('panel: several runs stack, each after the previous one ends', () => {
  const r = check(
    'three runs',
    base({
      agents: agents(['this chat', 'scan']),
      costs: COSTS,
      runs: [run(1, 'review:a'), run(5, 'review:runtime-and-repo-wide-consolidation-pass', { more: 2, name: 'second' }), run(0, 'x', { name: 'third' })],
    }),
  )
  const heads = r.plates.filter(p => p.kind === 'head').map(p => p.y)
  // main row 110; head 134; one plate row 158; head 182; 5 plates in 2 cols = 3 rows 206..254, more 278; head 302.
  expect(heads).toEqual([134, 182, 302])
  expect(r.more).toEqual([{ y: 278, n: 2 }])
  expect(r.height).toBe(326)
})

test('panel: a run with many phases or long names keeps its head inside the grid', () => {
  const phases = Array.from({ length: 12 }, (_, i) => ({ name: `phase-number-${i}-with-a-long-name`, done: i, total: 12 }))
  const r = check('many phases', base({ agents: agents(['m']), runs: [run(2, 'a', { phases, name: 'n'.repeat(200), secs: 99_999 })] }))
  const head = r.plates.find(p => p.kind === 'head')!
  le(head.w, 850)
  le(head.x + head.w, 1000)
  le(10, head.textLength)
  // Phase names are cut at 12 characters; a phase with no agents draws a single hollow pip.
  expect(r.svg).toContain('PHASE-NUMBE…')
  const odd = check('empty phases', base({ runs: [run(1, 'a', { phases: [] }), run(1, 'a', { phases: [{ name: '', done: 0, total: 0 }] })] }))
  expect(odd.svg).toContain('○')
})

test('panel: workflow agent plates are drawn in their model color and are never faded', () => {
  const r = check('wf colors', base({ runs: [run(3, 'a', { agents: ['claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-5'].map((model, i) => ({ key: `k${i}`, label: 'x', model, secs: 61 + i })) })] }))
  expect(r.plates.filter(p => p.kind === 'wf').map(p => p.stripe)).toEqual(['#D97757', '#7FA65A', '#B18AE0'])
  expect(r.svg).toContain('1:01')
  expect(r.svg).toContain('1:02')
  expect(r.svg).not.toContain('fill-opacity="0.35"')
})

// ── geometry over many inputs ───────────────────────────────────────────────

test('panel: the geometry holds across a spread of hand-picked sessions', () => {
  const sets: [string, Panel][] = [
    ['all lengths 0..40', base({ agents: agents(Array.from({ length: 41 }, (_, i) => 'x'.repeat(i))) })],
    ['all lengths 0..40 with costs and a run', base({ costs: COSTS, agents: agents(Array.from({ length: 41 }, (_, i) => 'x'.repeat(i))), runs: [run(7, 'review:a', { more: 4 })] })],
    ['two runs of long labels', base({ agents: agents(['m']), runs: [run(9, 'z'.repeat(80)), run(3, 'z'.repeat(80), { more: 1 })] })],
    ['waiting mix', base({ agents: agents(['a', D17, D36, LONG, 'b']).map((a, i) => ({ ...a, isRunning: i % 2 === 1 })) })],
    ['quotes everywhere', base({ agents: agents(['"', '&', '<', '>', '"&<>"']), runs: [run(5, '"&<>"')] })],
    ['wide plate count at each size', base({ agents: agents(Array(6).fill(D16)), runs: [run(6, 'a')] })],
  ]
  for (const [name, p] of sets) check(name, p)
  for (let n = 0; n <= 12; n++) {
    for (const duty of ['', 'a', D16, D17, D35, D36, LONG, 'y'.repeat(200)]) {
      check(`${n} agents of ${duty.length} chars`, base({ agents: agents(Array(n).fill(duty)) }))
      check(`${n} agents of ${duty.length} chars in a run`, base({ runs: [run(n, duty || 'x', { more: n % 3 })] }))
    }
  }
})

test('panel: the geometry holds for a few hundred pseudo-random sessions', () => {
  let seed = 20261011
  const rnd = (n: number) => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed % n
  }
  const models = [OPUS, SONNET, 'claude-haiku-5-5', 'claude-fable-5-5', 'claude-some-very-long-model-name-9-9-9', 'x']
  const chars = 'abc XYZ-_:/+<>&"é日'
  const word = (n: number) => Array.from({ length: n }, () => chars[rnd(chars.length)]).join('')
  const lens = [0, 1, 5, 12, 16, 17, 25, 35, 36, 50, 89, 90, 91, 150]

  for (let i = 0; i < 400; i++) {
    const list: Agent[] = Array.from({ length: rnd(26) }, (_, j) => ({ key: `a${j}`, model: models[rnd(models.length)]!, duty: word(lens[rnd(lens.length)]!), isRunning: rnd(3) > 0 }))
    const runs = Array.from({ length: rnd(3) }, (_, r) =>
      run(rnd(10), word(lens[rnd(lens.length)]!) || 'x', {
        name: word(rnd(40)),
        secs: rnd(100_000),
        more: rnd(4) === 0 ? rnd(30) : 0,
        phases: Array.from({ length: rnd(7) }, () => ({ name: word(rnd(20)), done: rnd(5), total: rnd(6) })),
        key: `r${r}`,
      }),
    )
    check(`random #${i}`, base({ agents: list, runs, costs: rnd(2) ? COSTS : [] }))
  }
})

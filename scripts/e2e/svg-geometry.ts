// End-to-end geometry check of the HUD's SVG band, with the browser's real font metrics.
//
//   CHROME=/opt/pw-browsers/chromium npx tsx scripts/e2e/svg-geometry.ts <outDir>
//
// Renders named scenarios with the mod's own panel() as inline <svg> in a card at 600/1000/1500 px, in dark and
// light colour schemes. For every nameplate (a <g transform=translate> holding an outline <polygon> and a <text>)
// it asserts, in viewBox units:
//   text    the text's right edge is inside its plate's outline (2 units of tolerance)
//   left    plates and their text start at x >= 150 (the tag column is 0..136)
//   overlap plates in one row never overlap horizontally
//   bounds  nothing is drawn outside the 1000-unit viewBox width (or below its height)
//   squeeze textLength (which forces text onto its plate) bends glyphs by at most 1.2x squeezed or 1/0.6 stretched
//   tag     tag labels stay inside their tag polygons
// A PNG per scenario/width/scheme goes to <outDir>; a PASS/FAIL table is printed; exit 1 on any failure.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import { panel } from '../../plugin/hooks/panel.ts'
import type { Agent, Panel, Run } from '../../plugin/hooks/panel.ts'

const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium'
const outDir = process.argv[2]

if (!outDir) {
  console.error('usage: CHROME=<chrome> npx tsx scripts/e2e/svg-geometry.ts <outDir>')
  process.exit(2)
}

const WIDTHS = [600, 1000, 1500]
const SCHEMES = ['dark', 'light'] as const
const TOL = 2
// The page forces each plate's text to its plate (textLength); more than this much bending is visibly distorted.
const SQUEEZE_MAX = 1.2
const SQUEEZE_MIN = 0.6

// ---- scenarios -------------------------------------------------------------------------------------------------

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-fable-1']
const SHORT = ['scan', 'lint', 'docs', 'test', 'build', 'fmt', 'types', 'deps', 'perf', 'e2e']
const LONG = [
  'Investigate the flaky integration test in the payments service and propose a fix',
  'Refactor the authentication middleware to use the new session store API everywhere',
  'Write migration scripts for the legacy customer tables and verify row counts match',
  'Audit every dependency in the monorepo for known vulnerabilities and licence issues',
]
const SPECIAL = ['<script>alert("x")</script>', 'a & b < c > d "quoted"', "it's &amp; &lt;b&gt;", '</text><rect/>']
const UNICODE = ['日本語のタスクを実行する', '🚀 deploy 🎉 to prod', 'Ünïcödé façade — naïve café', '🧑‍💻 pair 👩‍👩‍👧‍👦 family']

const agent = (i: number, duty: string, model = MODELS[i % MODELS.length], isRunning = i % 3 !== 2): Agent => ({
  key: `a${i}`,
  model,
  duty,
  isRunning,
})
const main = (): Agent => ({ key: 'main', model: 'claude-opus-5-5', duty: 'this chat', isRunning: true })
const many = (n: number, duties: string[]) => [main(), ...Array.from({ length: n - 1 }, (_, i) => agent(i, duties[i % duties.length]))]

const COSTS = [
  { model: 'claude-opus-5-5', cost: 4.2 },
  { model: 'claude-sonnet-5-5', cost: 1.1 },
  { model: 'claude-haiku-4-5', cost: 0.07 },
]

const base = (over: Partial<Panel> = {}): Panel => ({
  name: 'probe',
  ctx: 42,
  five: 63,
  resets: '3:11',
  debt: '0',
  week: 35,
  costs: COSTS,
  agents: [main()],
  ...over,
})

const run = (n: number, more: number, labels: string[] = SHORT): Run => ({
  key: 'r1',
  name: 'review-pipeline',
  secs: 125,
  count: n + more,
  phases: [
    { name: 'scan', done: 2, total: 3 },
    { name: 'synthesize-everything', done: 0, total: 2 },
  ],
  agents: Array.from({ length: n }, (_, i) => ({
    key: `w${i}`,
    label: labels[i % labels.length],
    model: MODELS[i % 3],
    secs: 10 + i * 61,
  })),
  more,
})

const SCENARIOS: Record<string, Panel> = {
  'main-only': base(),
  'agents-2-short': base({ agents: many(2, SHORT) }),
  'agents-3-short': base({ agents: many(3, SHORT) }),
  'agents-4-short': base({ agents: many(4, SHORT) }),
  'agents-9-short': base({ agents: many(9, SHORT) }),
  'agents-20-short': base({ agents: many(20, SHORT) }),
  'agents-2-long': base({ agents: many(2, LONG) }),
  'agents-4-long': base({ agents: many(4, LONG) }),
  'agents-9-long': base({ agents: many(9, LONG) }),
  'agents-20-long': base({ agents: many(20, LONG) }),
  'agents-9-mixed': base({ agents: many(9, [...SHORT.slice(0, 3), LONG[0], 'x', LONG[1], 'mid-length duty here']) }),
  'agents-4-mixed': base({ agents: many(4, ['scan', LONG[0], 'docs']) }),
  'agents-4-empty-duty': base({ agents: many(4, ['']) }),
  'agents-9-unicode': base({ agents: many(9, UNICODE) }),
  'agents-4-unicode': base({ agents: many(4, UNICODE) }),
  'agents-9-html-special': base({ agents: many(9, SPECIAL) }),
  'agents-4-html-special': base({ agents: many(4, SPECIAL) }),
  'agents-4-unknown-model': base({ agents: [main(), agent(0, 'scan', 'model ?'), agent(1, 'lint', 'model ?'), agent(2, 'docs', 'model ?')] }),
  'agents-9-no-costs': base({ costs: [], agents: many(9, SHORT) }),
  'agents-20-long-no-costs': base({ costs: [], agents: many(20, LONG) }),
  'main-only-no-costs': base({ costs: [] }),
  'workflow-1-agent': base({ agents: many(3, SHORT), runs: [run(1, 0)] }),
  'workflow-1-agent-long': base({ agents: many(3, SHORT), runs: [run(1, 0, LONG)] }),
  'workflow-4-agents-more': base({ agents: many(4, SHORT), runs: [run(4, 7)] }),
  'workflow-4-long-more': base({ agents: many(9, LONG), runs: [run(4, 12, LONG)] }),
  'workflow-4-special-no-costs': base({ costs: [], agents: many(4, SPECIAL), runs: [run(4, 3, SPECIAL), run(2, 1, UNICODE)] }),
  'final-round': base({ week: 93, five: 95, ctx: 96, debt: '12', agents: many(4, SHORT) }),
  'final-round-workflow': base({ week: 100, five: 100, ctx: 100, debt: '999', agents: many(9, LONG), runs: [run(4, 2, LONG)] }),
  'week-tiny': base({ week: 3, ctx: 0, five: 0, resets: '' }),
}

// ---- in-page measurement ---------------------------------------------------------------------------------------

// A string, not a function: the TypeScript transpiler's helpers would not exist in the page.
const MEASURE = `(() => {
  const svg = document.querySelector('#card svg')
  const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(/\\s+/).map(Number)
  const tr = g => {
    const m = /translate\\(([-\\d.]+)[ ,]+([-\\d.]+)\\)/.exec(g.getAttribute('transform') || '')
    return m ? [Number(m[1]), Number(m[2])] : [0, 0]
  }
  const r = n => Math.round(n * 10) / 10
  const plates = []
  for (const g of svg.querySelectorAll(':scope > g')) {
    const poly = g.querySelector(':scope > polygon')
    const text = g.querySelector(':scope > text')
    if (!poly || !text || poly.getAttribute('fill') !== '#1b1b1b') continue
    const [tx, ty] = tr(g)
    const pb = poly.getBBox()
    const xb = text.getBBox()
    // how far textLength bends the glyphs: the text's natural width over the width it is forced to
    let squeeze = 1
    const forced = Number(text.getAttribute('textLength'))
    if (forced) {
      const c = text.cloneNode(true)
      c.removeAttribute('textLength'); c.removeAttribute('lengthAdjust')
      g.appendChild(c)
      squeeze = c.getComputedTextLength() / forced
      c.remove()
    }
    plates.push({
      squeeze: Math.round(squeeze * 100) / 100,
      text: text.textContent,
      y: ty,
      pl: r(tx + pb.x), pr: r(tx + pb.x + pb.width),
      tl: r(tx + xb.x), tr: r(tx + xb.x + xb.width),
    })
  }
  // tag labels: a polygon straight followed by a text, both direct children of the svg
  const tags = []
  for (const t of svg.querySelectorAll(':scope > text')) {
    const p = t.previousElementSibling
    if (p && p.tagName === 'polygon' && /stroke-width="1"/.test(p.outerHTML) && p.getAttribute('fill') === '#1b1b1b' && p.getBBox().width < 140) {
      const pb = p.getBBox(), xb = t.getBBox()
      tags.push({ text: t.textContent, pr: r(pb.x + pb.width), tr: r(xb.x + xb.width), tl: r(xb.x) })
    }
  }
  // everything: the painted extent of every element, in viewBox units, via the screen matrix
  const sr = svg.getBoundingClientRect()
  const k = vw / sr.width
  let minX = 1e9, maxX = -1e9, maxY = -1e9
  for (const el of svg.querySelectorAll('text, polygon, rect')) {
    if (el.closest('defs, clipPath')) continue
    const b = el.getBoundingClientRect()
    if (!b.width && !b.height) continue
    minX = Math.min(minX, (b.left - sr.left) * k)
    maxX = Math.max(maxX, (b.right - sr.left) * k)
    maxY = Math.max(maxY, (b.bottom - sr.top) * k)
  }
  return { vw, vh, plates, tags, minX: r(minX), maxX: r(maxX), maxY: r(maxY), svgW: r(sr.width), font: getComputedStyle(svg.querySelector('text')).fontFamily }
})()`

type Plate = { squeeze: number; text: string; y: number; pl: number; pr: number; tl: number; tr: number }
type Measured = {
  vw: number
  vh: number
  plates: Plate[]
  tags: { text: string; pr: number; tr: number; tl: number }[]
  minX: number
  maxX: number
  maxY: number
  svgW: number
}

function check(m: Measured) {
  const bad: string[] = []
  const q = (s: string) => JSON.stringify(Array.from(s).length > 40 ? `${Array.from(s).slice(0, 39).join('')}…` : s)

  for (const p of m.plates) {
    if (p.tr > p.pr + TOL) {
      bad.push(`text: ${q(p.text)} right edge ${p.tr} > plate right ${p.pr} (+${(p.tr - p.pr).toFixed(1)}) at y=${p.y}`)
    }
    if (p.squeeze > SQUEEZE_MAX || p.squeeze < SQUEEZE_MIN) {
      bad.push(`squeeze: ${q(p.text)} natural width is ${Math.round(p.squeeze * 100)}% of its forced textLength (glyphs ${p.squeeze > 1 ? 'squeezed' : 'stretched'}) at y=${p.y}`)
    }
    if (p.pl < 150 - 0.5 || p.tl < 150) {
      bad.push(`left: ${q(p.text)} starts at plate ${p.pl} / text ${p.tl}, inside the tag column (<150)`)
    }
  }

  const rows = new Map<number, Plate[]>()
  for (const p of m.plates) {
    rows.set(p.y, [...(rows.get(p.y) ?? []), p])
  }
  for (const [y, row] of rows) {
    row.sort((a, b) => a.pl - b.pl)
    for (let i = 1; i < row.length; i++) {
      if (row[i].pl < row[i - 1].pr - 0.5) {
        bad.push(`overlap: row y=${y}: ${q(row[i - 1].text)} ends ${row[i - 1].pr} but ${q(row[i].text)} starts ${row[i].pl}`)
      }
    }
  }

  if (m.maxX > m.vw + 1 || m.minX < -1) {
    bad.push(`bounds: drawn extent x ${m.minX}..${m.maxX} outside 0..${m.vw}`)
  }
  if (m.maxY > m.vh + 1) {
    bad.push(`bounds: drawn extent bottom ${m.maxY} > viewBox height ${m.vh}`)
  }

  for (const t of m.tags) {
    if (t.tr > t.pr + TOL) {
      bad.push(`tag: ${q(t.text)} right edge ${t.tr} > tag right ${t.pr}`)
    }
  }

  return bad
}

// ---- run -------------------------------------------------------------------------------------------------------

const card = (w: number, dark: boolean) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:${dark ? '#1f1e1d' : '#f0eee6'}">
<style>#card svg{display:block;width:100%;height:auto}</style>
<div id="card" style="width:${w}px;box-sizing:border-box;margin:24px;padding:18px 22px;background:${dark ? '#262624' : '#faf9f5'};border-radius:14px"></div>`

mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ executablePath: CHROME })
const results: { name: string; cells: Record<string, string[]> }[] = []
let font = ''
let worstSq = { min: 9, max: 0, minAt: '', maxAt: '' }

for (const [name, state] of Object.entries(SCENARIOS)) {
  const cells: Record<string, string[]> = {}
  const svg = panel(state)

  for (const scheme of SCHEMES) {
    for (const w of WIDTHS) {
      const page = await browser.newPage({ viewport: { width: w + 48, height: 600 }, colorScheme: scheme, deviceScaleFactor: 1 })
      await page.setContent(card(w, scheme === 'dark'))
      await page.evaluate(s => {
        document.getElementById('card')!.innerHTML = s
      }, svg)
      await page.evaluate('document.fonts.ready')
      const m = (await page.evaluate(MEASURE)) as Measured & { font: string }
      font = m.font
      const bad = check(m)
      for (const p of m.plates) {
        if (p.squeeze < worstSq.min) worstSq = { ...worstSq, min: p.squeeze, minAt: `${name} ${JSON.stringify(Array.from(p.text).slice(0, 30).join(''))}` }
        if (p.squeeze > worstSq.max) worstSq = { ...worstSq, max: p.squeeze, maxAt: `${name} ${JSON.stringify(Array.from(p.text).slice(0, 30).join(''))}` }
      }
      if (m.plates.length < state.agents.length) {
        bad.push(`measure: found ${m.plates.length} plates for ${state.agents.length} agents`)
      }
      cells[`${w}${scheme[0]}`] = bad
      await page.locator('#card').screenshot({ path: join(outDir, `${name}__${w}__${scheme}.png`) })
      await page.close()
    }
  }

  results.push({ name, cells })
}

await browser.close()

// ---- report ----------------------------------------------------------------------------------------------------

const keys = SCHEMES.flatMap(s => WIDTHS.map(w => `${w}${s[0]}`))
const pad = (s: string, n: number) => s.padEnd(n)
const nameW = Math.max(...results.map(r => r.name.length)) + 2

console.log(`font-family in page: ${font}   (d = dark, l = light; widths are card px)`)
console.log(pad('scenario', nameW) + keys.map(k => pad(k, 7)).join(''))

let fails = 0
for (const r of results) {
  console.log(pad(r.name, nameW) + keys.map(k => pad(r.cells[k].length ? 'FAIL' : 'PASS', 7)).join(''))
  fails += keys.filter(k => r.cells[k].length).length
}

for (const r of results) {
  for (const k of keys) {
    if (r.cells[k].length) {
      console.log(`\nFAIL ${r.name} @ ${k}`)
      r.cells[k].slice(0, 8).forEach(b => console.log(`  - ${b}`))
      if (r.cells[k].length > 8) console.log(`  ... ${r.cells[k].length - 8} more`)
    }
  }
}

const total = results.length * keys.length
console.log(`\nglyph distortion (natural/forced width; 1 = none): most stretched ${worstSq.min} (${worstSq.minAt}), most squeezed ${worstSq.max} (${worstSq.maxAt})`)
console.log(`${total - fails}/${total} cells passed; PNGs in ${outDir}`)
process.exit(fails ? 1 : 0)

import type { ModelCost } from '../types'

// The HUD's drawing: pure functions from numbers to SVG, shared by the band and the media scripts.

const TINT: [RegExp, string][] = [
  [/opus/, '#D97757'],
  [/sonnet/, '#6A9BCC'],
  [/haiku/, '#7FA65A'],
  [/fable/, '#B18AE0'],
]

export const tint = (model = '') => TINT.find(([re]) => re.test(model))?.[1] ?? '#D97757'

export const short = (model?: string) => model?.replace(/^claude-/, '') ?? 'model ?'

export const clamp = (n: number) => Math.min(100, Math.max(0, n))

// Green when low, through yellow, to red when high: hsl(120→0, 85%, 50%) as hex, which every surface takes.
export const heat = (pct: number) => {
  const h = 120 * (1 - clamp(pct) / 100)

  return `#${[0, 8, 4]
    .map(n => {
      const k = (n + h / 30) % 12
      return Math.round(255 * (0.5 - 0.425 * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
        .toString(16)
        .padStart(2, '0')
    })
    .join('')}`
}

// Elapsed time, short: 44s, 2:05, 1:02:05.
export const elapsed = (secs: number) => {
  const s = Math.max(0, Math.floor(secs))

  if (s < 60) {
    return `${s}s`
  }

  const [h, m] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60)]
  const ss = String(s % 60).padStart(2, '0')

  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// h:mm until an ISO time, or '' when unknown.
export const countdown = (iso: string | undefined, now: number) => {
  const ms = iso ? Date.parse(iso) - now : NaN

  if (!(ms > 0)) {
    return ''
  }

  const min = Math.floor(ms / 60000)

  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
}

export const textBar = (pct: number) => '█'.repeat(Math.round(clamp(pct) / 10)) + '░'.repeat(10 - Math.round(clamp(pct) / 10))

const esc = (s: string) => s.replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`)

// A slanted Tekken frame at the origin: dark track, `inner` clipped to it under a gloss, light outline.
function frame(id: string, inner: string, w: number, h: number, slant: number) {
  const shape = `${slant},0 ${w},0 ${w - slant},${h} 0,${h}`

  return `<defs>
  <clipPath id="${id}"><polygon points="${shape}"/></clipPath>
  <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff" stop-opacity="0.45"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
</defs>
<polygon points="${shape}" fill="#1b1b1b"/>
<g clip-path="url(#${id})">${inner}<rect width="${w}" height="${h}" fill="url(#${id}g)"/></g>
<polygon points="${shape}" fill="none" stroke="#e8e8e8" stroke-width="1.5"/>`
}

// A health bar filled `pct` from its outer edge; pulses when `isDanger`.
function bar(id: string, pct: number, color: string, isDanger: boolean, w: number, h: number, slant: number) {
  const pulse = isDanger ? '<animate attributeName="opacity" values="1;0.5;1" dur="0.8s" repeatCount="indefinite"/>' : ''

  return frame(id, `<rect width="${(w * clamp(pct)) / 100}" height="${h}" fill="${color}">${pulse}</rect>`, w, h, slant)
}

export type Agent = { key: string; model: string; duty: string; isRunning: boolean }

// One workflow run: its name and age, its phases as done/total pips, and the agents still running.
export type Run = {
  key: string
  name: string
  secs: number
  count: number
  phases: { name: string; done: number; total: number }[]
  agents: { key: string; label: string; model: string; secs: number }[]
  more: number
}

export type Panel = {
  name: string
  ctx: number
  five: number
  resets: string
  debt: string
  week: number
  costs: ModelCost[]
  agents: Agent[]
  runs?: Run[]
}

// Heavy italic type throughout, like the game's HUD. Light mode flips text drawn on the band (.l .v .d);
// text on the dark plates and tags (.pl .pv .pd) stays light in both themes.
const STYLE = `<style>
text{font-family:system-ui,-apple-system,sans-serif;font-style:italic;font-weight:800;letter-spacing:.05em}
.l{fill:#9a9a9a;font-size:13px}
.v{fill:#f0f0f0;font-size:14px}
.d{fill:#9a9a9a;font-size:13px;font-weight:600;letter-spacing:.01em}
.in{fill:#141414;font-size:11px;font-weight:900}
.pl{fill:#9a9a9a;font-size:13px}
.pv{fill:#f0f0f0;font-size:14px}
.pd{fill:#9a9a9a;font-size:13px;font-weight:600;letter-spacing:.01em}
@media (prefers-color-scheme:light){.l,.d{fill:#5f5f5f}.v{fill:#2b2b2b}}
</style>`

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// The gap between a plate's name and its details: a dx offset, since SVG collapses runs of spaces.
const GAP = 12

// The text inside a plate of width w is told to span exactly the plate's inside, so a width estimate that is a
// little off for the viewer's font scales the text a touch instead of spilling it past the plate's edge.
const fit = (w: number) => ` textLength="${Math.max(10, w - 34 - 14)}" lengthAdjust="spacingAndGlyphs"`

// A nameplate as wide as its model name and duty, never past the right edge.
const plate = (a: Agent) => Math.min(850, Math.round(34 + short(a.model).length * 10.4 + GAP + cut(a.duty, 90).length * 7.4 + 24))

// A slanted label tag for the left column; red when it calls a danger.
const tag = (y: number, text: string, isDanger = false) =>
  `<polygon points="6,${y} 136,${y} 130,${y + 16} 0,${y + 16}" fill="#1b1b1b" stroke="${isDanger ? '#E5534B' : '#5a5a5a'}" stroke-width="1"/>
<text x="12" y="${y + 12.5}" class="pl"${isDanger ? ' style="fill:#E5534B"' : ''}>${text}</text>`

// Everything on one 1000-wide grid, so it scales to the band as one piece: tags at 0, gauges from
// 150 to the right edge. P1 is context filling up; P2 is the 5-hour limit, its health draining as you
// use it; debt is the round timer. Below: 7-day stamina, today's spend by model, a nameplate per agent.
export function panel(p: Panel) {
  const total = p.costs.reduce((s, c) => s + c.cost, 0)
  const isFinal = p.week >= 90
  const weekW = (850 * p.week) / 100
  let mx = 0

  const versus = `
<text x="0" y="14" class="v">${esc(p.name.toUpperCase())}<tspan class="l"> · CTX ${p.ctx}%</tspan></text>
<text x="1000" y="14" text-anchor="end" class="l">5H LIMIT ${p.five}%${p.resets ? ` · ${p.resets}` : ''}</text>
<g transform="translate(0,22)">${bar('p1', p.ctx, heat(p.ctx), p.ctx >= 90, 436, 22, 12)}</g>
<g transform="translate(1000,22) scale(-1,1)">${bar('p2', 100 - p.five, heat(p.five), p.five >= 90, 436, 22, 12)}</g>
<text x="500" y="14" text-anchor="middle" class="l">DEBT</text>
<polygon points="460,19 540,19 552,33 540,47 460,47 448,33" fill="#1b1b1b" stroke="#e8e8e8" stroke-width="1.5"/>
<text x="500" y="40" text-anchor="middle" style="font-size:21px;font-weight:900" fill="#f5c542">${esc(p.debt)}</text>`

  const stamina = `
${tag(58, isFinal ? 'FINAL ROUND' : '7D STAMINA', isFinal)}
<g transform="translate(150,59)">${bar('st', p.week, heat(p.week), isFinal, 850, 14, 8)}</g>
${
  weekW >= 50
    ? `<text x="${150 + weekW - 12}" y="70" text-anchor="end" class="in">${p.week}%</text>`
    : `<text x="${150 + Math.max(8, weekW) + 10}" y="70" class="l">${p.week}%</text>`
}`

  // Each model's share sits inside its own segment when the segment has room for it.
  const segments = p.costs
    .map(c => {
      const w = (850 * c.cost) / (total || 1)
      const pct = Math.round((100 * c.cost) / (total || 1))
      const name = short(c.model).replace(/-\d.*$/, '').toUpperCase()
      const seg = `<rect x="${mx}" width="${w}" height="14" fill="${tint(c.model)}"/>${
        w > 90 ? `<text x="${mx + 14}" y="11" class="in">${esc(name)} ${pct}%</text>` : ''
      }`
      mx += w
      return seg
    })
    .join('')
  // No spend data (no Node or ccusage): the TODAY row is left out and the rows below move up.
  const hasMix = p.costs.length > 0
  const below = hasMix ? 110 : 84
  const mixRow = !hasMix ? '' : `
${tag(84, `TODAY $${total.toFixed(2)}`)}
<g transform="translate(150,85)">${frame('mx', segments, 850, 14, 8)}</g>`

  // Fighter nameplates: a slanted plate with the model's color stripe; faded while the agent waits.
  const agents = p.agents
    .map((a, i) => {
      const y = below + i * 24
      return `${i === 0 ? tag(y + 1, 'RUNNING') : ''}
<g transform="translate(150,${y})">
  <polygon points="8,0 ${plate(a)},0 ${plate(a) - 8},18 0,18" fill="#1b1b1b" stroke="#5a5a5a" stroke-width="1"/>
  <polygon points="8,0 26,0 18,18 0,18" fill="${tint(a.model)}"${a.isRunning ? '' : ' fill-opacity="0.35"'}/>
  <text x="34" y="13.5" class="pv"${fit(plate(a))}>${esc(short(a.model).toUpperCase())}<tspan class="pd" dx="${GAP}">${esc(cut(a.duty, 90))}</tspan></text>
</g>`
    })
    .join('')

  // Workflows: a gold header plate per run with phase pips, then a plate per running agent, +N past four.
  let y = below + p.agents.length * 24
  const runs = (p.runs ?? [])
    .map(r => {
      // Each phase: its name (cut to 12) and a pip per agent; widths estimated as drawn.
      const phases = r.phases.map(ph => ({
        name: cut(ph.name.toUpperCase(), 12),
        dots: Array.from({ length: Math.max(1, ph.total) }, (_, i) => (i < ph.done ? '●' : '○')).join(''),
      }))
      const pips = phases
        .map(ph => `<tspan class="pl" dx="${GAP}">${esc(ph.name)}</tspan><tspan fill="#f5c542" style="fill:#f5c542" dx="5">${ph.dots}</tspan>`)
        .join('')
      const pipW = phases.reduce((n, ph) => n + GAP + ph.name.length * 9.4 + 5 + ph.dots.length * 12, 0)
      // The name line gets the room the pips leave, so the plate never has to squeeze it.
      const room = Math.max(16, Math.floor((850 - 58 - pipW) / 10.4))
      const headText = cut(`${r.name.toUpperCase()} · ${elapsed(r.secs)} · ${r.count} AGENT${r.count === 1 ? '' : 'S'}`, room)
      const headW = Math.min(850, Math.round(34 + headText.length * 10.4 + pipW + 24))
      const head = `${tag(y + 1, 'WORKFLOW')}
<g transform="translate(150,${y})">
  <polygon points="8,0 ${headW},0 ${headW - 8},18 0,18" fill="#1b1b1b" stroke="#f5c542" stroke-width="1"/>
  <polygon points="8,0 26,0 18,18 0,18" fill="#f5c542"/>
  <text x="34" y="13.5" class="pv"${fit(headW)}>${esc(headText)}${pips}</text>
</g>`
      y += 24
      const rows = r.agents
        .map(a => {
          const text = `${a.label.toUpperCase()}`
          const meta = `${short(a.model).toUpperCase()} · ${elapsed(a.secs)}`
          const w = Math.min(830, Math.round(34 + cut(text, 40).length * 10.4 + GAP + meta.length * 7.4 + 24))
          const row = `<g transform="translate(170,${y})">
  <polygon points="8,0 ${w},0 ${w - 8},18 0,18" fill="#1b1b1b" stroke="#5a5a5a" stroke-width="1"/>
  <polygon points="8,0 26,0 18,18 0,18" fill="${tint(a.model)}"/>
  <text x="34" y="13.5" class="pv"${fit(w)}>${esc(cut(text, 40))}<tspan class="pd" dx="${GAP}">${esc(meta)}</tspan></text>
</g>`
          y += 24
          return row
        })
        .join('')
      const more = r.more > 0 ? `<text x="204" y="${y + 13.5}" class="l">+${r.more} more</text>` : ''
      y += r.more > 0 ? 24 : 0
      return head + rows + more
    })
    .join('')

  const height = y

  // The markup asks for more width than any band has, so the host draws it at the band's full width.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" width="4000" height="${4 * height}">${STYLE}${versus}${stamina}${mixRow}${agents}${runs}</svg>`
}

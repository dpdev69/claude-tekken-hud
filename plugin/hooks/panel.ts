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

// Green when low, through yellow, to red when high.
export const heat = (pct: number) => `hsl(${Math.round(120 * (1 - clamp(pct) / 100))}, 85%, 50%)`

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

export type Panel = {
  name: string
  ctx: number
  five: number
  resets: string
  debt: string
  week: number
  costs: ModelCost[]
  agents: Agent[]
}

// Heavy italic type throughout, like the game's HUD; light mode flips the text.
const STYLE = `<style>
text{font-family:system-ui,-apple-system,sans-serif;font-style:italic;font-weight:800;letter-spacing:.05em}
.l{fill:#9a9a9a;font-size:13px}
.v{fill:#f0f0f0;font-size:14px}
.d{fill:#9a9a9a;font-size:13px;font-weight:600;letter-spacing:.01em}
.in{fill:#141414;font-size:11px;font-weight:900}
@media (prefers-color-scheme:light){.l,.d{fill:#5f5f5f}.v{fill:#2b2b2b}}
</style>`

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// A nameplate as wide as its model name and duty, never past the right edge.
const plate = (a: Agent) => Math.min(850, Math.round(34 + short(a.model).length * 10.4 + 16 + cut(a.duty, 90).length * 7.4 + 24))

// A slanted label tag for the left column; red when it calls a danger.
const tag = (y: number, text: string, isDanger = false) =>
  `<polygon points="6,${y} 136,${y} 130,${y + 16} 0,${y + 16}" fill="#1b1b1b" stroke="${isDanger ? '#E5534B' : '#5a5a5a'}" stroke-width="1"/>
<text x="12" y="${y + 12.5}" class="l"${isDanger ? ' style="fill:#E5534B"' : ''}>${text}</text>`

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
  const mixRow = `
${tag(84, `TODAY $${total.toFixed(2)}`)}
<g transform="translate(150,85)">${frame('mx', segments, 850, 14, 8)}</g>`

  // Fighter nameplates: a slanted plate with the model's color stripe; faded while the agent waits.
  // ponytail: plate width from per-character estimates of the HUD font; measure in a browser if it ever clips
  const agents = p.agents
    .map((a, i) => {
      const y = 110 + i * 24
      return `${i === 0 ? tag(y + 1, 'RUNNING') : ''}
<g transform="translate(150,${y})">
  <polygon points="8,0 ${plate(a)},0 ${plate(a) - 8},18 0,18" fill="#1b1b1b" stroke="#5a5a5a" stroke-width="1"/>
  <polygon points="8,0 26,0 18,18 0,18" fill="${tint(a.model)}"${a.isRunning ? '' : ' fill-opacity="0.35"'}/>
  <text x="34" y="13.5" class="v">${esc(short(a.model).toUpperCase())}<tspan class="d">   ${esc(cut(a.duty, 90))}</tspan></text>
</g>`
    })
    .join('')

  const height = 110 + p.agents.length * 24

  // The markup asks for more width than any band has, so the host draws it at the band's full width.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" width="4000" height="${4 * height}">${STYLE}${versus}${stamina}${mixRow}${agents}</svg>`
}

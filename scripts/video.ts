// Builds the launch video and its poster from the HUD's real drawing code.
//
//   npx tsx scripts/video.ts   →  media/launch.mp4, media/launch-poster.png
//
// Pass 1 renders each distinct HUD state with scripts/render.ts; pass 2 composites every video frame
// (captions, title/end cards, K.O. flash, toast, fake bar pulse) at 1920x1080 in Chrome; ffmpeg encodes.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import type { Agent, Panel } from '../plugin/hooks/panel.ts'
import { renderFrames } from './render.ts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FFMPEG = '/opt/homebrew/bin/ffmpeg'
const DIR = '.frames/video'
const FPS = 30
const END = 33.5 // seconds
const HUD_FROM = 4.2
const HUD_TO = 28.2
const KO = 25.5

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const seg = (t: number, a: number, b: number) => ease((t - a) / (b - a))
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const fade = (t: number, a: number, b: number, d = 0.3) => Math.max(0, Math.min(1, (t - a) / d, (b - t) / d))

// The fight, as numbers over time.
function hudAt(t: number): Panel {
  const ctx = Math.round(lerp(18, 34, seg(t, 4.5, 8)) + 62 * seg(t, 8, 13))
  const five = Math.round(lerp(41, 60, seg(t, 4.5, 22)) + 40 * seg(t, 22, KO))
  const week = Math.round(lerp(64, 72, seg(t, 4.5, 18)) + 21 * seg(t, 18, 21))
  const mins = Math.max(0, 107 - Math.floor((t - 4.5) * 2.4))
  const agents: Agent[] = []
  const add = (from: number, to: number, a: Omit<Agent, 'isRunning'>, waits: [number, number][] = []) => {
    if (t >= from && t < to) agents.push({ ...a, isRunning: !waits.some(([w0, w1]) => t >= w0 && t < w1) })
  }
  add(13.2, 99, { key: 'a1', model: 'claude-sonnet-5-5', duty: 'Refactoring auth middleware to session tokens' }, [[23, 99]])
  add(14.2, 99, { key: 'a2', model: 'claude-haiku-5-5', duty: 'Scanning the test suite for flaky retries' }, [[16.4, 17.6]])
  add(15.2, 21.5, { key: 'a3', model: 'claude-haiku-5-5', duty: 'Summarizing the CHANGELOG since v1.4.0' })

  const costs = [
    { model: 'claude-opus-5-5', cost: lerp(3.2, 9.8, seg(t, 4.5, 28)) },
    { model: 'claude-sonnet-5-5', cost: lerp(0, 4.1, seg(t, 13.2, 26)) },
    { model: 'claude-haiku-5-5', cost: lerp(0, 0.9, seg(t, 14.2, 24)) },
  ].filter(c => c.cost > 0.01)

  return {
    name: 'tekken-hud',
    ctx,
    five,
    resets: five >= 100 ? '' : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`,
    debt: t < 10 ? '3' : t < 20 ? '4' : '5',
    week,
    costs: costs.map(c => ({ ...c, cost: Math.round(c.cost * 100) / 100 })),
    agents,
  }
}

const CAPTIONS: [number, number, string][] = [
  [4.6, 8, 'P1 · YOUR CONTEXT &nbsp;&nbsp;<b>VS</b>&nbsp;&nbsp; P2 · YOUR 5-HOUR LIMIT'],
  [8, 13, 'CONTEXT FILLS UP — <i class="g">GREEN</i>, <i class="y">YELLOW</i>, <i class="r">RED</i>'],
  [13, 18, 'EVERY AGENT STEPS IN AS A FIGHTER'],
  [18, 22, '7-DAY STAMINA RUNNING LOW? <i class="r">FINAL ROUND.</i>'],
  [22, 28.2, 'THE 5-HOUR LIMIT IS YOUR OPPONENT'],
]

type Frame = {
  title: number
  big: { text: string; o: number; s: number; cls: string }
  stage: number
  shake: [number, number]
  caption: { html: string; o: number }
  hud?: { file: string; n: number; pulse: { p1: number; p2: number; st: number } }
  toast: number
  flash: number
  end: number
}

function frameAt(t: number, hudFile: (t: number) => string): Frame {
  const p = hudAt(t)
  const pulse = (on: boolean) => (on ? ((1 - Math.cos((2 * Math.PI * t) / 0.8)) / 2) * 0.5 : 0)
  const big =
    t >= 2.5 && t < 3.4
      ? { text: 'ROUND 1', o: fade(t, 2.5, 3.4, 0.12), s: lerp(1.5, 1, seg(t, 2.5, 2.7)), cls: 'gold' }
      : t >= 3.4 && t < 4.6
        ? { text: 'FIGHT!', o: fade(t, 3.4, 4.6, 0.25), s: lerp(2.2, 1, seg(t, 3.4, 3.55)) + 0.15 * seg(t, 3.55, 4.6), cls: 'red' }
        : t >= KO && t < 27.6
          ? { text: 'K.O.', o: fade(t, KO, 27.6, 0.1), s: lerp(2.6, 1, seg(t, KO, KO + 0.18)), cls: 'red' }
          : { text: '', o: 0, s: 1, cls: '' }
  const shaking = t >= KO && t < KO + 0.5
  const cap = CAPTIONS.find(([a, b]) => t >= a && t < b)

  return {
    title: fade(t, 0.1, 2.4, 0.4),
    big,
    stage: Math.min(seg(t, HUD_FROM, HUD_FROM + 0.4), 1 - seg(t, 27.8, HUD_TO)),
    shake: shaking ? [Math.round(Math.sin(t * 97) * 14), Math.round(Math.cos(t * 71) * 10)] : [0, 0],
    caption: { html: cap?.[2] ?? '', o: cap ? fade(t, cap[0], cap[1]) * (t >= KO ? 0.25 : 1) : 0 },
    hud: t >= HUD_FROM && t < HUD_TO ? { file: hudFile(t), n: p.agents.length, pulse: { p1: pulse(p.ctx >= 90), p2: pulse(p.five >= 90), st: pulse(p.week >= 90) } } : undefined,
    toast: seg(t, KO + 0.3, KO + 0.6),
    flash: t >= KO ? 0.85 * (1 - seg(t, KO, KO + 0.3)) : 0,
    end: seg(t, 28.3, 28.9),
  }
}

const PAGE = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}
body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#1f1e1d;font-family:system-ui,-apple-system,sans-serif;color:#f0f0f0}
.layer{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.brand{font-size:150px;font-weight:900;font-style:italic;letter-spacing:.04em;line-height:1;
  background:linear-gradient(180deg,#fff6d0 0%,#f5c542 45%,#d97757 100%);-webkit-background-clip:text;color:transparent;
  filter:drop-shadow(0 6px 0 #000)}
.sub{margin-top:22px;font-size:46px;font-weight:700;font-style:italic;letter-spacing:.12em;color:#c9c4bb}
#big{font-size:210px;font-weight:900;font-style:italic;letter-spacing:.03em;-webkit-text-stroke:5px #111;paint-order:stroke fill;filter:drop-shadow(0 10px 0 rgba(0,0,0,.6))}
#big.gold{background:linear-gradient(180deg,#fff 0%,#f5c542 60%,#c9861a 100%);-webkit-background-clip:text;color:transparent}
#big.red{background:linear-gradient(180deg,#fff2c2 0%,#ff7a45 40%,#e5341f 100%);-webkit-background-clip:text;color:transparent}
#stage{position:absolute;left:80px;top:230px;width:1760px}
#caption{height:110px;display:flex;align-items:center;justify-content:center;font-size:50px;font-weight:900;font-style:italic;letter-spacing:.04em}
#caption b{color:#f5c542}.g{color:#3fd65a}.y{color:#e8d23a}.r{color:#ff4a3d}
#hudwrap{position:relative;width:1500px;zoom:1.1733;margin-top:30px}
#hud{display:block;width:1500px}
#pulse{position:absolute;left:22px;top:18px;width:1456px}
#prompt{margin:26px auto 0;width:1760px;height:96px;border-radius:22px;background:#30302e;border:1px solid #4a4845;
  display:flex;align-items:center;padding:0 36px;font-size:30px;color:#8d8a83}
#toast{position:absolute;right:80px;bottom:60px;padding:22px 34px;border-radius:16px;background:#141413;border:2px solid #E5534B;
  font-size:36px;font-weight:800;box-shadow:0 12px 40px rgba(0,0,0,.6)}
#flash{position:absolute;inset:0;background:#fff;pointer-events:none}
#end .cmd{margin-top:70px;padding:28px 44px;border-radius:18px;background:#141413;border:2px solid #f5c542;font:600 34px ui-monospace,Menlo,monospace;line-height:1.6;color:#f0f0f0}
#end .cmd span{color:#9a9a9a}
#end .url{margin-top:36px;font-size:32px;color:#9a9a9a;font-weight:600;letter-spacing:.04em}
#end{background:#1f1e1d}
</style>
<div class="layer" id="title"><div class="brand">TEKKEN HUD</div><div class="sub">for Claude Code</div></div>
<div id="stage">
  <div id="caption"></div>
  <div id="hudwrap"><img id="hud"><svg id="pulse" xmlns="http://www.w3.org/2000/svg">
    <polygon id="p1" points="12,22 436,22 424,44 0,44" fill="#1b1b1b"/>
    <polygon id="p2" points="988,22 564,22 576,44 1000,44" fill="#1b1b1b"/>
    <polygon id="st" points="158,59 1000,59 992,73 150,73" fill="#1b1b1b"/>
  </svg></div>
  <div id="prompt">Reply to Claude…</div>
</div>
<div id="toast">💥 K.O.! 5-hour limit reached</div>
<div class="layer" id="end"><div class="brand">TEKKEN HUD</div><div class="sub">for Claude Code</div>
  <div class="cmd">/plugin marketplace add dpdev69/claude-tekken-hud<br>/plugin install tekken-hud@claude-tekken-hud</div>
  <div class="url">github.com/dpdev69/claude-tekken-hud</div></div>
<div class="layer"><div id="big"></div></div>
<div id="flash"></div>
<script>
window.set = async (f, src) => {
      const $ = (id) => document.getElementById(id)
      $('title').style.opacity = String(f.title)
      $('title').style.transform = \`scale(\${1.15 - 0.15 * Math.min(1, f.title)})\`
      $('big').textContent = f.big.text
      $('big').className = f.big.cls
      $('big').style.opacity = String(f.big.o)
      $('big').style.transform = \`scale(\${f.big.s})\`
      $('stage').style.opacity = String(f.stage)
      $('stage').style.transform = \`translate(\${f.shake[0]}px,\${f.shake[1]}px)\`
      $('caption').innerHTML = f.caption.html
      $('caption').style.opacity = String(f.caption.o)
      $('toast').style.opacity = String(f.toast)
      $('toast').style.transform = \`translateY(\${(1 - f.toast) * 40}px)\`
      $('flash').style.opacity = String(f.flash)
      $('end').style.opacity = String(f.end)
      if (f.hud) {
        $('pulse').setAttribute('viewBox', \`0 0 1000 \${110 + f.hud.n * 24}\`)
        for (const [id, a] of Object.entries(f.hud.pulse)) $(id).setAttribute('fill-opacity', String(a))
      }
      if (src) {
        const img = $('hud')
        img.src = src
        await img.decode()
      }
}
</script>`

async function setFrame(page: import('playwright-core').Page, f: Frame, cache: { file?: string }) {
  const src = f.hud && f.hud.file !== cache.file ? `data:image/png;base64,${readFileSync(f.hud.file).toString('base64')}` : ''
  if (f.hud) cache.file = f.hud.file
  // The setter lives in the page: tsx's __name helper would break a function passed to evaluate.
  await page.evaluate(([f, src]) => (window as any).set(f, src), [f, src] as const)
}

// Pass 1: each distinct HUD state once, with the mod's own renderer.
rmSync(DIR, { recursive: true, force: true })
const hudDir = join(DIR, 'hud')
const states: Panel[] = []
const index = new Map<string, number>()
const hudFile = (t: number) => {
  const key = JSON.stringify(hudAt(t))
  if (!index.has(key)) {
    index.set(key, states.length)
    states.push(hudAt(t))
  }
  return join(hudDir, `${String(index.get(key)).padStart(4, '0')}.png`)
}
const frames = Array.from({ length: Math.round(END * FPS) }, (_, i) => frameAt(i / FPS, hudFile))
const posterFrame: Frame = {
  ...frameAt(24.6, hudFile),
  caption: { html: '<span class="brand" style="font-size:84px">TEKKEN HUD</span>&nbsp;&nbsp;<span class="sub" style="font-size:44px">for Claude Code</span>', o: 1 },
  toast: 0,
}
await renderFrames(states, hudDir)
console.log(`rendered ${states.length} HUD states`)

// Pass 2: composite every video frame at 1920x1080.
const outDir = join(DIR, 'out')
mkdirSync(outDir, { recursive: true })
mkdirSync('media', { recursive: true })
const browser = await chromium.launch({ executablePath: CHROME })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' })
await page.setContent(PAGE)
const cache = {}
for (const [i, f] of frames.entries()) {
  await setFrame(page, f, cache)
  await page.screenshot({ path: join(outDir, `${String(i).padStart(4, '0')}.png`) })
}
await setFrame(page, posterFrame, cache)
await page.evaluate(() => {
  document.getElementById('caption')!.style.height = '140px'
})
await page.screenshot({ path: 'media/launch-poster.png' })
await browser.close()

execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(outDir, '%04d.png'),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', 'media/launch.mp4'], { stdio: 'inherit' })
console.log('wrote media/launch.mp4 and media/launch-poster.png')

// Builds media/hero.png and the README GIFs.   npx tsx scripts/gifs.ts
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'

import type { Panel } from '../plugin/hooks/panel.ts'
import { renderFrames } from './render.ts'

const FPS = 16
const W = 1100
const FFMPEG = '/opt/homebrew/bin/ffmpeg'
const FFPROBE = '/opt/homebrew/bin/ffprobe'

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t))
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min) % 60).padStart(2, '0')}`

const base: Panel = {
  name: 'my-app',
  ctx: 55,
  five: 40,
  resets: hm(112),
  debt: '9',
  week: 70,
  costs: [
    { model: 'claude-opus-5-5', cost: 6 },
    { model: 'claude-sonnet-5-5', cost: 3 },
    { model: 'claude-haiku-5-5', cost: 1 },
  ],
  agents: [],
}
const ag = (key: string, model: string, duty: string, isRunning = true) => ({ key, model: `claude-${model}`, duty, isRunning })
const opus = ag('o', 'opus-5-5', 'this chat')
const sonnet = ag('s', 'sonnet-5-5', 'Research Claude Code mods on GitHub')
const haiku = ag('h', 'haiku-5-5', 'Validate the plugin')

// Build a GIF from a state-at-time function (seconds), then pad frames to one size and encode.
async function gif(name: string, seconds: number, at: (t: number) => Panel) {
  const dir = `.frames/gifs/${name}`
  rmSync(dir, { recursive: true, force: true })
  const n = Math.round(seconds * FPS)
  await renderFrames(Array.from({ length: n }, (_, i) => at(i / FPS)), dir, W)
  // Agent counts change the frame height: pad every frame to the tallest (ffmpeg would otherwise rescale), then palette-encode.
  execFileSync('bash', ['-c', `
    set -e; cd ${dir}; mkdir -p pad
    H=$(for f in 0*.png; do ${FFPROBE} -v error -show_entries stream=height -of csv=p=0 $f; done | sort -n | tail -1)
    for f in 0*.png; do ${FFMPEG} -v error -y -i $f -vf "pad=${W}:$H:0:0:color=0x1f1e1d" pad/$f; done
    ${FFMPEG} -v error -y -framerate ${FPS} -i pad/%04d.png -vf "split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=none" -loop 0 ../../../media/${name}.gif`])
}

mkdirSync('media', { recursive: true })

// hero
await renderFrames([{ ...base, agents: [opus, sonnet, haiku] }], '.frames/gifs/hero', 1500)
copyFileSync('.frames/gifs/hero/0000.png', 'media/hero.png')

// fill: 0.5s hold, 5s fill, 0.7s hold
await gif('fill', 6.2, t => {
  const ctx = Math.round(lerp(10, 95, (t - 0.5) / 5))
  return { ...base, ctx, five: 35, resets: hm(130), week: 40, agents: [] }
})

// agents: spawn sonnet, haiku, sonnet; haiku waits then runs; first sonnet finishes
await gif('agents', 7, t => {
  const list = []
  const s1 = t >= 0.6 && t < 5.2
  const h = t >= 1.4 && t < 5.6
  const s2 = t >= 2.2 && t < 6.0
  const waiting = t >= 3.2 && t < 4.2
  if (s1) list.push(sonnet)
  if (h) list.push(waiting ? { ...haiku, isRunning: false } : haiku)
  if (s2) list.push({ ...sonnet, key: 's2', duty: 'Summarize the open issues' })
  return { ...base, agents: list }
})

// final round: week 72 -> 97, five 72 -> 100 used, so P2 health drains to 0 (K.O.), then hold
await gif('final-round', 6, t => {
  const k = (t - 0.6) / 4
  const five = Math.round(lerp(72, 100, k))
  const week = Math.round(lerp(72, 97, k))
  return { ...base, ctx: 78, five, resets: five < 100 ? hm(lerp(90, 20, k)) : '', week, agents: [] }
})

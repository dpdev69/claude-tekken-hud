// Renders HUD states to PNG frames with the mod's own drawing code, in the system Chrome.
//
//   npx tsx scripts/render.ts states.json out/dir [width]
//
// states.json is an array of Panel objects (see plugin/hooks/panel.ts); frame N is out/dir/000N.png.
// Import `renderFrames` instead to drive it from another script.
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import { panel } from '../plugin/hooks/panel.ts'
import type { Panel } from '../plugin/hooks/panel.ts'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// The band as the desktop app draws it: a dark rounded card on the chat background.
const PAGE = (width: number) => `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#1f1e1d">
<div id="card" style="width:${width}px;box-sizing:border-box;margin:24px;padding:18px 22px;background:#262624;border-radius:14px">
<img id="hud" style="width:100%;display:block">
</div>`

export async function renderFrames(states: Panel[], outDir: string, width = 1500) {
  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ executablePath: CHROME })
  const page = await browser.newPage({ viewport: { width: width + 48, height: 600 }, colorScheme: 'dark', deviceScaleFactor: 1 })
  await page.setContent(PAGE(width))
  const card = page.locator('#card')

  for (const [i, state] of states.entries()) {
    const src = `data:image/svg+xml;utf8,${encodeURIComponent(panel(state))}`
    await page.evaluate(async s => {
      const img = document.getElementById('hud') as HTMLImageElement
      img.src = s
      await img.decode()
    }, src)
    await card.screenshot({ path: join(outDir, `${String(i).padStart(4, '0')}.png`) })
  }

  await browser.close()
}

if (process.argv[1]?.endsWith('render.ts')) {
  const [statesFile, outDir, width] = process.argv.slice(2)
  await renderFrames(JSON.parse(readFileSync(statesFile, 'utf8')), outDir, width ? Number(width) : 1500)
}

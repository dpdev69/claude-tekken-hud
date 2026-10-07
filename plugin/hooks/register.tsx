import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentModels, ModelCost } from '../types'

import { clamp, countdown, heat, panel, short, textBar, tint } from './panel'
import type { Agent } from './panel'

const models = atom({ plugin: 'tekken-hud', key: 'models' } as const, {} as AgentModels)
const tick = atom({ plugin: 'tekken-hud', key: 'tick' } as const, 0)
const debt = atom({ plugin: 'tekken-hud', key: 'debt' } as const, '?')
const project = atom({ plugin: 'tekken-hud', key: 'project' } as const, '')
const root = atom({ plugin: 'tekken-hud', key: 'root' } as const, '')
const mix = atom({ plugin: 'tekken-hud', key: 'mix' } as const, [] as ModelCost[])

// ponytail: debt is a git grep per turn, not a cached ledger; ceiling is repo size, add a cache if it ever passes the timeout
// Counts in the project: the git root of $1 (the last file a tool touched), else of the session's folder.
// git grep keeps it dependency-free and skips ignored files; outside a repo it searches the folder.
// Prints the project name, then the count.
const DEBT = `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; P='(#|//|/[*]) ?ponytail:'
cd "\${1:-.}" 2>/dev/null; cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && basename "$PWD" &&
{ git grep --untracked -I -c -E "$P" 2>/dev/null || git grep --no-index --exclude-standard -I -c -E "$P" 2>/dev/null; } | awk -F: '{s+=$NF} END {print s+0}'`

// Today's cost per model, from ccusage over the local logs: the installed one when setup.sh put it there, else npx.
const MIX = `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; S=$(date +%Y%m%d)
if command -v ccusage >/dev/null; then ccusage daily --json --breakdown --since $S; else npx -y ccusage@20.0.26 daily --json --breakdown --since $S; fi`

const LIVE = ['running', 'pending', 'waiting'] as const

// A failed count shows '?' instead of taking the whole band down.
async function refresh($: EngineInterface) {
  const ran = await $.process.run(['sh', '-c', DEBT, 'sh', await read($, root)], { timeoutMs: 15000 }).catch(() => undefined)
  const [name = '', count = ''] = ran?.stdout.trim().split('\n') ?? []

  await update($, project, () => name)
  await update($, debt, () => count || '?')

  // ponytail: ccusage via npx per turn, ~seconds; install it globally if turns feel it
  const usage = await $.process.run(['sh', '-c', MIX], { timeoutMs: 90000 }).catch(() => undefined)

  try {
    const day = JSON.parse(usage?.stdout ?? '').daily?.[0]
    const costs: ModelCost[] = (day?.modelBreakdowns ?? []).map((b: { modelName: string; cost: number }) => ({
      model: b.modelName,
      cost: b.cost,
    }))

    await update($, mix, () => costs.sort((a, b) => b.cost - a.cost))
  } catch {
    // keep the last mix
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    let isKo = false
    let isFinal = false

    // ponytail: 2s repaint tick, ceiling is redraw cost; swap for agent-finished redraws when the engine exposes one
    $.clock.every(2000, async () => {
      await update($, tick, n => n + 1)

      const limits = (await $.session.usage().catch(() => undefined))?.rateLimits ?? []
      const five = limits.find(l => l.kind === 'five_hour')?.percentUsed ?? 0
      const week = limits.find(l => l.kind === 'seven_day')?.percentUsed ?? 0

      if (five >= 100 && !isKo) {
        $.ui.toast('💥 K.O.! 5-hour limit reached')
      }

      if (week >= 90 && !isFinal) {
        $.ui.toast('⚠️ FINAL ROUND: 7-day limit past 90%')
      }

      isKo = five >= 100
      isFinal = week >= 90
    })
    void refresh($) // never hold up the session for a count

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)

    return next(e)
  })

  // The project follows the files being worked on, so a chat opened above several repos counts the right one.
  on('tool.call', async ($, e, next) => {
    const path = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : ''
    const dir = path.slice(0, path.lastIndexOf('/'))

    if (dir) {
      void (async () => {
        const ran = await $.process.run(['git', '-C', dir, 'rev-parse', '--show-toplevel'], { timeoutMs: 5000 }).catch(() => undefined)
        const top = ran?.exitCode === 0 ? ran.stdout.trim() : ''

        if (top && top !== (await read($, root))) {
          await update($, root, () => top)
          await refresh($)
        }
      })()
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const { agentId, model } = spawned

    if (agentId !== undefined && model !== undefined) {
      await update($, models, m => ({ ...m, [agentId]: model }))
    }

    return spawned
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    await read($, tick) // the read subscribes the band to the tick

    const usage = await $.session.usage().catch(() => undefined)
    const now = await $.clock.now()
    const ctxPct = clamp(usage?.context.percent ?? 0)
    const five = usage?.rateLimits.find(l => l.kind === 'five_hour')
    const week = usage?.rateLimits.find(l => l.kind === 'seven_day')
    const fiveUsed = clamp(five?.percentUsed ?? 0)
    const weekUsed = clamp(week?.percentUsed ?? 0)
    const resets = countdown(five?.resetsAt, now)
    const name = (await read($, project)) || 'p1'
    const debtCount = await read($, debt)
    const costs = await read($, mix)
    const mixTotal = costs.reduce((s, c) => s + c.cost, 0)

    const live = (await $.agent.list()).filter(a => (LIVE as readonly string[]).includes(a.status))
    const seen = await read($, models)
    const main = await $.session.model().catch(() => 'model ?')
    const agents: Agent[] = [
      { key: 'main', model: main, duty: 'this chat', isRunning: e.props.isWorking },
      ...live.map(a => ({
        key: a.id,
        model: seen[a.id] ?? 'model ?',
        duty: a.description || a.name || a.type,
        isRunning: a.status === 'running',
      })),
    ]

    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const hasSvg = e.surface !== 'terminal' && 'Svg' in els

    if (hasSvg) {
      return (
        <els.Svg
          key="panel"
          source={panel({ name, ctx: ctxPct, five: fiveUsed, resets, debt: debtCount, week: weekUsed, costs, agents })}
          alt={`${name}: context ${ctxPct}%, debt ${debtCount}, 5-hour limit ${fiveUsed}% used, 7-day ${weekUsed}% used`}
        />
      )
    }

    // The terminal has no Svg: the same rows as text.
    return (
      <Box flexDirection="column">
        <Box key="versus" gap={1}>
          <Text bold>{name}</Text>
          <Text color={heat(ctxPct)}>{textBar(ctxPct)}</Text>
          <Text bold color="#f5c542">[ {debtCount} ]</Text>
          <Text color={heat(fiveUsed)}>{textBar(100 - fiveUsed).split('').reverse().join('')}</Text>
          <Text dimColor>5h {fiveUsed}%{resets ? ` · ${resets}` : ''}</Text>
        </Box>
        <Box key="stamina" gap={1}>
          <Text dimColor>7d stamina</Text>
          <Text color={heat(weekUsed)}>{textBar(weekUsed)}</Text>
          <Text bold color={heat(weekUsed)}>{weekUsed}%</Text>
          {weekUsed >= 90 && (
            <Text bold color="#E5534B">
              FINAL ROUND
            </Text>
          )}
        </Box>
        {costs.length > 0 && (
          <Box key="mix" gap={1}>
            <Text dimColor>today ${mixTotal.toFixed(2)}</Text>
            {costs.map(c => (
              <Text key={`mix-${c.model}`} color={tint(c.model)}>
                ■ {short(c.model).replace(/-\d.*$/, '')} {Math.round((100 * c.cost) / (mixTotal || 1))}%
              </Text>
            ))}
          </Box>
        )}
        {agents.map(a => (
          <Box key={`run-${a.key}`} gap={1}>
            <Text color={tint(a.model)}>{a.isRunning ? '●' : '○'}</Text>
            <Text bold>{short(a.model)}</Text>
            <Text dimColor wrap="truncate-end">
              {a.duty}
            </Text>
          </Box>
        ))}
      </Box>
    )
  })
}

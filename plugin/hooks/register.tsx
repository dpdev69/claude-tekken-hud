import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentModels, ModelCost, WfAgents, WfRuns } from '../types'

import { clamp, countdown, elapsed, heat, panel, short, textBar, tint } from './panel'
import type { Agent, Run } from './panel'

const models = atom({ plugin: 'tekken-hud', key: 'models' } as const, {} as AgentModels)
const tick = atom({ plugin: 'tekken-hud', key: 'tick' } as const, 0)
const debt = atom({ plugin: 'tekken-hud', key: 'debt' } as const, '?')
const project = atom({ plugin: 'tekken-hud', key: 'project' } as const, '')
const root = atom({ plugin: 'tekken-hud', key: 'root' } as const, '')
const mix = atom({ plugin: 'tekken-hud', key: 'mix' } as const, [] as ModelCost[])
const runs = atom({ plugin: 'tekken-hud', key: 'runs' } as const, {} as WfRuns)
const wf = atom({ plugin: 'tekken-hud', key: 'wf' } as const, {} as WfAgents)
// Kept in state so a reload doesn't toast again for a limit already crossed.
const alerted = atom({ plugin: 'tekken-hud', key: 'alerted' } as const, { ko: false, final: false })

const PATH = 'export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"'

// Counts in the project: the git root of $1 (the last file a tool touched), else of the session's folder.
// git grep keeps it dependency-free and skips ignored files; outside a repo it searches three levels down.
// Prints the project name, then the count.
const DEBT = `${PATH}; P='(#|//|/[*]) ?ponytail:'
cd "\${1:-.}" 2>/dev/null; cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" && basename "$PWD" &&
{ if git rev-parse -q --git-dir >/dev/null 2>&1; then git grep --untracked -I -c -E "$P"
  else git grep --no-index --exclude-standard --max-depth 3 -I -c -E "$P"; fi; } 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}'`

// Today's cost per model, from ccusage over the local logs: the installed one when setup.sh put it there, else npx.
const MIX = `${PATH}; S=$(date +%Y%m%d)
if command -v ccusage >/dev/null; then ccusage daily --json --breakdown --since $S; else npx -y ccusage@20.0.26 daily --json --breakdown --since $S; fi`

const LIVE = ['running', 'pending', 'waiting'] as const

// A run's plates hold the 4 running agents; the rest fold into "+N more".
const SHOWN = 4
// A finished run lingers this long; an agent that never reports back is dropped after the second.
const LINGER = 30_000
const STALE = 30 * 60_000

// DEBT prints the project name, then the count; anything else is a failed run.
export const parseDebt = (stdout = '') => {
  const [name = '', count = ''] = stdout.trim().split('\n')
  return name && /^\d+$/.test(count) ? { name, count } : undefined
}

// ccusage's daily JSON → today's cost per model, biggest first; undefined when it isn't that JSON.
export const parseMix = (stdout = ''): ModelCost[] | undefined => {
  try {
    const day = JSON.parse(stdout).daily?.[0]
    const rows: { modelName?: string; cost?: number }[] = day?.modelBreakdowns ?? []
    return rows
      .filter(b => typeof b.modelName === 'string' && typeof b.cost === 'number')
      .map(b => ({ model: b.modelName as string, cost: b.cost as number }))
      .sort((a, b) => b.cost - a.cost)
  } catch {
    return undefined
  }
}

// Tools that only read: any other tool (an edit, a shell command, an MCP tool, a workflow) may change files, so the
// next refresh re-counts the debt after it finishes.
const READERS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'Skill', 'TodoWrite', 'AskUserQuestion'])
// Edits made outside Claude (an editor, a terminal) are caught by a re-count at most this old.
const DEBT_EVERY = 120_000
// Today's spend moves slowly and ccusage reads every log, so it runs at most once a minute.
const MIX_EVERY = 60_000

let isDirty = true // the debt needs a count: at start, after a file-changing tool, on a new project
let debtAt = -Infinity
let mixAt = -Infinity
let isMixDue = false // a refresh skipped the spend inside its minute; the 2s timer catches it up

// A failed count keeps the last good one instead of blanking the band.
async function refresh($: EngineInterface) {
  const startedAt = await $.clock.now()

  if (isDirty || startedAt - debtAt >= DEBT_EVERY) {
    isDirty = false // cleared first, so a write while the count runs asks for another
    debtAt = startedAt

    const ran = await $.process.run(['sh', '-c', DEBT, 'sh', await read($, root)], { timeoutMs: 15000 }).catch(() => undefined)
    const counted = parseDebt(ran?.stdout)

    if (counted) {
      await update($, project, () => counted.name)
      await update($, debt, () => counted.count)
    } else {
      isDirty = true // try again next turn
    }
  }

  const now = await $.clock.now()

  if (now - mixAt < MIX_EVERY) {
    isMixDue = true
    return
  }

  mixAt = now
  isMixDue = false

  const usage = await $.process.run(['sh', '-c', MIX], { timeoutMs: 90000 }).catch(() => undefined)
  const costs = parseMix(usage?.stdout)

  if (costs) {
    await update($, mix, () => costs)
  } else {
    isMixDue = true // retried once its minute is up
  }
}

// One refresh at a time: a call while one runs queues a single rerun, which reads the latest root.
let running: Promise<void> | undefined
// Each folder's git root, once looked up: one git process per folder, nested repos included.
const tops = new Map<string, string>()
let again = false

function kick($: EngineInterface) {
  if (running) {
    again = true
    return
  }

  running = refresh($).finally(() => {
    running = undefined

    if (again) {
      again = false
      kick($)
    }
  })
}

// The phase titles of a workflow script's meta, in order: `phases: [{ title: 'Review' }, ...]`.
const phasesOf = (script = '') =>
  [...(script.match(/phases\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/title\s*:\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1] ?? '').filter(Boolean)

// Which phase an agent belongs to: the phase its label starts with (`review:runtime` → Review); a workflow with one
// phase owns every agent; else the label's prefix stands in for a phase.
const phaseOf = (label: string, phases: string[]) => {
  const head = label.toLowerCase().split(/[:/\s]/)[0] ?? ''

  return phases.find(p => head.startsWith(p.toLowerCase()) || p.toLowerCase().startsWith(head)) ?? (phases.length === 1 ? phases[0] ?? head : head)
}

// The runs the band shows, from the recorded agents; also says which runs and agents are past keeping.
function shape(allRuns: WfRuns, agents: WfAgents, now: number) {
  const out: Run[] = []
  const dropRuns: string[] = []
  const dropAgents = Object.entries(agents).filter(([, a]) => !a.endedAt && now - a.startedAt > STALE).map(([id]) => id)

  for (const [runId, run] of Object.entries(allRuns)) {
    const mine = Object.entries(agents).filter(([id, a]) => a.runId === runId && !dropAgents.includes(id))
    const live = mine.filter(([, a]) => !a.endedAt)
    const lastEnd = Math.max(0, ...mine.map(([, a]) => a.endedAt ?? 0))

    if ((!live.length && mine.length && now - lastEnd > LINGER) || (!mine.length && now - run.startedAt > STALE)) {
      dropRuns.push(runId)
      continue
    }

    if (!mine.length) {
      continue
    }

    const titles = [...run.phases]

    for (const [, a] of mine) {
      const p = phaseOf(a.label, run.phases)
      if (!titles.some(t => t.toLowerCase() === p.toLowerCase())) titles.push(p)
    }

    out.push({
      key: runId,
      name: run.name,
      secs: ((live.length ? now : lastEnd) - Math.min(run.startedAt, ...mine.map(([, a]) => a.startedAt))) / 1000,
      count: mine.length,
      phases: titles.map(t => {
        const inPhase = mine.filter(([, a]) => phaseOf(a.label, run.phases).toLowerCase() === t.toLowerCase())
        return { name: t, done: inPhase.filter(([, a]) => a.endedAt).length, total: inPhase.length }
      }),
      agents: live.slice(0, SHOWN).map(([id, a]) => ({ key: id, label: a.label, model: a.model, secs: (now - a.startedAt) / 1000 })),
      more: Math.max(0, live.length - SHOWN),
    })
  }

  return { out, dropRuns, dropAgents }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    let seen = ''

    // Repaint only when something visible moved: an agent came or went, a workflow is running, or the minute rolled
    // (the reset countdown). Usage changes repaint through session.measure.
    $.clock.every(2000, async () => {
      const now = await $.clock.now()
      const list = await $.agent.list().catch(() => [])
      const { out, dropRuns, dropAgents } = shape(await read($, runs), await read($, wf), now)

      if (dropRuns.length || dropAgents.length) {
        await update($, runs, r => Object.fromEntries(Object.entries(r).filter(([k]) => !dropRuns.includes(k))))
        await update($, wf, w => Object.fromEntries(Object.entries(w).filter(([k, a]) => !dropAgents.includes(k) && !dropRuns.includes(a.runId))))
      }

      const sig = `${list.map(a => a.id + a.status).join()}|${Math.floor(now / 60000)}|${out.map(r => r.key + r.count).join()}`

      if (sig !== seen || out.some(r => r.agents.length)) {
        seen = sig
        await update($, tick, n => n + 1)
      }

      // Catch-ups: spend skipped inside its minute, and a debt count gone stale (edits made outside Claude).
      if ((isMixDue && now - mixAt >= MIX_EVERY) || now - debtAt >= DEBT_EVERY) {
        kick($)
      }
    })
    kick($) // never held up: kick runs in the background

    return next(e)
  })

  // Usage moved: repaint, and toast once when a limit crosses its line.
  on('session.measure', async ($, e, next) => {
    const five = e.rateLimits.find(l => l.kind === 'five_hour')?.percentUsed ?? 0
    const week = e.rateLimits.find(l => l.kind === 'seven_day')?.percentUsed ?? 0
    const was = await read($, alerted)

    if (five >= 100 && !was.ko) {
      $.ui.toast('💥 K.O.! 5-hour limit reached')
    }

    if (week >= 90 && !was.final) {
      $.ui.toast('⚠️ FINAL ROUND: 7-day limit past 90%')
    }

    if (was.ko !== five >= 100 || was.final !== week >= 90) {
      await update($, alerted, () => ({ ko: five >= 100, final: week >= 90 }))
    }

    await update($, tick, n => n + 1)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ends its run: mark workflow agents done. Only the main loop's turns refresh the counts.
    if (e.agentId) {
      const id = e.agentId
      const now = await $.clock.now()

      if ((await read($, wf))[id]) {
        await update($, wf, w => {
          const cur = w[id]
          return cur ? { ...w, [id]: { ...cur, endedAt: now } } : w
        })
      }
    } else {
      kick($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A Workflow launch names its run; its script's meta lists the phases.
    if (e.tool === 'Workflow') {
      const ran = await next(e)
      const out = ran.result as { runId?: string; workflowName?: string } | undefined
      const runId = out?.runId

      if (runId) {
        const startedAt = await $.clock.now()
        const name = out?.workflowName || e.name || 'workflow'
        const phases = phasesOf(e.script)

        await update($, runs, r => ({ ...r, [runId]: { name, phases: phases.length ? phases : (r[runId]?.phases ?? []), startedAt: r[runId]?.startedAt ?? startedAt } }))
      }

      isDirty = true // its agents may edit files
      return ran
    }

    // The project follows the files being worked on, so a chat opened above several repos counts the right one.
    const path = 'file_path' in e && typeof e.file_path === 'string' ? e.file_path : ''
    const dir = path.slice(0, path.lastIndexOf('/'))

    if (dir) {
      void (async () => {
        let top = tops.get(dir)

        if (top === undefined) {
          const ran = await $.process
            .run(['sh', '-c', `${PATH}; git -C "$1" rev-parse --show-toplevel`, 'sh', dir], { timeoutMs: 5000 })
            .catch(() => undefined)
          top = ran?.exitCode === 0 ? ran.stdout.trim() : ''

          // Only repos are remembered: a folder outside any repo is checked again next time. A folder already mapped
          // to a repo keeps that root for the session, even if it becomes a nested repo of its own later.
          if (top) {
            if (tops.size >= 1000) tops.clear()
            tops.set(dir, top)
          }
        }

        if (top && top !== (await read($, root))) {
          await update($, root, () => top)
          isDirty = true
          kick($)
        }
      })()
    }

    const ran = await next(e)

    // Marked after the tool finishes, so a count that started mid-tool is followed by one that sees the change.
    if (!READERS.has(e.tool)) {
      isDirty = true
    }

    return ran
  }).catch(($, e, next) => next(e)) // tracking only: a failure here must never block a tool

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const { agentId, model } = spawned

    if (agentId !== undefined && model !== undefined) {
      await update($, models, m => ({ ...m, [agentId]: model }))

      // A workflow's agent: tracked here, since $.agent.list() doesn't list workflow agents.
      if (e.workflow?.runId) {
        const { runId, agentIndex } = e.workflow
        const startedAt = await $.clock.now()

        await update($, wf, w => ({ ...w, [agentId]: { runId, label: e.description || `agent ${agentIndex}`, model, startedAt } }))
        await update($, runs, r => (r[runId] ? r : { ...r, [runId]: { name: runId, phases: [], startedAt } }))
      }
    }

    return spawned
  }).catch(($, e, next) => next(e)) // bookkeeping only: a failure here must never block a spawn

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
    const { out: wfRuns } = shape(await read($, runs), await read($, wf), now)

    const live = (await $.agent.list().catch(() => [])).filter(a => (LIVE as readonly string[]).includes(a.status))
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
          source={panel({ name, ctx: ctxPct, five: fiveUsed, resets, debt: debtCount, week: weekUsed, costs, agents, runs: wfRuns })}
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
        {wfRuns.map(r => (
          <Box key={`wf-${r.key}`} flexDirection="column">
            <Box gap={1}>
              <Text bold color="#f5c542">
                ▶ {r.name}
              </Text>
              <Text dimColor>
                {elapsed(r.secs)} · {r.count} agents · {r.phases.map(p => `${p.name} ${p.done}/${p.total}`).join('  ')}
              </Text>
            </Box>
            {r.agents.map(a => (
              <Box key={`wfa-${a.key}`} gap={1} paddingLeft={2}>
                <Text color={tint(a.model)}>●</Text>
                <Text bold>{a.label}</Text>
                <Text dimColor>
                  {short(a.model)} · {elapsed(a.secs)}
                </Text>
              </Box>
            ))}
            {r.more > 0 && <Text dimColor>  +{r.more} more</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}

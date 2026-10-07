export type AgentModels = Record<string, string>
export type ModelCost = { model: string; cost: number }
// Workflow runs by run id, and their agents by agent id (the agent list leaves workflow agents out).
export type WfRuns = Record<string, { name: string; phases: string[]; startedAt: number }>
export type WfAgents = Record<string, { runId: string; label: string; model: string; startedAt: number; endedAt?: number }>

declare module 'claude-code' {
  interface PluginState {
    'tekken-hud': {
      models: AgentModels
      tick: number
      debt: string
      project: string
      root: string
      mix: ModelCost[]
      runs: WfRuns
      wf: WfAgents
      alerted: { ko: boolean; final: boolean }
    }
  }
}

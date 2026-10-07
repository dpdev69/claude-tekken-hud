export type AgentModels = Record<string, string>
export type ModelCost = { model: string; cost: number }

declare module 'claude-code' {
  interface PluginState {
    'tekken-hud': { models: AgentModels; tick: number; debt: string; project: string; root: string; mix: ModelCost[] }
  }
}

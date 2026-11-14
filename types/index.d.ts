export type Item = { id: string; on: boolean; line: number }

declare module 'claude-code' {
  interface PluginState {
    'usagebar': {
      tick: number
      effort: string
      model: string
      menu: string
      extra: boolean
      settings: boolean
      layout: Item[]
      ctxMode: string
      picked: string
      stats: { streak: number; tokens: number }
      sent: string[]
    }
  }
}
export type Tick = number

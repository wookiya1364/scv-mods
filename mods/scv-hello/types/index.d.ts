export type StageState = 'done' | 'doing' | 'blocked' | 'waiting'

export type StepMark = { name: string; mark: StageState | undefined }

export type PlanFile = { slug: string; planText: string; testsText: string }

export type Plan = {
  slug: string
  title: string
  status: string
  steps: StepMark[]
  scenarios: { id: string; name: string }[]
  howToRun: string[]
}

export type Stage = { name: string; state: StageState }

export type TestRun = {
  command: string
  isOk: boolean
  at: number
  byId: Record<string, 'pass' | 'fail'>
  failLines: string[]
}

export type TestRow = { id: string; name: string; result: 'pass' | 'fail' | 'none' }

export type Block = { kind: 'waiting' | 'test' | 'stage'; title: string; detail: string }

export type Task = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }

export type Dreams = { date: string; items: string[]; reportPath: string | null }

export type Snapshot = { plans: PlanFile[]; dreamsText: string | null; cwd: string }

export type Live = {
  isWorking: boolean
  turnStartedAt: number
  tool: { name: string; target: string; startedAt: number } | null
}

export type Expanded = { steps: boolean; tests: boolean; blocks: boolean; dreams: boolean }

declare module 'claude-code' {
  interface PluginState {
    'scv-hello': {
      snapshot: Snapshot
      chosen: string | null
      expanded: Expanded
      runs: TestRun[]
      waiting: string | null
      live: Live
      tasks: Task[]
      history: { slug: string; done: number; at: number }[]
      now: number
      note: string | null
    }
  }
}

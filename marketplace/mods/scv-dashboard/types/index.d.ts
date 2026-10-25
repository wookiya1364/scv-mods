export type StageState = 'done' | 'doing' | 'blocked' | 'waiting'

export type StepMark = { name: string; mark: StageState | undefined; refs: string[]; note?: string }

export type PipelineStep = { name: string; role: string; io: string; kind: string }

export type PlanFile = { slug: string; planText: string; testsText: string; isArchived?: boolean }

export type Plan = {
  slug: string
  title: string
  status: string
  steps: StepMark[]
  scenarios: { id: string; name: string }[]
  howToRun: string[]
  pipeline: PipelineStep[]
  isArchived: boolean
}

export type Stage = { name: string; state: StageState; refs: string[]; note?: string }

// What Claude reported about one step of a plan's Suggested path, kept in the mod's own store.
export type StepSignal = { plan: string; step: number; state: 'doing' | 'done' | 'blocked'; note: string; at: number; startedAt?: number }

export type WorkEntry = { tool: string; target: string; at: number }

export type TestRun = {
  command: string
  isOk: boolean
  at: number
  byId: Record<string, 'pass' | 'fail'>
  failLines: string[]
}

export type TestRow = { id: string; name: string; result: 'pass' | 'fail' | 'none' }

export type Block = { kind: 'waiting' | 'permit' | 'stopped' | 'test' | 'stage'; title: string; detail: string }

// A permission prompt on screen: which tool asks, and since when.
export type Permit = { tool: string; target: string; at: number }

// The main turn ended without finishing its answer: an error, or a refusal.
export type Stopped = { why: 'error' | 'refusal'; at: number }

// A subagent at work: its name and the last tool it used, since when.
export type AgentState = { id: string; name: string; tool: string; target: string; at: number }

// The moment the person last sent a message, and which steps of the plan on screen were done then.
export type Since = { at: number; slug: string; doneSteps: number[] }

// One usage window as the session reports it: five_hour, seven_day or a gateway's spend_limit.
export type UsageLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type Task = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }

export type Dreams = { date: string; items: string[]; reportPath: string | null }

// cwd: the project folder the pane reads (the nearest holding scv/); root: the session root it was found from.
export type Snapshot = { plans: PlanFile[]; dreamsText: string | null; cwd: string; root: string }

export type Live = {
  isWorking: boolean
  turnStartedAt: number
  tool: { name: string; target: string; startedAt: number } | null
}

export type Expanded = { steps: boolean; tests: boolean; blocks: boolean; dreams: boolean }

// A viewer session drawing another session's state: whose, when it last arrived (0: nothing yet) and when it was last asked for.
export type Mirror = { host: string; at: number; askedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'scv-dashboard': {
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
      focusStep: number | null
      stepLog: Record<string, WorkEntry[]>
      signals: StepSignal[]
      permit: Permit | null
      stopped: Stopped | null
      agents: AgentState[]
      since: Since | null
      limits: UsageLimit[]
      mirror: Mirror | null
    }
  }
}

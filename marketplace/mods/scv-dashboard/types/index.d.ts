export type StageState = 'done' | 'doing' | 'blocked' | 'waiting'

export type StepMark = { name: string; mark: StageState | undefined; refs: string[]; role?: string; note?: string }

export type PipelineStep = { name: string; role: string; io: string; kind: string }

// archivedAt: the date its archive record (ARCHIVED_AT.md) gives, for an archived plan.
export type PlanFile = { slug: string; planText: string; testsText: string; isArchived?: boolean; archivedAt?: string }

export type Plan = {
  slug: string
  title: string
  status: string
  steps: StepMark[]
  scenarios: { id: string; name: string }[]
  howToRun: string[]
  pipeline: PipelineStep[]
  isArchived: boolean
  archivedAt: string
  // A plan set aside for another (status: paused): the plan it waits for and the step it resumes from;
  // a plan made for such a detour: the plan to go back to. '' when absent.
  pausedBy: string
  resumeAt: string
  returnTo: string
}

export type Stage = { name: string; state: StageState; refs: string[]; role?: string; note?: string }

// What Claude reported about one step of a plan's Suggested path, kept in the mod's own store.
export type StepSignal = { plan: string; step: number; state: 'doing' | 'done' | 'blocked'; note: string; at: number; startedAt?: number }

export type WorkEntry = { tool: string; target: string; at: number }

// The project's pure-function dictionary (scv/core/catalog/pure/*.md), by function name: its role and kind.
export type Catalog = Record<string, { role: string; kind: string }>

// A function a step wrote under an @pure / @deterministic marker, with what its comment says.
export type MadeFunction = { name: string; tier: 'pure' | 'deterministic'; role: string; kind: string }

// What a step did in functions: the ones it wrote under a marker, and the known ones its writing calls.
export type StepFunctions = { made: MadeFunction[]; used: string[] }

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
// reportHtml: the dreams report itself, so a viewer on another device can open its own copy.
// catalog: the project's pure-function dictionary, read with the plans.
export type Snapshot = { plans: PlanFile[]; dreamsText: string | null; reportHtml?: string | null; cwd: string; root: string; catalog?: Catalog }

export type Live = {
  isWorking: boolean
  turnStartedAt: number
  tool: { name: string; target: string; startedAt: number } | null
}

export type Expanded = { steps: boolean; tests: boolean; blocks: boolean; dreams: boolean }

// A viewer session drawing another session's state: whose, when it last arrived (0: nothing yet) and when it was last asked for.
// hostAt: the working session's own clock on the newest state taken, so a state that arrives late is dropped.
// from: the address this session gave in its last ask; a newer one (Remote Control written down late) asks again.
export type Mirror = { host: string; at: number; askedAt: number; name?: string | null; hostAt?: number; from?: string }

// The viewer sessions a working session sends its state to, by address: what was sent last, when, and failed sends in a row.
export type Viewers = Record<string, { sent: string; at: number; misses: number }>

declare module 'claude-code' {
  interface PluginState {
    'scv-dashboard': {
      snapshot: Snapshot
      chosen: string | null
      'host-in-view': string | null
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
      stepFunctions: Record<string, StepFunctions>
      showCalls: boolean
      workingOn: { plan: string; step: number } | null
      signals: StepSignal[]
      permit: Permit | null
      stopped: Stopped | null
      agents: AgentState[]
      since: Since | null
      limits: UsageLimit[]
      mirror: Mirror | null
      viewers: Viewers
    }
  }
}

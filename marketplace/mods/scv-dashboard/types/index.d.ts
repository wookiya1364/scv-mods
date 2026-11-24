// yourTurn: the step in progress while Claude's turn has ended and the work waits for the person's next message.
// It exists on screen only — a plan's progress lines and Claude's step signals never carry it.
export type StageState = 'done' | 'doing' | 'blocked' | 'waiting' | 'yourTurn'

// Whose move it is: Claude is working, the person's message is awaited, or work Claude started in the background is.
export type TurnState = 'working' | 'yourTurn' | 'background'

// isReported: the mark came from a report of the step itself (a step signal, a progress line), not from a mark
// left in the plan's step list — only a reported step past the first open one shows as in progress.
export type StepMark = { name: string; mark: StageState | undefined; refs: string[]; role?: string; note?: string; isReported?: boolean }

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
  // The plan's `## 변경 이력` entries — headline only, newest first (step progress, added steps, pauses, choice answers).
  history: string[]
}

export type Stage = { name: string; state: StageState; refs: string[]; role?: string; note?: string }

// What Claude reported about one step of a plan's Suggested path, kept in the mod's own store.
// What a step reported as its proof when it was done: project files (pictures, results) and/or a command's output.
export type EvidenceFile = { path: string; size: number; kind: 'image' | 'text' | 'other' }
export type Evidence = { files: EvidenceFile[]; output?: string }

// Where a running step's real progress can be seen: a log file in the project and/or a page to open.
export type StepSource = { log?: string; url?: string }

export type StepSignal = {
  plan: string
  step: number
  state: 'doing' | 'done' | 'blocked'
  note: string
  at: number
  startedAt?: number
  evidence?: Evidence
  source?: StepSource
}

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

// at: when the task became the one in progress (absent for a task that never was, or a list read before 0.2.26).
export type Task = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed'; at?: number }

// Work a turn left running after it ended: a command sent to the background, a watch, or a command started in a
// terminal tab. output: the file its output goes to (absent for a terminal tab); line, done, total: the last
// progress line read from it; changedAt: when that file last changed (the start, until it does).
export type Job = {
  id: string
  title: string
  kind: 'command' | 'watch' | 'terminal'
  startedAt: number
  changedAt: number
  output?: string
  line?: string
  done?: number
  total?: number
}

// The jobs still running, at most eight remembered; extra: how many more started while eight were running.
export type JobBoard = { jobs: Job[]; extra: number }

// One line of 'recently finished': when, what, and whether it ended well.
export type DoneEntry = { at: number; text: string; isOk: boolean }

export type Dreams = { date: string; items: string[]; reportPath: string | null }

// cwd: the project folder the pane reads (the nearest holding scv/); root: the session root it was found from.
// reportHtml: the dreams report itself, so a viewer on another device can open its own copy.
// catalog: the project's pure-function dictionary, read with the plans.
// settingsText · gearsText: the project's SCV settings and gear index as read (undefined in a viewer session, which reads no file).
// core: where the SCV plugin is installed (null: not found). gearWaits: gear runs waiting for the person's go-ahead.
export type Snapshot = {
  plans: PlanFile[]
  dreamsText: string | null
  reportHtml?: string | null
  cwd: string
  root: string
  catalog?: Catalog
  settingsText?: string | null
  gearsText?: string | null
  core?: string | null
  gearWaits?: number
}

// hasEnded: this session saw its own main turn end (a new session knows nothing of the turn before it).
// background: the turn that ended last started work that will wake the session by itself.
export type Live = {
  isWorking: boolean
  turnStartedAt: number
  tool: { name: string; target: string; startedAt: number } | null
  hasEnded?: boolean
  background?: boolean
}

// more: the cards under '더 보기' (progress, tests, dreams, history) are open
export type Expanded = { steps: boolean; tests: boolean; blocks: boolean; dreams: boolean; more?: boolean }

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
      jobs: JobBoard
      doneLog: DoneEntry[]
      waiting: string | null
      live: Live
      tasks: Task[]
      history: { slug: string; done: number; at: number }[]
      now: number
      note: string | null
      paneNote: string | null
      gearResult: Record<string, string[]>
      focusStep: number | null
      stepLog: Record<string, WorkEntry[]>
      stepFunctions: Record<string, StepFunctions>
      showCalls: boolean
      startedSteps: { plan: string; step: number }[]
      signals: StepSignal[]
      permit: Permit | null
      stopped: Stopped | null
      agents: AgentState[]
      since: Since | null
      limits: UsageLimit[]
      contextFill?: number | null
      mirror: Mirror | null
      viewers: Viewers
    }
  }
}

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
// What a step reported as its proof when it was done: project files a person can look at (a picture, a video, a page
// to open) and/or a command's output. A step with no file stands on the pure functions its plan line names.
export type EvidenceFile = { path: string; size: number; kind: 'image' | 'video' | 'document' }
export type Evidence = { files: EvidenceFile[]; output?: string }
// The proof picture a person asked to see large: the plan, the step's place in its flow (from 0) and the file's place
// among that step's proof files.
export type BigProof = { plan: string; step: number; index: number }

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
  // The step said it runs behind the conversation (a step that names a log or a page is such work too).
  background?: boolean
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
// kind 'agent': a subagent still running — only in the list kept for the conversation after a clear (the board
// never holds one); its id is the agent's, which its end notice carries.
export type Job = {
  id: string
  title: string
  kind: 'command' | 'watch' | 'terminal' | 'agent'
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

// cwd: the project folder the pane reads (the nearest holding scv/); root: the session root it was found from.
// catalog: the project's pure-function dictionary, read with the plans.
// settingsText · gearsText: the project's SCV settings and gear index as read (undefined in a viewer session, which reads no file).
// core: where the SCV plugin is installed (null: not found). gearWaits: gear runs waiting for the person's go-ahead.
// wordsText: the project's word dictionary (scv/words/WORDS.tsv) as read — null: no such file; undefined: a state
// from a working session that does not read it.
export type Snapshot = {
  plans: PlanFile[]
  cwd: string
  root: string
  catalog?: Catalog
  settingsText?: string | null
  gearsText?: string | null
  wordsText?: string | null
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

// more: the cards under '더 보기' (progress, tests, history) are open
export type Expanded = { steps: boolean; tests: boolean; blocks: boolean; more?: boolean }

// A viewer session drawing another session's state: whose, when it last arrived (0: nothing yet) and when it was last asked for.
// hostAt: the working session's own clock on the newest state taken, so a state that arrives late is dropped.
// from: the address this session gave in its last ask; a newer one (Remote Control written down late) asks again.
export type Mirror = { host: string; at: number; askedAt: number; name?: string | null; hostAt?: number; from?: string }

// The viewer sessions a working session sends its state to, by address: what was sent last, when, and failed sends in a row.
export type Viewers = Record<string, { sent: string; at: number; misses: number }>

// A gear run the pane started itself (no model): when it started and ended, the end of what it wrote, how it ended
// (exitCode null while it runs; 11: it stands before a step that reaches outside), and whether the person stopped it.
export type GearRun = { startedAt: number; endedAt: number | null; tail: string; exitCode: number | null; isStopped: boolean }

// A place where a gear run stopped before a step that reaches outside: the run's token and that step's number.
export type GearWait = { token: string; step: string }

// The block open under a gear in the pane. values: the values being set (picked: the choice buttons' values, by
// argument). confirm: the question before a gear that reaches outside runs — its lines, the steps those lines name,
// the values and data it will run with, and the place a started run waits at (null: nothing has run yet).
// from: where the press came from (the gear card, or the band above the prompt box).
export type GearForm =
  | { kind: 'values'; from: 'card' | 'band'; picked: Record<string, string> }
  | { kind: 'confirm'; from: 'card' | 'band'; picked: Record<string, string>; input: string; lines: string[]; teeth: string[]; wait: GearWait | null; startedAt: number }

// What SCV's `ask` printed for each gear, kept while the gear index reads the same (index: the index text it was read
// under). An empty text: the command ran and did not print values (an older SCV) — that gear goes to the conversation.
export type GearAsks = { index: string | null; byName: Record<string, string> }

// The word dictionary card as this session's person left it: whether it is unfolded (folded, it is one line), the
// entry open in the form (by its avoided word), the entry asked about before it is removed, whether every entry is
// listed, and how many times the form was emptied (a new form draws new fields, so a saved text does not stay in them).
export type WordsView = { isOpen: boolean; edit: string | null; asking: string | null; isAll: boolean; gen: number }

// A viewer session's own line after a press that went to the working session: the card it was pressed in, and
// what came of the send. Gone when the next state arrives.
export type ActNote = { where: 'limits' | 'askMode' | 'gears' | 'words'; text: string }

// A viewer session: the values picked here for a gear's block, by gear then by argument (they travel to the working
// session when the block is submitted). Its other values: hostActs — the acts its working session says it takes
// (0: none said); hostLive — the gear runs under way there. A working session: fromMirror — what a mirror last had it do.
export type ViewPicks = Record<string, Record<string, string>>

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
      gearRuns: Record<string, GearRun>
      gearForms: Record<string, GearForm>
      gearAsks: GearAsks
      light: { isOn: boolean; percent: number }
      lightSaid: string | null
      talks: { user: string; answer: string }[]
      place: { home: string | null; branch: { name: string; isBranch: boolean } | null }
      branchPick: string[] | null
      placeNote: string | null
      gearHint: string | null
      gearDismissed: string | null
      gearOpen: string | null
      gearsAll: boolean
      gearRecent: string[]
      focusStep: number | null
      bigProof: BigProof | null
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
      wordsNote: string | null
      wordsView: WordsView
      hostActs: number
      hostLive: string[]
      viewPicks: ViewPicks
      actNote: ActNote | null
      fromMirror: string | null
    }
  }
}

// Pure steps of the SCV dashboard: text in, values out, nothing read or written.
// The hooks module reads the files and watches the session; these only shape what it saw.

import type {
  AgentState,
  Block,
  Dreams,
  Permit,
  PipelineStep,
  PlanFile,
  Plan,
  Since,
  Stage,
  StageState,
  StepMark,
  StepSignal,
  Stopped,
  Task,
  TestRow,
  TestRun,
  UsageLimit,
  WorkEntry,
} from '../types'

const STATUS_ORDER = ['in_progress', 'testing', 'planned', 'done', 'archived']

const MARKS: readonly [RegExp, StageState][] = [
  [/^\[x\]\s*|^✅\s*/i, 'done'],
  [/^\[~\]\s*|^🔄\s*/, 'doing'],
  [/^\[!\]\s*|^⛔\s*/, 'blocked'],
]

const frontmatter = (text: string, key: string) =>
  text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')

const section = (text: string, names: readonly string[]) => {
  const lines = text.split('\n')
  const start = lines.findIndex(line => names.some(name => line.trim().toLowerCase() === `## ${name}`.toLowerCase()))
  if (start < 0) return []
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line))

  return lines.slice(start + 1, end < 0 ? undefined : end)
}

// A step line may name the pipeline steps it builds after a dash: "화면 그리기 — `render`".
const splitRefs = (text: string) => {
  const [head = '', tail] = text.split(/\s+—\s+(?=`)/)

  return { name: head.trim(), refs: [...(tail ?? '').matchAll(/`([^`]+)`/g)].map(([, ref = '']) => ref.trim()) }
}

const parseStep = (raw: string): StepMark => {
  for (const [pattern, state] of MARKS) {
    if (pattern.test(raw)) return { ...splitRefs(raw.replace(pattern, '')), mark: state }
  }

  return { ...splitRefs(raw), mark: undefined }
}

const cell = (text: string) => text.trim().replace(/^`|`$/g, '')

const howToRun = (testsText: string) =>
  section(testsText, ['How to run', '실행 방법'])
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('```') && !line.startsWith('<!--') && !line.startsWith('#'))

// The plan's pipeline table, read by its header: 단계 (name), 하는 일 (role), 받는 값 → 돌려주는 값, 순수/부수효과.
const parsePipeline = (planText: string): PipelineStep[] => {
  const rows = section(planText, ['순수함수 · 파이프라인 (Pure functions & pipeline)', '순수함수 · 파이프라인', 'Pure functions & pipeline'])
    .filter(line => line.trim().startsWith('|'))
    .map(line => line.split('|').slice(1, -1).map(cell))
  const header = rows[0] ?? []
  const column = (test: (title: string) => boolean) => header.findIndex(test)
  const at = {
    name: column(title => title === '단계' || /^step$/i.test(title)),
    role: column(title => title.includes('하는 일') || title.includes('역할')),
    io: column(title => title.includes('→')),
    kind: column(title => title.includes('순수')),
  }
  const pick = (cells: string[], index: number) => (index >= 0 ? (cells[index] ?? '') : '')

  return rows
    .filter(cells => /^\d+$/.test(cells[0] ?? ''))
    .map(cells => ({ name: pick(cells, at.name), role: pick(cells, at.role), io: pick(cells, at.io), kind: pick(cells, at.kind) }))
}

export const parsePlan = (file: PlanFile): Plan => ({
  slug: file.slug,
  title: frontmatter(file.planText, 'title') ?? file.slug,
  status: file.isArchived ? 'archived' : (frontmatter(file.planText, 'status') ?? 'planned'),
  steps: section(file.planText, ['Suggested path', 'Steps'])
    .map(line => line.match(/^\s*\d+\.\s+(.+)$/)?.[1])
    .filter((step): step is string => Boolean(step))
    .map(parseStep),
  scenarios: [...file.testsText.matchAll(/^###\s+(T\d+)\.\s*(.+)$/gm)].map(([, id = '', name = '']) => ({ id, name: name.trim() })),
  howToRun: howToRun(file.testsText),
  pipeline: parsePipeline(file.planText),
  isArchived: file.isArchived === true,
})

export const parsePlans = (files: readonly PlanFile[]): Plan[] =>
  files
    .map(parsePlan)
    .sort((a, b) => rank(a.status) - rank(b.status) || b.slug.localeCompare(a.slug))

const rank = (status: string) => {
  const at = STATUS_ORDER.indexOf(status)

  return at < 0 ? STATUS_ORDER.length : at
}

export const pickPlan = (plans: readonly Plan[], chosen: string | null): Plan | undefined =>
  plans.find(plan => plan.slug === chosen) ?? plans[0]

export const deriveStages = (plan: Plan): { stages: Stage[]; isEstimated: boolean } => {
  const isMarked = plan.steps.some(step => step.mark)
  const isFinished = plan.status === 'done' || plan.status === 'archived'
  const isStarted = plan.status === 'in_progress' || plan.status === 'testing'

  if (isFinished) return { stages: plan.steps.map(step => ({ name: step.name, refs: step.refs, state: 'done' })), isEstimated: !isMarked }

  // Work stands at one place: the first step not done. Only that step may be doing or blocked;
  // a later step has not started, so whatever its mark says it is still waiting.
  const current = plan.steps.findIndex(step => step.mark !== 'done')
  const stages: Stage[] = plan.steps.map((step, i) => {
    const state: StageState =
      step.mark === 'done' ? 'done' : i !== current ? 'waiting' : step.mark === 'blocked' ? 'blocked' : step.mark === 'doing' || isStarted ? 'doing' : 'waiting'

    return step.note ? { name: step.name, refs: step.refs, state, note: step.note } : { name: step.name, refs: step.refs, state }
  })

  return { stages, isEstimated: !isMarked }
}

export const countStages = (stages: readonly Stage[]) => ({
  done: stages.filter(stage => stage.state === 'done').length,
  doing: stages.filter(stage => stage.state === 'doing').length,
  blocked: stages.filter(stage => stage.state === 'blocked').length,
  waiting: stages.filter(stage => stage.state === 'waiting').length,
  total: stages.length,
})

const TEST_WORDS = /\b(test|tests|pytest|vitest|jest|playwright|mocha|run-plan-tests)\b/

export const isTestCommand = (command: string, howTo: readonly string[]) =>
  howTo.some(line => line.length > 3 && command.includes(line.replace(/^cd\s+\S+\s*&&\s*/, ''))) ||
  TEST_WORDS.test(command)

export const parseTestOutput = (command: string, output: string, isOk: boolean, at: number): TestRun => {
  const byId: Record<string, 'pass' | 'fail'> = {}
  const failLines: string[] = []
  for (const line of output.split('\n')) {
    const isFail = /\b(fail|failed|error)\b|✗|✘|×|실패/i.test(line)
    const isPass = /\b(pass|passed|ok)\b|✓|✔|통과/i.test(line)
    if (isFail && failLines.length < 5 && line.trim()) failLines.push(line.trim().slice(0, 160))
    for (const [, id = ''] of line.matchAll(/\b(T\d+)\b/g)) {
      if (isFail) byId[id] = 'fail'
      else if (isPass && byId[id] !== 'fail') byId[id] = 'pass'
    }
  }

  return { command, isOk, at, byId, failLines }
}

export const runFor = (plan: Plan, runs: readonly TestRun[]): TestRun | undefined => {
  const own = [...runs].reverse().find(run => isTestCommand(run.command, plan.howToRun) && plan.howToRun.some(line => run.command.includes(line.replace(/^cd\s+\S+\s*&&\s*/, ''))))

  return own ?? runs[runs.length - 1]
}

export const mergeTests = (plan: Plan, run: TestRun | undefined): TestRow[] =>
  plan.scenarios.map(scenario => ({ ...scenario, result: run?.byId[scenario.id] ?? 'none' }))

export const findBlocks = (
  stages: readonly Stage[],
  run: TestRun | undefined,
  waiting: string | null,
  permit: Permit | null = null,
  stopped: Stopped | null = null,
): Block[] => [
  ...(stopped
    ? [{ kind: 'stopped' as const, title: `멈춤 — ${stopped.why === 'error' ? '오류' : '거절'}`, detail: '대화창에서 다시 시키면 이어집니다' }]
    : []),
  ...(permit
    ? [{ kind: 'permit' as const, title: `허락 기다림 — ${permit.tool}${permit.target ? `: ${permit.target}` : ''}`, detail: '대화창에서 허락하거나 거절하면 사라집니다' }]
    : []),
  ...(waiting ? [{ kind: 'waiting' as const, title: '답을 기다리는 중', detail: waiting }] : []),
  ...(run && !run.isOk
    ? [{
        kind: 'test' as const,
        title: '시험 실패',
        detail: [Object.entries(run.byId).filter(([, result]) => result === 'fail').map(([id]) => id).join(', '), ...run.failLines]
          .filter(Boolean)
          .join('\n') || run.command,
      }]
    : []),
  ...stages
    .filter(stage => stage.state === 'blocked')
    .map(stage => ({ kind: 'stage' as const, title: '막힌 단계', detail: stage.note ? `${stage.name} — ${stage.note}` : stage.name })),
]

// A live block (an unanswered question, a failed test run) stops the step in progress.
export const applyBlocks = (stages: readonly Stage[], blocks: readonly Block[]): Stage[] =>
  blocks.some(block => block.kind !== 'stage')
    ? stages.map(stage => (stage.state === 'doing' ? { ...stage, state: 'blocked' } : stage))
    : [...stages]

// What a step builds, said as the plan's pipeline: the rows it names, else the rows its words mention.
export const stageRole = (stage: Stage, pipeline: readonly PipelineStep[]): PipelineStep[] => {
  const named = pipeline.filter(step => stage.refs.includes(step.name))

  return named.length > 0 ? named : pipeline.filter(step => step.name.length > 1 && stage.name.includes(step.name))
}

// What a pipeline step does, in plain words: the plan's 하는 일, else what it takes and gives back.
export const describeRole = (step: PipelineStep) => {
  if (step.role) return step.role
  const [input = '', output = ''] = step.io.split('→').map(part => part.trim())

  return output ? `받음: ${input} · 내놓음: ${output}` : step.io || step.name
}

export const logWork = (log: Readonly<Record<string, WorkEntry[]>>, key: string, entry: WorkEntry): Record<string, WorkEntry[]> => {
  const last = log[key]?.[log[key].length - 1]
  if (last?.tool === entry.tool && last.target === entry.target) return { ...log }

  return { ...log, [key]: [...(log[key] ?? []), entry].slice(-8) }
}

const shorten = (text: string, room: number) => (text.length > room ? `${text.slice(0, room - 1)}…` : text)

const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path

export const describeTool = (tool: string, input: Record<string, unknown>): string => {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  if (tool === 'Bash') return text('description') || shorten(text('command'), 60)
  if (text('file_path') || text('notebook_path')) return baseName(text('file_path') || text('notebook_path'))
  if (tool === 'AskUserQuestion') {
    const questions = input.questions as { question?: string }[] | undefined

    return shorten(questions?.[0]?.question ?? '', 80)
  }

  return shorten(text('description') || text('pattern') || text('query') || text('url') || text('skill') || text('path'), 60)
}

export const applyTaskEvent = (tasks: readonly Task[], tool: string, input: Record<string, unknown>): Task[] => {
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    return (input.todos as { content: string; status: Task['status']; activeForm?: string }[]).map((todo, i) => ({
      id: String(i + 1),
      subject: todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content,
      status: todo.status,
    }))
  }
  if (tool === 'TaskCreate') {
    return [...tasks, { id: String(tasks.length + 1), subject: String(input.activeForm ?? input.subject ?? ''), status: 'pending' }]
  }
  if (tool === 'TaskUpdate') {
    if (input.status === 'deleted') return tasks.filter(task => task.id !== input.taskId)

    return tasks.map(task =>
      task.id === input.taskId
        ? {
            ...task,
            subject: String(input.activeForm ?? input.subject ?? task.subject),
            status: (input.status as Task['status'] | undefined) ?? task.status,
          }
        : task,
    )
  }

  return [...tasks]
}

export type StepTime = { slug: string; done: number; at: number }

export const recordStepTimes = (history: readonly StepTime[], slug: string, done: number, at: number): StepTime[] => {
  const last = [...history].reverse().find(entry => entry.slug === slug)

  return last?.done === done ? [...history] : [...history, { slug, done, at }].slice(-200)
}

export const estimateEta = (history: readonly StepTime[], slug: string, remaining: number) => {
  const own = history.filter(entry => entry.slug === slug)
  const perStep = own
    .slice(1)
    .map((entry, i) => {
      const before = own[i] ?? entry

      return { steps: entry.done - before.done, ms: entry.at - before.at }
    })
    .filter(gap => gap.steps > 0)
  if (remaining <= 0) return { kind: 'done' as const }
  if (perStep.length === 0) return { kind: 'unknown' as const }
  const average = perStep.reduce((sum, gap) => sum + gap.ms / gap.steps, 0) / perStep.length

  return { kind: 'estimate' as const, ms: Math.round(average * remaining), basis: perStep.length }
}

// The folders from `dir` up to the root, nearest first: where to look for the project's scv folder.
export const ancestorsOf = (dir: string): string[] => {
  const parts = dir.split('/').filter(Boolean)

  return [...parts.map((_, i) => `/${parts.slice(0, parts.length - i).join('/')}`), '/']
}

// ── step signals: Claude reports a step of the Suggested path; the mod keeps it in its own store ──

export const STEP_TOOL = 'mcp__scv-dashboard__scv_step'

const SIGNAL_STATES = ['doing', 'done', 'blocked'] as const

export type SignalInput = { plan: string; step: number; state: string; note?: string }

export type SignalCheck = { isOk: true } | { isOk: false; reason: string }

// Plan marks and signals as one: a step either side calls done is done; otherwise the latest signal speaks.
export const mergeMarks = (plan: Plan, signals: readonly StepSignal[]): Plan => {
  const own = signals.filter(signal => signal.plan === plan.slug)
  if (own.length === 0) return plan

  return {
    ...plan,
    steps: plan.steps.map((step, i) => {
      const signal = own.find(one => one.step === i + 1)
      if (!signal || step.mark === 'done') return step

      return signal.note ? { ...step, mark: signal.state, note: signal.note } : { ...step, mark: signal.state }
    }),
  }
}

// A signal must name a plan in progress and a step it has; doing and blocked only at the step the work stands on.
export const checkSignal = (input: SignalInput, plans: readonly Plan[], signals: readonly StepSignal[]): SignalCheck => {
  const open = plans.filter(plan => !plan.isArchived && plan.status !== 'done')
  const plan = open.find(one => one.slug === input.plan)
  if (!plan) return { isOk: false, reason: `그런 진행 중 계획이 없습니다: ${input.plan || '(빈 이름)'} — 진행 중: ${open.map(one => one.slug).join(', ') || '없음'}` }
  if (!Number.isInteger(input.step) || input.step < 1 || input.step > plan.steps.length) {
    return { isOk: false, reason: `단계는 1~${plan.steps.length} 입니다 (받은 값: ${String(input.step)})` }
  }
  if (!(SIGNAL_STATES as readonly string[]).includes(input.state)) return { isOk: false, reason: 'state 는 doing · done · blocked 중 하나입니다' }
  if (input.state === 'blocked' && !input.note?.trim()) return { isOk: false, reason: '막힘에는 이유(note)가 필요합니다' }
  if (input.state !== 'done') {
    const current = mergeMarks(plan, signals).steps.findIndex(step => step.mark !== 'done') + 1
    if (current === 0) return { isOk: false, reason: '모든 단계가 이미 끝났습니다' }
    if (input.step !== current) {
      return { isOk: false, reason: `${input.state === 'blocked' ? '막힘' : '진행'}은 지금 단계(${current}번)에만 보낼 수 있습니다` }
    }
  }

  return { isOk: true }
}

// The newest signal for a step replaces the one before it; a step still open keeps the time it started.
export const applySignal = (signals: readonly StepSignal[], input: SignalInput, at: number): StepSignal[] => {
  const before = signals.find(signal => signal.plan === input.plan && signal.step === input.step)
  const startedAt = before && before.state !== 'done' ? (before.startedAt ?? before.at) : undefined

  return [
    ...signals.filter(signal => signal !== before),
    {
      plan: input.plan,
      step: input.step,
      state: input.state as StepSignal['state'],
      note: input.note?.trim() ?? '',
      at,
      ...(startedAt !== undefined ? { startedAt } : {}),
    },
  ].slice(-300)
}

// Steps reported done within this of each other were reported together; the gap says nothing of the work.
const TOGETHER_MS = 30_000

// How long each finished step took: from its start when one was reported, else from the step finished
// before it — unless the two were reported together.
export const stepDurationsFromSignals = (signals: readonly StepSignal[], slug: string): number[] => {
  const done = signals.filter(signal => signal.plan === slug && signal.state === 'done').sort((a, b) => a.at - b.at)

  return done.flatMap((signal, i) => {
    if (signal.startedAt !== undefined) return signal.at > signal.startedAt ? [signal.at - signal.startedAt] : []
    const before = done[i - 1]

    return before && signal.at - before.at >= TOGETHER_MS ? [signal.at - before.at] : []
  })
}

export const estimateFromDurations = (durations: readonly number[], remaining: number): ReturnType<typeof estimateEta> => {
  if (remaining <= 0) return { kind: 'done' }
  if (durations.length === 0) return { kind: 'unknown' }
  const average = durations.reduce((sum, ms) => sum + ms, 0) / durations.length

  return { kind: 'estimate', ms: Math.round(average * remaining), basis: durations.length }
}

// The few lines added to Claude's instructions, only while a plan is in progress.
export const buildStepPrompt = (plans: readonly Plan[], tool = STEP_TOOL): string | null => {
  const open = plans.filter(plan => !plan.isArchived && plan.status !== 'done')
  if (open.length === 0) return null

  return [
    `SCV step signal (scv-dashboard mod): while you implement one of this project's SCV plans, report each step of its Suggested path with the ${tool} tool`,
    '— state "doing" when you start a step, "done" when you finish it, "blocked" with a one-line reason in note when you cannot go on.',
    "Steps are numbered as in the plan's Suggested path, starting at 1. It only updates the SCV pane and changes no file.",
    'If the tool is listed as deferred, load it with ToolSearch first.',
    `Open plans (scv/promote): ${open.map(plan => `${plan.slug} (${plan.steps.length} steps)`).join(', ')}.`,
  ].join(' ')
}

// ── alerts: the moments worth calling the person back for ──

export const ALERT_AFTER_MS = 2 * 60_000

// A subagent's or teammate's turn carries its loop's id; the main conversation's carries none.
export const isMainLoop = (e: { agentId?: string }) => !e.agentId

export type TurnEnd = { kind: 'none' } | { kind: 'done' } | { kind: 'stopped'; why: Stopped['why'] }

// A long answer that finished is worth a call back, and so is a turn an error or a refusal stopped;
// an interrupt is the person's own doing.
export const classifyTurnEnd = (reason: string, durationMs: number, afterMs = ALERT_AFTER_MS): TurnEnd => {
  if (reason === 'error' || reason === 'refusal') return { kind: 'stopped', why: reason }
  if (reason === 'answer' && durationMs >= afterMs) return { kind: 'done' }

  return { kind: 'none' }
}

export const permissionWaitOf = (tool: string, input: Record<string, unknown>, at: number): Permit => ({ tool, target: describeTool(tool, input), at })

// One line of at most 200 characters, the most a phone notification shows.
export const buildAlertText = (parts: readonly (string | null | undefined | false)[]) =>
  shorten(parts.filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim(), 200)

// ── while the person was away: what happened since their last message, and who is working now ──

export type AwayInput = {
  slug: string
  stages: readonly Stage[]
  runs: readonly TestRun[]
  waiting: string | null
  permit: Permit | null
  stopped: Stopped | null
}

export type AwayEvents = { steps: string[]; runs: TestRun[]; waits: string[] }

// What happened after the last message: steps finished since (the plan on screen then), test runs since,
// and whatever waits on the person now.
export const eventsSince = (input: AwayInput, since: Since): AwayEvents => ({
  steps:
    input.slug === since.slug ? input.stages.filter((stage, i) => stage.state === 'done' && !since.doneSteps.includes(i)).map(stage => stage.name) : [],
  runs: input.runs.filter(run => run.at > since.at),
  waits: [
    ...(input.stopped ? [input.stopped.why === 'error' ? '오류로 멈춤' : '거절로 멈춤'] : []),
    ...(input.permit ? [`허락 기다림 — ${input.permit.tool}`] : []),
    ...(input.waiting ? ['질문 1개 기다림'] : []),
  ],
})

const describeRuns = (runs: readonly TestRun[]) => {
  const failed = runs.filter(run => !run.isOk).length
  if (failed === 0) return '모두 통과'
  if (runs[runs.length - 1]?.isOk) return `실패 ${failed}번 뒤 통과`

  return failed === runs.length ? '모두 실패' : `실패 ${failed}번 · 마지막 실패`
}

// At most three lines in plain words; nothing at all when nothing happened.
export const summarizeAway = (events: AwayEvents, elapsedMs: number, format: (ms: number) => string): { title: string; lines: string[] } | null => {
  const lines = [
    events.steps.length > 0 ? shorten(`단계 ${events.steps.length}개 끝 — ${events.steps.join(', ')}`, 80) : null,
    events.runs.length > 0 ? `시험 ${events.runs.length}번 — ${describeRuns(events.runs)}` : null,
    events.waits.length > 0 ? events.waits.join(' · ') : null,
  ].filter((line): line is string => line !== null)

  return lines.length > 0 ? { title: `그 사이 · ${format(elapsedMs)}`, lines } : null
}

export type AgentEvent =
  | { kind: 'start'; id: string; name: string; at: number }
  | { kind: 'tool'; id: string; tool: string; target: string; at: number }
  | { kind: 'end'; id: string }

const agentNamed = (agents: readonly AgentState[], id: string, name: string, at: number): AgentState => ({
  id,
  name: shorten(name, 24) || `에이전트 ${agents.length + 1}`,
  tool: '',
  target: '',
  at,
})

// An agent appears when it starts (or first uses a tool), moves with each tool it uses, and leaves when its run ends.
export const applyAgentEvent = (agents: readonly AgentState[], event: AgentEvent): AgentState[] => {
  if (event.kind === 'end') return agents.filter(agent => agent.id !== event.id)
  const known = agents.find(agent => agent.id === event.id)
  if (event.kind === 'start') {
    if (!known) return [...agents, agentNamed(agents, event.id, event.name, event.at)]

    return event.name ? agents.map(agent => (agent.id === event.id ? { ...agent, name: shorten(event.name, 24) } : agent)) : [...agents]
  }
  const moved = { ...(known ?? agentNamed(agents, event.id, '', event.at)), tool: event.tool, target: event.target, at: event.at }

  return known ? agents.map(agent => (agent.id === event.id ? moved : agent)) : [...agents, moved]
}

// One line per agent, five at most, the rest counted.
export const agentLines = (agents: readonly AgentState[], now: number, format: (ms: number) => string, max = 5): string[] => {
  const lines = agents
    .slice(0, max)
    .map(agent => `${agent.name} · ${agent.tool ? `${agent.tool}${agent.target ? `: ${agent.target}` : ''}` : '준비 중'} · ${format(now - agent.at)}`)

  return agents.length > max ? [...lines, `+${agents.length - max}개 더`] : lines
}

// ── the next command into the prompt box, and the usage limits ──

export type PromptFill = { text: string; mode: 'replace' | 'append' }

// An empty box takes the command; what the person already typed stays, the command after it.
export const planPromptFill = (command: string, draft: string): PromptFill =>
  draft.trim() === '' ? { text: command, mode: 'replace' } : { text: `${/\s$/.test(draft) ? '' : ' '}${command}`, mode: 'append' }

// The dim suggestion after a turn: only when the next thing to do is a command.
export const suggestNext = (action: NextAction): string | null => action.command

const LIMIT_LABEL: Record<string, string> = { five_hour: '5시간', seven_day: '7일', spend_limit: '지출 한도' }

const LIMIT_ORDER = ['five_hour', 'seven_day', 'spend_limit']

// A reset time in the person's own clock: 'HH:MM', or 'M/D HH:MM' when it is days away.
export const formatReset = (iso: string, offsetMinutes: number, withDate: boolean) => {
  const local = new Date(Date.parse(iso) + offsetMinutes * 60_000)
  const time = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`

  return withDate ? `${local.getUTCMonth() + 1}/${local.getUTCDate()} ${time}` : time
}

const percentOf = (limit: UsageLimit) => `${Math.round(limit.percentUsed * 10) / 10}%`

// '5시간 72% · 17:40 초기화 · 7일 31%': the 5-hour reset always, a longer window's when it is nearly used up.
export const usageLine = (limits: readonly UsageLimit[], offsetMinutes: number, nearlyAt = 90): string | null => {
  if (limits.length === 0) return null
  const ordered = [...limits].sort((a, b) => rankOf(a.kind) - rankOf(b.kind))

  return ordered
    .map(limit => {
      const label = `${LIMIT_LABEL[limit.kind] ?? limit.kind} ${percentOf(limit)}`
      const showReset = limit.resetsAt && (limit.kind === 'five_hour' || limit.percentUsed >= nearlyAt)

      return showReset && limit.resetsAt ? `${label} · ${formatReset(limit.resetsAt, offsetMinutes, limit.kind !== 'five_hour')} 초기화` : label
    })
    .join(' · ')
}

const rankOf = (kind: string) => {
  const at = LIMIT_ORDER.indexOf(kind)

  return at < 0 ? LIMIT_ORDER.length : at
}

// Each window over the line is announced once until it resets: its kind and reset time are its name.
export const usageAlerts = (
  limits: readonly UsageLimit[],
  alerted: readonly string[],
  offsetMinutes: number,
  threshold = 90,
): { texts: string[]; alerted: string[] } => {
  const due = limits.filter(limit => limit.percentUsed >= threshold && !alerted.includes(`${limit.kind}:${limit.resetsAt ?? ''}`))

  return {
    texts: due.map(
      limit =>
        `${LIMIT_LABEL[limit.kind] ?? limit.kind} 사용 한도 ${percentOf(limit)}${limit.resetsAt ? ` — ${formatReset(limit.resetsAt, offsetMinutes, limit.kind !== 'five_hour')} 초기화` : ''}`,
    ),
    alerted: [...alerted, ...due.map(limit => `${limit.kind}:${limit.resetsAt ?? ''}`)].slice(-20),
  }
}

export const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}초`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}분 ${seconds % 60}초`

  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`
}

// Splits on `separator` only outside parentheses: "a(x · y) · b" → ["a(x · y)", "b"].
export const splitTopLevel = (text: string, separator: string) => {
  const parts: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    if (text[i] === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && text.startsWith(separator, i)) {
      parts.push(text.slice(from, i))
      from = i + separator.length
      i = from - 1
    }
  }

  return [...parts, text.slice(from)].map(part => part.trim()).filter(Boolean)
}

export const parseDreams = (text: string | null): Dreams | undefined => {
  if (!text) return undefined
  try {
    const raw = JSON.parse(text) as { date?: string; summary?: string; report?: string }
    const parts = splitTopLevel((raw.summary ?? '').replace(/^\[SCV 드림\]\s*/, ''), ' · ')
    const date = raw.date?.match(/^(\d{4})(\d{2})(\d{2})$/)

    return {
      date: date ? `${date[1] ?? ''}-${date[2] ?? ''}-${date[3] ?? ''}` : raw.date ?? '',
      items: parts.filter(part => !part.startsWith('보고서')),
      reportPath: raw.report ?? null,
    }
  } catch {
    return undefined
  }
}

export const NODE_COLOR: Record<StageState, string> = { done: '#3fb950', doing: '#e3b341', blocked: '#f85149', waiting: '#6e7681' }

// One step's node as a small picture: a traffic-light circle, and below it the line to the next step
// (solid after a finished step, dashed after any other; none after the last).
export const nodeIconSvg = (state: StageState, next: StageState | null, height = 44) => {
  const color = NODE_COLOR[state]
  const fill = state === 'waiting' ? 'none' : color
  const ring = state === 'doing' || state === 'blocked' ? `<circle cx="11" cy="11" r="10" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.5"/>` : ''
  const line =
    next === null
      ? ''
      : `<line x1="11" y1="20" x2="11" y2="${height}" stroke="${state === 'done' ? NODE_COLOR.done : NODE_COLOR.waiting}" stroke-width="2.5"${state === 'done' ? '' : ' stroke-dasharray="3 3"'}/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="${height}" viewBox="0 0 22 ${height}">${line}${ring}<circle cx="11" cy="11" r="7" fill="${fill}" stroke="${color}" stroke-width="2"/></svg>`
}

// The plan's status in plain words, read together with its steps so the two never disagree.
export const statusWords = (status: string, stages: readonly Stage[]) => {
  const isAllDone = stages.length > 0 && stages.every(stage => stage.state === 'done')
  if (status === 'archived') return '보관됨'
  if (status === 'done') return '끝남'
  if (status === 'planned') return '시작 전'
  if (status === 'testing') return isAllDone ? '단계 끝 · 시험 확인 중' : '시험 중'
  if (status === 'in_progress') return isAllDone ? '단계 끝 · 마무리 중' : '만드는 중'

  return status
}

export type NextAction = { text: string; command: string | null }

// What the person can do next, and the command for it when there is one.
export const nextAction = (slug: string, status: string, stages: readonly Stage[], blocks: readonly Block[]): NextAction => {
  const isAllDone = stages.length > 0 && stages.every(stage => stage.state === 'done')
  if (blocks.some(block => block.kind === 'stopped')) return { text: '멈췄어요 — 대화창에서 다시 시키기', command: null }
  if (blocks.some(block => block.kind === 'permit')) return { text: 'Claude가 허락을 기다려요 — 대화창에서 허락하기', command: null }
  if (blocks.some(block => block.kind === 'waiting')) return { text: 'Claude가 묻고 있어요 — 대화창에서 답하기', command: null }
  if (blocks.some(block => block.kind === 'test')) return { text: '시험 실패 — 고쳐서 다시 시험하기', command: `/scv:work ${slug}` }
  if (status === 'archived' || status === 'done') return { text: '끝난 계획 — 할 일 없음', command: null }
  if (status === 'planned') return { text: '시작하기', command: `/scv:work ${slug}` }
  if (isAllDone) return { text: '모든 단계 끝 — 보관하기', command: `/scv:work ${slug} --archive` }

  return { text: '진행 중 — 기다리면 됩니다', command: null }
}

// The one line at the top: where the work stands, whether anything is stuck, and the time left.
export const headline = (stages: readonly Stage[], blocks: readonly Block[], eta: ReturnType<typeof estimateEta>, format: (ms: number) => string) => {
  const here = stages.findIndex(stage => stage.state === 'doing' || stage.state === 'blocked')
  const done = stages.filter(stage => stage.state === 'done').length
  const where =
    here >= 0
      ? `${here + 1}단계 ${stages[here]?.state === 'blocked' ? '막힘' : '진행 중'}`
      : stages.length > 0 && done === stages.length
        ? '모든 단계 끝'
        : '시작 전'
  const stuck = blocks.length > 0 ? `막힘 ${blocks.length}` : '막힘 없음'
  const left = eta.kind === 'estimate' ? `약 ${format(eta.ms)} 남음(추정)` : eta.kind === 'done' ? '남은 단계 없음' : '남은 시간 추정 불가'

  return `${where} · ${stuck} · ${left}`
}

export const barColor = (stages: readonly Stage[], blocks: readonly Block[]) =>
  blocks.length > 0 || stages.some(stage => stage.state === 'blocked')
    ? NODE_COLOR.blocked
    : stages.length > 0 && stages.every(stage => stage.state === 'done')
      ? NODE_COLOR.done
      : NODE_COLOR.doing

// ── mirror: another session's pane fed by this one ──────────────────────────
// A Remote Control viewer cannot draw a pane, so a session the viewer's own app runs (a 'viewer session') asks the
// working session for its state and draws that. The messages go between sessions and never reach either model.

export const MIRROR_MARK = 'SCV-MIRROR'

// What a viewer's press asks the working session to do on its own side: put the plan's next command in its prompt
// box, or open its dreams report. The working session works the command out from its own state, never from the message.
export type MirrorAct = { do: 'fill'; slug: string } | { do: 'open-report' }

export type MirrorMessage =
  | { kind: 'hello'; address: string }
  | { kind: 'bye'; address: string }
  | { kind: 'state'; body: string }
  | { kind: 'act'; address: string; act: MirrorAct }

const escapeTags = (body: string) => body.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

// The state travels as JSON inside the delivery's envelope; <, > and & are escaped so the envelope's own tags stay whole.
export const mirrorText = (message: MirrorMessage) =>
  message.kind === 'state'
    ? `${MIRROR_MARK} STATE ${escapeTags(message.body)}`
    : message.kind === 'act'
      ? `${MIRROR_MARK} ACT ${message.address} ${escapeTags(JSON.stringify(message.act))}`
      : `${MIRROR_MARK} ${message.kind.toUpperCase()} ${message.address}`

// An act this version knows, else null.
const parseAct = (json: string): MirrorAct | null => {
  try {
    const act = JSON.parse(json) as { do?: unknown; slug?: unknown }
    if (act.do === 'open-report') return { do: 'open-report' }
    if (act.do === 'fill' && typeof act.slug === 'string' && act.slug) return { do: 'fill', slug: act.slug }
  } catch {
    // not JSON
  }

  return null
}

// A delivery that carries a mirror message, else null; the envelope around it (a cross-session tag) is left out.
export const parseMirror = (text: string): MirrorMessage | null => {
  const found = text.match(new RegExp(`${MIRROR_MARK} (HELLO|BYE|STATE|ACT) ([^\\n]*)`))
  if (!found?.[1] || !found[2]) return null
  const body = found[2].trim()
  if (found[1] === 'STATE') return { kind: 'state', body }

  if (!body) return null
  if (found[1] === 'ACT') {
    const gap = body.indexOf(' ')
    const act = gap > 0 ? parseAct(body.slice(gap + 1)) : null

    return act ? { kind: 'act', address: body.slice(0, gap), act } : null
  }

  return found[1] === 'HELLO' ? { kind: 'hello', address: body } : { kind: 'bye', address: body }
}

// Whether the working session sends its state to a viewer now: only when it changed, and not sooner than `gap` after
// the last send — each send is a row in the viewer's app, so an idle session sends none and a busy one a few a minute.
export const isMirrorDue = (last: { sent: string; at: number }, body: string, at: number, gap: number) =>
  body !== last.sent && (last.at === 0 || at - last.at >= gap)

// Where other sessions reach this one: its Remote Control id when Remote Control is on (other computers reach that),
// else its own id (this computer only). `files` is the session files' text, one JSON object per line.
export const mirrorAddress = (files: string, sessionId: string) => {
  for (const line of files.split('\n')) {
    try {
      const entry = JSON.parse(line) as { sessionId?: unknown; bridgeSessionId?: unknown }
      if (entry.sessionId === sessionId && typeof entry.bridgeSessionId === 'string') return { address: entry.bridgeSessionId, isRemote: true }
    } catch {
      // a file being written, or not one of the session files
    }
  }

  return { address: sessionId, isRemote: false }
}

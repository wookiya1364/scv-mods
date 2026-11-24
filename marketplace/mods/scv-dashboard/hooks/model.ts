// Pure steps of the SCV dashboard: text in, values out, nothing read or written.
// The hooks module reads the files and watches the session; these only shape what it saw.

import type {
  AgentState,
  Block,
  Catalog,
  DoneEntry,
  Dreams,
  Evidence,
  EvidenceFile,
  Job,
  JobBoard,
  Live,
  MadeFunction,
  Permit,
  PipelineStep,
  PlanFile,
  Plan,
  Since,
  Stage,
  StageState,
  StepFunctions,
  StepMark,
  StepSignal,
  StepSource,
  Stopped,
  Task,
  TestRow,
  TestRun,
  TurnState,
  UsageLimit,
  WorkEntry,
} from '../types'

const STATUS_ORDER = ['in_progress', 'paused', 'testing', 'planned', 'done', 'archived']

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

// A step line may name the pipeline steps it builds after a dash: "화면 그리기 — `render`",
// or, when it builds none, say what it does in plain words: "녹음 — 고객 말을 녹음한다".
const splitRefs = (text: string): { name: string; refs: string[]; role?: string } => {
  const [, head = text, tail = ''] = text.match(/^(.*?)\s+—\s+(.*)$/) ?? []
  if (!tail) return { name: text.trim(), refs: [] }
  if (!tail.startsWith('`')) return { name: head.trim(), refs: [], role: tail.trim() }

  return { name: head.trim(), refs: [...tail.matchAll(/`([^`]+)`/g)].map(([, ref = '']) => ref.trim()) }
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

// `## 변경 이력` entries, newest first: each "- **…**" headline without its leading "- " and bold marks.
export const historyOf = (planText: string): string[] =>
  section(planText, ['변경 이력'])
    .filter(line => line.startsWith('- **'))
    .map(line => line.slice(2).replace(/\*\*/g, ''))
    .reverse()

// Step marks from the plan's own progress lines ("- **<day> 진행** — <n>단계 시작|끝|막힘: …"), oldest first so the
// latest line for a step wins. A step the plan already marks keeps that mark; the mod's own step signals still apply
// on top (mergeMarks). This is what keeps the pane right when a step report was missed, and without the step tool.
const PROGRESS_STATE: Record<string, 'doing' | 'done' | 'blocked'> = { 시작: 'doing', 끝: 'done', 막힘: 'blocked' }
export const progressMarks = (planText: string): Map<number, 'doing' | 'done' | 'blocked'> => {
  const marks = new Map<number, 'doing' | 'done' | 'blocked'>()
  for (const line of section(planText, ['변경 이력'])) {
    const hit = line.match(/^- \*\*\S+ 진행\*\* — (\d+)단계 (시작|끝|막힘):/)
    if (hit) marks.set(Number(hit[1]), PROGRESS_STATE[hit[2] ?? '끝'] ?? 'done')
  }

  return marks
}

const withProgress = (steps: StepMark[], planText: string): StepMark[] => {
  const marks = progressMarks(planText)

  return steps.map((step, i) => (step.mark || !marks.has(i + 1) ? step : { ...step, mark: marks.get(i + 1), isReported: true }))
}

export const parsePlan = (file: PlanFile): Plan => ({
  slug: file.slug,
  title: frontmatter(file.planText, 'title') ?? file.slug,
  status: file.isArchived ? 'archived' : (frontmatter(file.planText, 'status') ?? 'planned'),
  steps: withProgress(
    section(file.planText, ['Suggested path', 'Steps'])
      .map(line => line.match(/^\s*\d+[a-z]?\.\s+(.+)$/)?.[1])
      .filter((step): step is string => Boolean(step))
      .map(parseStep),
    file.planText,
  ),
  scenarios: [...file.testsText.matchAll(/^###\s+(T\d+)\.\s*(.+)$/gm)].map(([, id = '', name = '']) => ({ id, name: name.trim() })),
  howToRun: howToRun(file.testsText),
  pipeline: parsePipeline(file.planText),
  isArchived: file.isArchived === true,
  archivedAt: file.archivedAt ?? '',
  pausedBy: frontmatter(file.planText, 'paused_by') ?? '',
  resumeAt: frontmatter(file.planText, 'resume_at') ?? '',
  returnTo: frontmatter(file.planText, 'return_to') ?? '',
  history: historyOf(file.planText),
})

// A plan's title from its folder name; the folder name itself when that plan is not in the list.
export const titleOf = (plans: readonly Plan[], slug: string) => plans.find(plan => plan.slug === slug)?.title ?? slug

// The line under the status for a plan made for another plan's detour: where the work goes when it ends.
export const returnLine = (plan: Plan, plans: readonly Plan[]) =>
  plan.returnTo ? `끝나면 돌아갈 계획: ${titleOf(plans, plan.returnTo)}` : ''

// Plans by status; archived ones the most recently archived first (a plan with no record date last), then by name.
export const parsePlans = (files: readonly PlanFile[]): Plan[] =>
  files
    .map(parsePlan)
    .sort((a, b) => rank(a.status) - rank(b.status) || b.archivedAt.localeCompare(a.archivedAt) || b.slug.localeCompare(a.slug))

// The date an archive record (ARCHIVED_AT.md) gives in its archived_at line; '' when it has none.
export const archivedAtOf = (text: string | null) => text?.match(/^archived_at:\s*(\S+)/m)?.[1] ?? ''

const rank = (status: string) => {
  const at = STATUS_ORDER.indexOf(status)

  return at < 0 ? STATUS_ORDER.length : at
}

export const pickPlan = (plans: readonly Plan[], chosen: string | null): Plan | undefined =>
  plans.find(plan => plan.slug === chosen) ?? plans[0]

// The engine draws a Select of 1 to 64 options, so the plan list keeps the first ones in order (plans in progress, then
// the most recently archived), the plan on screen always among them.
export const PICKER_MAX = 64

export const pickerPlans = (plans: readonly Plan[], shown: string): Plan[] => {
  const first = plans.slice(0, PICKER_MAX)
  const own = plans.find(plan => plan.slug === shown)

  return own && !first.includes(own) ? [...first.slice(0, PICKER_MAX - 1), own] : first
}

export const deriveStages = (plan: Plan): { stages: Stage[]; isEstimated: boolean } => {
  const isMarked = plan.steps.some(step => step.mark)
  const isFinished = plan.status === 'done' || plan.status === 'archived'
  const isStarted = plan.status === 'in_progress' || plan.status === 'testing'

  if (isFinished) return { stages: plan.steps.map(step => ({ name: step.name, refs: step.refs, ...(step.role ? { role: step.role } : {}), state: 'done' })), isEstimated: !isMarked }

  // A step reported as started or blocked (a step signal, a progress line) is so wherever it stands: steps worked on
  // at the same time are all in progress. With no such report, work stands at one place — the first step not done —
  // and only that step may be doing or blocked: a mark left by hand on a later step says nothing, it is still waiting.
  const current = plan.steps.findIndex(step => step.mark !== 'done')
  const isReportedOpen = (step: StepMark) => step.isReported === true && (step.mark === 'doing' || step.mark === 'blocked')
  const hasReportedOpen = plan.steps.some(isReportedOpen)
  const stages: Stage[] = plan.steps.map((step, i) => {
    const state: StageState =
      step.mark === 'done'
        ? 'done'
        : isReportedOpen(step)
          ? (step.mark ?? 'doing')
          : i !== current
            ? 'waiting'
            : step.mark === 'blocked'
              ? 'blocked'
              : step.mark === 'doing' || (isStarted && !hasReportedOpen)
                ? 'doing'
                : 'waiting'

    const stage: Stage = { name: step.name, refs: step.refs, ...(step.role ? { role: step.role } : {}), state }

    return step.note ? { ...stage, note: step.note } : stage
  })

  return { stages, isEstimated: !isMarked }
}

export const countStages = (stages: readonly Stage[]) => ({
  done: stages.filter(stage => stage.state === 'done').length,
  doing: stages.filter(stage => stage.state === 'doing' || stage.state === 'yourTurn').length,
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

// ── whose move: Claude's, the person's, or background work's ──

// A tool call that leaves work running after the turn and wakes the session when it is done:
// a command sent to the background, a watch, or a wake-up the session set for itself.
export const isBackgroundStart = (tool: string, input: Record<string, unknown>) =>
  (tool === 'Bash' && input.run_in_background === true) || tool === 'Monitor' || (tool === 'ScheduleWakeup' && input.stop !== true)

// The person's turn: this session saw its main turn end, nothing live holds the work (an error, a permission
// prompt and an open question show red on their own), and nothing the turn started still runs.
// Work that will wake the session by itself is not the person's turn.
// jobs: how many jobs the session left running and has not heard the end of; they outlast a turn the person starts.
export const turnStateOf = (input: { isWorking: boolean; hasEnded: boolean; blocks: readonly Block[]; agents: number; background: boolean; jobs?: number }): TurnState => {
  if (input.isWorking || !input.hasEnded) return 'working'
  if (input.blocks.some(block => block.kind === 'stopped' || block.kind === 'permit' || block.kind === 'waiting')) return 'working'
  if (input.agents > 0 || input.background || (input.jobs ?? 0) > 0) return 'background'

  return 'yourTurn'
}

// On the person's turn the step in progress says so; a blocked step and every other step stay as they are.
export const applyTurn = (stages: readonly Stage[], turn: TurnState): Stage[] =>
  turn === 'yourTurn' ? stages.map(stage => (stage.state === 'doing' ? { ...stage, state: 'yourTurn' } : stage)) : [...stages]

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

// ── step functions: what a step builds and did, said with the project's pure-function dictionary ──
// The rules are SCV core's (contracts/purity.md, scripts/lib/pure-catalog.sh), so the pane and the dictionary agree.

// The dictionary files (scv/core/catalog/pure/<kind>.md) as one table: each "### name" with its "- 역할:" line, and the
// kind from the file's title "# <kind> — …". The contents file (INDEX.md) has no entries and adds nothing.
export const parseCatalog = (texts: readonly string[]): Catalog => {
  const catalog: Catalog = {}
  for (const text of texts) {
    const kind = text.match(/^#\s+(.+?)\s+—/m)?.[1]?.trim() ?? ''
    let name = ''
    for (const line of text.split('\n')) {
      const head = line.match(/^###\s+(\S+)/)?.[1]
      if (head) {
        name = head
        catalog[name] = { role: '', kind }
        continue
      }
      const role = line.match(/^-\s*역할:\s*(.+)$/)?.[1]?.trim()
      const entry = catalog[name]
      if (role && entry) catalog[name] = { ...entry, role }
    }
  }

  return catalog
}

// A comment line's text without its lead (# // /// /* * */ -- ; % '), as the dictionary reads any language; else null.
const commentBody = (line: string) => {
  const lead = line.match(/^\s*(\/\/\/?|\/\*+|\*\/|\*|#+|--|;+|%+|')/)

  return lead ? line.slice(lead[0].length).trim() : null
}

const commentField = (body: string, key: string) => (body.startsWith(`${key}:`) ? body.slice(key.length + 1).trim() : '')

// The functions a piece of writing defines under an @pure / @deterministic marker, with the role and kind its comment
// gives. The name is the marker's own ("@pure add"), or for shell the "name() {" line under the comment.
export const extractMarked = (text: string): MadeFunction[] => {
  const made: MadeFunction[] = []
  let tier: MadeFunction['tier'] | '' = ''
  let name = ''
  let role = ''
  let kind = ''
  const reset = () => {
    tier = ''
    name = ''
    role = ''
    kind = ''
  }
  const emit = (found: string) => {
    if (tier) made.push({ name: found, tier, role, kind })
  }
  for (const line of text.split('\n')) {
    const body = commentBody(line)
    if (body !== null) {
      const marker = body.match(/^@(pure|deterministic)(?:\s+([A-Za-z_][A-Za-z0-9_.:$-]*))?$/)
      if (marker) {
        if (tier && name) emit(name)
        reset()
        tier = marker[1] === 'pure' ? 'pure' : 'deterministic'
        name = marker[2] ?? ''
        continue
      }
      role = commentField(body, '역할') || role
      kind = commentField(body, '종류') || kind
      continue
    }
    if (!line.trim()) {
      if (!tier) reset()
      continue
    }
    if (tier && name) {
      emit(name)
      reset()
      continue
    }
    const shell = tier ? line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\(\)\s*\{/)?.[1] : undefined
    if (shell) emit(shell)
    reset()
  }
  if (tier && name) emit(name)

  return made
}

// A project whose dictionary is the source (core 0.98.0+, no comments in code): the functions a piece of writing defines
// are the dictionary's names it declares — "fn name", "function name", "def name", "const name =", "name() {".
export const definedFromCatalog = (text: string, catalog: Catalog): MadeFunction[] =>
  Object.entries(catalog)
    .filter(([name]) => {
      const n = name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
      return new RegExp(`(^|\\n)[^\\n]*\\b(fn|function|def|const|let|var|func)\\s+${n}\\b|(^|\\n)\\s*${n}\\s*\\(\\)\\s*\\{`).test(text)
    })
    .map(([name, entry]) => ({ name, tier: 'pure' as const, role: entry.role, kind: entry.kind }))

const wordPattern = (name: string) => new RegExp(`(^|[^A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}($|[^A-Za-z0-9_])`)

// The known functions a piece of writing calls: each known name standing as a whole word, other than those it defines.
export const usedNames = (text: string, known: readonly string[], defined: readonly string[]) =>
  [...new Set(known)].filter(name => name && !defined.includes(name) && wordPattern(name).test(text))

// A step's functions with one more piece of writing taken in: a function written again keeps its newest comment,
// and one this step made is not also counted as used.
export const recordFunctions = (log: Readonly<Record<string, StepFunctions>>, key: string, found: StepFunctions): Record<string, StepFunctions> => {
  const was = log[key] ?? { made: [], used: [] }
  const made = [...was.made.filter(old => !found.made.some(one => one.name === old.name)), ...found.made]
  const used = [...new Set([...was.used, ...found.used])].filter(name => !made.some(one => one.name === name))

  return { ...log, [key]: { made, used } }
}

export type FunctionLine = { name: string; kind: string; role: string }

// What a step builds, one line per function its line names (else the plan's table rows it matches): the dictionary's
// role first, then the comment of one made in this session but not yet in the dictionary, then the plan's 하는 일.
export const stageFunctions = (stage: Stage, pipeline: readonly PipelineStep[], catalog: Catalog, made: readonly MadeFunction[]): FunctionLine[] => {
  const names = stage.refs.length > 0 ? stage.refs : stageRole(stage, pipeline).map(step => step.name)

  return names.map(name => {
    const entry = catalog[name]
    const own = made.find(one => one.name === name)
    const row = pipeline.find(step => step.name === name)

    return { name, kind: entry?.kind || own?.kind || '', role: entry?.role || own?.role || (row ? describeRole(row) : '') }
  })
}

// A function's one-line description: its role up to the first ' — ' (the rest is detail for the dictionary).
export const firstClause = (role: string) => role.split(' — ')[0]?.trim() ?? ''

// The bullet a function stands on: its name, and its kind when known.
export const functionBullet = (name: string, kind = '') => `• ${name}${kind ? ` (${kind})` : ''}`

export type DoneFunction = { name: string; detail: string }

// What a step did, as two lists under '새로 만듦 N' and '가져다 씀 N': a function the step's 하는 일 already shows
// is named only; another gets its one-line description (the dictionary's role, else the comment it was made with).
export const doneFunctions = (
  found: StepFunctions | undefined,
  shown: readonly string[],
  catalog: Catalog,
  earlier: readonly { step: number; made: readonly MadeFunction[] }[],
): { made: DoneFunction[]; used: DoneFunction[] } => {
  const detail = (name: string, own?: MadeFunction) => {
    if (shown.includes(name)) return ''
    const role = catalog[name]?.role || own?.role || earlier.flatMap(one => one.made).find(fn => fn.name === name)?.role || ''

    return firstClause(role)
  }

  return {
    made: (found?.made ?? []).map(one => ({ name: one.name, detail: detail(one.name, one) })),
    used: (found?.used ?? []).map(name => ({ name, detail: detail(name) })),
  }
}

// The code a tool call writes: Write's content, Edit's new_string, MultiEdit's new_strings. Files under the project's
// scv folder (plans, the dictionary, records) only name functions, they do not call them, so they are left out.
export const writtenCode = (tool: string, input: Record<string, unknown>): string | null => {
  const path = typeof input.file_path === 'string' ? input.file_path : ''
  if (!path || /(^|\/)scv\//.test(path)) return null
  if (tool === 'Write' && typeof input.content === 'string') return input.content
  if (tool === 'Edit' && typeof input.new_string === 'string') return input.new_string
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return (input.edits as { new_string?: unknown }[]).map(edit => (typeof edit.new_string === 'string' ? edit.new_string : '')).join('\n')
  }

  return null
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

// The desktop app's own task list tool: the whole list (items), the next step (advance), or steps by number (done, start).
export const PLAN_TOOL = 'mcp__ccd_turn__update_plan'

const TASK_STATES = ['pending', 'in_progress', 'completed']

// A task that became the one in progress carries the time; one that already was keeps its own.
const stamped = (before: readonly Task[], after: Task[], at?: number): Task[] =>
  after.map(task => {
    if (task.status !== 'in_progress') return task
    const was = before.find(one => one.id === task.id && one.subject === task.subject)
    const since = was?.status === 'in_progress' ? was.at : at

    return since === undefined ? task : { ...task, at: since }
  })

const applyPlanTool = (tasks: readonly Task[], input: Record<string, unknown>): Task[] | null => {
  if (input.items !== undefined) {
    if (!Array.isArray(input.items)) return null
    const items = input.items as { content?: unknown; status?: unknown }[]
    if (!items.every(item => typeof item?.content === 'string' && TASK_STATES.includes(String(item.status)))) return null

    return items.map((item, i) => ({ id: String(i + 1), subject: String(item.content), status: item.status as Task['status'] }))
  }
  if (input.advance === true) {
    const doing = tasks.findIndex(task => task.status === 'in_progress')
    const next = tasks.findIndex((task, i) => i > doing && task.status === 'pending')

    return tasks.map((task, i) => (i === doing ? { ...task, status: 'completed' as const } : i === next ? { ...task, status: 'in_progress' as const } : task))
  }
  const done = Array.isArray(input.done) ? (input.done as unknown[]).filter((n): n is number => typeof n === 'number') : []
  const start = typeof input.start === 'number' ? input.start : null
  if (done.length === 0 && start === null) return null

  return tasks.map((task, i) =>
    done.includes(i + 1) ? { ...task, status: 'completed' as const } : i + 1 === start ? { ...task, status: 'in_progress' as const } : task,
  )
}

// at: the time of the call, kept on the task it puts in progress (the 'now' line says since when).
export const applyTaskEvent = (tasks: readonly Task[], tool: string, input: Record<string, unknown>, at?: number): Task[] => {
  if (tool === PLAN_TOOL) {
    const next = applyPlanTool(tasks, input)

    return next ? stamped(tasks, next, at) : [...tasks]
  }
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

export type SignalInput = { plan: string; step: number; state: string; note?: string; evidence?: Evidence; source?: StepSource }

export type SignalCheck = { isOk: true } | { isOk: false; reason: string }

// Plan marks and signals as one: a step either side calls done is done; otherwise the latest signal speaks,
// and the step is marked as reported — which is what lets a step past the first open one show as in progress.
export const mergeMarks = (plan: Plan, signals: readonly StepSignal[]): Plan => {
  const own = signals.filter(signal => signal.plan === plan.slug)
  if (own.length === 0) return plan

  return {
    ...plan,
    steps: plan.steps.map((step, i) => {
      const signal = own.find(one => one.step === i + 1)
      if (!signal || step.mark === 'done') return step

      return signal.note ? { ...step, mark: signal.state, note: signal.note, isReported: true } : { ...step, mark: signal.state, isReported: true }
    }),
  }
}

// A signal must name a plan in progress and a step it has; doing and blocked go to any step not yet done, so steps
// worked on at the same time can each be reported — only a step already done takes neither.
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
    const steps = mergeMarks(plan, signals).steps
    if (steps.every(step => step.mark === 'done')) return { isOk: false, reason: '모든 단계가 이미 끝났습니다' }
    if (steps[input.step - 1]?.mark === 'done') {
      return { isOk: false, reason: `${input.step}단계는 이미 끝났습니다 — ${input.state === 'blocked' ? '막힘' : '진행'}은 끝나지 않은 단계에만 보낼 수 있습니다` }
    }
  }

  return { isOk: true }
}

// The steps this session said it started and has not yet said are done or blocked, oldest first: the session's work
// goes to the last one. A step started again moves to the end; a plan file's own "in progress" mark is not enough —
// it can be left from another day.
export const nextStarted = (started: readonly { plan: string; step: number }[], signal: { plan: string; step: number; state: string }) => {
  const others = started.filter(one => one.plan !== signal.plan || one.step !== signal.step)

  return signal.state === 'doing' ? [...others, { plan: signal.plan, step: signal.step }] : others
}

const SIGNAL_WORD: Record<string, string> = { doing: '시작', done: '끝', blocked: '막힘' }

// What a taken signal answers: the step and its new state, how many steps are done, and every step now in
// progress — so a sender that named the wrong step sees it at once. stages: the plan's stages after the signal.
export const signalAnswer = (signal: { plan: string; step: number; state: string }, stages: readonly Stage[] | undefined) => {
  const said = `기록함: ${signal.plan} ${signal.step}단계 ${SIGNAL_WORD[signal.state] ?? signal.state}`
  if (!stages) return said
  const doing = stages.flatMap((stage, i) => (stage.state === 'doing' ? [i + 1] : []))

  return `${said} — 진행 ${stages.filter(stage => stage.state === 'done').length}/${stages.length}${doing.length > 0 ? ` · 진행 중: ${stepRanges(doing)}단계` : ''}`
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
      ...(input.state === 'done' && input.evidence ? { evidence: input.evidence } : {}),
      ...(input.state === 'doing' && input.source && (input.source.log || input.source.url) ? { source: input.source } : {}),
    },
  ].slice(-300)
}

// What the file system says of one path a step sent as evidence or as its log: found, inside the project, when it last changed.
export type FileFact = { path: string; isFound: boolean; isInside: boolean; mtimeMs: number; size: number }

export type EvidenceCheck = { isOk: true; evidence: Evidence } | { isOk: false; reason: string }

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i
const TEXT_EXT = /\.(txt|log|md|json|csv|tsv|html?|xml|ya?ml|out)$/i

// The kind a piece of evidence is drawn as, by its name: a picture, text, or a file to open.
export const evidenceKind = (path: string): EvidenceFile['kind'] => (IMAGE_EXT.test(path) ? 'image' : TEXT_EXT.test(path) ? 'text' : 'other')

// A command output is kept to this many characters: enough to see the result, not the whole log.
const OUTPUT_ROOM = 1200

// Whether a step's "done" carries real proof: project files made or changed after the step began, or a command's output.
// No proof, a missing file, a file outside the project, or one older than the step's start is refused with what to send.
export const judgeEvidence = (paths: readonly string[], output: string | undefined, facts: readonly FileFact[], startedAt?: number): EvidenceCheck => {
  const text = (output ?? '').trim()
  if (paths.length === 0 && !text) {
    return { isOk: false, reason: '끝에는 증거가 필요합니다 — evidence 에 이 단계가 만든 프로젝트 안 파일(화면 · 결과), 또는 output 에 명령 출력 발췌를 함께 보내세요' }
  }
  const files: EvidenceFile[] = []
  for (const path of paths) {
    const fact = facts.find(one => one.path === path)
    if (!fact || !fact.isFound) return { isOk: false, reason: `증거 파일이 없습니다: ${path}` }
    if (!fact.isInside) return { isOk: false, reason: `프로젝트 밖 파일은 증거로 받지 않습니다: ${path}` }
    if (startedAt !== undefined && fact.mtimeMs < startedAt) {
      return { isOk: false, reason: `단계 시작 전에 생긴 파일입니다(옛 파일): ${path} — 이 단계에서 만들거나 바꾼 결과를 보내세요` }
    }
    files.push({ path, size: fact.size, kind: evidenceKind(path) })
  }

  return { isOk: true, evidence: { files, ...(text ? { output: text.slice(-OUTPUT_ROOM) } : {}) } }
}

// A running step's live view: the last lines of its log as a person would see them, and how far along it is when a
// line says so ('3/10', '45%').
export const liveOf = (tail: string, lineCount = 5): { lines: string[]; ratio: number | null; line: string } => {
  const lines = tail
    .split('\n')
    .map(raw => raw.replace(/\r+$/, '').split('\r').pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .map(shown => shown.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim())
    .filter(Boolean)
  const progress = progressOf(tail)
  const ratio = progress.done !== undefined && progress.total ? Math.min(1, progress.done / progress.total) : null

  return { lines: lines.slice(-lineCount).map(line => shorten(line, LINE_ROOM)), ratio, line: progress.line }
}

// The newest signal a plan's step sent: where its evidence or its live source is.
export const lastSignalOf = (signals: readonly StepSignal[], plan: string, step: number): StepSignal | undefined =>
  [...signals].reverse().find(signal => signal.plan === plan && signal.step === step)

// A picture small enough to draw inside the pane (an SVG holds at most 131072 characters); a larger one is opened.
export const IMAGE_DRAW_BYTES = 90 * 1024

// The SVG that draws a picture sent as evidence, from its bytes.
export const imageSvg = (base64: string, path: string, width = 320, height = 200) => {
  const ext = (path.match(/\.([a-z]+)$/i)?.[1] ?? 'png').toLowerCase()
  const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="data:image/${mime};base64,${base64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/></svg>`
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
    'A "done" needs proof: evidence (project files this step made or changed — a screenshot, a result file) and/or output (the command output excerpt that shows the result); without it the tool refuses.',
    'A "doing" for long-running work names log (the project file it writes) and url (a page showing its progress) so the pane shows its real progress.',
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
// The context window's fill as the card shows it; nothing before the first reply has a reading.
export const contextLine = (percent: number | null): string | null => (percent === null ? null : `${Math.round(percent)}%`)

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

export const NODE_COLOR: Record<StageState, string> = { done: '#3fb950', doing: '#e3b341', blocked: '#f85149', waiting: '#6e7681', yourTurn: '#a371f7' }

// One step's node as a small picture: a traffic-light circle, and below it the line to the next step
// (solid after a finished step, dashed after any other; none after the last).
export const nodeIconSvg = (state: StageState, next: StageState | null, height = 44) => {
  const color = NODE_COLOR[state]
  const fill = state === 'waiting' ? 'none' : color
  const ring = state === 'doing' || state === 'blocked' || state === 'yourTurn' ? `<circle cx="11" cy="11" r="10" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.5"/>` : ''
  const line =
    next === null
      ? ''
      : `<line x1="11" y1="20" x2="11" y2="${height}" stroke="${state === 'done' ? NODE_COLOR.done : NODE_COLOR.waiting}" stroke-width="2.5"${state === 'done' ? '' : ' stroke-dasharray="3 3"'}/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="${height}" viewBox="0 0 22 ${height}">${line}${ring}<circle cx="11" cy="11" r="7" fill="${fill}" stroke="${color}" stroke-width="2"/></svg>`
}

// The plan's status in plain words, read together with its steps so the two never disagree.
// A paused plan names the plan it waits for (its title, given by the caller) when there is one.
export const statusWords = (status: string, stages: readonly Stage[], waitsFor = '') => {
  const isAllDone = stages.length > 0 && stages.every(stage => stage.state === 'done')
  if (status === 'paused') return waitsFor ? `보류 · ${waitsFor} 끝나면 재개` : '보류'
  if (status === 'archived') return '보관됨'
  if (status === 'done') return '끝남'
  if (status === 'planned') return '시작 전'
  if (status === 'testing') return isAllDone ? '단계 끝 · 시험 확인 중' : '시험 중'
  if (status === 'in_progress') return isAllDone ? '단계 끝 · 마무리 중' : '만드는 중'

  return status
}

export type NextAction = { text: string; command: string | null }

// What the person can do next, and the command for it when there is one.
export const nextAction = (slug: string, status: string, stages: readonly Stage[], blocks: readonly Block[], turn: TurnState = 'working'): NextAction => {
  const isAllDone = stages.length > 0 && stages.every(stage => stage.state === 'done')
  if (blocks.some(block => block.kind === 'stopped')) return { text: '멈췄어요 — 대화창에서 다시 시키기', command: null }
  if (blocks.some(block => block.kind === 'permit')) return { text: 'Claude가 허락을 기다려요 — 대화창에서 허락하기', command: null }
  if (blocks.some(block => block.kind === 'waiting')) return { text: 'Claude가 묻고 있어요 — 대화창에서 답하기', command: null }
  if (blocks.some(block => block.kind === 'test')) return { text: '시험 실패 — 고쳐서 다시 시험하기', command: `/scv:work ${slug}` }
  if (status === 'archived' || status === 'done') return { text: '끝난 계획 — 할 일 없음', command: null }
  if (status === 'paused') return { text: '보류 중 — 먼저 할 계획이 끝나면 이어서 함', command: null }
  if (status === 'planned') return { text: '시작하기', command: `/scv:work ${slug}` }
  if (isAllDone) return { text: '모든 단계 끝 — 보관하기', command: `/scv:work ${slug} --archive` }
  if (stages.some(stage => stage.state === 'yourTurn')) return { text: '사용자 차례 — 대화창에서 이어서 하라고 말해 주세요', command: null }
  if (turn === 'background') return { text: '배경 작업을 기다리는 중 — 끝나면 스스로 이어집니다', command: null }

  return { text: '진행 중 — 기다리면 됩니다', command: null }
}

// Step numbers in plain words: three or more in a row become a range ('2 · 4~6').
export const stepRanges = (steps: readonly number[]): string => {
  const runs = [...steps]
    .sort((a, b) => a - b)
    .reduce<number[][]>((found, step) => {
      const last = found[found.length - 1]

      return last && step === (last[last.length - 1] ?? step) + 1 ? [...found.slice(0, -1), [...last, step]] : [...found, [step]]
    }, [])

  return runs.flatMap(run => (run.length >= 3 ? [`${run[0]}~${run[run.length - 1]}`] : run.map(String))).join(' · ')
}

const ACTIVE_STATES = ['blocked', 'yourTurn', 'doing'] as const
const ACTIVE_WORD: Record<(typeof ACTIVE_STATES)[number], string> = { blocked: '막힘', yourTurn: '사용자 차례', doing: '진행 중' }

// The steps the work stands on, by state — blocked first, then the person's turn, then in progress — each with its
// step numbers; a state no step is in is left out. Steps worked on at the same time are all here.
export const activeSteps = (stages: readonly Stage[]): { state: (typeof ACTIVE_STATES)[number]; steps: number[] }[] =>
  ACTIVE_STATES.map(state => ({ state, steps: stages.flatMap((stage, i) => (stage.state === state ? [i + 1] : [])) })).filter(group => group.steps.length > 0)

// The one line at the top: where the work stands, whether anything is stuck, and the time left.
export const headline = (stages: readonly Stage[], blocks: readonly Block[], eta: ReturnType<typeof estimateEta>, format: (ms: number) => string) => {
  const active = activeSteps(stages)
  const done = stages.filter(stage => stage.state === 'done').length
  const where =
    active.length > 0
      ? active.map(group => `${stepRanges(group.steps)}단계 ${ACTIVE_WORD[group.state]}`).join(' · ')
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
      : stages.some(stage => stage.state === 'yourTurn')
        ? NODE_COLOR.yourTurn
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

// Whether a viewer asks again by itself: only while no state has come yet and its own address is no longer the
// one it gave (Remote Control written down late). It never asks again just because nothing came for a while —
// each ask is a row in the working session's conversation.
export const isMirrorAskDue = (mirrored: { at: number; from?: string }, ownAddress: string) => !mirrored.at && ownAddress !== mirrored.from

const MIRROR_QUIET_MS = 10 * 60_000

// The mirror line: whose pane this is and how long ago its state came; quiet for over ten minutes, it says so
// (the working session rests, or the link is gone — the pane cannot tell which).
export const mirrorLineText = (input: { host: string; name?: string | null; receivedAt: number; at: number; formatDuration: (ms: number) => string }) => {
  const since = Math.max(0, input.at - input.receivedAt)
  const heard = input.receivedAt ? `${input.formatDuration(since)} 전 받음` : '상태를 기다리는 중'
  const quiet = input.receivedAt && since > MIRROR_QUIET_MS ? ' · 10분 넘게 소식 없음(쉬는 중이거나 끊김)' : ''

  return `거울: ${hostLabel(input.host, input.name)} · ${heard}${quiet}`
}

// Whether an address the person typed is this session's own: its Remote Control id or its local id, `bridge:` or not.
export const isOwnAddress = (asked: string, own: { address: string; localId: string }) => {
  const bare = asked.trim().replace(/^bridge:/, '')

  return bare === own.address || bare === own.localId
}

// Whether an address the person typed is a session mirroring this one (one of its viewers), `bridge:` or not.
export const isViewerOf = (asked: string, viewers: Readonly<Record<string, unknown>>) =>
  Object.hasOwn(viewers, asked.trim().replace(/^bridge:/, ''))

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

// The name the app shows for this session (its sidebar title), from the same session files; null when it has none.
export const sessionName = (files: string, sessionId: string) => {
  for (const line of files.split('\n')) {
    try {
      const entry = JSON.parse(line) as { sessionId?: unknown; name?: unknown }
      if (entry.sessionId === sessionId) return typeof entry.name === 'string' && entry.name ? entry.name : null
    } catch {
      // a file being written, or not one of the session files
    }
  }

  return null
}

// How a viewer names the session it mirrors: its name and address together, or the address alone.
export const hostLabel = (host: string, name?: string | null) => (name ? `${name} (${host})` : host)

// ── now view: what is being done now, what runs in the background, what just finished ──

const JOB_ROOM = 8
const DONE_ROOM = 5
const LINE_ROOM = 120
const TAIL_ROOM = 4000
const STALE_MS = 5 * 60_000

const textOf = (input: Record<string, unknown>, key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')

// The work a tool call left running, read from the call and what it answered: a command sent to the background (asked
// for, or moved there by its time limit), a watch, or a command started in a terminal tab. null: nothing was left.
export const jobStartOf = (tool: string, input: Record<string, unknown>, ran: { result?: unknown; text?: string }, at: number): Job | null => {
  const result = (ran.result ?? {}) as Record<string, unknown>
  const said = ran.text ?? ''
  const output = (textOf(result, 'backgroundOutputPath') || (said.match(/written to:\s*(\S+)/)?.[1] ?? '')).replace(/[.,;]+$/, '')
  const title = textOf(input, 'description') || textOf(input, 'title') || shorten(textOf(input, 'command'), 60)
  const withOutput = (job: Job): Job => (output ? { ...job, output } : job)
  if (tool === 'Bash') {
    const id = textOf(result, 'backgroundTaskId') || (said.match(/running in background with ID:\s*([\w-]+)/)?.[1] ?? '')
    if (!id && input.run_in_background !== true) return null

    return withOutput({ id: id || `bash-${at}`, title: title || '명령', kind: 'command', startedAt: at, changedAt: at })
  }
  if (tool === 'Monitor') {
    const id = said.match(/ID:\s*([\w-]+)/)?.[1]

    return withOutput({ id: id ?? `watch-${at}`, title: title || '지켜보기', kind: 'watch', startedAt: at, changedAt: at })
  }
  if (tool.endsWith('run_in_terminal')) {
    const tab = textOf(result, 'tab_id') || (said.match(/"tab_id"\s*:\s*"([^"]+)"/)?.[1] ?? '')

    return { id: `tab:${tab || at}`, title: title || '터미널 명령', kind: 'terminal', startedAt: at, changedAt: at }
  }

  return null
}

export type JobEnd = { id: string | null; how: 'done' | 'failed' | 'stopped' }

// Which job ended and how, read from a task notification's text, or from a call that stops a task or a terminal tab.
// id null: the notice names no task. null: this is not an end.
export const jobEndOf = (source: { text: string } | { tool: string; input: Record<string, unknown> }): JobEnd | null => {
  if ('text' in source) {
    if (!source.text.includes('<task-notification>')) return null
    const status = source.text.match(/<status>([^<]*)<\/status>/)?.[1]?.trim() ?? 'completed'
    const code = Number(source.text.match(/exit code (\d+)/)?.[1] ?? '0')
    const how = /kill|stop|cancel/.test(status) ? 'stopped' : status === 'completed' && code === 0 ? 'done' : 'failed'

    return { id: source.text.match(/<task-id>([^<]+)<\/task-id>/)?.[1]?.trim() ?? null, how }
  }
  const { tool, input } = source
  if (tool === 'TaskStop' || tool === 'KillShell' || tool === 'KillBash') {
    const id = textOf(input, 'task_id') || textOf(input, 'shell_id')

    return id ? { id, how: 'stopped' } : null
  }
  if (tool.endsWith('stop_terminal_tab')) return textOf(input, 'tab_id') ? { id: `tab:${textOf(input, 'tab_id')}`, how: 'stopped' } : null

  return null
}

// The job an end names: by its id; a notice that names none ends the command that has run longest.
export const findJob = (board: JobBoard, id: string | null): Job | undefined =>
  id === null ? board.jobs.find(job => job.kind !== 'terminal') : board.jobs.find(job => job.id === id)

export type JobEvent =
  | { kind: 'start'; job: Job }
  | { kind: 'progress'; id: string; line: string; done?: number; total?: number; at: number }
  | { kind: 'end'; id: string | null }

// The board after a job started, said how far it is, or ended. Eight jobs are remembered; a ninth is only counted,
// and an end that names none of the eight takes one off that count.
export const applyJobEvent = (board: JobBoard, event: JobEvent): JobBoard => {
  if (event.kind === 'start') {
    if (board.jobs.some(job => job.id === event.job.id)) return { jobs: [...board.jobs], extra: board.extra }

    return board.jobs.length >= JOB_ROOM ? { jobs: [...board.jobs], extra: board.extra + 1 } : { jobs: [...board.jobs, event.job], extra: board.extra }
  }
  if (event.kind === 'progress') {
    return {
      jobs: board.jobs.map(job => {
        if (job.id !== event.id) return job
        const { done: _done, total: _total, ...rest } = job

        return { ...rest, line: event.line, changedAt: event.at, ...(event.done !== undefined && event.total !== undefined ? { done: event.done, total: event.total } : {}) }
      }),
      extra: board.extra,
    }
  }
  const ended = findJob(board, event.id)
  if (!ended) return { jobs: [...board.jobs], extra: Math.max(0, board.extra - 1) }

  return { jobs: board.jobs.filter(job => job.id !== ended.id), extra: board.extra }
}

// The line a finished job leaves in 'recently finished'.
export const doneLine = (job: Job, how: JobEnd['how'], at: number): DoneEntry => ({
  at,
  text: `${job.title} ${how === 'done' ? '끝' : how === 'failed' ? '실패' : '멈춤'}`,
  isOk: how === 'done',
})

// The subjects of the tasks that became completed between two task lists.
export const newlyDone = (before: readonly Task[], after: readonly Task[]): string[] =>
  after.flatMap(task => (task.status === 'completed' && before.some(one => one.id === task.id && one.subject === task.subject && one.status !== 'completed') ? [task.subject] : []))

export const applyDone = (done: readonly DoneEntry[], entry: DoneEntry): DoneEntry[] => [...done, entry].slice(-DONE_ROOM)

// The end of an output, which is all the progress line needs.
export const tailOf = (text: string) => text.slice(-TAIL_ROOM)

// The last line of an output as a person would see it: what the terminal shows after carriage returns, no colour
// codes or control characters, one line of at most 120 characters. done / total: read from '10 / 64', '[4/7]' or '45%'.
export const progressOf = (tail: string): { line: string; done?: number; total?: number } => {
  const lines = tail
    .split('\n')
    .map(raw => raw.replace(/\r+$/, '').split('\r').pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .map(shown => shown.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim())
    .filter(Boolean)
  const line = shorten(lines.pop() ?? '', LINE_ROOM)
  const ratio = line.match(/(\d+)\s*\/\s*(\d+)/)
  const percent = ratio ? null : line.match(/(\d+(?:\.\d+)?)\s*%/)
  const done = ratio ? Number(ratio[1]) : percent ? Number(percent[1]) : null
  const total = ratio ? Number(ratio[2]) : percent ? 100 : null

  return done !== null && total !== null && total > 0 && done <= total ? { line, done, total } : { line }
}

// What is being done now, in one plain line, and since when. While a turn runs: the task in progress, else the plan's
// step in progress, else the tool that is running, else a default. After the turn: the jobs it left, else waiting.
export const nowLine = (input: {
  tasks: readonly Task[]
  step: { number: number; name: string } | null
  tool: Live['tool']
  jobs: readonly Job[]
  extra: number
  isWorking: boolean
  turnStartedAt: number
}): { text: string; since: number | null } => {
  if (!input.isWorking) {
    const first = input.jobs[0]
    const more = input.jobs.length - 1 + input.extra
    if (first) return { text: `뒤에서 도는 일을 기다리는 중 — ${first.title}${more > 0 ? ` 외 ${more}개` : ''}`, since: first.startedAt }

    return { text: '사용자의 말을 기다리는 중', since: null }
  }
  const task = input.tasks.find(one => one.status === 'in_progress')
  if (task) return { text: task.subject, since: task.at ?? input.turnStartedAt }
  if (input.step) return { text: `${input.step.number}단계 — ${input.step.name}`, since: input.turnStartedAt }
  if (input.tool) return { text: input.tool.target || input.tool.name, since: input.tool.startedAt }

  return { text: '결과를 읽거나 다음을 정하는 중', since: input.turnStartedAt }
}

// 'HH:MM' in the person's own clock.
const clockOf = (at: number, offsetMinutes: number) => formatReset(new Date(at).toISOString(), offsetMinutes, false)

// The three parts of the now view as lines: the now line with its start time, one row per running job (its name,
// how long it has run, its last progress line; ratio for a bar; isStale when its output has not changed for five
// minutes and nobody said it ended), and the recently finished with their times.
export const nowBlock = (input: {
  now: { text: string; since: number | null }
  board: JobBoard
  done: readonly DoneEntry[]
  at: number
  offsetMinutes: number
  formatDuration: (ms: number) => string
}): { now: string; jobs: { text: string; ratio: number | null; isStale: boolean }[]; done: string[] } => ({
  now: `${input.now.text}${input.now.since ? ` (${clockOf(input.now.since, input.offsetMinutes)}부터)` : ''}`,
  jobs: [
    ...input.board.jobs.map(job => {
      const isStale = job.output !== undefined && input.at - job.changedAt > STALE_MS
      const parts = [job.title, input.formatDuration(input.at - job.startedAt), job.line, job.kind === 'terminal' ? '터미널 탭' : '', isStale ? '끝난 듯' : '']

      return { text: parts.filter(Boolean).join(' · '), ratio: job.done !== undefined && job.total ? job.done / job.total : null, isStale }
    }),
    ...(input.board.extra > 0 ? [{ text: `외 ${input.board.extra}개`, ratio: null, isStale: false }] : []),
  ],
  done: input.done.map(entry => `${clockOf(entry.at, input.offsetMinutes)} ${entry.text}`),
})

// ── ask mode · gears (pane 0.3.0) ────────────────────────────────────────────

export type AskMode = 'all' | 'ends'

// The project's ask mode from its settings text: 'ends' only when the file says so, else 'all' (the default).
export const parseAskMode = (settingsText: string | null | undefined): AskMode => {
  if (!settingsText) return 'all'
  try {
    const value = (JSON.parse(settingsText) as Record<string, unknown>)?.SCV_ASK_MODE

    return typeof value === 'string' && value.trim().toLowerCase() === 'ends' ? 'ends' : 'all'
  } catch {
    return 'all'
  }
}

const ASK_MODE_TEXT: Record<AskMode, { name: string; meaning: string }> = {
  all: { name: '전부 묻기', meaning: '결정이 나올 때마다 선택 창으로 물음' },
  ends: { name: '처음 · 끝에만 묻기', meaning: '처음(요구 · 계획) · 끝(검증) · 되돌릴 수 없는 일만 물음. 나머지는 추천대로 하고 끝 보고에 적음' },
}

// What the ask-mode card says and what a press switches to.
export const askModeView = (mode: AskMode) => {
  const next: AskMode = mode === 'all' ? 'ends' : 'all'

  return { ...ASK_MODE_TEXT[mode], next, nextLabel: `${ASK_MODE_TEXT[next].name}로 바꾸기` }
}

export type Gear = { name: string; mark: string; takes: string; gives: string; does: string; args: string[]; words: string[] }

// The gears of a project's gear index (a tab-separated line each: name · kind · mark · in · out · does · words · arguments).
// Teeth are left out. The mark is the strongest one in the gear's whole flow (core 0.102.0+; '-' in an older index).
export const parseGears = (indexText: string | null | undefined): Gear[] =>
  (indexText ?? '')
    .split('\n')
    .map(line => line.split('\t'))
    .filter(cols => cols[1] === 'gear' && Boolean(cols[0]))
    .map(cols => ({
      name: cols[0] ?? '',
      mark: cols[2] ?? '-',
      takes: cols[3] ?? '*',
      gives: cols[4] ?? '*',
      does: cols[5] ?? '',
      args: (cols[7] ?? '')
        .split(';')
        .map(one => one.trim())
        .filter(Boolean),
      words: (cols[6] ?? '').split(/\s+/).filter(Boolean),
    }))

const GEAR_TITLE_MAX = 34

// A line cut to at most max characters, the cut marked with an ellipsis.
export const cutLine = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text)

const VALUE_WORD: Record<string, string> = { none: '없음', '*': '아무 값' }
const MARK_WORD: Record<string, string> = {
  pure: '밖으로 영향 없음',
  effect: '이 컴퓨터에 영향 있음',
  outward: '밖으로 나감 — 돌리기 전에 확인',
  judge: 'Claude 가 판단하는 단계 있음',
}

export type GearRow = {
  name: string
  // what the folded line says: the gear's role in plain words, cut short (its name when it has no role line)
  title: string
  // the words a request for this work would use, as the gear's own file lists them
  words: string
  flow: string
  does: string
  argsLine: string | null
  markLine: string | null
  // run: a press runs it here; input: it needs a value typed first; null: only through the prompt box
  direct: 'run' | 'input' | null
}

// One line per gear with what a press may do: a gear whose whole flow is pure runs in the pane (with a value typed
// first when it takes one, where the surface draws a field), every other gear goes through the prompt box.
export const gearRows = (gears: readonly Gear[], hasCore: boolean, hasField: boolean): GearRow[] =>
  gears.map(gear => {
    const takesValue = gear.takes !== 'none'
    const canRun = hasCore && gear.mark === 'pure' && (!takesValue || hasField)

    return {
      name: gear.name,
      title: cutLine(gear.does || gear.name, GEAR_TITLE_MAX),
      words: [...new Set(gear.words)].join(' · '),
      flow: `${VALUE_WORD[gear.takes] ?? gear.takes} → ${VALUE_WORD[gear.gives] ?? gear.gives}`,
      does: gear.does,
      argsLine: gear.args.length > 0 ? `인자 ${gear.args.join(' · ')}` : null,
      markLine: MARK_WORD[gear.mark] ?? null,
      direct: canRun ? (takesValue ? 'input' : 'run') : null,
    }
  })

const GEAR_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

// The command the prompt box gets: the gear alone, so Claude asks for the values it needs (core 0.102.0+).
export const gearCommand = (name: string) => (GEAR_NAME.test(name) ? `/scv:gear run ${name}` : null)

// The command a direct run starts: the name is one word of its own, and what the person typed never joins it.
export const gearRunArgv = (core: string, name: string) => (GEAR_NAME.test(name) ? ['bash', `${core}/scripts/gear.sh`, 'run', name] : null)

// What a direct run printed, cut to a few lines; a failed one says its exit code and its error lines.
export const gearResultView = (exitCode: number, stdout: string, stderr: string, max = 12): string[] => {
  const linesOf = (text: string) => text.split('\n').filter(line => line.trim() !== '')
  if (exitCode !== 0) return [`실패 — 종료 코드 ${exitCode}`, ...linesOf(stderr || stdout).slice(0, max)]
  const lines = linesOf(stdout)
  if (lines.length === 0) return ['끝남 — 출력 없음']

  return lines.length > max ? [...lines.slice(0, max), `… 외 ${lines.length - max}줄`] : lines
}

// Where the SCV plugin is installed, from Claude's own list of installed plugins: the install made for this
// project when there is one, else the person's own. null when the list has none (then presses fall back to the prompt box).
export const pluginRoot = (installedText: string | null | undefined, project: string): string | null => {
  if (!installedText) return null
  try {
    const plugins = (JSON.parse(installedText) as { plugins?: Record<string, unknown> }).plugins ?? {}
    const entries = Object.entries(plugins)
      .filter(([key]) => key === 'scv' || key.startsWith('scv@'))
      .flatMap(([, list]) => (Array.isArray(list) ? (list as { scope?: string; installPath?: string; projectPath?: string }[]) : []))
      .filter(one => typeof one.installPath === 'string' && one.installPath !== '')
    const own = entries.find(one => one.projectPath && one.projectPath === project)

    return (own ?? entries.find(one => one.scope === 'user') ?? entries[0])?.installPath ?? null
  } catch {
    return null
  }
}

export type PaneSection = 'limits' | 'askMode' | 'gears' | 'blocks' | 'steps' | 'more'

// The cards always shown, top to bottom; the rest sits under 'more'. Blocked work shows only when there is some,
// the steps only with a plan, and ask mode · gears only where this session reads the project itself.
export const paneSections = (has: { plan: boolean; blocks: boolean; project: boolean }): PaneSection[] => [
  'limits',
  ...(has.project ? (['askMode', 'gears'] as const) : []),
  ...(has.plan && has.blocks ? (['blocks'] as const) : []),
  ...(has.plan ? (['steps', 'more'] as const) : []),
]

// ── a gear for what the person is typing (pane 0.3.1) ────────────────────────

// The words of a text: lower case, split at anything that is not a letter or a digit, two characters or more.
export const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 2)

export type GearMatch = { gear: Gear; hits: string[] }

const MATCH_MIN_HITS = 2
const MATCH_MIN_CHARS = 6

// The gear that fits what the person typed: the one whose own words (and name parts) the text hits most, when it
// hits two or more. A typed word hits a gear word when one starts with the other, so '릴리스를' hits '릴리스' and a
// half-typed word hits too. Commands (a leading '/') and very short texts fit nothing; a tie goes to the first by name.
export const gearMatch = (text: string, gears: readonly Gear[]): GearMatch | null => {
  const typed = text.trim()
  if (typed.startsWith('/') || typed.length < MATCH_MIN_CHARS) return null
  const tokens = wordsOf(typed)
  const scored = gears
    .map(gear => {
      const own = [...new Set(wordsOf([...gear.words, ...gear.name.split('-')].join(' ')))]

      return { gear, hits: own.filter(word => tokens.some(token => token.startsWith(word) || word.startsWith(token))) }
    })
    .filter(one => one.hits.length >= MATCH_MIN_HITS)
    .sort((a, b) => b.hits.length - a.hits.length || a.gear.name.localeCompare(b.gear.name))

  return scored[0] ?? null
}

// The line drawn above the prompt box while a gear fits what is being typed: the gear's whole role line, never cut
// (the band wraps it) — a cut line hid what the gear does (seen in the app, 2026-11-24).
export const hintLine = (gear: Gear) => `저장해 둔 방법이 있음: ${gear.does || gear.name}`

// What is sent: the person's own text, with one line at its end that names the gear when one fits and was not
// turned down. The gear's name goes in only when it has the shape of one.
const GEAR_LINE_HEAD = '[SCV 기어] 이 요청에 맞는 저장해 둔 방법이 있음:'

export const submitWithGear = (text: string, gear: Gear | null, isDismissed: boolean): string =>
  !gear || isDismissed || !GEAR_NAME.test(gear.name) || text.includes(GEAR_LINE_HEAD)
    ? text
    : `${text}\n\n${GEAR_LINE_HEAD} ${gear.name} — 이 기어로 해 주세요(/scv:gear run ${gear.name}). 값은 위 요청에서 읽고, 없는 값은 물어 주세요.`

const CATALOG_MAX = 5

// The gears a pane lists: those used lately first (newest first), then the rest by name; five unless all are asked for.
export const gearCatalog = (gears: readonly Gear[], recent: readonly string[], isAll: boolean, max = CATALOG_MAX) => {
  const byName = [...gears].sort((a, b) => a.name.localeCompare(b.name))
  const used = recent.flatMap(name => byName.filter(gear => gear.name === name))
  const ordered = [...new Set([...used, ...byName])]
  const shown = isAll ? ordered : ordered.slice(0, max)

  return { shown, hidden: ordered.length - shown.length, total: ordered.length }
}

// The lately-used list with one more use at its front (no repeats, the ten newest kept).
export const usedGear = (recent: readonly string[], name: string) => [name, ...recent.filter(one => one !== name)].slice(0, 10)


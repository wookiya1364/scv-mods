// Pure steps of the SCV dashboard: text in, values out, nothing read or written.
// The hooks module reads the files and watches the session; these only shape what it saw.

import type { Block, Dreams, PipelineStep, PlanFile, Plan, Stage, StageState, StepMark, Task, TestRow, TestRun, WorkEntry } from '../types'

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
  status: frontmatter(file.planText, 'status') ?? 'planned',
  steps: section(file.planText, ['Suggested path', 'Steps'])
    .map(line => line.match(/^\s*\d+\.\s+(.+)$/)?.[1])
    .filter((step): step is string => Boolean(step))
    .map(parseStep),
  scenarios: [...file.testsText.matchAll(/^###\s+(T\d+)\.\s*(.+)$/gm)].map(([, id = '', name = '']) => ({ id, name: name.trim() })),
  howToRun: howToRun(file.testsText),
  pipeline: parsePipeline(file.planText),
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

    return { name: step.name, refs: step.refs, state }
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

export const findBlocks = (stages: readonly Stage[], run: TestRun | undefined, waiting: string | null): Block[] => [
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
  ...stages.filter(stage => stage.state === 'blocked').map(stage => ({ kind: 'stage' as const, title: '막힌 단계', detail: stage.name })),
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

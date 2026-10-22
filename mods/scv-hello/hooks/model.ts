// Pure steps of the SCV dashboard: text in, values out, nothing read or written.
// The hooks module reads the files and watches the session; these only shape what it saw.

import type { Block, Dreams, PlanFile, Plan, Stage, StageState, StepMark, Task, TestRow, TestRun } from '../types'

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

const parseStep = (raw: string): StepMark => {
  for (const [pattern, state] of MARKS) {
    if (pattern.test(raw)) return { name: raw.replace(pattern, '').trim(), mark: state }
  }

  return { name: raw.trim(), mark: undefined }
}

const howToRun = (testsText: string) =>
  section(testsText, ['How to run', '실행 방법'])
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('```') && !line.startsWith('<!--') && !line.startsWith('#'))

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

  if (isFinished) return { stages: plan.steps.map(step => ({ name: step.name, state: 'done' })), isEstimated: !isMarked }

  const stages: Stage[] = plan.steps.map(step => ({ name: step.name, state: step.mark ?? 'waiting' }))
  const hasDoing = stages.some(stage => stage.state === 'doing')
  const next = stages.findIndex(stage => stage.state === 'waiting')
  const isNext = (i: number) => isStarted && !hasDoing && i === next

  return { stages: stages.map((stage, i) => (isNext(i) ? { ...stage, state: 'doing' } : stage)), isEstimated: !isMarked }
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

const GRAPH_COLOR: Record<StageState, string> = { done: '#3fb950', doing: '#4f8cff', blocked: '#f85149', waiting: '#6e7681' }
const GRAPH_LABEL: Record<StageState, string> = { done: '완료', doing: '진행 중', blocked: '막힘', waiting: '대기' }

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The stage flow as nodes joined top to bottom: green done, blue doing (ringed), red blocked, grey waiting.
// The node where the work stands now (doing, else blocked) carries a "지금 여기" tag.
export const stageGraphSvg = (stages: readonly Stage[], width = 320) => {
  const row = 52
  const top = 22
  const x = 22
  const height = Math.max(row, top + (stages.length - 1) * row + 30)
  const here = stages.findIndex(stage => stage.state === 'doing')
  const at = here >= 0 ? here : stages.findIndex(stage => stage.state === 'blocked')
  const y = (i: number) => top + i * row

  const edges = stages.slice(1).map((stage, i) => {
    const from = stages[i]
    const isDone = from?.state === 'done' && stage.state !== 'waiting'
    const color = isDone ? GRAPH_COLOR.done : from?.state === 'done' ? GRAPH_COLOR[stage.state] : GRAPH_COLOR.waiting
    const dash = from?.state === 'done' ? '' : ' stroke-dasharray="4 4"'

    return `<line x1="${x}" y1="${y(i) + 12}" x2="${x}" y2="${y(i + 1) - 12}" stroke="${color}" stroke-width="3"${dash}/>`
  })

  const nodes = stages.map((stage, i) => {
    const color = GRAPH_COLOR[stage.state]
    const cy = y(i)
    const room = i === at ? 15 : 24
    const name = stage.name.length > room ? `${stage.name.slice(0, room - 1)}…` : stage.name
    const mark =
      stage.state === 'done'
        ? `<path d="M${x - 5} ${cy} l3.5 3.5 l6.5 -7" fill="none" stroke="#0d1117" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
        : stage.state === 'blocked'
          ? `<text x="${x}" y="${cy + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="#0d1117">!</text>`
          : stage.state === 'doing'
            ? `<circle cx="${x}" cy="${cy}" r="4" fill="#0d1117"/>`
            : ''
    const ring =
      i === at
        ? `<circle cx="${x}" cy="${cy}" r="17" fill="none" stroke="${color}" stroke-width="2" opacity="0.5"><animate attributeName="r" values="14;18;14" dur="1.6s" repeatCount="indefinite"/></circle>`
        : ''
    const fill = stage.state === 'waiting' ? '#0d1117' : color
    const tag =
      i === at
        ? `<rect x="${width - 70}" y="${cy - 10}" width="64" height="20" rx="10" fill="${color}"/><text x="${width - 38}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="600" fill="#0d1117">지금 여기</text>`
        : ''

    return [
      `<g><title>${escapeXml(`${i + 1}. ${stage.name} — ${GRAPH_LABEL[stage.state]}`)}</title>`,
      ring,
      `<circle cx="${x}" cy="${cy}" r="12" fill="${fill}" stroke="${color}" stroke-width="2"/>`,
      mark,
      `<text x="${x + 24}" y="${cy - 2}" font-size="13" fill="${stage.state === 'waiting' ? '#8b949e' : '#e6edf3'}">${escapeXml(`${i + 1}. ${name}`)}</text>`,
      `<text x="${x + 24}" y="${cy + 14}" font-size="11" fill="${color}">${GRAPH_LABEL[stage.state]}</text>`,
      tag,
      '</g>',
    ].join('')
  })

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, system-ui, 'Noto Sans KR', sans-serif">`,
    ...edges,
    ...nodes,
    '</svg>',
  ].join('')
}

export const stageGraphAlt = (stages: readonly Stage[]) =>
  stages.map((stage, i) => `${i + 1}. ${stage.name}: ${GRAPH_LABEL[stage.state]}`).join(' → ')

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Expanded, Live, PlanFile, Snapshot, StageState } from '../types'
import {
  applyTaskEvent,
  countStages,
  deriveStages,
  describeTool,
  estimateEta,
  findBlocks,
  formatDuration,
  isTestCommand,
  mergeTests,
  parseDreams,
  parsePlans,
  parseTestOutput,
  pickPlan,
  recordStepTimes,
  runFor,
  stageGraphAlt,
  stageGraphSvg,
} from './model'

const PANE = 'scv-hello'
const TITLE = 'SCV'
const REFRESH_MS = 3000

const snapshot = atom({ plugin: 'scv-hello', key: 'snapshot' } as const, { plans: [], dreamsText: null, cwd: '' } as Snapshot)
const chosen = atom({ plugin: 'scv-hello', key: 'chosen' } as const, null as string | null)
const expanded = atom({ plugin: 'scv-hello', key: 'expanded' } as const, { steps: false, tests: false, blocks: true, dreams: false } as Expanded)
const runs = atom({ plugin: 'scv-hello', key: 'runs' } as const, [])
const waiting = atom({ plugin: 'scv-hello', key: 'waiting' } as const, null as string | null)
const live = atom({ plugin: 'scv-hello', key: 'live' } as const, { isWorking: false, turnStartedAt: 0, tool: null } as Live)
const tasks = atom({ plugin: 'scv-hello', key: 'tasks' } as const, [])
const history = atom({ plugin: 'scv-hello', key: 'history' } as const, [])
const now = atom({ plugin: 'scv-hello', key: 'now' } as const, 0)
const note = atom({ plugin: 'scv-hello', key: 'note' } as const, null as string | null)

const STATE_LABEL: Record<StageState, string> = { done: '완료', doing: '진행', blocked: '막힘', waiting: '대기' }
const STATE_MARK: Record<StageState, string> = { done: '✓', doing: '▶', blocked: '⛔', waiting: '○' }
const STATE_COLOR: Record<StageState, string> = { done: '#3fb950', doing: '#4f8cff', blocked: '#f85149', waiting: '#8b949e' }
const RESULT_LABEL = { pass: '통과', fail: '실패', none: '결과 없음' } as const
const RESULT_COLOR = { pass: '#3fb950', fail: '#f85149', none: '#8b949e' } as const

type Api = EngineInterface

const readText = async ($: Api, path: string) => {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

// The entry of the pipeline: the session's SCV files, read and never written.
const readSources = async ($: Api, cwd: string): Promise<Snapshot> => {
  const scv = cwd ? `${cwd}/scv` : 'scv'
  const entries = await $.fs.list(`${scv}/promote`).catch(() => [])
  const plans: PlanFile[] = []
  for (const entry of entries.filter(one => one.kind === 'dir')) {
    const planText = await readText($, `${scv}/promote/${entry.name}/PLAN.md`)
    if (planText) plans.push({ slug: entry.name, planText, testsText: (await readText($, `${scv}/promote/${entry.name}/TESTS.md`)) ?? '' })
  }

  return { plans, dreamsText: await readText($, `${scv}/dreams/latest.json`), cwd }
}

const refresh = async ($: Api) => {
  const at = await $.clock.now()
  const current = await read($, snapshot)
  const next = await readSources($, current.cwd)
  await update($, snapshot, () => next)
  await update($, now, () => at)
  const plan = pickPlan(parsePlans(next.plans), await read($, chosen))
  if (plan) {
    const done = countStages(deriveStages(plan).stages).done
    await update($, history, list => recordStepTimes(list, plan.slug, done, at))
  }
}

const openPane = ($: Api) => $.ui.open({ id: PANE, title: TITLE })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, snapshot, value => ({ ...value, cwd: e.cwd }))
    await $.command.register({ name: 'scv-hello', description: 'Open the SCV dashboard pane' })
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($).catch(() => undefined))
    void openPane($).catch(() => undefined)

    return started
  })

  on('prompt.submit', async ($, e, next) => {
    const submitted = await next(e)
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (!isOpen) await openPane($)

    return submitted
  })

  on('command.run', { command: 'scv-hello' }, async $ => {
    const { isPlaced } = await openPane($)

    return { text: `SCV dashboard ${isPlaced ? 'is open' : 'is not drawn here'}.` }
  })

  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    await update($, live, value => ({ ...value, isWorking: true, turnStartedAt: at }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, live, value => ({ ...value, isWorking: false, tool: null }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const at = await $.clock.now()
    await update($, live, value => ({ ...value, tool: { name: e.tool, target: describeTool(e.tool, input), startedAt: at } }))
    await update($, tasks, list => applyTaskEvent(list, e.tool, input))
    if (e.tool === 'AskUserQuestion') await update($, waiting, () => describeTool(e.tool, input) || '질문')

    try {
      const ran = await next(e)
      if (e.tool === 'Bash' && typeof input.command === 'string') {
        const plans = parsePlans((await read($, snapshot)).plans)
        const howTo = plans.flatMap(plan => plan.howToRun)
        if (isTestCommand(input.command, howTo)) {
          const result = ran.result as { stdout?: string; stderr?: string } | undefined
          const output = [result?.stdout, result?.stderr, ran.text].filter(Boolean).join('\n')
          const run = parseTestOutput(input.command, output, !ran.isError && !ran.deny, await $.clock.now())
          await update($, runs, list => [...list, run].slice(-20))
        }
      }

      return ran
    } finally {
      if (e.tool === 'AskUserQuestion') await update($, waiting, () => null)
      await update($, live, value => (value.tool?.startedAt === at ? { ...value, tool: null } : value))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Select = 'Select' in elements ? elements.Select : undefined
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const shot = await read($, snapshot)
    const plans = parsePlans(shot.plans)
    const plan = pickPlan(plans, await read($, chosen))
    const open = await read($, expanded)
    const at = await read($, now)
    const state = await read($, live)
    const todo = await read($, tasks)
    const asked = await read($, waiting)
    const dreams = parseDreams(shot.dreamsText)
    const message = await read($, note)

    const toggle = (key: keyof Expanded) => () => void update($, expanded, value => ({ ...value, [key]: !value[key] }))

    const openReport = async () => {
      const path = dreams?.reportPath
      if (!path) return
      const full = path.startsWith('/') ? path : `${shot.cwd}/${path}`
      for (const opener of ['xdg-open', 'open']) {
        const opened = await $.process.run([opener, full]).catch(() => undefined)
        if (opened?.exitCode === 0) return void update($, note, () => null)
      }
      await update($, note, () => `보고서를 열지 못했습니다: ${full}`)
    }

    const card = (children: RenderChildren, color = '#30363d') => (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginBottom={1}>
        {children}
      </Box>
    )

    if (!plan) {
      return (
        <Box flexDirection="column">
          <Text bold>SCV 대시보드</Text>
          <Text dimColor>이 폴더에 진행 중인 SCV 계획이 없습니다. /scv:promote 로 계획을 만들면 여기에 보입니다.</Text>
          <Text dimColor>{`확인한 곳: ${shot.cwd || '(작업 폴더 모름)'}/scv/promote`}</Text>
          {dreamsPart()}
        </Box>
      )
    }

    const { stages, isEstimated } = deriveStages(plan)
    const count = countStages(stages)
    const run = runFor(plan, await read($, runs))
    const rows = mergeTests(plan, run)
    const blocks = findBlocks(stages, run, asked)
    const eta = estimateEta(await read($, history), plan.slug, count.total - count.done)
    const percent = count.total ? Math.round((count.done / count.total) * 100) : 0
    const current = stages.find(stage => stage.state === 'doing')
    const doneTasks = todo.filter(task => task.status === 'completed').length
    const doingTask = todo.find(task => task.status === 'in_progress')

    function dreamsPart() {
      return card(
        <>
          <Text bold>드림</Text>
          {dreams ? (
            <>
              <Text dimColor>{dreams.date}</Text>
              <Text>{dreams.items[0] ?? '요약 없음'}</Text>
              {open.dreams && dreams.items.slice(1).map(item => <Text>· {item}</Text>)}
              <Box flexDirection="row" gap={1}>
                <Button key="dreams-toggle" label={open.dreams ? '개선점 접기' : '개선점 펼치기'} onPress={toggle('dreams')} />
                {dreams.reportPath && <Button key="dreams-report" label="보고서 열기" onPress={() => void openReport()} />}
              </Box>
              {message && <Text color="#f85149">{message}</Text>}
            </>
          ) : (
            <Text dimColor>아직 드림 없음 — /scv:dreams 로 만들 수 있습니다.</Text>
          )}
        </>,
      )
    }

    return (
      <Box flexDirection="column">
        {plans.length > 1 && Select ? (
          <Select
            key="plan"
            label="계획"
            value={plan.slug}
            options={plans.map(one => ({ value: one.slug, label: `${one.title} (${one.status})` }))}
            onSelect={(value: string) => void update($, chosen, () => value)}
          />
        ) : null}
        <Text bold>{plan.title}</Text>
        <Text dimColor>상태: {plan.status}</Text>

        {card(
          <>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold>진행률</Text>
              <Text bold>{`${count.done}/${count.total}`}</Text>
            </Box>
            <Box width="100%" height={1} backgroundColor="#21262d">
              <Box width={`${percent}%`} height={1} backgroundColor="#4f8cff" />
            </Box>
            <Text dimColor>
              {eta.kind === 'done'
                ? '모든 단계 완료'
                : eta.kind === 'unknown'
                  ? '예상 완료 시간: 아직 추정 불가'
                  : `예상 완료 시간: 약 ${formatDuration(eta.ms)} 남음 (추정 · 단계 ${eta.basis}개 평균)`}
            </Text>
          </>,
        )}

        {card(
          <>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold>진행 중</Text>
              <Text color={state.isWorking ? '#4f8cff' : '#8b949e'}>
                {state.isWorking ? `일하는 중 · ${formatDuration(at - state.turnStartedAt)}` : '쉬는 중'}
              </Text>
            </Box>
            <Text>{current ? `단계: ${current.name}` : '진행 중인 단계 없음'}</Text>
            {state.tool ? (
              <Text dimColor>
                {`${state.tool.name}${state.tool.target ? `: ${state.tool.target}` : ''} · ${formatDuration(at - state.tool.startedAt)}`}
              </Text>
            ) : null}
            {todo.length > 0 ? (
              <Text dimColor>{`할 일 ${doneTasks}/${todo.length}${doingTask ? ` · ${doingTask.subject}` : ''}`}</Text>
            ) : null}
          </>,
          '#4f8cff',
        )}

        {blocks.length > 0
          ? card(
              <>
                <Box flexDirection="row" justifyContent="space-between">
                  <Text bold color="#f85149">{`막힌 작업 ${blocks.length}`}</Text>
                  <Button key="blocks-toggle" label={open.blocks ? '접기' : '펼치기'} onPress={toggle('blocks')} />
                </Box>
                {blocks.map(block => (
                  <>
                    <Text color="#f85149">{block.title}</Text>
                    {open.blocks && <Text dimColor>{block.detail}</Text>}
                  </>
                ))}
              </>,
              '#f85149',
            )
          : null}

        {card(
          <>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold>단계 흐름{isEstimated ? ' (추정)' : ''}</Text>
              <Button key="steps-toggle" label={open.steps ? '단계 접기' : '단계 펼치기'} onPress={toggle('steps')} />
            </Box>
            {Svg ? (
              <Svg source={stageGraphSvg(stages)} alt={stageGraphAlt(stages)} isInteractive />
            ) : (
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                {stages.map(stage => <Text color={STATE_COLOR[stage.state]}>{STATE_MARK[stage.state]}</Text>)}
              </Box>
            )}
            <Text dimColor>{`완료 ${count.done} · 진행 ${count.doing} · 막힘 ${count.blocked} · 대기 ${count.waiting}`}</Text>
            {open.steps &&
              stages.map((stage, i) => (
                <Text color={STATE_COLOR[stage.state]}>{`${i + 1}. ${STATE_MARK[stage.state]} ${stage.name} — ${STATE_LABEL[stage.state]}`}</Text>
              ))}
          </>,
        )}

        {card(
          <>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold>시험 결과</Text>
              <Button key="tests-toggle" label={open.tests ? '시험 접기' : '시험 펼치기'} onPress={toggle('tests')} />
            </Box>
            <Text dimColor>
              {run ? `마지막 실행: ${run.isOk ? '통과' : '실패'} · ${formatDuration(at - run.at)} 전` : '이 세션에서 돌린 시험 없음'}
            </Text>
            <Text dimColor>{`통과 ${rows.filter(row => row.result === 'pass').length} · 실패 ${rows.filter(row => row.result === 'fail').length} · 결과 없음 ${rows.filter(row => row.result === 'none').length}`}</Text>
            {open.tests &&
              rows.map(row => <Text color={RESULT_COLOR[row.result]}>{`${row.id} ${row.name} — ${RESULT_LABEL[row.result]}`}</Text>)}
          </>,
        )}

        {dreamsPart()}
      </Box>
    )
  })
}

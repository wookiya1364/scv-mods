import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Expanded, Live, Plan, PlanFile, Snapshot, StageState, StepSignal, TestRun, WorkEntry } from '../types'
import {
  STEP_TOOL,
  applyBlocks,
  applySignal,
  applyTaskEvent,
  barColor,
  buildStepPrompt,
  checkSignal,
  countStages,
  describeRole,
  nodeIconSvg,
  deriveStages,
  describeTool,
  estimateEta,
  findBlocks,
  formatDuration,
  headline,
  isTestCommand,
  logWork,
  mergeMarks,
  mergeTests,
  nextAction,
  parseDreams,
  parsePlans,
  parseTestOutput,
  pickPlan,
  recordStepTimes,
  runFor,
  stageRole,
  statusWords,
  stepTimesFromSignals,
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
const focusStep = atom({ plugin: 'scv-hello', key: 'focusStep' } as const, null as number | null)
const stepLog = atom({ plugin: 'scv-hello', key: 'stepLog' } as const, {} as Record<string, WorkEntry[]>)
const signals = atom({ plugin: 'scv-hello', key: 'signals' } as const, [] as StepSignal[])

const STATE_LABEL: Record<StageState, string> = { done: '완료', doing: '진행 중', blocked: '막힘', waiting: '대기' }
const STATE_MARK: Record<StageState, string> = { done: '●', doing: '◉', blocked: '●', waiting: '○' }
const STATE_COLOR: Record<StageState, string> = { done: '#3fb950', doing: '#e3b341', blocked: '#f85149', waiting: '#8b949e' }
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

const readPlans = async ($: Api, dir: string, isArchived: boolean): Promise<PlanFile[]> => {
  const entries = await $.fs.list(dir).catch(() => [])
  const plans: PlanFile[] = []
  for (const entry of entries.filter(one => one.kind === 'dir')) {
    const planText = await readText($, `${dir}/${entry.name}/PLAN.md`)
    if (planText) plans.push({ slug: entry.name, planText, testsText: (await readText($, `${dir}/${entry.name}/TESTS.md`)) ?? '', isArchived })
  }

  return plans
}

// The entry of the pipeline: the session's SCV files, read and never written.
// With no plan in progress, the plans already archived stand in, newest first.
const readSources = async ($: Api, cwd: string): Promise<Snapshot> => {
  const scv = cwd ? `${cwd}/scv` : 'scv'
  const active = await readPlans($, `${scv}/promote`, false)
  const plans = active.length > 0 ? active : (await readPlans($, `${scv}/archive`, true)).sort((a, b) => b.slug.localeCompare(a.slug))

  return { plans, dreamsText: await readText($, `${scv}/dreams/latest.json`), cwd }
}

// Test runs and step signals are kept in the mod's own store, per project folder, so a new session
// (or another session on this computer) still shows them.
const runsKey = (cwd: string) => `runs:${cwd}`
const signalsKey = (cwd: string) => `signals:${cwd}`

const loadSignals = async ($: Api, cwd: string) => {
  const kept = await $.store.get(signalsKey(cwd)).catch(() => undefined)
  if (Array.isArray(kept)) await update($, signals, () => kept as StepSignal[])
}

// The plan on screen with Claude's step signals merged into its marks.
const planInView = async ($: Api): Promise<Plan | undefined> => {
  const plan = pickPlan(parsePlans((await read($, snapshot)).plans), await read($, chosen))

  return plan && mergeMarks(plan, await read($, signals))
}

const refresh = async ($: Api) => {
  const at = await $.clock.now()
  const current = await read($, snapshot)
  const next = await readSources($, current.cwd)
  await update($, snapshot, () => next)
  await update($, now, () => at)
  await loadSignals($, next.cwd)
  const plan = await planInView($)
  if (plan) {
    const done = countStages(deriveStages(plan).stages).done
    await update($, history, list => recordStepTimes(list, plan.slug, done, at))
  }
}

const STATE_WORD = { doing: '시작', done: '끝', blocked: '막힘' } as const

// The mod's own tool is not among the tool names the types know, so its hooks match it by pattern.
const STEP_TOOL_NAME = new RegExp(`^${STEP_TOOL}$`)

const STEP_TOOL_SPEC = {
  name: 'scv_step',
  description:
    "Report a step of an SCV plan's Suggested path so the SCV pane shows real progress: state doing (started), done (finished) or blocked (cannot go on — give the reason in note). Changes no file.",
  inputSchema: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: 'The plan folder name under scv/promote' },
      step: { type: 'integer', minimum: 1, description: "The step's number in the plan's Suggested path, starting at 1" },
      state: { type: 'string', enum: ['doing', 'done', 'blocked'] },
      note: { type: 'string', description: 'One line; the reason when state is blocked' },
    },
    required: ['plan', 'step', 'state'],
    additionalProperties: false,
  },
}

// One alert per event: the host's notification, else the system's own (the desktop app has no terminal to ring), and a toast.
const alert = async ($: Api, text: string) => {
  const sent = await $.ui.notify(text, { title: 'SCV' }).catch(() => undefined)
  if (!sent?.isSent) {
    for (const argv of [
      ['osascript', '-e', `display notification ${JSON.stringify(text)} with title "SCV"`],
      ['notify-send', 'SCV', text],
    ]) {
      const ran = await $.process.run(argv).catch(() => undefined)
      if (ran?.exitCode === 0) break
    }
  }
  try {
    await $.ui.toast(`SCV: ${text}`)
  } catch {
    // a toast is a courtesy; the alert has been raised
  }
}

const openPane = ($: Api) => $.ui.open({ id: PANE, title: TITLE })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await update($, snapshot, value => ({ ...value, cwd: e.cwd }))
    const kept = await $.store.get(runsKey(e.cwd)).catch(() => undefined)
    if (Array.isArray(kept)) await update($, runs, () => kept as TestRun[])
    await loadSignals($, e.cwd)
    await $.command.register({ name: 'scv-hello', description: 'Open the SCV dashboard pane' })
    await $.tool.register(STEP_TOOL_SPEC).catch(() => undefined)
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

  // Claude's instructions carry the step signal only while a plan is in progress.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const text = buildStepPrompt(parsePlans((await read($, snapshot)).plans))

    return text ? { sections: [...composed.sections, { id: 'scv-hello:step-signal', text, scope: 'session' as const }] } : composed
  })

  // The mod's own tool asks no permission; every other tool's verdict is left as it is.
  on('tool.check', { tool: STEP_TOOL_NAME }, () => ({ decision: 'allow' as const }))

  on('tool.call', { tool: STEP_TOOL_NAME }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const asked = {
      plan: typeof input.plan === 'string' ? input.plan : '',
      step: Number(input.step),
      state: typeof input.state === 'string' ? input.state : '',
      ...(typeof input.note === 'string' ? { note: input.note } : {}),
    }
    const shot = await read($, snapshot)
    const plans = parsePlans(shot.plans)
    // The store is the record: a signal sent right after another (or from another session) builds on it,
    // where the session value read here could still be the one from before the last write.
    const stored = await $.store.get(signalsKey(shot.cwd)).catch(() => undefined)
    const before = Array.isArray(stored) ? (stored as StepSignal[]) : await read($, signals)
    const checked = checkSignal(asked, plans, before)
    if (!checked.isOk) return { deny: checked.reason }

    const kept = applySignal(before, asked, await $.clock.now())
    await $.store.set(signalsKey(shot.cwd), kept).catch(() => undefined)
    await update($, signals, () => kept)
    const plan = plans.find(one => one.slug === asked.plan)
    const count = plan ? countStages(deriveStages(mergeMarks(plan, kept)).stages) : undefined

    return {
      result: `기록함: ${asked.plan} ${asked.step}단계 ${STATE_WORD[asked.state as keyof typeof STATE_WORD]}${count ? ` — 진행 ${count.done}/${count.total}` : ''}`,
    }
  })

  on('tool.call', async ($, e, next) => {
    if ((e.tool as string) === STEP_TOOL) return next(e)
    const input = e as unknown as Record<string, unknown>
    const at = await $.clock.now()
    await update($, live, value => ({ ...value, tool: { name: e.tool, target: describeTool(e.tool, input), startedAt: at } }))
    await update($, tasks, list => applyTaskEvent(list, e.tool, input))
    const plan = await planInView($)
    const current = plan ? deriveStages(plan).stages.findIndex(stage => stage.state === 'doing') : -1
    if (plan && current >= 0) {
      const entry = { tool: e.tool, target: describeTool(e.tool, input), at }
      await update($, stepLog, log => logWork(log, `${plan.slug}#${current}`, entry))
    }
    if (e.tool === 'AskUserQuestion') {
      const question = describeTool(e.tool, input) || '질문'
      await update($, waiting, () => question)
      await alert($, `답을 기다리는 중 — ${question}`)
    }

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
          const cwd = (await read($, snapshot)).cwd
          await $.store.set(runsKey(cwd), await read($, runs)).catch(() => undefined)
          if (!run.isOk) {
            const failed = Object.entries(run.byId).filter(([, result]) => result === 'fail').map(([id]) => id)
            await alert($, `시험 실패${failed.length ? ` — ${failed.join(', ')}` : ''}`)
          }
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
    const picked = pickPlan(plans, await read($, chosen))
    const reported = await read($, signals)
    const plan = picked && mergeMarks(picked, reported)
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

    const derived = deriveStages(plan)
    const isEstimated = derived.isEstimated
    const run = runFor(plan, await read($, runs))
    const rows = mergeTests(plan, run)
    const blocks = findBlocks(derived.stages, run, asked)
    const stages = applyBlocks(derived.stages, blocks)
    const here = stages.findIndex(stage => stage.state === 'doing' || stage.state === 'blocked')
    const focused = (await read($, focusStep)) ?? (here >= 0 ? here : null)
    const focusedStage = focused === null ? undefined : stages[focused]
    const work = focused === null ? [] : ((await read($, stepLog))[`${plan.slug}#${focused}`] ?? [])
    const count = countStages(stages)
    // Step times from Claude's signals survive a new session; the times seen here are the fallback.
    const signalTimes = picked ? stepTimesFromSignals(reported, picked) : []
    const eta = estimateEta(signalTimes.length >= 2 ? signalTimes : await read($, history), plan.slug, count.total - count.done)
    const action = nextAction(plan.slug, plan.status, stages, blocks)
    const percent = count.total ? Math.round((count.done / count.total) * 100) : 0
    const current = stages.find(stage => stage.state === 'doing' || stage.state === 'blocked')
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
              {message && !message.startsWith('복사') && <Text color="#f85149">{message}</Text>}
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
        {plan.isArchived ? <Text dimColor>진행 중인 계획이 없어 최근 끝난 계획을 보여 줍니다.</Text> : null}
        {plans.length > 1 && Select ? null : <Text bold>{plan.title}</Text>}
        <Text dimColor>{`상태: ${statusWords(plan.status, stages)}`}</Text>
        {card(
          <>
            <Text bold>{headline(stages, blocks, eta, formatDuration)}</Text>
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <Text color={action.command ? STATE_COLOR.doing : '#8b949e'}>{`다음: ${action.text}`}</Text>
              {action.command ? (
                <Button
                  key="next-copy"
                  label="명령 복사"
                  onPress={() =>
                    void $.ui.copy({ text: action.command ?? '', surface: e.surface }).then(copied =>
                      update($, note, () => (copied.isCopied ? `복사함: ${action.command}` : `복사 못 함 — ${action.command}`)),
                    )
                  }
                />
              ) : null}
            </Box>
            {message && message.startsWith('복사') ? <Text dimColor>{message}</Text> : null}
          </>,
          barColor(stages, blocks),
        )}

        {card(
          <>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold>진행률</Text>
              <Text bold>{`${count.done}/${count.total}`}</Text>
            </Box>
            <Box width="100%" height={1} backgroundColor="#21262d">
              <Box width={`${percent}%`} height={1} backgroundColor={barColor(stages, blocks)} />
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
            </Box>
            <Box flexDirection="column">
              {stages.map((stage, i) => (
                <Box flexDirection="row" gap={1} backgroundColor={i === focused ? '#1f242c' : undefined}>
                  {Svg ? (
                    <Svg
                      source={nodeIconSvg(stage.state, stages[i + 1]?.state ?? null)}
                      alt={`${i + 1}단계 ${STATE_LABEL[stage.state]}`}
                      width={22}
                      height={44}
                    />
                  ) : (
                    <Text color={STATE_COLOR[stage.state]}>{STATE_MARK[stage.state]}</Text>
                  )}
                  <Box flexDirection="column" flexShrink={1}>
                    <Button key={`step-${i + 1}`} plain onPress={() => void update($, focusStep, value => (value === i ? null : i))}>
                      {`${i + 1}. ${stage.name}`}
                    </Button>
                    <Text color={STATE_COLOR[stage.state]}>
                      {i === here ? `${STATE_LABEL[stage.state]}  ◀ 지금 여기` : STATE_LABEL[stage.state]}
                    </Text>
                  </Box>
                </Box>
              ))}
            </Box>
            <Text dimColor>{`완료 ${count.done} · 진행 ${count.doing} · 막힘 ${count.blocked} · 대기 ${count.waiting} — 단계를 누르면 자세히`}</Text>
            {focusedStage && focused !== null ? (
              <Box flexDirection="column" borderStyle="round" borderColor={STATE_COLOR[focusedStage.state]} paddingX={1} marginTop={1}>
                <Text bold color={STATE_COLOR[focusedStage.state]}>{`${focused + 1}. ${focusedStage.name} — ${STATE_LABEL[focusedStage.state]}`}</Text>
                <Text bold>하는 일</Text>
                {stageRole(focusedStage, plan.pipeline).length > 0 ? (
                  stageRole(focusedStage, plan.pipeline).map(role => <Text>{`• ${describeRole(role)}`}</Text>)
                ) : (
                  <Text dimColor>계획서 파이프라인 표에서 이 단계가 하는 일을 찾지 못했습니다.</Text>
                )}
                <Text bold>이 단계에서 한 일</Text>
                {work.length > 0 ? (
                  work.map(entry => <Text dimColor>{`${entry.tool}${entry.target ? `: ${entry.target}` : ''}`}</Text>)
                ) : (
                  <Text dimColor>이 세션에서 기록된 일 없음</Text>
                )}
              </Box>
            ) : null}
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

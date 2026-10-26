import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

import {
  applyTaskEvent,
  deriveStages,
  describeTool,
  estimateEta,
  formatDuration,
  mergeTests,
  parseDreams,
  parsePlan,
  parseTestOutput,
  applyBlocks,
  barColor,
  headline,
  nextAction,
  statusWords,
  describeRole,
  nodeIconSvg,
  stageRole,
  STEP_TOOL,
  applySignal,
  buildStepPrompt,
  checkSignal,
  mergeMarks,
  stepDurationsFromSignals,
  estimateFromDurations,
  buildAlertText,
  classifyTurnEnd,
  isMainLoop,
  permissionWaitOf,
  agentLines,
  applyAgentEvent,
  ancestorsOf,
  planPromptFill,
  suggestNext,
  usageAlerts,
  usageLine,
  isMirrorDue,
  isOwnAddress,
  isViewerOf,
  mirrorAddress,
  mirrorText,
  parseMirror,
} from './model'

const PANE = {
  plugin: 'scv-dashboard',
  component: 'Pane',
  requestId: 'scv-dashboard',
  props: {
    title: 'SCV',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const plan = (opts: { title: string; status: string; steps: string[]; tests?: string[]; pipeline?: string[] }) => ({
  planText: `---\ntitle: ${opts.title}\nstatus: ${opts.status}\n---\n\n## 순수함수 · 파이프라인 (Pure functions & pipeline)\n\n| # | 단계 | 하는 일 | 받는 값 → 돌려주는 값 | 순수/부수효과 |\n|---|---|---|---|---|\n${(opts.pipeline ?? []).map((row, i) => `| ${i + 1} | ${row} |`).join('\n')}\n\n## Suggested path\n\n${opts.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n## Related Documents\n`,
  testsText: `# Tests\n\n## Test scenarios\n\n${(opts.tests ?? []).map((name, i) => `### T${i + 1}. ${name}\n`).join('\n')}\n## How to run\n\n\`\`\`bash\nnpm run verify-dashboard\n\`\`\`\n`,
})

const st = (name: string, state: 'done' | 'doing' | 'blocked' | 'waiting') => ({ name, state, refs: [] as string[] })

const ELEVEN = ['[x] a', '[x] b', '[x] c', '[x] d', '[x] e', '[~] f', 'g', 'h', 'i', 'j', 'k']

const DREAMS = JSON.stringify({
  date: '20261022',
  summary: '[SCV 드림] 아직 셀 것이 없음(보관된 계획 0개) · 개선점: 완료 기준 비율 0/7(0%) · 보고서 scv/dreams/x.html',
  report: 'scv/dreams/x.html',
})

type Files = Record<string, { planText: string; testsText: string }>

const engine = (
  on: On,
  files: Files,
  dreams: string | null = DREAMS,
  clock = { at: 1_000_000 },
  archived: Files = {},
  // true: the test answers $.clock itself (mock.clock), so the refresh timer can be advanced
  isClockMocked = false,
) => {
  const opened: string[] = []
  const panes: { id: string }[] = []
  const store = new Map<string, unknown>()
  const notices: string[] = []
  const copies: string[] = []
  const toasts: string[] = []
  const notify = { isSent: true }
  const processes: string[][] = []
  const proc = { stdout: '' }
  const sent: { to: string; text: string }[] = []
  const delivery = { isDelivered: true }
  on('command.register', () => ({ value: { command: 'scv-dashboard' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__scv-dashboard__${e.name}` } }) as never)
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: panes as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  if (!isClockMocked) {
    on('clock.now', () => ({ value: clock.at }))
    on('clock.every', () => ({ value: undefined }))
  }
  const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
  on('fs.list', (_, e) => ({
    value:
      e.path === '/work'
        ? [dir('scv'), dir('marketplace')]
        : /scv\/(promote|archive)$/.test(e.path)
          ? Object.keys(e.path.endsWith('scv/archive') ? archived : files).map(dir)
          : [],
  }))
  on('fs.read', (_, e) => {
    const [, where, slug, file] = e.path.match(/scv\/(promote|archive)\/([^/]+)\/(PLAN|TESTS)\.md$/) ?? []
    const found = slug ? (where === 'archive' ? archived : files)[slug] : undefined
    if (found) return { value: file === 'PLAN' ? found.planText : found.testsText }
    if (e.path.endsWith('scv/dreams/latest.json') && dreams) return { value: dreams }
    return { deny: `ENOENT ${e.path}` }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    notices.push(e.text)
    return { value: notify.isSent ? { isSent: true, channel: 'iterm2' } : { isSent: false, reason: 'no-surface' } } as never
  })
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } } as never
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    processes.push([...e.argv])
    return { value: { exitCode: 0, stdout: proc.stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: 'local-id' }))
  on('session.send', (_, e) => {
    if (!delivery.isDelivered) return { isDelivered: false, reason: 'no such session' } as never
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('session.receive', (_, e) => ({ text: e.text }))

  return { opened, processes, clock, panes, store, notices, copies, toasts, notify, proc, sent, delivery }
}

const start = ($: Engine) =>
  $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

const text = async (ui: { find: (q: { type: 'Text'; text: RegExp }) => Promise<{ text?: string } | undefined> }, pattern: RegExp) =>
  (await ui.find({ type: 'Text', text: pattern }))?.text

// Draws the pane through the engine's own render, which a hook still running may call.
const drawnText = async ($: Engine) =>
  JSON.stringify(await $.ui.render({ ...PANE, surface: 'desktop' } as never))

const typed = (value: string) => ({ text: value, wait: false, origin: { kind: 'composer' } }) as const

// ── progress plan ────────────────────────────────────────────────────────────

test('progress T1 진행률은 진행 경로 단계 중 끝난 수 / 전체', async ($, on) => {
  engine(on, { a: plan({ title: '대시보드', status: 'in_progress', steps: ELEVEN }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^5\/11$/)).toBe('5/11')
  await ui.unmount()
})

test('progress T2 단계 흐름이 완료·진행·막힘·대기를 구분', async ($, on) => {
  const steps = ['[x] a', '[x] b', '[~] c', '[!] d', 'e']
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps }) })
  expect(deriveStages(parsePlan({ slug: 'a', ...plan({ title: 'p', status: 'in_progress', steps }) })).stages.map(s => s.state)).toEqual([
    'done',
    'done',
    'doing',
    'waiting',
    'waiting',
  ])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /완료 2 · 진행 1 · 막힘 0 · 대기 2/)).toBe('완료 2 · 진행 1 · 막힘 0 · 대기 2 — 단계를 누르면 자세히')
  expect((await ui.find({ type: 'Button', key: 'step-3' }))?.text).toBe('3. c')
  expect(await text(ui, /지금 여기/)).toBe('진행 중  ◀ 지금 여기')
  await ui.unmount()
})

test('progress T2b 단계 흐름 — 신호등 색 노드가 선으로 이어지고, 이름을 누르면 상세, 지금 멈춘 곳 표시', async ($, on) => {
  const done = nodeIconSvg('done', 'doing')
  expect(done).toContain('fill="#3fb950"')
  expect(done).toContain('<line ')
  expect(done).not.toContain('stroke-dasharray')
  const doing = nodeIconSvg('doing', 'waiting')
  expect(doing).toContain('fill="#e3b341"')
  expect(doing).toContain('stroke-dasharray')
  expect(nodeIconSvg('blocked', null)).toContain('fill="#f85149"')
  expect(nodeIconSvg('blocked', null)).not.toContain('<line ')
  expect(nodeIconSvg('waiting', null)).toContain('fill="none" stroke="#6e7681"')

  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] 준비', '화면 만들기', '올리기'] }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  const rows = await ui.findAll({ type: 'Button' })
  expect(rows.filter(row => row.key?.startsWith('step-')).map(row => row.text)).toEqual(['1. 준비', '2. 화면 만들기', '3. 올리기'])
  const icons = await ui.findAll({ type: 'Svg' })
  expect(icons.map(icon => icon.props.alt)).toEqual(['1단계 완료', '2단계 진행 중', '3단계 대기'])
  expect(String(icons[1]?.props.source)).toContain('#e3b341')
  expect((await ui.findAll({ type: 'Text', text: /지금 여기/ })).length).toBe(1)
  await ui.unmount()
})

test('progress T2c 막힘은 지금 단계에만 — 시작 안 한 단계는 대기, 답 대기·시험 실패면 지금 단계가 막힘', async ($, on) => {
  const states = (steps: string[]) =>
    deriveStages(parsePlan({ slug: 'a', ...plan({ title: 'p', status: 'in_progress', steps }) })).stages.map(s => s.state)
  expect(states(['[x] a', '[!] b', 'c'])).toEqual(['done', 'blocked', 'waiting'])
  expect(states(['[x] a', 'b', '[!] c'])).toEqual(['done', 'doing', 'waiting'])
  expect(applyBlocks([st('a', 'done'), st('b', 'doing')], [{ kind: 'waiting', title: '', detail: '' }]).map(s => s.state)).toEqual(['done', 'blocked'])
  expect(applyBlocks([st('a', 'done'), st('b', 'doing')], []).map(s => s.state)).toEqual(['done', 'doing'])

  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] a', 'b', 'c'] }) })
  const seen: string[] = []
  on('tool.call', async () => {
    seen.push(await drawnText($))
    return { result: { answers: {} } }
  })
  await start($)
  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'Q?', header: 'h', multiSelect: false, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }],
  })
  expect(seen[0]).toContain('2단계 막힘')
  expect(seen[0]).toContain('막힘  ◀ 지금 여기')
  expect(seen[0]).toContain('3단계 대기')
})

test('progress T3 표시가 없으면 계획 상태로 짐작하고 추정을 붙인다', async ($, on) => {
  const states = (status: string) =>
    deriveStages(parsePlan({ slug: 'a', ...plan({ title: 'p', status, steps: ['a', 'b', 'c'] }) })).stages.map(s => s.state)
  expect(states('planned')).toEqual(['waiting', 'waiting', 'waiting'])
  expect(states('in_progress')).toEqual(['doing', 'waiting', 'waiting'])
  expect(states('done')).toEqual(['done', 'done', 'done'])

  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a', 'b'] }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /\(추정\)/)).toBe('단계 흐름 (추정)')
  await ui.unmount()
})

test('progress T4 내 답을 기다리면 막힘 카드, 답이 오면 사라짐', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a'] }) })
  const seen: (string | undefined)[] = []
  on('tool.call', async () => {
    seen.push(await drawnText($))
    return { result: { answers: {} } }
  })
  await start($)

  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'X 할까요?', header: 'h', multiSelect: false, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }],
  })
  expect(seen[0]).toContain('답을 기다리는 중')
  expect(seen[0]).toContain('X 할까요?')
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(after, /답을 기다리는 중/)).toBeUndefined()
  await after.unmount()
})

test('progress T5 시험이 실패하면 막힘 카드에 실패한 시나리오', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'testing', steps: ['a'], tests: ['one', 'two'] }) })
  on('tool.call', () => ({ isError: true, result: {}, text: 'Exit code 1\n(pass) T1 one\n(fail) T2 two' }))
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm run verify-dashboard' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^시험 실패$/)).toBe('시험 실패')
  expect(await text(ui, /^T2/)).toContain('T2')
  await ui.unmount()
})

test('progress T6 시험 결과 목록은 시나리오마다 통과·실패·결과 없음', async ($, on) => {
  const parsed = parsePlan({ slug: 'a', ...plan({ title: 'p', status: 'testing', steps: ['a'], tests: ['one', 'two', 'three'] }) })
  const run = parseTestOutput('npm run verify-dashboard', '(pass) T1 one\n(fail) T2 two', false, 0)
  expect(mergeTests(parsed, run).map(row => row.result)).toEqual(['pass', 'fail', 'none'])

  engine(on, { a: plan({ title: 'p', status: 'testing', steps: ['a'], tests: ['one', 'two', 'three'] }) })
  on('tool.call', () => ({ isError: true, result: {}, text: '(pass) T1 one\n(fail) T2 two' }))
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm run verify-dashboard' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tests-toggle' })

  expect(await text(ui, /^T1 one/)).toBe('T1 one — 통과')
  expect(await text(ui, /^T2 two/)).toBe('T2 two — 실패')
  expect(await text(ui, /^T3 three/)).toBe('T3 three — 결과 없음')
  await ui.unmount()
})

test('progress T7 단계를 누르면 그 단계가 만드는 역할(파이프라인)과 한 일이 보인다', async ($, on) => {
  const pipeline = ['`parsePlans` | 계획서 글을 읽어 제목·상태·단계 목록으로 정리한다 | 글 → Plan[] | 순수', '`render` | 정리된 값을 오른쪽 칸 화면으로 그린다 | View → 화면 | 부수효과 (출구)']
  const steps = ['[x] 파싱 만들기 — `parsePlans`', '화면 그리기 — `render`']
  const parsed = parsePlan({ slug: 'a', ...plan({ title: 'p', status: 'in_progress', steps, pipeline }) })
  expect(parsed.steps.map(step => step.name)).toEqual(['파싱 만들기', '화면 그리기'])
  expect(stageRole({ ...st('파싱 만들기', 'done'), refs: ['parsePlans'] }, parsed.pipeline)).toEqual([
    { name: 'parsePlans', role: '계획서 글을 읽어 제목·상태·단계 목록으로 정리한다', io: '글 → Plan[]', kind: '순수' },
  ])
  expect(describeRole({ name: 'x', role: '', io: '글 → Plan[]', kind: '순수' })).toBe('받음: 글 · 내놓음: Plan[]')

  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps, pipeline }) })
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/work/hooks/view.tsx', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^2\. 화면 그리기 — /)).toBe('2. 화면 그리기 — 진행 중')
  expect(await text(ui, /^• /)).toBe('• 정리된 값을 오른쪽 칸 화면으로 그린다')
  expect(await text(ui, /render|부수효과|순수/)).toBeUndefined()
  expect(await text(ui, /^Edit: view\.tsx$/)).toBe('Edit: view.tsx')

  await ui.press({ key: 'step-1' })
  expect(await text(ui, /^1\. 파싱 만들기 — /)).toBe('1. 파싱 만들기 — 완료')
  expect(await text(ui, /^• /)).toBe('• 계획서 글을 읽어 제목·상태·단계 목록으로 정리한다')
  expect(await text(ui, /이 세션에서 기록된 일 없음/)).toBe('이 세션에서 기록된 일 없음')

  await ui.press({ key: 'step-1' })
  expect(await text(ui, /^1\. 파싱 만들기 — /)).toBeUndefined()
  await ui.unmount()
})

test('progress T7b 단계 줄 끝 글 꼬리는 그 단계의 하는 일, 백틱 꼬리는 표와 잇고, 꼬리가 없으면 단계 줄 자체 — 옛 계획서도 못 찾음 문구 없음', async ($, on) => {
  const pipeline = ['`render` | 정리된 값을 오른쪽 칸 화면으로 그린다 | View → 화면 | 부수효과 (출구)']
  const steps = ['화면 그리기 — `render`', '시나리오: 비싸요 갈래 — 특약 빼기 제안 · 동의 · 거절 흐름을 시나리오에 넣는다', '녹음']
  const parsed = parsePlan({ slug: 'a', ...plan({ title: 'p', status: 'in_progress', steps, pipeline }) })
  expect(parsed.steps.map(({ name, refs, role }) => ({ name, refs, role }))).toEqual([
    { name: '화면 그리기', refs: ['render'], role: undefined },
    { name: '시나리오: 비싸요 갈래', refs: [], role: '특약 빼기 제안 · 동의 · 거절 흐름을 시나리오에 넣는다' },
    { name: '녹음', refs: [], role: undefined },
  ])

  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps, pipeline }) })
  on('tool.call', () => ({ result: {} }))
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^• /)).toBe('• 정리된 값을 오른쪽 칸 화면으로 그린다')
  await ui.press({ key: 'step-2' })
  expect(await text(ui, /^2\. /)).toBe('2. 시나리오: 비싸요 갈래 — 대기')
  expect(await text(ui, /^• /)).toBe('• 특약 빼기 제안 · 동의 · 거절 흐름을 시나리오에 넣는다')
  await ui.press({ key: 'step-3' })
  expect(await text(ui, /^• /)).toBe('• 녹음')
  expect(await text(ui, /찾지 못했습니다/)).toBeUndefined()
  await ui.unmount()
})

test('progress T8 계획이 여러 개면 선택 항목으로 고른다', async ($, on) => {
  engine(on, {
    '20261022-a': plan({ title: '진행 중 계획', status: 'in_progress', steps: ['a'] }),
    '20261022-b': plan({ title: '대기 계획', status: 'planned', steps: ['a'] }),
  })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Select', key: 'plan' }))?.props.value).toBe('20261022-a')
  expect(await text(ui, /^상태: /)).toBe('상태: 만드는 중')
  await ui.select({ key: 'plan', value: '20261022-b' })
  expect((await ui.find({ type: 'Select', key: 'plan' }))?.props.value).toBe('20261022-b')
  expect(await text(ui, /^상태: /)).toBe('상태: 시작 전')
  await ui.unmount()
})

test('progress T9 세션 시작 때 열리고, 닫혀 있으면 다음 메시지 때 다시 열림', async ($, on) => {
  const { opened, panes } = engine(on, {})
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await start($)
  expect(opened).toEqual(['scv-dashboard'])
  await $.prompt.submit(typed('hi'))
  expect(opened).toEqual(['scv-dashboard', 'scv-dashboard'])
  panes.push({ id: 'scv-dashboard' })
  await $.prompt.submit(typed('again'))
  expect(opened).toEqual(['scv-dashboard', 'scv-dashboard'])
})

test('progress T10 프로젝트 파일을 쓰지 않는다', async ($, on) => {
  const writes: string[] = []
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a'] }) })
  on('fs.write', (_, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: { stdout: '(pass) T1', stderr: '' } }))
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'step-1' })
  await ui.press({ key: 'dreams-report' })
  await ui.unmount()

  expect(writes).toEqual([])
})

test('progress T11 계획이 없으면 확인한 폴더 경로를 보여 준다', async ($, on) => {
  engine(on, {})
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /진행 중인 SCV 계획이 없습니다/)).toContain('계획이 없습니다')
  expect(await text(ui, /^확인한 곳/)).toBe('확인한 곳: /work/scv/promote')
  await ui.unmount()
})

test('progress T12 맨 위 한 줄 요약 · 상태 쉬운 말 · 다음 할 일과 명령 복사', async ($, on) => {
  const stages = [st('a', 'done'), st('b', 'doing')]
  expect(headline([...stages], [], { kind: 'unknown' }, String)).toBe('2단계 진행 중 · 막힘 없음 · 남은 시간 추정 불가')
  expect(statusWords('testing', [{ name: 'a', state: 'done', refs: [] }])).toBe('단계 끝 · 시험 확인 중')
  expect(statusWords('in_progress', [...stages])).toBe('만드는 중')
  expect(nextAction('s', 'in_progress', [...stages], [{ kind: 'waiting', title: '', detail: '' }]).text).toBe('Claude가 묻고 있어요 — 대화창에서 답하기')
  expect(nextAction('s', 'planned', [], [])).toEqual({ text: '시작하기', command: '/scv:work s' })

  const { copies } = engine(on, { a: plan({ title: 'p', status: 'testing', steps: ['[x] a', '[x] b'] }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^모든 단계 끝 · /)).toBe('모든 단계 끝 · 막힘 없음 · 남은 단계 없음')
  expect(await text(ui, /^상태: /)).toBe('상태: 단계 끝 · 시험 확인 중')
  expect(await text(ui, /^다음: /)).toBe('다음: 모든 단계 끝 — 보관하기')
  await ui.press({ key: 'next-copy' })
  expect(copies).toEqual(['/scv:work a --archive'])
  expect(await text(ui, /^복사함/)).toBe('복사함: /scv:work a --archive')
  await ui.unmount()
})

test('progress T13 시험 결과는 세션을 넘어 기억된다 (모드 전용 저장소)', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'testing', steps: ['a'], tests: ['one'] }) })
  store.set('runs:/work', [{ command: 'npm run verify-dashboard', isOk: true, at: 1_000_000 - 7_200_000, byId: { T1: 'pass' }, failLines: [] }])
  on('tool.call', () => ({ result: { stdout: '(pass) T1 one', stderr: '' } }))
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^마지막 실행/)).toBe('마지막 실행: 통과 · 2시간 0분 전')
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'npm run verify-dashboard' })
  expect((store.get('runs:/work') as unknown[]).length).toBe(2)
})

test('progress T14 답 대기·시험 실패 때 알림 한 번, 앱에 알림 통로가 없으면 시스템 알림', async ($, on) => {
  const { notices, processes, notify } = engine(on, { a: plan({ title: 'p', status: 'testing', steps: ['a'], tests: ['one', 'two'] }) })
  on('tool.call', (_, e) =>
    e.tool === 'Bash' ? { isError: true, result: {}, text: '(fail) T2 two' } : { result: { answers: {} } },
  )
  await start($)
  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'Q?', header: 'h', multiSelect: false, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }],
  })
  await $.tool.call({ tool: 'Bash', command: 'npm run verify-dashboard' })
  expect(notices).toEqual(['답을 기다리는 중 — Q?', '시험 실패 — T2'])
  expect(processes).toEqual([])

  notify.isSent = false
  await $.tool.call({ tool: 'Bash', command: 'npm run verify-dashboard' })
  expect(processes[0]?.[0]).toBe('osascript')
})

test('progress T15 진행률 막대도 신호등 색', () => {
  const st2 = (state: 'done' | 'doing' | 'blocked' | 'waiting') => ({ name: 'x', state, refs: [] })
  expect(barColor([st2('done'), st2('done')], [])).toBe('#3fb950')
  expect(barColor([st2('done'), st2('doing')], [])).toBe('#e3b341')
  expect(barColor([st2('doing')], [{ kind: 'test', title: '', detail: '' }])).toBe('#f85149')
})

test('progress T16 진행 중 계획이 없으면 최근 보관한 계획을 끝난 계획으로 보여 준다', async ($, on) => {
  engine(on, {}, DREAMS, { at: 1_000_000 }, {
    '20261020-old': plan({ title: '예전 계획', status: 'done', steps: ['[x] a'] }),
    '20261022-new': plan({ title: '최근 계획', status: 'done', steps: ['[x] a', '[x] b'] }),
  })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /최근 끝난 계획/)).toBe('진행 중인 계획이 없어 최근 끝난 계획을 보여 줍니다.')
  expect((await ui.find({ type: 'Select', key: 'plan' }))?.props.value).toBe('20261022-new')
  expect(await text(ui, /^상태: /)).toBe('상태: 보관됨')
  expect(await text(ui, /^2\/2$/)).toBe('2/2')
  expect(await text(ui, /^다음: /)).toBe('다음: 끝난 계획 — 할 일 없음')
  expect(await text(ui, /계획이 없습니다/)).toBeUndefined()
  await ui.unmount()
})

// ── live plan ────────────────────────────────────────────────────────────────

test('live T1 진행 중 카드에 지금 단계 이름 + 도구 + 대상 파일', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] 준비', '화면 만들기'] }) })
  const seen: (string | undefined)[] = []
  on('tool.call', async () => {
    seen.push(await drawnText($))
    return { result: {} }
  })
  await start($)
  await $.tool.call({ tool: 'Edit', file_path: '/work/hooks/register.tsx', old_string: 'a', new_string: 'b' })

  expect(seen[0]).toContain('단계: 화면 만들기')
  expect(seen[0]).toContain('Edit: register.tsx')
})

test('live T2 차례가 시작되면 일하는 중, 끝나면 쉬는 중', async ($, on) => {
  const { clock } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a'] }) })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '', reason: 'answer' as const }))
  await start($)

  await $.turn.start({ text: 'hi', turnId: 't1' })
  clock.at += 65_000
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const working = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(working, /^일하는 중/)).toBe('일하는 중 · 1분 5초')
  await working.unmount()

  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
  const resting = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(resting, /^쉬는 중$/)).toBe('쉬는 중')
  await resting.unmount()
})

test('live T3 Bash 는 설명을 먼저, 없으면 명령 앞부분만', () => {
  expect(describeTool('Bash', { command: 'npm test', description: 'Run the tests' })).toBe('Run the tests')
  const long = describeTool('Bash', { command: 'x'.repeat(200) })
  expect(long.length).toBeLessThanOrEqual(60)
  expect(long.endsWith('…')).toBe(true)
})

test('live T4 할 일 목록 n/N 과 지금 항목', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a'] }) })
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: '파싱', status: 'completed', activeForm: '파싱하는 중' },
      { content: '그리기', status: 'in_progress', activeForm: '그리는 중' },
      { content: '올리기', status: 'pending', activeForm: '올리는 중' },
    ],
  })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^할 일/)).toBe('할 일 1/3 · 그리는 중')
  await ui.unmount()

  const created = applyTaskEvent(applyTaskEvent([], 'TaskCreate', { subject: 'a', description: '' }), 'TaskUpdate', { taskId: '1', status: 'completed' })
  expect(created).toEqual([{ id: '1', subject: 'a', status: 'completed' }])
})

test('live T5 예상 완료 시간은 단계당 평균 × 남은 단계, 추정 표시', async ($, on) => {
  const history = [
    { slug: 'a', done: 0, at: 0 },
    { slug: 'a', done: 1, at: 4 * 60_000 },
    { slug: 'a', done: 2, at: 10 * 60_000 },
  ]
  expect(estimateEta(history, 'a', 3)).toEqual({ kind: 'estimate', ms: 15 * 60_000, basis: 2 })

  const steps = ['a', 'b', 'c', 'd', 'e']
  const files = { a: plan({ title: 'p', status: 'in_progress', steps }) }
  const { clock } = engine(on, files)
  await start($)
  for (const [done, minutes] of [[1, 4], [2, 10]] as const) {
    files.a = plan({ title: 'p', status: 'in_progress', steps: steps.map((step, i) => (i < done ? `[x] ${step}` : step)) })
    clock.at = 1_000_000 + minutes * 60_000
    await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^예상 완료 시간/)).toBe('예상 완료 시간: 약 15분 0초 남음 (추정 · 단계 2개 평균)')
  await ui.unmount()
})

test('live T6 자료가 없으면 아직 추정 불가', async ($, on) => {
  expect(estimateEta([], 'a', 3)).toEqual({ kind: 'unknown' })
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a', 'b'] }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^예상 완료 시간/)).toBe('예상 완료 시간: 아직 추정 불가')
  await ui.unmount()
})

test('live T7 지난 시간 글자 형식', () => {
  expect(formatDuration(130_000)).toBe('2분 10초')
  expect(formatDuration(5_000)).toBe('5초')
  expect(formatDuration(3_720_000)).toBe('1시간 2분')
})

// ── dreams plan ──────────────────────────────────────────────────────────────

test('dreams T1 최신 드림 요약 한 줄과 날짜', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a'] }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^아직 셀 것이 없음/)).toBe('아직 셀 것이 없음(보관된 계획 0개)')
  expect(await text(ui, /^2026-10-22$/)).toBe('2026-10-22')
  await ui.unmount()
})

test('dreams T2 개선점 펼치기', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a'] }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /개선점: 완료 기준/)).toBeUndefined()
  await ui.press({ key: 'dreams-toggle' })
  expect(await text(ui, /개선점: 완료 기준/)).toBe('· 개선점: 완료 기준 비율 0/7(0%)')
  await ui.press({ key: 'dreams-toggle' })
  expect(await text(ui, /개선점: 완료 기준/)).toBeUndefined()
  await ui.unmount()
})

test('dreams T3 보고서 열기 버튼이 보고서 전체 경로로 브라우저를 연다', async ($, on) => {
  const { processes } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a'] }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dreams-report' })

  expect(processes).toEqual([['xdg-open', '/work/scv/dreams/x.html']])
  await ui.unmount()
})

test('dreams T4 드림이 없으면 안내', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a'] }) }, null)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /아직 드림 없음/)).toBe('아직 드림 없음 — /scv:dreams 로 만들 수 있습니다.')
  await ui.unmount()
})

test('dreams T5 parseDreams 는 앞머리를 떼고 · 로 나눈다', () => {
  expect(parseDreams(DREAMS)).toEqual({
    date: '2026-10-22',
    items: ['아직 셀 것이 없음(보관된 계획 0개)', '개선점: 완료 기준 비율 0/7(0%)'],
    reportPath: 'scv/dreams/x.html',
  })
  expect(parseDreams(null)).toBeUndefined()

  // The real summary carries ' · ' inside parentheses too.
  const real = JSON.stringify({
    date: '20261022',
    summary: '[SCV 드림] 아직 셀 것이 없음(보관된 계획 0개 · 사람 질의 9번) · 개선점: 요청에 완료 기준(무엇이 되면 끝인지)을 직접 말한 비율 0/7(0%) · 보고서 scv/dreams/r.html',
    report: 'scv/dreams/r.html',
  })
  expect(parseDreams(real)?.items).toEqual([
    '아직 셀 것이 없음(보관된 계획 0개 · 사람 질의 9번)',
    '개선점: 요청에 완료 기준(무엇이 되면 끝인지)을 직접 말한 비율 0/7(0%)',
  ])
})

// ── step-signal plan ─────────────────────────────────────────────────────────

const FIVE = ['a', 'b', 'c', 'd', 'e']

const COMPOSE = { model: 'claude-test', promptModel: 'claude-test', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] } as const

const signal = ($: Engine, step: number, state: string, note?: string, slug = 'a') =>
  $.tool.call({ tool: STEP_TOOL, plan: slug, step, state, ...(note ? { note } : {}) } as never) as Promise<{ deny?: string; result?: unknown }>

test('step-signal T1 단계 끝 신호를 받으면 진행률이 1 오른다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  const answered = await signal($, 1, 'done')
  expect(answered.deny).toBeUndefined()
  expect(String(answered.result)).toContain('1/5')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^1\/5$/)).toBe('1/5')
  expect(await text(ui, /^완료 \d/)).toBe('완료 1 · 진행 1 · 막힘 0 · 대기 3 — 단계를 누르면 자세히')
  expect(await text(ui, /지금 여기/)).toBe('진행 중  ◀ 지금 여기')
  expect(await text(ui, /^단계: /)).toBe('단계: b')
  await ui.unmount()
})

test('step-signal T2 계획서 표시와 신호를 합친다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] a', 'b', 'c', 'd', 'e'] }) })
  await start($)
  await signal($, 2, 'done')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^2\/5$/)).toBe('2/5')
  expect(await text(ui, /^단계: /)).toBe('단계: c')
  await ui.unmount()

  const merged = mergeMarks(parsePlan({ slug: 'a', ...plan({ title: 'p', status: 'in_progress', steps: ['[x] a', '[!] b', 'c'] }) }), [
    { plan: 'a', step: 1, state: 'doing', note: '', at: 0 },
    { plan: 'a', step: 2, state: 'done', note: '', at: 0 },
  ])
  expect(merged.steps.map(step => step.mark)).toEqual(['done', 'done', undefined])
})

test('step-signal T3 틀린 신호는 거절하고 이유를 돌려준다', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  await signal($, 1, 'done')

  expect((await signal($, 1, 'done', undefined, 'nope')).deny).toContain('그런 진행 중 계획이 없습니다: nope')
  expect((await signal($, 9, 'done')).deny).toContain('단계는 1~5')
  expect((await signal($, 4, 'blocked', '막힘')).deny).toContain('막힘은 지금 단계(2번)에만')
  expect((await signal($, 4, 'doing')).deny).toContain('진행은 지금 단계(2번)에만')
  expect((await signal($, 2, 'blocked')).deny).toContain('이유(note)')
  expect((await signal($, 2, 'paused')).deny).toContain('doing · done · blocked')
  expect(store.get('signals:/work')).toEqual([{ plan: 'a', step: 1, state: 'done', note: '', at: 1_000_000 }])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^1\/5$/)).toBe('1/5')
  await ui.unmount()
})

test('step-signal T3b 한꺼번에 온 신호도 모두 남는다', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  await Promise.all([signal($, 1, 'done'), signal($, 2, 'done'), signal($, 3, 'done')])

  expect((store.get('signals:/work') as { step: number }[]).map(one => one.step).sort()).toEqual([1, 2, 3])
})

test('step-signal T4 막힘 신호는 지금 단계를 빨강으로, 막힌 작업 카드에 이유', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  await signal($, 1, 'done')
  await signal($, 2, 'blocked', '시험 실패 — T3')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /지금 여기/)).toBe('막힘  ◀ 지금 여기')
  expect(await text(ui, /^막힌 작업/)).toBe('막힌 작업 1')
  expect(await text(ui, /시험 실패 — T3/)).toBe('b — 시험 실패 — T3')
  await ui.unmount()

  // the step moves on once the block is lifted
  await signal($, 2, 'doing')
  const after = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(after, /지금 여기/)).toBe('진행 중  ◀ 지금 여기')
  expect(await text(after, /^막힌 작업/)).toBeUndefined()
  await after.unmount()
})

test('step-signal T5 예상 완료 시간을 신호 시각으로 계산한다', async ($, on) => {
  const signals = [1, 2, 3].map((step, i) => ({ plan: 'a', step, state: 'done' as const, note: '', at: i * 10 * 60_000 }))
  const durations = stepDurationsFromSignals(signals, 'a')
  expect(durations).toEqual([10 * 60_000, 10 * 60_000])
  expect(estimateFromDurations(durations, 2)).toEqual({ kind: 'estimate', ms: 20 * 60_000, basis: 2 })

  const { clock } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  for (const step of [1, 2, 3]) {
    clock.at = 1_000_000 + (step - 1) * 10 * 60_000
    await signal($, step, 'done')
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^예상 완료 시간/)).toBe('예상 완료 시간: 약 20분 0초 남음 (추정 · 단계 2개 평균)')
  await ui.unmount()
})

test('step-signal T5b 단계 시간은 시작 신호부터 재고, 한꺼번에 보고한 끝은 시간으로 치지 않는다', async ($, on) => {
  let kept = applySignal([], { plan: 'a', step: 1, state: 'doing' }, 0)
  kept = applySignal(kept, { plan: 'a', step: 1, state: 'done' }, 10 * 60_000)
  expect(kept).toEqual([{ plan: 'a', step: 1, state: 'done', note: '', at: 10 * 60_000, startedAt: 0 }])
  kept = applySignal(kept, { plan: 'a', step: 2, state: 'done' }, 10 * 60_000 + 5_000)
  kept = applySignal(kept, { plan: 'a', step: 3, state: 'done' }, 10 * 60_000 + 6_000)
  expect(stepDurationsFromSignals(kept, 'a')).toEqual([10 * 60_000])

  const { clock } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  await signal($, 1, 'doing')
  clock.at += 10 * 60_000
  await signal($, 1, 'done')
  for (const step of [2, 3]) {
    clock.at += 1_000
    await signal($, step, 'done')
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^예상 완료 시간/)).toBe('예상 완료 시간: 약 20분 0초 남음 (추정 · 단계 1개 평균)')
  await ui.unmount()
})

test('step-signal T6 진행 중 계획이 있을 때만 Claude 지시가 붙는다', async ($, on) => {
  const active = parsePlan({ slug: 'a', ...plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  const archived = { ...parsePlan({ slug: 'z', ...plan({ title: 'z', status: 'done', steps: FIVE }), isArchived: true }) }
  expect(buildStepPrompt([archived])).toBeNull()
  expect(buildStepPrompt([active])).toContain('a (5 steps)')
  expect(buildStepPrompt([active])).toContain(STEP_TOOL)

  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  await start($)
  const composed = await $.prompt.compose(COMPOSE)
  const added = composed.sections.find(section => section.id === 'scv-dashboard:step-signal')
  expect(added?.scope).toBe('session')
  expect(added?.text).toContain('a (5 steps)')
  expect(composed.sections[0]?.id).toBe('intro')
})

test('step-signal T6b 보관된 계획만 있으면 Claude 지시를 붙이지 않는다', async ($, on) => {
  engine(on, {}, DREAMS, { at: 1_000_000 }, { z: plan({ title: 'z', status: 'done', steps: FIVE }) })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  await start($)
  const composed = await $.prompt.compose(COMPOSE)

  expect(composed.sections.map(section => section.id)).toEqual(['intro'])
})

test('step-signal T7 신호 도구는 허락 창을 띄우지 않는다, 다른 도구 판단은 그대로', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('tool.check', () => ({ decision: 'ask' as const }))
  await start($)

  expect((await $.tool.check({ tool: STEP_TOOL, input: {} })).decision).toBe('allow')
  expect((await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf x' } })).decision).toBe('ask')
})

test('step-signal T8 세션을 새로 열어도 신호가 이어진다', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  store.set('signals:/work', [
    { plan: 'a', step: 1, state: 'done', note: '', at: 1 },
    { plan: 'a', step: 2, state: 'done', note: '', at: 2 },
  ])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^2\/5$/)).toBe('2/5')
  await ui.unmount()
})

test('step-signal T8b 세션이 하위 폴더에서 열려도 가장 가까운 scv 폴더의 계획을 따른다', async ($, on) => {
  expect(ancestorsOf('/work/marketplace/mods')).toEqual(['/work/marketplace/mods', '/work/marketplace', '/work', '/'])
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('session.root', () => ({ value: '/work/marketplace/mods/scv-dashboard' }))
  await $.session.start({ cwd: '/work/marketplace/mods/scv-dashboard', surface: 'desktop', isInteractive: true })
  expect((await signal($, 1, 'done')).deny).toBeUndefined()
  expect(store.get('signals:/work')).toHaveLength(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^1\/5$/)).toBe('1/5')
  await ui.unmount()
})

test('step-signal T9 신호도 표시도 없으면 지금처럼 (추정)', async ($, on) => {
  expect(applySignal([], { plan: 'a', step: 1, state: 'doing' }, 5)).toEqual([{ plan: 'a', step: 1, state: 'doing', note: '', at: 5 }])
  expect(checkSignal({ plan: 'a', step: 1, state: 'doing' }, [], [])).toEqual({ isOk: false, reason: '그런 진행 중 계획이 없습니다: a — 진행 중: 없음' })

  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^단계 흐름/)).toBe('단계 흐름 (추정)')
  expect(await text(ui, /^0\/5$/)).toBe('0/5')
  expect(await text(ui, /^예상 완료 시간/)).toBe('예상 완료 시간: 아직 추정 불가')
  await ui.unmount()
})

// ── alerts plan ──────────────────────────────────────────────────────────────

const turnEngine = (on: On) => {
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '', reason: 'answer' as const }))
}

const turnEnd = ($: Engine, reason: string, durationMs: number, agentId?: string) =>
  $.turn.complete({ turnId: 't1', answer: '', durationMs, isAborted: reason === 'aborted', reason, ...(agentId ? { agentId } : {}) } as never)

test('alerts T1 2분 넘게 걸린 메인 차례가 답으로 끝나면 끝 알림', async ($, on) => {
  expect(classifyTurnEnd('answer', 192_000)).toEqual({ kind: 'done' })
  const { notices } = engine(on, { a: plan({ title: '대시보드', status: 'in_progress', steps: FIVE }) })
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await turnEnd($, 'answer', 192_000)

  expect(notices).toHaveLength(1)
  expect(notices[0]).toContain('끝났어요')
  expect(notices[0]).toContain('3분 12초')
  expect(notices[0]).toContain('대시보드 0/5')
})

test('alerts T2 2분 안에 끝난 차례는 알리지 않는다', async ($, on) => {
  expect(classifyTurnEnd('answer', 119_000)).toEqual({ kind: 'none' })
  const { notices } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await turnEnd($, 'answer', 119_000)

  expect(notices).toEqual([])
})

test('alerts T3 오류로 끝나면 바로 알리고 칸에 빨간 멈춤 — 오류, 다음 차례에 사라진다', async ($, on) => {
  const { notices } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await turnEnd($, 'error', 5_000)
  expect(notices).toHaveLength(1)
  expect(notices[0]).toContain('오류로 멈춤')

  const stopped = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(stopped, /^멈춤 — 오류$/)).toBe('멈춤 — 오류')
  expect(await text(stopped, /^다음: /)).toBe('다음: 멈췄어요 — 대화창에서 다시 시키기')
  await stopped.unmount()

  await $.turn.start({ text: 'again', turnId: 't2' })
  const resumed = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(resumed, /멈춤/)).toBeUndefined()
  await resumed.unmount()
})

test('alerts T4 답을 거절하고 끝나면 거절로 멈춤', async ($, on) => {
  const { notices } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await turnEnd($, 'refusal', 3_000)
  expect(notices[0]).toContain('거절로 멈춤')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^멈춤 — 거절$/)).toBe('멈춤 — 거절')
  await ui.unmount()
})

test('alerts T5 사용자가 멈춘 차례는 알리지 않는다', async ($, on) => {
  expect(classifyTurnEnd('aborted', 600_000)).toEqual({ kind: 'none' })
  const { notices } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await turnEnd($, 'aborted', 600_000)
  expect(notices).toEqual([])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /멈춤/)).toBeUndefined()
  await ui.unmount()
})

test('alerts T6 하위 에이전트의 차례가 끝나도 칸은 일하는 중, 알림 없음', async ($, on) => {
  expect(isMainLoop({ agentId: 'ag1' })).toBe(false)
  expect(isMainLoop({})).toBe(true)
  const { notices } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.start({ text: 'look around', turnId: 'a1', agentId: 'ag1' } as never)
  await $.turn.complete({ turnId: 'a1', answer: '', durationMs: 180_000, isAborted: false, reason: 'answer', agentId: 'ag1' } as never)

  expect(notices).toEqual([])
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^일하는 중/)).toBe('일하는 중 · 0초')
  await ui.unmount()
})

test('alerts T7 허락 창이 뜨면 허락 기다림을 보이고 알린다, 도구가 끝나면 사라진다', async ($, on) => {
  expect(permissionWaitOf('Bash', { command: 'npm test' }, 5)).toEqual({ tool: 'Bash', target: 'npm test', at: 5 })
  const { notices } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  on('classic.PermissionRequest', () => ({}))
  await start($)

  // the prompt is shown while the Bash call waits; the call then runs and ends
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } } as never)
  const waitingFor = await drawnText($)
  expect(waitingFor).toContain('허락 기다림 — Bash: npm test')
  expect(waitingFor).toContain('Claude가 허락을 기다려요')
  expect(notices).toContain('허락 기다림 — Bash: npm test')

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(await drawnText($)).not.toContain('허락 기다림')
})

test('alerts T7b 설정 훅이 이미 답한 허락 요청은 창이 없으니 기다림도 없다', async ($, on) => {
  const { notices } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' as const } }))
  await start($)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'ls' } } as never)

  expect(await drawnText($)).not.toContain('허락 기다림')
  expect(notices).toEqual([])
})

test('alerts T8 허락을 거절해도 허락 기다림이 사라진다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('tool.call', () => ({ deny: '사용자가 거절함' }))
  on('classic.PermissionRequest', () => ({}))
  await start($)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } } as never)
  expect(await drawnText($)).toContain('허락 기다림 — Bash: rm -rf build')

  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(await drawnText($)).not.toContain('허락 기다림')
})

test('alerts T9 모든 알림이 Claude 자체 알림 도구로도 간다, 실패해도 다른 길은 그대로', async ($, on) => {
  expect(buildAlertText(['a'.repeat(300)]).length).toBeLessThanOrEqual(200)
  expect(buildAlertText(['끝났어요', '3분\n12초', null])).toBe('끝났어요 · 3분 12초')

  const { notices } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  const pushes: string[] = []
  let isPushDown = false
  on('tool.call', (_, e) => {
    if (e.tool === 'PushNotification') {
      if (isPushDown) throw new Error('no such tool')
      pushes.push(String((e as { message?: string }).message))
    }
    return { result: {} }
  })
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await turnEnd($, 'error', 1_000)
  expect(pushes).toHaveLength(1)
  expect(pushes[0]?.startsWith('SCV: ')).toBe(true)
  expect(pushes[0]?.length).toBeLessThanOrEqual(200)
  expect(pushes[0]).not.toContain('\n')

  isPushDown = true
  await $.turn.start({ text: 'go', turnId: 't2' })
  await turnEnd($, 'error', 1_000)
  expect(notices).toHaveLength(2)
  expect(await drawnText($)).toContain('멈춤 — 오류')
})

test('alerts T10 지금 있는 알림(답 기다림 · 시험 실패)도 같은 길로 간다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'testing', steps: ['a'], tests: ['one', 'two'] }) })
  const pushes: string[] = []
  on('tool.call', (_, e) => {
    if (e.tool === 'PushNotification') pushes.push(String((e as { message?: string }).message))
    return e.tool === 'Bash' ? { isError: true, result: {}, text: '(fail) T2 two' } : { result: { answers: {} } }
  })
  await start($)
  await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [{ question: 'Q?', header: 'h', multiSelect: false, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }],
  })
  await $.tool.call({ tool: 'Bash', command: 'npm run verify-dashboard' })

  expect(pushes).toEqual(['SCV: 답을 기다리는 중 — Q?', 'SCV: 시험 실패 — T2'])
})

// ── work-view plan ───────────────────────────────────────────────────────────

const ASK = {
  tool: 'AskUserQuestion' as const,
  questions: [{ question: 'Q?', header: 'h', multiSelect: false, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }],
}

const spawn = ($: Engine, description: string) =>
  $.agent.spawn({ tool_use_id: `u-${description}`, prompt: 'look', description, subagentType: 'Explore', parentModel: 'm', background: false, fork: false } as never)

const agentTool = ($: Engine, agentId: string, tool: string, input: Record<string, unknown>) =>
  $.tool.call({ tool, ...input, agentId } as never)

const agentEngine = (on: On) => on('agent.spawn', (_, e) => ({ model: 'm', agentId: `ag-${(e as { description: string }).description}` }))

test('work-view T1 메시지 뒤에 생긴 일을 세 줄로 요약한다', async ($, on) => {
  const { clock } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  let bashRuns = 0
  const seen: string[] = []
  on('tool.call', async (_, e) => {
    if (e.tool === 'Bash') {
      bashRuns += 1
      return bashRuns === 1 ? { isError: true, result: {}, text: '(fail) T1' } : { result: { stdout: '(pass) T1', stderr: '' } }
    }
    if (e.tool === 'AskUserQuestion') seen.push(await drawnText($))
    return { result: { answers: {} } }
  })
  await start($)
  await $.prompt.submit(typed('계속해'))
  clock.at += 60_000
  await signal($, 1, 'done')
  await signal($, 2, 'done')
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call(ASK)

  expect(seen[0]).toContain('단계 2개 끝 — a, b')
  expect(seen[0]).toContain('시험 2번 — 실패 1번 뒤 통과')
  expect(seen[0]).toContain('질문 1개 기다림')
})

test('work-view T2 메시지를 새로 보내면 요약이 비고 카드가 숨겨진다', async ($, on) => {
  const { clock } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {} }))
  await start($)
  await $.prompt.submit(typed('계속해'))
  clock.at += 60_000
  await signal($, 1, 'done')
  expect(await drawnText($)).toContain('그 사이')

  clock.at += 60_000
  await $.prompt.submit(typed('다음'))
  expect(await drawnText($)).not.toContain('그 사이')
})

test('work-view T3 그 사이 아무 일도 없으면 카드가 없다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await start($)
  expect(await drawnText($)).not.toContain('그 사이')
  await $.prompt.submit(typed('계속해'))

  expect(await drawnText($)).not.toContain('그 사이')
})

test('work-view T4 메시지를 보내기 전 일은 들어가지 않는다', async ($, on) => {
  const { clock } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: { stdout: '(pass) T1', stderr: '' } }))
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  clock.at += 60_000
  await $.prompt.submit(typed('계속해'))
  clock.at += 60_000
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  expect(await drawnText($)).toContain('시험 1번 — 모두 통과')
})

test('work-view T5 오류 멈춤과 허락 기다림도 셋째 줄에 나온다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('classic.PermissionRequest', () => ({}))
  turnEngine(on)
  await start($)
  await $.prompt.submit(typed('계속해'))
  await $.turn.start({ text: '계속해', turnId: 't1' })
  await turnEnd($, 'error', 1_000)
  const halted = await drawnText($)
  expect(halted).toContain('그 사이')
  expect(halted).toContain('오류로 멈춤')

  await $.turn.start({ text: '다시', turnId: 't2' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm test' } } as never)
  expect(await drawnText($)).toContain('허락 기다림 — Bash')
})

test('work-view T6 에이전트 2개가 동시에 도구를 쓰면 메인 줄과 에이전트 줄 2개가 보인다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  agentEngine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await spawn($, 'A')
  await spawn($, 'B')
  await agentTool($, 'ag-A', 'Grep', { pattern: 'alert' })
  await agentTool($, 'ag-B', 'Bash', { command: 'npm test', description: '시험 돌리기' })
  const drawn = await drawnText($)

  expect(drawn).toContain('단계: a')
  expect(drawn).toContain('A · Grep: alert')
  expect(drawn).toContain('B · Bash: 시험 돌리기')
})

test('work-view T7 에이전트가 끝나면 그 줄이 사라진다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  agentEngine(on)
  turnEngine(on)
  on('tool.call', () => ({ result: {} }))
  await start($)
  await spawn($, 'A')
  await spawn($, 'B')
  await agentTool($, 'ag-A', 'Grep', { pattern: 'alert' })
  await $.turn.complete({ turnId: 'a1', answer: '', durationMs: 1, isAborted: false, reason: 'answer', agentId: 'ag-A' } as never)
  const drawn = await drawnText($)

  expect(drawn).not.toContain('A · Grep')
  expect(drawn).toContain('B · 준비 중')
})

test('work-view T8 에이전트가 6개면 5줄과 +1개 더', async ($, on) => {
  const six = [1, 2, 3, 4, 5, 6].reduce((list, n) => applyAgentEvent(list, { kind: 'start', id: `x${n}`, name: `일꾼 ${n}`, at: 0 }), [] as ReturnType<typeof applyAgentEvent>)
  const lines = agentLines(six, 5_000, formatDuration)
  expect(lines).toHaveLength(6)
  expect(lines[5]).toBe('+1개 더')
  expect(lines[0]).toBe('일꾼 1 · 준비 중 · 5초')

  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  agentEngine(on)
  await start($)
  for (const name of ['1', '2', '3', '4', '5', '6']) await spawn($, name)
  const drawn = await drawnText($)
  expect(drawn).toContain('+1개 더')
  expect(drawn).not.toContain('6 · 준비 중')
})

test('work-view T9 에이전트 안 도구가 메인 줄을 덮어쓰지 않는다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  agentEngine(on)
  const seen: string[] = []
  on('tool.call', async (_, e) => {
    if (e.tool === 'Edit') seen.push(await drawnText($))
    return { result: {} }
  })
  await start($)
  await spawn($, 'A')
  await agentTool($, 'ag-A', 'Read', { file_path: '/work/notes.md' })
  await $.tool.call({ tool: 'Edit', file_path: '/work/view.tsx', old_string: 'a', new_string: 'b' })

  expect(seen[0]).toContain('Edit: view.tsx')
  expect(seen[0]).toContain('A · Read: notes.md')

  await agentTool($, 'ag-A', 'Grep', { pattern: 'x' })
  const after = await drawnText($)
  expect(after).toContain('A · Grep: x')
  // the 'now' line reads '<tool>: <target> · <time>'; the agent's Grep must not become it
  expect(after).not.toContain('"Grep: x ·')
})

// ── prompt-usage plan ────────────────────────────────────────────────────────

const promptEngine = (on: On, draft = '', isFilled = true) => {
  const fills: { text: string; mode?: string }[] = []
  const suggestions: string[] = []
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }) as never)
  on('prompt.fill', (_, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled } as never
  })
  on('prompt.suggest', (_, e) => {
    suggestions.push(e.text)
    return { isShown: true } as never
  })

  return { fills, suggestions }
}

// 17:40 in Seoul (UTC+9) is 08:40 UTC
const KST = 9 * 60
const LIMITS = [
  { kind: 'seven_day', percentUsed: 31, resetsAt: '2026-10-27T01:00:00Z' },
  { kind: 'five_hour', percentUsed: 72, resetsAt: '2026-10-23T08:40:00Z' },
]

test('prompt-usage T1 빈 입력창에 입력창에 넣기를 누르면 다음 명령이 들어간다', async ($, on) => {
  expect(planPromptFill('/scv:work a', '')).toEqual({ text: '/scv:work a', mode: 'replace' })
  engine(on, { a: plan({ title: 'p', status: 'planned', steps: FIVE }) })
  const { fills } = promptEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'next-fill' })

  expect(fills).toEqual([{ text: '/scv:work a', mode: 'replace' }])
  expect(await text(ui, /^입력창에/)).toBe('입력창에 넣음: /scv:work a')
  await ui.unmount()
})

test('prompt-usage T2 입력창에 글이 있으면 지우지 않고 뒤에 붙인다', async ($, on) => {
  expect(planPromptFill('/scv:work a', '이것도 봐 줘 ')).toEqual({ text: '/scv:work a', mode: 'append' })
  engine(on, { a: plan({ title: 'p', status: 'planned', steps: FIVE }) })
  const { fills } = promptEngine(on, '이것도 봐 줘')
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'next-fill' })

  expect(fills).toEqual([{ text: ' /scv:work a', mode: 'append' }])
  await ui.unmount()
})

test('prompt-usage T3 못 넣으면 복사로 대신하고 그렇게 알린다', async ($, on) => {
  const { copies } = engine(on, { a: plan({ title: 'p', status: 'planned', steps: FIVE }) })
  promptEngine(on, '', false)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'next-fill' })

  expect(copies).toEqual(['/scv:work a'])
  expect(await text(ui, /^입력창에/)).toBe('입력창에 못 넣어 복사함: /scv:work a')
  await ui.unmount()
})

test('prompt-usage T4 메인 차례가 끝났고 다음 할 일이 명령이면 제안을 띄운다', async ($, on) => {
  expect(suggestNext({ text: '시작하기', command: '/scv:work a' })).toBe('/scv:work a')
  expect(suggestNext({ text: '진행 중 — 기다리면 됩니다', command: null })).toBeNull()

  engine(on, { a: plan({ title: 'p', status: 'planned', steps: FIVE }) })
  const { suggestions } = promptEngine(on)
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.start({ text: 'look', turnId: 'a1', agentId: 'ag1' } as never)
  await $.turn.complete({ turnId: 'a1', answer: '', durationMs: 1, isAborted: false, reason: 'answer', agentId: 'ag1' } as never)
  expect(suggestions).toEqual([])

  await turnEnd($, 'answer', 1_000)
  expect(suggestions).toEqual(['/scv:work a'])
})

test('prompt-usage T4b 다음 할 일에 명령이 없으면 제안하지 않는다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  const { suggestions } = promptEngine(on)
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await turnEnd($, 'answer', 1_000)

  expect(suggestions).toEqual([])
})

test('prompt-usage T5 한도 줄을 한 줄로 보인다', async ($, on) => {
  expect(usageLine(LIMITS, KST)).toBe('5시간 72% · 17:40 초기화 · 7일 31%')
  expect(usageLine([{ kind: 'seven_day', percentUsed: 93.5, resetsAt: '2026-10-27T01:00:00Z' }], KST)).toBe('7일 93.5% · 10/27 10:00 초기화')

  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: LIMITS } }) as never)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^5시간 /)).toMatch(/^5시간 72% · \d\d:40 초기화 · 7일 31%$/)
  expect(await text(ui, /^사용 한도$/)).toBe('사용 한도')
  await ui.unmount()
})

test('prompt-usage T6 90%를 넘으면 한 번만 알리고, 초기화된 뒤 다시 넘으면 또 알린다', async ($, on) => {
  const first = usageAlerts([{ kind: 'five_hour', percentUsed: 91, resetsAt: '2026-10-23T08:40:00Z' }], [], KST)
  expect(first.texts).toEqual(['5시간 사용 한도 91% — 17:40 초기화'])
  expect(usageAlerts([{ kind: 'five_hour', percentUsed: 95, resetsAt: '2026-10-23T08:40:00Z' }], first.alerted, KST).texts).toEqual([])

  const { notices, store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  let limits = [{ kind: 'five_hour', percentUsed: 91, resetsAt: '2026-10-23T08:40:00Z' }]
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: limits } }) as never)
  await start($)
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: '2026-10-23T13:40:00Z' }]
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })

  expect(notices.filter(notice => notice.includes('사용 한도'))).toHaveLength(2)
  expect(store.get('usageAlerted')).toEqual(['five_hour:2026-10-23T08:40:00Z', 'five_hour:2026-10-23T13:40:00Z'])
})

test('prompt-usage T7 한도 정보가 없으면 줄이 없다', async ($, on) => {
  expect(usageLine([], KST)).toBeNull()
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [] } }) as never)
  await start($)

  expect(await drawnText($)).not.toContain('5시간')
  expect(await drawnText($)).not.toContain('사용 한도')
})

test('prompt-usage T8 명령 복사 버튼은 그대로 있다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'planned', steps: FIVE }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Button', key: 'next-fill' }))?.text).toBe('입력창에 넣기')
  expect((await ui.find({ type: 'Button', key: 'next-copy' }))?.text).toBe('명령 복사')
  await ui.unmount()
})

// ── mirror: a viewer session draws the working session's pane ───────────────

const envelope = (body: string) => `<cross-session-message from="unknown" from-mode="prompting">\n${body}\n</cross-session-message>`

test('mirror T1 거울 메시지는 봉투 안에서도 그대로 읽히고, 주소는 Remote Control id가 먼저', () => {
  const body = JSON.stringify({ text: '<b> & </cross-session-message>' })
  const parsed = parseMirror(envelope(mirrorText({ kind: 'state', body })))

  expect(parsed?.kind === 'state' ? JSON.parse(parsed.body) : null).toEqual({ text: '<b> & </cross-session-message>' })
  expect(parseMirror(envelope(mirrorText({ kind: 'hello', address: 'session_v' })))).toEqual({ kind: 'hello', address: 'session_v' })
  expect(parseMirror(envelope('그냥 메시지'))).toBeNull()
  const files = [JSON.stringify({ sessionId: 'other', bridgeSessionId: 'session_x' }), JSON.stringify({ sessionId: 'me', bridgeSessionId: 'session_me' }), 'not json'].join('\n')
  expect(mirrorAddress(files, 'me')).toEqual({ address: 'session_me', isRemote: true })
  expect(mirrorAddress(files, 'nobody')).toEqual({ address: 'nobody', isRemote: false })
})

test('mirror T2 보기 세션은 내 주소를 담아 요청하고, 받은 상태로 칸을 그린다 — 받은 메시지는 모델에 안 감', async ($, on) => {
  const env = engine(on, {})
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  const asked = await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)

  expect(asked.text).toContain('거울 요청을 보냈습니다')
  expect(env.sent).toHaveLength(1)
  expect(env.sent[0]?.to).toContain('session_host')
  expect(env.sent[0]?.text).toBe('SCV-MIRROR HELLO session_viewer')
  expect(await drawnText($)).toContain('상태를 기다리는 중')

  const hostPlan = { slug: 'p', isArchived: false, ...plan({ title: '작업 세션 계획', status: 'in_progress', steps: ['[x] a', '[~] b', 'c'] }) }
  const state = { snapshot: { plans: [hostPlan], dreamsText: null, cwd: '/host', root: '/host' } }
  const got = await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body: JSON.stringify(state) })) })

  expect(got.consumed).toBe('scv mirror state')
  const drawn = await drawnText($)
  expect(drawn).toContain('작업 세션 계획')
  expect(drawn).toContain('거울: session_host')
  expect(drawn).toContain('1/3')
  expect((await $.command.run({ command: 'scv-mirror', args: '' } as never)).text).toContain('거울 중: session_host · 0초 전 받음 · 작업 세션 계획 1/3')
})

test('mirror T3 작업 세션은 요청한 주소로 상태를 보내고, 다른 메시지는 그대로 모델에 간다', async ($, on) => {
  const env = engine(on, { a: plan({ title: '대시보드', status: 'in_progress', steps: ELEVEN }) })
  on('tool.check', () => ({ decision: 'ask' as const }))
  await start($)
  const hello = await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'hello', address: 'session_viewer' })) })

  expect(hello.consumed).toBe('scv mirror hello')
  expect(env.sent).toHaveLength(1)
  expect(env.sent[0]?.to).toContain('session_viewer')
  const pushed = parseMirror(env.sent[0]?.text ?? '')
  expect(pushed?.kind === 'state' ? JSON.parse(pushed.body).snapshot.plans[0].slug : null).toBe('a')

  const plain = await $.session.receive({ origin: { kind: 'peer' }, text: envelope('안녕') })
  expect(plain.consumed).toBeUndefined()
  expect(plain.text).toContain('안녕')
  // Only the mod's own sends skip the permission check; the model's SendMessage is judged as ever.
  expect((await $.tool.check({ tool: 'SendMessage', input: { to: 'x', message: 'hi' } } as never)).decision).toBe('ask')
})

// ── mirror-two-way: fewer rows, and the mirrored pane's presses done by the working session ──

const PLANNED = () => ({ p: plan({ title: '작업 세션 계획', status: 'planned', steps: ['a', 'b'] }) })

// A viewer session mirroring session_host, with the host's state (plan p, dreams report) already drawn.
const startViewer = async ($: Engine, on: On) => {
  const env = engine(on, {})
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  const hostPlan = { slug: 'p', isArchived: false, ...PLANNED().p }
  const state = { snapshot: { plans: [hostPlan], dreamsText: DREAMS, cwd: '/host', root: '/host' } }
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body: JSON.stringify(state) })) })

  return env
}

const hello = (address = 'session_viewer') => ({ origin: { kind: 'peer' as const }, text: envelope(mirrorText({ kind: 'hello', address })) })

test('mirror-two-way T1 ACT 메시지는 봉투 안에서도 읽히고, 모르는 형태는 버린다', () => {
  const fill = { kind: 'act' as const, address: 'session_v', act: { do: 'fill' as const, slug: 'a' } }
  const report = { kind: 'act' as const, address: 'session_v', act: { do: 'open-report' as const } }

  expect(parseMirror(envelope(mirrorText(fill)))).toEqual(fill)
  expect(parseMirror(envelope(mirrorText(report)))).toEqual(report)
  expect(parseMirror(envelope('SCV-MIRROR ACT session_v {"do":"run"}'))).toBeNull()
  expect(parseMirror(envelope('SCV-MIRROR ACT session_v {"do":"fill","slug":""}'))).toBeNull()
  expect(parseMirror(envelope('SCV-MIRROR ACT session_v {not json'))).toBeNull()
  expect(parseMirror(envelope('SCV-MIRROR ACT {"do":"open-report"}'))).toBeNull()
})

test('mirror-two-way T2 보낼지 판단 — 바뀌었고 간격이 지났을 때만', () => {
  expect(isMirrorDue({ sent: 'x', at: 1000 }, 'x', 100_000, 10_000)).toBe(false)
  expect(isMirrorDue({ sent: 'x', at: 1000 }, 'y', 6000, 10_000)).toBe(false)
  expect(isMirrorDue({ sent: 'x', at: 1000 }, 'y', 11_000, 10_000)).toBe(true)
  expect(isMirrorDue({ sent: '', at: 0 }, 'y', 5, 10_000)).toBe(true)
})

test('mirror-two-way T3 작업 세션은 바뀐 게 없으면 보내지 않고, 바뀌면 간격을 두고 보낸다', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const files = PLANNED()
  const env = engine(on, files, DREAMS, undefined, {}, true)
  await start($)
  await $.session.receive(hello())
  expect(env.sent).toHaveLength(1)

  await clock.advance(10 * 60_000)
  expect(env.sent).toHaveLength(1)

  files.p = plan({ title: '작업 세션 계획', status: 'in_progress', steps: ['[x] a', 'b'] })
  await clock.advance(3000)
  expect(env.sent).toHaveLength(2)

  files.p = plan({ title: '작업 세션 계획', status: 'in_progress', steps: ['[x] a', '[x] b'] })
  await clock.advance(3000)
  expect(env.sent).toHaveLength(2)

  await clock.advance(9000)
  expect(env.sent).toHaveLength(3)
  expect(env.sent.every(one => one.to.includes('session_viewer'))).toBe(true)
})

test('mirror-two-way T4 BYE 를 받은 시청자에게는 바뀌어도 보내지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const files = PLANNED()
  const env = engine(on, files, DREAMS, undefined, {}, true)
  await start($)
  await $.session.receive(hello())
  const bye = await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'bye', address: 'session_viewer' })) })

  expect(bye.consumed).toBe('scv mirror bye')
  files.p = plan({ title: '작업 세션 계획', status: 'in_progress', steps: ['[x] a', 'b'] })
  await clock.advance(30_000)
  expect(env.sent).toHaveLength(1)
})

test('mirror-two-way T5 보기 세션은 소식이 없어도 10분 전에는 다시 요청하지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const env = engine(on, {}, DREAMS, undefined, {}, true)
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  expect(env.sent).toHaveLength(1)

  await clock.advance(9 * 60_000)
  expect(env.sent).toHaveLength(1)

  await clock.advance(2 * 60_000)
  expect(env.sent).toHaveLength(2)
  expect(env.sent[1]?.text).toBe('SCV-MIRROR HELLO session_viewer')
})

test('mirror-two-way T6 거울 칸의 입력창에 넣기는 작업 세션으로 ACT 를 보낸다', async ($, on) => {
  const { fills } = promptEngine(on)
  const env = await startViewer($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'next-fill' })

  expect(env.sent).toHaveLength(2)
  expect(env.sent[1]?.to).toContain('session_host')
  expect(env.sent[1]?.text).toBe('SCV-MIRROR ACT session_viewer {"do":"fill","slug":"p"}')
  expect(fills).toEqual([])
  expect(await text(ui, /^입력창/)).toBe('입력창(작업 세션)에 넣으라고 보냄: /scv:work p')
  await ui.unmount()
})

test('mirror-two-way T7 작업 세션은 시청자의 fill 만 받아, 자기 상태로 계산한 명령을 입력창에 넣는다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'planned', steps: FIVE }) })
  const { fills } = promptEngine(on)
  await start($)
  await $.session.receive(hello())
  const act = (address: string) => ({ origin: { kind: 'peer' as const }, text: envelope(mirrorText({ kind: 'act', address, act: { do: 'fill', slug: 'a' } })) })

  const mine = await $.session.receive(act('session_viewer'))
  expect(mine.consumed).toBe('scv mirror act')
  expect(fills).toEqual([{ text: '/scv:work a', mode: 'replace' }])

  const stranger = await $.session.receive(act('session_other'))
  expect(stranger.consumed).toBe('scv mirror act')
  expect(fills).toHaveLength(1)
})

test('mirror-two-way T8 거울 칸의 보고서 열기는 작업 세션에서 연다', async ($, on) => {
  const env = await startViewer($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dreams-report' })

  expect(env.processes.some(argv => argv[0] === 'xdg-open' || argv[0] === 'open')).toBe(false)
  expect(env.sent[env.sent.length - 1]?.text).toBe('SCV-MIRROR ACT session_viewer {"do":"open-report"}')
  await ui.unmount()
})

test('mirror-two-way T8b 작업 세션은 시청자의 open-report 를 받아 자기 보고서를 연다', async ($, on) => {
  const { processes } = engine(on, PLANNED())
  await start($)
  await $.session.receive(hello())
  const got = await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'act', address: 'session_viewer', act: { do: 'open-report' } })) })

  expect(got.consumed).toBe('scv mirror act')
  expect(processes).toContainEqual(['xdg-open', '/work/scv/dreams/x.html'])
})

test('mirror-two-way T9 ACT 는 모델에 안 가고, 모델의 SendMessage 는 여전히 검사받는다', async ($, on) => {
  engine(on, PLANNED())
  on('tool.check', () => ({ decision: 'ask' as const }))
  await start($)
  const got = await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'act', address: 'session_x', act: { do: 'open-report' } })) })

  expect(got.consumed).toBe('scv mirror act')
  expect((await $.tool.check({ tool: 'SendMessage', input: { to: 'x', message: 'hi' } } as never)).decision).toBe('ask')
})

// ── mirror-self-address: one's own address is refused, and a failed ask keeps the mirror ──

test('mirror-self-address T1 자기 주소 판단', () => {
  const own = { address: 'session_me', localId: 'local-id' }

  expect(isOwnAddress('session_me', own)).toBe(true)
  expect(isOwnAddress('bridge:session_me', own)).toBe(true)
  expect(isOwnAddress(' local-id ', own)).toBe(true)
  expect(isOwnAddress('session_other', own)).toBe(false)
})

test('mirror-self-address T2 자기 주소로 /scv-mirror 를 치면 보내지 않고 한국어로 거절한다', async ($, on) => {
  const env = engine(on, {})
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)

  for (const args of ['session_viewer', 'bridge:session_viewer']) {
    const got = await $.command.run({ command: 'scv-mirror', args } as never)
    expect(got.text).toContain('이 세션 자신의 주소')
    expect(got.text).toContain('다른 세션')
  }
  expect(env.sent).toHaveLength(0)
  expect(await drawnText($)).not.toContain('거울:')
})

test('mirror-self-address T3 걸려 있던 거울은 자기 주소 실수에도 그대로 남는다', async ($, on) => {
  await startViewer($, on)
  await $.command.run({ command: 'scv-mirror', args: 'session_viewer' } as never)
  const drawn = await drawnText($)

  expect(drawn).toContain('거울: session_host')
  expect(drawn).toContain('작업 세션 계획')
})

test('mirror-self-address T4 다른 세션으로 보내기에 실패해도 걸려 있던 거울은 그대로다', async ($, on) => {
  const env = await startViewer($, on)
  env.delivery.isDelivered = false
  const got = await $.command.run({ command: 'scv-mirror', args: 'session_gone' } as never)

  expect(got.text).toContain('거울 요청을 보내지 못했습니다')
  const drawn = await drawnText($)
  expect(drawn).toContain('거울: session_host')
  expect(drawn).toContain('작업 세션 계획')
})

test('mirror-viewer-chat T1 거울 세션에서 친 글은 Claude에게 가지 않고 작업 세션 창에서 하라고 알린다', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await startViewer($, on)
  const typedHere = await $.prompt.submit(typed('음성 다시 들려줘'))
  const fromPhone = await $.prompt.submit({ ...typed('계속해'), origin: { kind: 'bridge' } } as never)

  expect(typedHere).toEqual({ drop: expect.stringContaining('대화는 작업 세션 창에서') })
  expect(typedHere.drop).toContain('session_host')
  expect(fromPhone.drop).toContain('/scv-mirror stop')
})

test('mirror-viewer-chat T2 거울을 끄면 다시 대화가 된다', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await startViewer($, on)
  await $.command.run({ command: 'scv-mirror', args: 'stop' } as never)

  expect(await $.prompt.submit(typed('계속해'))).toEqual(expect.objectContaining({ text: '계속해' }))
})

test('mirror-self-address T5 /scv-dashboard 안내가 다른 기기의 세션에서 치라고 말한다', async ($, on) => {
  const env = engine(on, {})
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  const got = await $.command.run({ command: 'scv-dashboard', args: '' } as never)

  expect(got.text).toContain('다른 기기')
  expect(got.text).toContain('다른 세션')
  expect(got.text).toContain('/scv-mirror session_viewer')
  expect(got.text).toContain('[거울 세션 열기](claude://code/new?q=%2Fscv-mirror%20session_viewer)')
})

// ── mirror-no-loop: no mirror onto a session that is mirroring this one ──

test('mirror-no-loop T1 시청자인지 판단', () => {
  const viewers = { session_v: { sent: '', at: 0, misses: 0 } }

  expect(isViewerOf('session_v', viewers)).toBe(true)
  expect(isViewerOf('bridge:session_v', viewers)).toBe(true)
  expect(isViewerOf(' session_v ', viewers)).toBe(true)
  expect(isViewerOf('session_x', viewers)).toBe(false)
})

test('mirror-no-loop T2 나를 보고 있는 세션으로 /scv-mirror 를 치면 보내지 않고 거절한다', async ($, on) => {
  const env = engine(on, PLANNED())
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_host' })
  await start($)
  await $.session.receive(hello())
  expect(env.sent).toHaveLength(1)

  const got = await $.command.run({ command: 'scv-mirror', args: 'session_viewer' } as never)
  expect(got.text).toContain('이 세션을 거울로 보고 있')
  expect(got.text).toContain('/scv-mirror stop')
  expect(env.sent).toHaveLength(1)
  const drawn = await drawnText($)
  expect(drawn).not.toContain('거울:')
  expect(drawn).toContain('작업 세션 계획')
})

test('mirror-no-loop T3 나를 보지 않는 세션으로는 그대로 걸린다', async ($, on) => {
  const env = engine(on, PLANNED())
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_host' })
  await start($)
  await $.session.receive(hello())
  const got = await $.command.run({ command: 'scv-mirror', args: 'session_other' } as never)

  expect(got.text).toContain('거울 요청을 보냈습니다')
  expect(env.sent[1]?.to).toContain('session_other')
  expect(env.sent[1]?.text).toBe('SCV-MIRROR HELLO session_host')
})

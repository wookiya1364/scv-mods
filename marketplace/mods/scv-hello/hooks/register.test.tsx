import { expect, test } from 'claude-code/testing'
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
  stepTimesFromSignals,
} from './model'

const PANE = {
  plugin: 'scv-hello',
  component: 'Pane',
  requestId: 'scv-hello',
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
) => {
  const opened: string[] = []
  const panes: { id: string }[] = []
  const store = new Map<string, unknown>()
  const notices: string[] = []
  const copies: string[] = []
  const toasts: string[] = []
  const notify = { isSent: true }
  const processes: string[][] = []
  on('command.register', () => ({ value: { command: 'scv-hello' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__scv-hello__${e.name}` } }) as never)
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: panes as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: clock.at }))
  on('clock.every', () => ({ value: undefined }))
  on('fs.list', (_, e) => ({
    value: Object.keys(e.path.endsWith('scv/archive') ? archived : files).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
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
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { opened, processes, clock, panes, store, notices, copies, toasts, notify }
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
  expect(opened).toEqual(['scv-hello'])
  await $.prompt.submit(typed('hi'))
  expect(opened).toEqual(['scv-hello', 'scv-hello'])
  panes.push({ id: 'scv-hello' })
  await $.prompt.submit(typed('again'))
  expect(opened).toEqual(['scv-hello', 'scv-hello'])
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
  const parsed = parsePlan({ slug: 'a', ...plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  const signals = [1, 2, 3].map((step, i) => ({ plan: 'a', step, state: 'done' as const, note: '', at: i * 10 * 60_000 }))
  const times = stepTimesFromSignals(signals, parsed)
  expect(times.map(time => time.done)).toEqual([1, 2, 3])
  expect(estimateEta(times, 'a', 2)).toEqual({ kind: 'estimate', ms: 20 * 60_000, basis: 2 })

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
  const added = composed.sections.find(section => section.id === 'scv-hello:step-signal')
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

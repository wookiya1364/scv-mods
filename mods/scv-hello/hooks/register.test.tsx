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

const plan = (opts: { title: string; status: string; steps: string[]; tests?: string[] }) => ({
  planText: `---\ntitle: ${opts.title}\nstatus: ${opts.status}\n---\n\n## Suggested path\n\n${opts.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n## Related Documents\n`,
  testsText: `# Tests\n\n## Test scenarios\n\n${(opts.tests ?? []).map((name, i) => `### T${i + 1}. ${name}\n`).join('\n')}\n## How to run\n\n\`\`\`bash\nnpm run verify-dashboard\n\`\`\`\n`,
})

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
) => {
  const opened: string[] = []
  const panes: { id: string }[] = []
  const processes: string[][] = []
  on('command.register', () => ({ value: { command: 'scv-hello' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: panes as never }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: clock.at }))
  on('clock.every', () => ({ value: undefined }))
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('fs.read', (_, e) => {
    const [, slug, file] = e.path.match(/scv\/promote\/([^/]+)\/(PLAN|TESTS)\.md$/) ?? []
    const found = slug ? files[slug] : undefined
    if (found) return { value: file === 'PLAN' ? found.planText : found.testsText }
    if (e.path.endsWith('scv/dreams/latest.json') && dreams) return { value: dreams }
    return { deny: `ENOENT ${e.path}` }
  })
  on('process.run', (_, e) => {
    processes.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return { opened, processes, clock, panes }
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
    'blocked',
    'waiting',
  ])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /완료 2 · 진행 1 · 막힘 1 · 대기 1/)).toBe('완료 2 · 진행 1 · 막힘 1 · 대기 1')
  await ui.unmount()
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

test('progress T7 펼쳐 보기 버튼이 상세를 열고 닫는다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] 첫 단계', '둘째 단계'] }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /첫 단계/)).toBeUndefined()
  await ui.press({ key: 'steps-toggle' })
  expect(await text(ui, /첫 단계/)).toBe('1. ✓ 첫 단계 — 완료')
  await ui.press({ key: 'steps-toggle' })
  expect(await text(ui, /첫 단계/)).toBeUndefined()
  await ui.unmount()
})

test('progress T8 계획이 여러 개면 선택 항목으로 고른다', async ($, on) => {
  engine(on, {
    '20261022-a': plan({ title: '진행 중 계획', status: 'in_progress', steps: ['a'] }),
    '20261022-b': plan({ title: '대기 계획', status: 'planned', steps: ['a'] }),
  })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^진행 중 계획$/)).toBe('진행 중 계획')
  await ui.select({ key: 'plan', value: '20261022-b' })
  expect(await text(ui, /^대기 계획$/)).toBe('대기 계획')
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
  await ui.press({ key: 'steps-toggle' })
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

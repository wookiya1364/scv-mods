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
  returnLine,
  titleOf,
  describeRole,
  nodeIconSvg,
  stageRole,
  STEP_TOOL,
  applySignal,
  buildStepPrompt,
  checkSignal,
  mergeMarks,
  activeSteps,
  nextStarted,
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
  contextLine,
  isMirrorDue,
  isOwnAddress,
  isViewerOf,
  hostLabel,
  mirrorAddress,
  sessionName,
  mirrorText,
  parseMirror,
  definedFromCatalog,
  extractMarked,
  parseCatalog,
  usedNames,
  writtenCode,
  doneFunctions,
  firstClause,
  archivedAtOf,
  parsePlans,
  pickerPlans,
  applyTurn,
  isBackgroundStart,
  turnStateOf,
  NODE_COLOR,
} from './model'
import type { Plan } from '../types'

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

const st = (name: string, state: 'done' | 'doing' | 'blocked' | 'waiting' | 'yourTurn') => ({ name, state, refs: [] as string[] })

const ELEVEN = ['[x] a', '[x] b', '[x] c', '[x] d', '[x] e', '[~] f', 'g', 'h', 'i', 'j', 'k']

const DREAMS = JSON.stringify({
  date: '20261022',
  summary: '[SCV 드림] 아직 셀 것이 없음(보관된 계획 0개) · 개선점: 완료 기준 비율 0/7(0%) · 보고서 scv/dreams/x.html',
  report: 'scv/dreams/x.html',
})

// The output files of background jobs the now-view tests set up, and the ones the mod read.
const JOB_OUTPUTS: { files: Record<string, { text: string; mtimeMs: number; size?: number; base64?: string }>; reads: string[] } = { files: {}, reads: [] }

// record: an archived plan's ARCHIVED_AT.md
type Files = Record<string, { planText: string; testsText: string; record?: string }>

const engine = (
  on: On,
  files: Files,
  dreams: string | null = DREAMS,
  clock = { at: 1_000_000 },
  archived: Files = {},
  // true: the test answers $.clock itself (mock.clock), so the refresh timer can be advanced
  isClockMocked = false,
  // the project's pure-function dictionary: file name → its text, under scv/core/catalog/pure
  catalog: Record<string, string> = {},
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
  // what the pane's own commands were started with (working folder · standard input · time limit) and how they end
  const runs: { argv: string[]; cwd?: string; stdin?: string; timeoutMs?: number }[] = []
  const procEnd = { exitCode: 0, stderr: '' }
  // more files this project holds, by the end of their path (settings, gear index, a gear run's state, the installed list)
  const extra: Record<string, string> = {}
  // folders listed for the gear-run state, by the end of their path
  const extraDirs: Record<string, string[]> = {}
  const env: Record<string, string | undefined> = { HOME: '/home/u' }
  // the cards under '더 보기' are open here, as every test written before the fold expects; a fold test closes them
  store.set('scv-dashboard:more', true)
  on('env.get', (_, e) => ({ value: env[e.name] }) as never)
  // the prompt box changing with no edit of the person's (a fill, a clear): nothing beneath the mod answers it
  on('prompt.change', (_, e) => ({ text: e.text }) as never)
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
          : e.path.endsWith('scv/core/catalog/pure')
            ? Object.keys(catalog).map(name => ({ ...dir(name), kind: 'file' as const }))
            : (Object.entries(extraDirs).find(([end]) => e.path.endsWith(end))?.[1] ?? []).map(dir),
  }))
  on('fs.read', (_, e) => {
    const [, where, slug, file] = e.path.match(/scv\/(promote|archive)\/([^/]+)\/(PLAN|TESTS)\.md$/) ?? []
    const found = slug ? (where === 'archive' ? archived : files)[slug] : undefined
    if (found) return { value: file === 'PLAN' ? found.planText : found.testsText }
    const recorded = e.path.match(/scv\/archive\/([^/]+)\/ARCHIVED_AT\.md$/)?.[1]
    if (recorded && archived[recorded]?.record) return { value: archived[recorded]!.record! }
    const kept = e.path.match(/scv\/core\/catalog\/pure\/([^/]+)$/)?.[1]
    if (kept && catalog[kept] !== undefined) return { value: catalog[kept] }
    const more = Object.entries(extra).find(([end]) => e.path.endsWith(end))?.[1]
    if (more !== undefined) return { value: more }
    if (e.path.endsWith('scv/dreams/latest.json') && dreams) return { value: dreams }
    if (e.path.endsWith('scv/dreams/x.html') && dreams) return { value: '<h1>드림</h1>' }
    // a background job's output file (now-view): which ones were read is kept, to see that only changed files are
    const output = JOB_OUTPUTS.files[e.path]
    if (output) {
      JOB_OUTPUTS.reads.push(e.path)
      // a picture sent as a step's evidence is read as bytes
      if (output.base64 !== undefined && e.as === 'bytes') return { value: { base64: output.base64 } } as never

      return { value: output.text }
    }
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
    runs.push({ argv: [...e.argv], cwd: e.init?.cwd, stdin: e.init?.stdin, timeoutMs: e.init?.timeoutMs })
    return { value: { exitCode: procEnd.exitCode, stdout: proc.stdout, stderr: procEnd.stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: 'local-id' }))
  on('session.send', (_, e) => {
    if (!delivery.isDelivered) return { isDelivered: false, reason: 'no such session' } as never
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('session.receive', (_, e) => ({ text: e.text }))

  return { opened, processes, clock, panes, store, notices, copies, toasts, notify, proc, sent, delivery, runs, procEnd, extra, extraDirs, env }
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
  await signal($, 2, 'doing')
  await $.tool.call({ tool: 'Edit', file_path: '/work/hooks/view.tsx', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^2\. 화면 그리기 — /)).toBe('2. 화면 그리기 — 진행 중')
  // Each function the step builds, with what it does: the dictionary is empty here, so the plan's table says it.
  expect(await text(ui, /^• render/)).toBe('• render')
  expect(await text(ui, /^정리된 값/)).toBe('정리된 값을 오른쪽 칸 화면으로 그린다')
  expect(await text(ui, /^새로 만듦 /)).toBe('새로 만듦 0')
  expect(await text(ui, /^가져다 씀 /)).toBe('가져다 씀 0')
  // The tool calls are folded under one line, and open on a press.
  expect(await text(ui, /^Edit: view\.tsx$/)).toBeUndefined()
  expect(await drawnText($)).toContain('▸ 도구 호출 1건')
  await ui.press({ key: 'calls-toggle' })
  expect(await text(ui, /^Edit: view\.tsx$/)).toBe('Edit: view.tsx')

  await ui.press({ key: 'step-1' })
  expect(await text(ui, /^1\. 파싱 만들기 — /)).toBe('1. 파싱 만들기 — 완료')
  expect(await text(ui, /^• parsePlans/)).toBe('• parsePlans')
  expect(await text(ui, /^계획서 글을/)).toBe('계획서 글을 읽어 제목·상태·단계 목록으로 정리한다')
  expect(await drawnText($)).not.toContain('도구 호출')

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

  expect(await text(ui, /^• render/)).toBe('• render')
  await ui.press({ key: 'step-2' })
  expect(await text(ui, /^2\. /)).toBe('2. 시나리오: 비싸요 갈래 — 대기')
  expect(await text(ui, /^순수함수 없음/)).toBe('순수함수 없음')
  expect(await text(ui, /^특약 빼기/)).toBe('특약 빼기 제안 · 동의 · 거절 흐름을 시나리오에 넣는다')
  await ui.press({ key: 'step-3' })
  expect(await text(ui, /^순수함수 없음/)).toBe('순수함수 없음')
  expect(await text(ui, /^녹음$/)).toBe('녹음')
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

test('progress T9 세션 시작 때 열리고, 닫힌 칸은 메시지로 다시 열리지 않고 /scv-panel · /scv-dashboard 로 열림', async ($, on) => {
  const { opened } = engine(on, {})
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await start($)
  expect(opened).toEqual(['scv-dashboard'])
  await $.prompt.submit(typed('hi'))
  await $.prompt.submit(typed('again'))
  expect(opened).toEqual(['scv-dashboard'])
  await $.command.run({ command: 'scv-panel', args: '' } as never)
  expect(opened).toEqual(['scv-dashboard', 'scv-dashboard'])
  await $.command.run({ command: 'scv-dashboard', args: '' } as never)
  expect(opened).toEqual(['scv-dashboard', 'scv-dashboard', 'scv-dashboard'])
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

// A done signal carries proof since 0.2.29; these tests send a command's output.
const DONE_OUTPUT = '시험 통과'
const signal = ($: Engine, step: number, state: string, note?: string, slug = 'a') =>
  $.tool.call({ tool: STEP_TOOL, plan: slug, step, state, ...(note ? { note } : {}), ...(state === 'done' ? { output: DONE_OUTPUT } : {}) } as never) as Promise<{ deny?: string; result?: unknown }>

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
  expect((await signal($, 1, 'blocked', '막힘')).deny).toContain('1단계는 이미 끝났습니다')
  expect((await signal($, 1, 'doing')).deny).toContain('1단계는 이미 끝났습니다')
  expect((await signal($, 2, 'blocked')).deny).toContain('이유(note)')
  expect((await signal($, 2, 'paused')).deny).toContain('doing · done · blocked')
  expect(store.get('signals:/work')).toEqual([{ plan: 'a', step: 1, state: 'done', note: '', at: 1_000_000, evidence: { files: [], output: DONE_OUTPUT } }])

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

test('prompt-usage T9 컨텍스트 차오름을 사용 한도 아래 따로 한 줄로 보인다', async ($, on) => {
  expect(contextLine(33.6)).toBe('34%')
  expect(contextLine(null)).toBeNull()

  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 67000, percent: 33.6 }, rateLimits: LIMITS } }) as never)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^컨텍스트$/)).toBe('컨텍스트')
  expect(await text(ui, /^34%$/)).toBe('34%')
  expect(await text(ui, /^사용 한도$/)).toBe('사용 한도')
  await ui.unmount()
})

test('prompt-usage T10 컨텍스트 값이 없으면 줄이 없다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: LIMITS } }) as never)
  await start($)

  expect(await drawnText($)).not.toContain('컨텍스트')
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

// ── mirror-first-ask: a fresh mirror shows no older plan, and a state held up on the way does not draw over a newer one ──

const stateOf = (title: string, sentAt?: number) =>
  JSON.stringify({ snapshot: { plans: [{ slug: 'p', isArchived: false, ...plan({ title, status: 'in_progress', steps: ['a', 'b'] }) }], dreamsText: null, cwd: '/host', root: '/host' }, ...(sentAt === undefined ? {} : { sentAt }) })

test('mirror-first-ask T1 새로 건 거울은 상태가 올 때까지 이 폴더의 계획도, 예전에 받은 계획도 그리지 않는다', async ($, on) => {
  const env = engine(on, { own: plan({ title: '보기 기기 폴더의 예전 계획', status: 'in_progress', steps: ['a'] }) })
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  expect(await drawnText($)).toContain('보기 기기 폴더의 예전 계획')

  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  let drawn = await drawnText($)
  expect(drawn).toContain('상태를 기다리는 중')
  expect(drawn).not.toContain('보기 기기 폴더의 예전 계획')

  await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body: stateOf('어제 받은 계획', 1000) })) })
  expect(await drawnText($)).toContain('어제 받은 계획')

  // Asked again by hand (same host), what was drawn before waits for the host's answer.
  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  drawn = await drawnText($)
  expect(drawn).toContain('상태를 기다리는 중')
  expect(drawn).not.toContain('어제 받은 계획')
})

test('mirror-first-ask T2 늦게 도착한 옛 상태는 새 상태를 덮지 않고, 보낸 시각이 없는 상태(옛 버전)는 받는다', async ($, on) => {
  const env = engine(on, {})
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  const take = (body: string) => $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body })) })

  await take(stateOf('지금 계획', 2000))
  await take(stateOf('밀려 있던 옛 계획', 1000))
  expect(await drawnText($)).toContain('지금 계획')
  expect(await drawnText($)).not.toContain('밀려 있던 옛 계획')

  await take(stateOf('옛 버전이 보낸 계획'))
  expect(await drawnText($)).toContain('옛 버전이 보낸 계획')
})

test('mirror-first-ask T3 작업 세션은 보낸 시각을 붙이되, 그대로인 상태는 다시 보내지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const env = engine(on, PLANNED(), DREAMS, undefined, {}, true)
  await start($)
  await $.session.receive(hello())
  const pushed = parseMirror(env.sent[0]?.text ?? '')

  expect(pushed?.kind === 'state' ? JSON.parse(pushed.body).sentAt : null).toBe(1_000_000)
  await clock.advance(60_000)
  expect(env.sent).toHaveLength(1)
})

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

// 0.2.27: 스스로 다시 묻지 않는다 — 묻는 글마다 작업 세션의 대화에 '메시지 받음' 줄이 하나씩 생기기 때문이다.
test('mirror-two-way T5 보기 세션은 소식이 없어도 스스로 다시 요청하지 않는다', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const env = engine(on, {}, DREAMS, undefined, {}, true)
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  expect(env.sent).toHaveLength(1)

  await clock.advance(9 * 60_000)
  expect(env.sent).toHaveLength(1)

  await clock.advance(2 * 60_000)
  expect(env.sent).toHaveLength(1)

  await clock.advance(60 * 60_000)
  expect(env.sent).toHaveLength(1)
})

test('mirror-late-address T1 원격 주소가 늦게 적히면, 상태를 기다리는 동안 새 주소로 저절로 다시 요청한다', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const env = engine(on, {}, DREAMS, undefined, {}, true)
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id' })
  await start($)
  const asked = await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)

  expect(asked.text).toContain('아직 찾지 못해')
  expect(env.sent).toHaveLength(1)
  expect(env.sent[0]?.text).toBe('SCV-MIRROR HELLO local-id')

  await clock.advance(3000)
  expect(env.sent).toHaveLength(1)

  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await clock.advance(3000)
  expect(env.sent).toHaveLength(2)
  expect(env.sent[1]?.text).toBe('SCV-MIRROR HELLO session_viewer')

  await clock.advance(30_000)
  expect(env.sent).toHaveLength(2)
})

test('mirror-late-address T2 상태를 받은 뒤에는 주소가 바뀌어도 10분 규칙만 따른다', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const env = engine(on, {}, DREAMS, undefined, {}, true)
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id' })
  await start($)
  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body: stateOf('작업 세션 계획', 1) })) })

  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await clock.advance(30_000)
  expect(env.sent).toHaveLength(1)
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

test('mirror-two-way T8 거울 칸의 보고서 열기는 받은 보고서를 이 기기에서 열고, 작업 세션에 보내지 않는다', async ($, on) => {
  const env = await startViewer($, on)
  const hostPlan = { slug: 'p', isArchived: false, ...PLANNED().p }
  const state = { snapshot: { plans: [hostPlan], dreamsText: DREAMS, reportHtml: '<h1>드림</h1>', cwd: '/host', root: '/host' } }
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body: JSON.stringify(state) })) })
  const sentBefore = env.sent.length
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dreams-report' })

  const opened = env.processes[env.processes.length - 1] ?? []
  expect(opened[0]).toBe('sh')
  expect(opened).toContain('<h1>드림</h1>')
  expect(opened.join(' ')).toContain('xdg-open')
  expect(env.sent).toHaveLength(sentBefore)
  await ui.unmount()
})

test('mirror-two-way T8c 작업 세션은 보고서 내용을 상태에 실어 보낸다', async ($, on) => {
  const env = engine(on, PLANNED())
  await start($)
  await $.session.receive(hello())

  const body = env.sent[env.sent.length - 1]?.text.replace(/^SCV-MIRROR STATE /, '') ?? '{}'
  expect(JSON.parse(body).snapshot.reportHtml).toBe('<h1>드림</h1>')
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

test('mirror-host-name T1 세션 기록에서 이름을 읽고, 이름과 주소를 함께 쓴다', () => {
  const files = [JSON.stringify({ sessionId: 'me', bridgeSessionId: 'session_me', name: '맥프로_aitmcenter' }), JSON.stringify({ sessionId: 'other' })].join('\n')

  expect(sessionName(files, 'me')).toBe('맥프로_aitmcenter')
  expect(sessionName(files, 'other')).toBeNull()
  expect(hostLabel('session_me', '맥프로_aitmcenter')).toBe('맥프로_aitmcenter (session_me)')
  expect(hostLabel('session_me', null)).toBe('session_me')
})

test('mirror-host-name T2 거울 칸 맨 위에 작업 세션 이름과 주소가 함께 보인다', async ($, on) => {
  await startViewer($, on)
  const hostPlan = { slug: 'p', isArchived: false, ...PLANNED().p }
  const state = { snapshot: { plans: [hostPlan], dreamsText: DREAMS, cwd: '/host', root: '/host' }, hostName: '맥프로_aitmcenter' }
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body: JSON.stringify(state) })) })

  expect(await drawnText($)).toContain('거울: 맥프로_aitmcenter (session_host)')
})

test('mirror-plan-in-view T1 거울 칸은 작업 세션이 보고 있는 계획을 따라 그린다', async ($, on) => {
  await startViewer($, on)
  const first = { slug: 'a', isArchived: false, ...plan({ title: '대본 통화', status: 'in_progress', steps: ['초안'] }) }
  const second = { slug: 'b', isArchived: false, ...plan({ title: 'STT 연결', status: 'in_progress', steps: ['다리', '확인'] }) }
  const state = { snapshot: { plans: [first, second], dreamsText: DREAMS, cwd: '/host', root: '/host' }, inView: 'b' }
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body: JSON.stringify(state) })) })

  const drawn = await drawnText($)
  expect(drawn).toContain('다리')
  expect(drawn).not.toContain('초안')
})

test('mirror-plan-in-view T2 작업 세션은 자기가 보고 있는 계획을 상태에 실어 보낸다', async ($, on) => {
  const env = engine(on, { a: plan({ title: '대본 통화', status: 'in_progress', steps: ['초안'] }), b: plan({ title: 'STT 연결', status: 'in_progress', steps: ['다리'] }) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'plan', value: 'b' })
  await ui.unmount()
  await $.session.receive(hello())

  const body = env.sent[env.sent.length - 1]?.text.replace(/^SCV-MIRROR STATE /, '') ?? '{}'
  expect(JSON.parse(body).inView).toBe('b')
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
  expect(got.text).not.toContain('claude://')
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

// ── step-functions: a step's detail says the functions it builds and what its writing made and called ──

const COMPARE_MD = `# 비교 — 둘을 비교해 순서나 같음을 낸다 — 버전 · 숫자 · 집합

> 생성물 — 원본은 각 함수 위 주석(역할 · 종류 · 예). 1개.

### scv_ver_lt
- 역할: 첫 버전이 둘째 버전보다 낮으면 참(숫자로 비교, 접미사는 무시)
- 위치: scripts/lib/template-digest.sh · @pure · sh
- 예: \`0.9.1 0.10.0 → ""\`
`
const INDEX_MD = '# 순수함수 사전 — 차례\n\n| 종류 | 하는 일 | 개수 | 파일 |\n|---|---|---|---|\n| 비교 | 둘을 비교 | 1 | [compare.md](compare.md) |\n'

test('step-functions T1 사전 파일에서 이름마다 역할 · 종류를 읽고, 차례 파일은 아무것도 더하지 않는다', () => {
  expect(parseCatalog([INDEX_MD, COMPARE_MD])).toEqual({
    scv_ver_lt: { role: '첫 버전이 둘째 버전보다 낮으면 참(숫자로 비교, 접미사는 무시)', kind: '비교' },
  })
  expect(parseCatalog([])).toEqual({})
})

test('step-functions T2 표식 읽기는 코어 사전과 같은 규칙 — 셸은 이름 줄, 다른 언어는 표식에 적힌 이름', () => {
  // The three examples of SCV core's own extractor (scripts/lib/pure-catalog.sh), the same here.
  expect(extractMarked('# @pure\n# 역할: 센다\n# 종류: 세기\n# 예: "a" → "1"\nf() {\n}')).toEqual([{ name: 'f', tier: 'pure', role: '센다', kind: '세기' }])
  expect(extractMarked('// @pure add\n// 역할: 더한다\n// 종류: 세기\n// 예: 1 2 → 3\nexport const add = (a, b) => a + b')).toEqual([
    { name: 'add', tier: 'pure', role: '더한다', kind: '세기' },
  ])
  expect(extractMarked('/**\n * @deterministic clamp\n * 역할: 범위로 자른다\n * 종류: 다듬기\n * 예: 5 0 3 → 3\n */\nint clamp(int v, int lo, int hi)')).toEqual([
    { name: 'clamp', tier: 'deterministic', role: '범위로 자른다', kind: '다듬기' },
  ])
  // No marker, or a marker with no definition under it (a bare shell marker over code that is not a function), is nothing.
  expect(extractMarked('# 역할: 센다\nf() {\n}')).toEqual([])
  expect(extractMarked('# @pure\necho hi')).toEqual([])
})

test('step-functions T3 부른 함수는 아는 이름이 낱말로 설 때만, 같은 글에서 만든 것은 빼고', () => {
  const code = 'line="$(scv_step_line "$tool")"\nscv_step_linex\nmy_scv_ver_lt'
  expect(usedNames(code, ['scv_step_line', 'scv_ver_lt', 'scv_step_active_plan'], [])).toEqual(['scv_step_line'])
  expect(usedNames(code, ['scv_step_line'], ['scv_step_line'])).toEqual([])
  expect(writtenCode('Write', { file_path: '/p/scv/promote/a/PLAN.md', content: 'scv_step_line' })).toBeNull()
  expect(writtenCode('Edit', { file_path: '/p/core/hooks/x.sh', new_string: 'b' })).toBe('b')
  expect(writtenCode('MultiEdit', { file_path: '/p/x.sh', edits: [{ new_string: 'a' }, { new_string: 'b' }] })).toBe('a\nb')
  // One line of description: a role up to its first ' — '.
  expect(firstClause('계획 이름 하나를 고른다 — 여럿이면 마지막 줄')).toBe('계획 이름 하나를 고른다')
  expect(firstClause('센다')).toBe('센다')
  // A function the step's 하는 일 already shows is named only; another gets its description.
  const made = { name: 'f', tier: 'pure' as const, role: '센다 — 길게', kind: '세기' }
  expect(doneFunctions({ made: [made], used: ['g'] }, ['f'], { g: { role: '고른다 — 길게', kind: '고르기' } }, [])).toEqual({
    made: [{ name: 'f', detail: '' }],
    used: [{ name: 'g', detail: '고른다' }],
  })
  expect(doneFunctions(undefined, [], {}, [])).toEqual({ made: [], used: [] })
})

const STEP_PLAN = (marks: [string, string, string]) =>
  plan({
    title: '단계 보고',
    status: 'in_progress',
    steps: [`${marks[0]}계획 고르기 규칙`, `${marks[1]}순수부와 단계 보고 스크립트 — \`scv_step_active_plan\`, \`scv_step_line\``, `${marks[2]}매 턴 훅에 한 줄, 시점 규칙 — 훅과 절차 문서만 고침`],
    pipeline: ['`scv_step_active_plan` | 계획 하나를 고른다 | 목록 → 이름 | 순수', '`scv_step_line` | 안내 한 줄을 만든다 | 이름 → 줄 | 순수'],
  })

const MADE_SH = [
  '# @pure',
  '# 역할: 구현 중인 계획 이름 하나를 고른다',
  '# 종류: 고르기',
  '# 예: "a" → "a"',
  'scv_step_active_plan() {',
  '  printf %s "$1"',
  '}',
  '',
  '# @pure',
  '# 역할: 도구 이름과 계획 이름으로 매 턴 안내 한 줄을 만든다',
  '# 종류: 조립',
  '# 예: "t" "p" → "t p"',
  'scv_step_line() {',
  '  printf "%s %s" "$1" "$2"',
  '}',
].join('\n')

test('step-functions T4 견본 — 2단계는 새로 만든 두 함수, 3단계는 순수함수 없음과 앞 단계 함수 두 개 가져다 씀', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const files = { a: STEP_PLAN(['[x] ', '[~] ', '']) }
  const env = engine(on, files, DREAMS, undefined, {}, true, { 'INDEX.md': INDEX_MD, 'compare.md': COMPARE_MD })
  on('tool.call', () => ({ result: {} }))
  await start($)
  await signal($, 2, 'doing')
  await $.tool.call({ tool: 'Write', file_path: '/work/core/scripts/lib/step.sh', content: MADE_SH })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^• scv_step_active_plan \(/)).toBe('• scv_step_active_plan (고르기)')
  expect(await text(ui, /^구현 중인/)).toBe('구현 중인 계획 이름 하나를 고른다')
  expect(await text(ui, /^• scv_step_line \(/)).toBe('• scv_step_line (조립)')
  expect(await text(ui, /^새로 만듦 /)).toBe('새로 만듦 2')
  expect(await text(ui, /^가져다 씀 /)).toBe('가져다 씀 0')

  files.a = STEP_PLAN(['[x] ', '[x] ', '[~] '])
  await clock.advance(3000)
  await signal($, 2, 'done')
  await signal($, 3, 'doing')
  await $.tool.call({ tool: 'Edit', file_path: '/work/core/hooks/on-turn.sh', old_string: 'x', new_string: 'line="$(scv_step_line "$(scv_step_active_plan "$p")" "$t")"\nscv_ver_lt "$a" "$b"' })

  expect(await text(ui, /^순수함수 없음/)).toBe('순수함수 없음')
  expect(await text(ui, /^훅과 절차/)).toBe('훅과 절차 문서만 고침')
  expect(await text(ui, /^새로 만듦 /)).toBe('새로 만듦 0')
  expect(await text(ui, /^가져다 씀 /)).toBe('가져다 씀 3')
  expect(await text(ui, /^• scv_step_line$/)).toBe('• scv_step_line')
  expect(await text(ui, /^도구 이름과 계획/)).toBe('도구 이름과 계획 이름으로 매 턴 안내 한 줄을 만든다')
  expect(await text(ui, /^첫 버전이/)).toBe('첫 버전이 둘째 버전보다 낮으면 참(숫자로 비교, 접미사는 무시)')
  // Kept per project, so a new session still shows what each step did.
  expect(env.store.get('functions:/work')).toBeDefined()
  await ui.unmount()
})

test('step-functions T5 단계 시작을 알리기 전 작업과 끝을 알린 뒤 작업은 어느 단계에도 쌓이지 않고, 기록 없는 단계는 기록 없음', async ($, on) => {
  const env = engine(on, { a: STEP_PLAN(['[x] ', '[~] ', '']) })
  on('tool.call', () => ({ result: {} }))
  await start($)
  // The plan file says step 2 is in progress (left from another day); this session has not said it started it.
  await $.tool.call({ tool: 'Write', file_path: '/work/core/x.sh', content: MADE_SH })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^기록 없음/)).toBe('기록 없음 — Claude가 이 세션에서 단계 시작을 알린 뒤의 작업만 셉니다')
  expect(await drawnText($)).not.toContain('도구 호출')

  await signal($, 2, 'doing')
  await $.tool.call({ tool: 'Edit', file_path: '/work/core/y.sh', old_string: 'a', new_string: 'b' })
  await signal($, 2, 'done')
  await $.tool.call({ tool: 'Edit', file_path: '/work/core/z.sh', old_string: 'a', new_string: 'b' })
  await ui.press({ key: 'step-2' })

  expect(await text(ui, /^새로 만듦 /)).toBe('새로 만듦 0')
  expect(await drawnText($)).toContain('▸ 도구 호출 1건')
  expect(env.store.get('functions:/work')).toBeUndefined()
  await ui.unmount()
})

// ── recent-archived: with no plan in progress, the plan archived last stands in, not the one created last ──

test('recent-archived T1 보관 기록 날짜가 늦은 계획이 앞, 같은 날이면 이름순, 기록 없는 계획은 뒤', () => {
  expect(archivedAtOf('---\narchived_at: 2026-11-02\narchived_by: w\n---')).toBe('2026-11-02')
  expect(archivedAtOf(null)).toBe('')
  const file = (slug: string, archivedAt?: string) => ({ slug, isArchived: true, ...plan({ title: slug, status: 'done', steps: ['a'] }), ...(archivedAt ? { archivedAt } : {}) })
  expect(parsePlans([file('20261025-b', '2026-10-25'), file('20261022-a', '2026-11-02'), file('20261030-old'), file('20261022-c', '2026-11-02')]).map(one => one.slug)).toEqual([
    '20261022-c',
    '20261022-a',
    '20261025-b',
    '20261030-old',
  ])
})

test('recent-archived T2 진행 중 계획이 없으면 칸은 가장 최근에 보관한 계획을 보여 준다', async ($, on) => {
  const record = (date: string) => `---\narchived_at: ${date}\narchived_by: w\nreason: t\n---\n`
  engine(on, {}, DREAMS, undefined, {
    '20261025-mirror': { ...plan({ title: '열흘 전 보관한 거울 계획', status: 'done', steps: ['a'] }), record: record('2026-10-25') },
    '20261022-alerts': { ...plan({ title: '오늘 보관한 알림 계획', status: 'done', steps: ['a'] }), record: record('2026-11-02') },
  })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect((await ui.find({ type: 'Select', key: 'plan' }))?.props.value).toBe('20261022-alerts')
  await ui.unmount()
})

test('paused T10 보류인 계획은 "보류 · <먼저 할 계획> 끝나면 재개", 새 계획엔 돌아갈 곳, 정렬은 진행 중 바로 뒤', async () => {
  const files = [
    { slug: 'p-done', planText: '---\ntitle: 끝남\nstatus: done\n---\n', testsText: '' },
    { slug: 'p-a', planText: '---\ntitle: 결제 화면\nstatus: paused\npaused_by: p-b\nresume_at: 2\n---\n', testsText: '' },
    { slug: 'p-b', planText: '---\ntitle: 로그 정리\nstatus: in_progress\nreturn_to: p-a\n---\n', testsText: '' },
    { slug: 'p-t', planText: '---\ntitle: 시험 중\nstatus: testing\n---\n', testsText: '' },
  ]
  const plans = parsePlans(files)
  expect(plans.map(one => one.slug)).toEqual(['p-b', 'p-a', 'p-t', 'p-done'])
  const a = plans.find(one => one.slug === 'p-a')!
  const b = plans.find(one => one.slug === 'p-b')!
  expect([a.pausedBy, a.resumeAt, a.returnTo, b.returnTo]).toEqual(['p-b', '2', '', 'p-a'])
  expect(statusWords(a.status, [], titleOf(plans, a.pausedBy))).toBe('보류 · 로그 정리 끝나면 재개')
  expect(statusWords('paused', [])).toBe('보류')
  expect(returnLine(b, plans)).toBe('끝나면 돌아갈 계획: 결제 화면')
  expect(returnLine(a, plans)).toBe('')
  expect(titleOf(plans, 'gone')).toBe('gone')
  expect(nextAction('p-a', 'paused', [], [])).toEqual({ text: '보류 중 — 먼저 할 계획이 끝나면 이어서 함', command: null })
  expect(statusWords('in_progress', [{ name: 'a', state: 'doing', refs: [] }])).toBe('만드는 중')
})

test('history T14 변경 이력은 최근 것부터 보이고, 2b 같은 단계 번호도 단계로 센다', async () => {
  const planText = [
    '---', 'title: 조합 밸런스', 'status: in_progress', '---', '',
    '## Suggested path', '', '1. 하나', '2. 둘', '2b. (추가) 연계 효과', '3. 셋', '',
    '## 변경 이력', '',
    '- **2026-11-09 01:24 선택** — 답: 지금 상태 다시 재고 계획 고침', '  - 질문: 3단계는 왜 멈췄나', '',
    '- **2026-11-09 진행** — 3단계: 성직자 체력 64', '  - 요청: 체력 64 (요청 ab12cd34)', '',
    '- **2026-11-09 04:54 선택** — 답: 덩굴 2턴 유지', '  - 질문: 회복은?', '',
    '## Links', '',
  ].join('\n')
  const [plan] = parsePlans([{ slug: 'p', planText, testsText: '' }])
  expect(plan!.steps.length).toBe(4)
  expect(plan!.history).toEqual([
    '2026-11-09 04:54 선택 — 답: 덩굴 2턴 유지',
    '2026-11-09 진행 — 3단계: 성직자 체력 64',
    '2026-11-09 01:24 선택 — 답: 지금 상태 다시 재고 계획 고침',
  ])
  const [none] = parsePlans([{ slug: 'q', planText: '---\ntitle: q\nstatus: planned\n---\n', testsText: '' }])
  expect(none!.history).toEqual([])
})

test('progress T15 단계 보고가 빠져도 계획 파일의 진행 줄로 단계 상태를 센다(마지막 줄이 이김)', async () => {
  const planText = [
    '---', 'title: a', 'status: in_progress', '---', '',
    '## Suggested path', '', '1. 하나', '2. 둘', '3. 셋', '4. [x] 넷', '',
    '## 변경 이력', '',
    '- **2026-11-09 진행** — 1단계 시작: a', '',
    '- **2026-11-09 진행** — 1단계 끝: a', '',
    '- **2026-11-09 진행** — 2단계 막힘: 키 없음', '',
    '- **2026-11-09 진행** — 4단계 시작: 이미 끝난 단계는 그대로', '',
    '- **2026-11-09 진행** — 3단계: 상태 없는 옛 줄은 세지 않음', '',
    '## Links', '',
  ].join('\n')
  const [plan] = parsePlans([{ slug: 'p', planText, testsText: '' }])
  expect(plan!.steps.map(step => step.mark)).toEqual(['done', 'blocked', undefined, 'done'])
})


test('history T15 변경 이력이 있는 계획도 칸이 그려진다', async ($, on) => {
  const planText = [
    '---', 'title: 조합 밸런스', 'status: in_progress', '---', '',
    '## Suggested path', '', '1. 하나', '',
    '## 변경 이력', '',
    '- **2026-11-09 21:56 선택** — 답: 지금 보관 (추천)', '',
    '## Links', '',
  ].join('\n')
  engine(on, { p: { planText, testsText: '' } })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^· 2026-11-09 21:56 선택/)).toBe('· 2026-11-09 21:56 선택 — 답: 지금 보관 (추천)')
  await ui.unmount()
})

test('picker T1 계획이 64개를 넘으면 목록은 앞의 64개만, 보이는 계획은 늘 남는다', async ($, on) => {
  const archived = Object.fromEntries(
    Array.from({ length: 70 }, (_, i) => [`2026${String(i).padStart(4, '0')}-a`, { ...plan({ title: `보관 ${i}`, status: 'archived', steps: ['a'] }), record: `archived_at: 2026-10-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` }]),
  )
  engine(on, {}, null, { at: 1_000_000 }, archived)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  const picker = await ui.find({ type: 'Select', key: 'plan' })
  expect((picker?.props.options as unknown[]).length).toBe(64)
  await ui.unmount()

  const plans = Array.from({ length: 70 }, (_, i) => ({ slug: `p${i}` }) as Plan)
  expect(pickerPlans(plans, 'p3').map(one => one.slug)).toEqual(plans.slice(0, 64).map(one => one.slug))
  expect(pickerPlans(plans, 'p69').map(one => one.slug)).toEqual([...plans.slice(0, 63).map(one => one.slug), 'p69'])
})

// ── your-turn: the step in progress says whose move it is (plan 20261112-wookiya1364-dashboard-your-turn) ──
// Claude's turn has ended and the work waits for the person: that step is not 'in progress — just wait'.

const ENDED = { isWorking: false, hasEnded: true, blocks: [], agents: 0, background: false } as const
const YOUR_TURN = '다음: 사용자 차례 — 대화창에서 이어서 하라고 말해 주세요'
const BACKGROUND = '다음: 배경 작업을 기다리는 중 — 끝나면 스스로 이어집니다'

test('your-turn T1 차례가 끝났고 막는 것도 배경 작업도 없으면 사용자 차례', () => {
  expect(turnStateOf(ENDED)).toBe('yourTurn')
})

test('your-turn T2 일하는 중 · 빨강 멈춤 · 배경 작업은 사용자 차례가 아니다', () => {
  const block = (kind: 'waiting' | 'permit' | 'stopped') => [{ kind, title: '', detail: '' }]

  expect(turnStateOf({ ...ENDED, isWorking: true })).toBe('working')
  // 이 세션이 차례의 끝을 본 적이 없으면(막 열린 세션) 아는 것이 없다 — 지금처럼 둔다
  expect(turnStateOf({ ...ENDED, hasEnded: false })).toBe('working')
  expect(turnStateOf({ ...ENDED, blocks: block('waiting') })).toBe('working')
  expect(turnStateOf({ ...ENDED, blocks: block('permit') })).toBe('working')
  expect(turnStateOf({ ...ENDED, blocks: block('stopped') })).toBe('working')
  expect(turnStateOf({ ...ENDED, agents: 1 })).toBe('background')
  expect(turnStateOf({ ...ENDED, background: true })).toBe('background')

  expect(isBackgroundStart('Bash', { command: 'x', run_in_background: true })).toBe(true)
  expect(isBackgroundStart('Bash', { command: 'x' })).toBe(false)
  expect(isBackgroundStart('ScheduleWakeup', { delaySeconds: 600 })).toBe(true)
  expect(isBackgroundStart('ScheduleWakeup', { stop: true })).toBe(false)
  expect(isBackgroundStart('Monitor', {})).toBe(true)
  expect(isBackgroundStart('Read', { file_path: 'a' })).toBe(false)
})

test('your-turn T3 사용자 차례일 때만 하는 중인 단계 하나가 바뀐다', () => {
  const stages = [st('a', 'done'), st('b', 'doing'), st('c', 'waiting'), st('d', 'waiting')]
  const states = (turn: 'working' | 'yourTurn' | 'background') => applyTurn(stages, turn).map(stage => stage.state)

  expect(states('yourTurn')).toEqual(['done', 'yourTurn', 'waiting', 'waiting'])
  expect(states('background')).toEqual(['done', 'doing', 'waiting', 'waiting'])
  expect(states('working')).toEqual(['done', 'doing', 'waiting', 'waiting'])
  expect(applyTurn([st('a', 'done'), st('b', 'blocked'), st('c', 'waiting')], 'yourTurn').map(stage => stage.state)).toEqual(['done', 'blocked', 'waiting'])
})

test('your-turn T4 새 색은 지금 쓰는 색들과 다르고, 단계 점과 진행 막대에 쓰인다', () => {
  expect([NODE_COLOR.done, NODE_COLOR.doing, NODE_COLOR.blocked, NODE_COLOR.waiting]).toEqual(['#3fb950', '#e3b341', '#f85149', '#6e7681'])
  // 초록 · 노랑 · 빨강 · 회색 둘, 그리고 '일하는 중' 글의 파랑
  expect(['#3fb950', '#e3b341', '#f85149', '#6e7681', '#8b949e', '#4f8cff']).not.toContain(NODE_COLOR.yourTurn)
  expect(nodeIconSvg('yourTurn', 'waiting')).toContain(`fill="${NODE_COLOR.yourTurn}"`)
  expect(barColor([st('a', 'done'), st('b', 'yourTurn')], [])).toBe(NODE_COLOR.yourTurn)
  expect(barColor([st('a', 'done'), st('b', 'doing')], [])).toBe('#e3b341')
  expect(barColor([st('a', 'yourTurn')], [{ kind: 'test', title: '', detail: '' }])).toBe('#f85149')
})

test('your-turn T5 윗줄과 다음 할 일이 사용자 차례와 배경 작업 기다림을 말한다', () => {
  const doing = [st('a', 'done'), st('b', 'doing'), st('c', 'waiting')]
  const yours = applyTurn(doing, 'yourTurn')

  expect(headline(yours, [], { kind: 'unknown' }, String)).toBe('2단계 사용자 차례 · 막힘 없음 · 남은 시간 추정 불가')
  expect(nextAction('s', 'in_progress', yours, [], 'yourTurn')).toEqual({ text: '사용자 차례 — 대화창에서 이어서 하라고 말해 주세요', command: null })
  expect(headline(doing, [], { kind: 'unknown' }, String)).toBe('2단계 진행 중 · 막힘 없음 · 남은 시간 추정 불가')
  expect(nextAction('s', 'in_progress', doing, [], 'background')).toEqual({ text: '배경 작업을 기다리는 중 — 끝나면 스스로 이어집니다', command: null })
  expect(nextAction('s', 'in_progress', doing, [], 'working')).toEqual({ text: '진행 중 — 기다리면 됩니다', command: null })
  expect(nextAction('s', 'in_progress', doing, [])).toEqual({ text: '진행 중 — 기다리면 됩니다', command: null })
})

test('your-turn T6 차례가 끝나면 사용자 차례, 다시 시작되면 진행 중으로 돌아온다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] a', 'b', 'c'] }) })
  turnEngine(on)
  await start($)

  // 막 열린 세션: 이 세션이 차례의 끝을 본 적이 없다 — 지금처럼 진행 중
  const fresh = await drawnText($)
  expect(fresh).toContain('2단계 진행 중')
  expect(fresh).not.toContain('사용자 차례')

  await $.turn.start({ text: 'go', turnId: 't1' })
  const working = await drawnText($)
  expect(working).toContain('2단계 진행 중')
  expect(working).not.toContain('사용자 차례')
  expect(working).not.toContain(NODE_COLOR.yourTurn)

  await turnEnd($, 'answer', 5_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^다음: /)).toBe(YOUR_TURN)
  expect(await text(ui, /^2단계 /)).toBe('2단계 사용자 차례 · 막힘 없음 · 남은 시간 추정 불가')
  expect(await text(ui, /지금 여기$/)).toBe('사용자 차례  ◀ 지금 여기')
  await ui.unmount()
  expect(await drawnText($)).toContain(`"backgroundColor":"${NODE_COLOR.yourTurn}"`)

  await $.turn.start({ text: '이어서 해', turnId: 't2' })
  const again = await drawnText($)
  expect(again).toContain('2단계 진행 중')
  expect(again).not.toContain('사용자 차례')
  expect(again).not.toContain(NODE_COLOR.yourTurn)
})

test('your-turn T6b 사용자가 멈춘 차례 뒤에도 사용자 차례', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] a', 'b'] }) })
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await turnEnd($, 'aborted', 5_000)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^다음: /)).toBe(YOUR_TURN)
  await ui.unmount()
})

test('your-turn T7 빨강 멈춤과 배경 작업은 사용자 차례로 보이지 않는다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] a', 'b', 'c'] }) })
  turnEngine(on)
  agentEngine(on)
  const asked: string[] = []
  on('tool.call', async (_, e) => {
    if (e.tool === 'AskUserQuestion') asked.push(await drawnText($))

    return { result: {} }
  })
  await start($)

  // (가) 차례가 끝난 뒤 선택 창이 떠 있는 동안: 빨강 그대로
  await $.turn.start({ text: 'go', turnId: 't1' })
  await turnEnd($, 'answer', 5_000)
  await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'X 할까요?', header: 'h', multiSelect: false, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }] })
  expect(asked[0]).toContain('답을 기다리는 중')
  expect(asked[0]).toContain('2단계 막힘')
  expect(asked[0]).not.toContain('사용자 차례')

  // (나) 오류로 끝난 차례: 빨강 멈춤
  await $.turn.start({ text: 'go', turnId: 't1' })
  await turnEnd($, 'error', 5_000)
  const halted = await drawnText($)
  expect(halted).toContain('멈춤 — 오류')
  expect(halted).not.toContain('사용자 차례')

  // (다) 배경으로 명령을 띄우고 끝난 차례: 노랑 그대로, 글만 배경 작업 기다림
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'sleep 600', run_in_background: true } as never)
  await turnEnd($, 'answer', 5_000)
  const waitingForWork = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(waitingForWork, /^다음: /)).toBe(BACKGROUND)
  expect(await text(waitingForWork, /지금 여기$/)).toBe('진행 중  ◀ 지금 여기')
  await waitingForWork.unmount()
  expect(await drawnText($)).not.toContain('사용자 차례')

  // 그 배경 작업이 세션을 깨워 차례가 돌고, 아무것도 남기지 않고 끝나면: 사용자 차례
  await $.turn.start({ text: '<task-notification>done</task-notification>', turnId: 't1' })
  await turnEnd($, 'answer', 5_000)
  const woken = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(woken, /^다음: /)).toBe(YOUR_TURN)
  await woken.unmount()

  // (라) 보조 작업이 도는 채 끝난 차례: 배경 작업 기다림, 그 보조 작업이 끝나면 사용자 차례
  await $.turn.start({ text: 'go', turnId: 't1' })
  await spawn($, '둘러보기')
  await turnEnd($, 'answer', 5_000)
  const withAgent = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(withAgent, /^다음: /)).toBe(BACKGROUND)
  await withAgent.unmount()
  await $.turn.complete({ turnId: 'a1', answer: '', durationMs: 1, isAborted: false, reason: 'answer', agentId: 'ag-둘러보기' } as never)
  const agentDone = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(agentDone, /^다음: /)).toBe(YOUR_TURN)
  await agentDone.unmount()
})

test('your-turn T8 거울 세션도 받은 상태로 사용자 차례 · 배경 작업 기다림을 그린다', async ($, on) => {
  const env = engine(on, {})
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  const hostPlan = { slug: 'p', isArchived: false, ...plan({ title: '작업 세션 계획', status: 'in_progress', steps: ['[x] a', 'b', 'c'] }) }
  const send = (live: Record<string, unknown>, sentAt: number) =>
    $.session.receive({
      origin: { kind: 'peer' },
      text: envelope(mirrorText({ kind: 'state', body: JSON.stringify({ snapshot: { plans: [hostPlan], dreamsText: null, cwd: '/host', root: '/host' }, live, sentAt }) })),
    })

  await send({ isWorking: false, turnStartedAt: 0, tool: null, hasEnded: true }, 1)
  expect(await drawnText($)).toContain('2단계 사용자 차례')

  await send({ isWorking: false, turnStartedAt: 0, tool: null, hasEnded: true, background: true }, 2)
  const waitingForWork = await drawnText($)
  expect(waitingForWork).toContain('배경 작업을 기다리는 중')
  expect(waitingForWork).not.toContain('사용자 차례')

  // 새 표시를 모르는 옛 버전의 작업 세션이 보낸 상태: 지금처럼 진행 중
  await send({ isWorking: false, turnStartedAt: 0, tool: null }, 3)
  const old = await drawnText($)
  expect(old).toContain('2단계 진행 중')
  expect(old).not.toContain('사용자 차례')
})

// ── now view: 지금 하는 일 · 뒤에서 도는 일 · 최근 끝난 일 ─────────────────────────

import { applyDone, applyJobEvent, findJob, jobEndOf, jobStartOf, nowBlock, nowLine, progressOf, tailOf } from './model'
import type { DoneEntry, Job, JobBoard } from '../types'

const NO_JOBS: JobBoard = { jobs: [], extra: 0 }
const job = (over: Partial<Job> & { id: string; title: string }): Job => ({ kind: 'command', startedAt: 1_000_000, changedAt: 1_000_000, ...over })
const BG_TEXT = (id: string, path: string) => `Command running in background with ID: ${id}. Output is being written to: ${path}. You will be notified when it completes.`
const NOTICE = (id: string, status: string, summary: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<output-file>/tmp/tasks/${id}.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`

// A plan with a step in progress, a turn engine, and tool calls that answer like a command sent to the background.
const nowEngine = (on: On, isClockMocked = false) => {
  JOB_OUTPUTS.files = {}
  JOB_OUTPUTS.reads = []
  const outputs = JOB_OUTPUTS.files
  const reads = JOB_OUTPUTS.reads
  const env = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] a', 'b', 'c'] }) }, DREAMS, { at: 1_000_000 }, {}, isClockMocked)
  turnEngine(on)
  agentEngine(on)
  on('fs.stat', (_, e) => {
    const found = outputs[e.path]

    return found ? ({ value: { kind: 'file', size: found.size ?? found.text.length, mtimeMs: found.mtimeMs, isLink: false } } as never) : { deny: `ENOENT ${e.path}` }
  })
  let serial = 0
  on('tool.call', (_, e) => {
    const input = e as unknown as Record<string, unknown>
    if (e.tool === 'Bash' && input.run_in_background === true) {
      serial += 1
      const id = `bg${serial}`

      return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: id }, text: BG_TEXT(id, `/tmp/tasks/${id}.output`) } as never
    }
    if (e.tool.endsWith('run_in_terminal')) return { result: {}, text: '{"tab_id":"c1","cwd":"/work"}' } as never

    return { result: {} }
  })

  return { ...env, outputs, reads }
}

const spoken = ($: Engine, textTyped: string) => $.turn.start({ text: textTyped, turnId: 't1' })

test('now-view T1 뒤의 일이 도는 중에 사용자가 말을 걸어도 사용자 차례가 아니다', async ($, on) => {
  nowEngine(on)
  await start($)
  await spoken($, '측정 돌려 줘')
  await $.tool.call({ tool: 'Bash', command: 'npm run measure', description: '측정 128판', run_in_background: true } as never)
  await turnEnd($, 'answer', 5_000)
  // 그 일이 도는 동안 사용자가 한마디 한다 — 새 턴이 시작되고, 아무것도 뒤로 보내지 않고 끝난다
  await spoken($, '지금 뭐 해?')
  await turnEnd($, 'answer', 2_000)
  const drawn = await drawnText($)
  expect(drawn).not.toContain('사용자 차례')
  expect(drawn).toContain('배경 작업을 기다리는 중')
  expect(drawn).toContain('측정 128판')
})

test('now-view T2 일이 끝나면 목록에서 빠지고, 남은 일이 없으면 사용자 차례다', async ($, on) => {
  nowEngine(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await start($)
  await spoken($, '측정 돌려 줘')
  await $.tool.call({ tool: 'Bash', command: 'npm run measure', description: '측정 128판', run_in_background: true } as never)
  await turnEnd($, 'answer', 5_000)
  await spoken($, '지금 뭐 해?')
  await turnEnd($, 'answer', 2_000)
  // 끝 알림이 세션을 깨운다
  await spoken($, NOTICE('bg1', 'completed', 'Background command "측정 128판" completed (exit code 0)'))
  await turnEnd($, 'answer', 2_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^다음: /)).toBe(YOUR_TURN)
  expect(await text(ui, /측정 128판 끝$/)).toMatch(/^\d{2}:\d{2} 측정 128판 끝$/)
  expect(await text(ui, /^뒤에서 도는 일/)).toBeUndefined()
  await ui.unmount()

  // 실패로 끝난 일은 실패라고 적힌다; 알림이 도는 턴 안으로 들어와도(턴 시작 없이) 끝으로 친다
  await spoken($, '다시 돌려')
  await $.tool.call({ tool: 'Bash', command: 'npm run measure', description: '다시 재기', run_in_background: true } as never)
  await $.prompt.submit({ text: NOTICE('bg2', 'failed', 'Background command "다시 재기" failed (exit code 1)'), wait: false, origin: { kind: 'task-notification' }, turnId: 't1' } as never)
  await turnEnd($, 'answer', 2_000)
  const again = await drawnText($)
  expect(again).toContain('다시 재기 실패')
  expect(again).toContain('사용자 차례')
})

test('now-view T3 뒤에서 도는 일이 일마다 한 줄 — 이름 · 걸린 시간 · 마지막 진행 줄', () => {
  const board: JobBoard = {
    jobs: [
      job({ id: 'a', title: '시험 전체 돌리기', startedAt: 1_000_000 - 95_000, line: '[4/7] 코어 받아 오기 연습 …', done: 4, total: 7 }),
      job({ id: 'b', title: '측정 128판', startedAt: 1_000_000 - 12_000 }),
    ],
    extra: 0,
  }
  const block = nowBlock({ now: { text: 'x', since: null }, board, done: [], at: 1_000_000, offsetMinutes: 0, formatDuration })
  expect(block.jobs.map(row => row.text)).toEqual(['시험 전체 돌리기 · 1분 35초 · [4/7] 코어 받아 오기 연습 …', '측정 128판 · 12초'])
  expect(Math.abs((block.jobs[0]?.ratio ?? 0) - 4 / 7) < 1e-9).toBe(true)
  expect(block.jobs[1]?.ratio).toBeNull()
  // 설명 글이 없는 명령은 명령의 앞 60자가 이름
  const long = `npm run ${'x'.repeat(80)}`
  const started = jobStartOf('Bash', { command: long, run_in_background: true }, { result: { backgroundTaskId: 'z' }, text: '' }, 5)
  expect(started?.title).toBe(`${long.slice(0, 59)}…`)
  expect(jobStartOf('Bash', { command: 'ls' }, { result: {}, text: '' }, 5)).toBeNull()
  // 시간 제한으로 뒤로 넘어간 명령도 뒤의 일이다
  expect(jobStartOf('Bash', { command: 'sleep 999', description: '오래 걸림' }, { result: { backgroundTaskId: 'k' }, text: BG_TEXT('k', '/tmp/k.output') }, 5)).toEqual(
    job({ id: 'k', title: '오래 걸림', startedAt: 5, changedAt: 5, output: '/tmp/k.output' }),
  )
})

test('now-view T4 진행 막대 — 한 것 / 전체 꼴을 읽는다', () => {
  expect(progressOf('끝난 판: 10 / 64')).toEqual({ line: '끝난 판: 10 / 64', done: 10, total: 64 })
  expect(progressOf('[4/7] 이름 … 통과 (257초)')).toMatchObject({ done: 4, total: 7 })
  expect(progressOf('Progress 45%')).toMatchObject({ done: 45, total: 100 })
  expect(progressOf('그냥 글')).toEqual({ line: '그냥 글' })
  expect(progressOf('0 / 0')).toEqual({ line: '0 / 0' })
  expect(progressOf('9 / 7')).toEqual({ line: '9 / 7' })
  expect(progressOf('')).toEqual({ line: '' })
  expect(progressOf('앞 줄 1/9\n\n마지막 줄 2/9\n\n')).toMatchObject({ line: '마지막 줄 2/9', done: 2, total: 9 })
})

test('now-view T5 지금 하는 일 — 앱의 할 일 목록에서 하는 중인 항목과 시작 시각', async ($, on) => {
  const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
  const items = [
    { content: '코드 읽기', status: 'in_progress' },
    { content: '시험 쓰기', status: 'pending' },
    { content: '고치기', status: 'pending' },
  ]
  const first = applyTaskEvent([], PLAN_TOOL, { items }, 100)
  expect(first.map(task => `${task.subject}:${task.status}`)).toEqual(['코드 읽기:in_progress', '시험 쓰기:pending', '고치기:pending'])
  expect(first[0]?.at).toBe(100)
  const second = applyTaskEvent(first, PLAN_TOOL, { advance: true }, 200)
  expect(second.map(task => task.status)).toEqual(['completed', 'in_progress', 'pending'])
  expect(second[1]?.at).toBe(200)
  const third = applyTaskEvent(second, PLAN_TOOL, { done: [2], start: 3 }, 300)
  expect(third.map(task => task.status)).toEqual(['completed', 'completed', 'in_progress'])
  expect(third[2]?.at).toBe(300)
  // 못 읽는 꼴은 지금 값을 그대로 둔다
  expect(applyTaskEvent(third, PLAN_TOOL, { items: 'x' }, 400)).toEqual(third)
  const working = { step: null, tool: null, jobs: [], extra: 0, isWorking: true, turnStartedAt: 50 }
  expect(nowLine({ ...working, tasks: first })).toEqual({ text: '코드 읽기', since: 100 })
  expect(nowLine({ ...working, tasks: second })).toEqual({ text: '시험 쓰기', since: 200 })
  expect(nowLine({ ...working, tasks: third })).toEqual({ text: '고치기', since: 300 })

  // 화면: 앱의 할 일 도구를 부르면 지금 하는 일과 끝난 일에 실린다
  nowEngine(on)
  await start($)
  await spoken($, '고쳐 줘')
  await $.tool.call({ tool: PLAN_TOOL, items } as never)
  await $.tool.call({ tool: PLAN_TOOL, advance: true } as never)
  const drawn = await drawnText($)
  expect(drawn).toContain('시험 쓰기')
  expect(drawn).toContain('코드 읽기 끝')
  expect(drawn).toContain('할 일 1/3')
})

test('now-view T6 지금 하는 일 — 재료를 차례로 본다', () => {
  const tasks = [{ id: '1', subject: '시험 쓰기', status: 'in_progress' as const, at: 7 }]
  const step = { number: 3, name: '진행 줄을 읽는다' }
  const tool = { name: 'Bash', target: '시험 전체 돌리기', startedAt: 9 }
  const base = { tasks: [], step: null, tool: null, jobs: [] as Job[], extra: 0, isWorking: true, turnStartedAt: 5 }
  expect(nowLine({ ...base, tasks })).toEqual({ text: '시험 쓰기', since: 7 })
  expect(nowLine({ ...base, step })).toEqual({ text: '3단계 — 진행 줄을 읽는다', since: 5 })
  expect(nowLine({ ...base, tool })).toEqual({ text: '시험 전체 돌리기', since: 9 })
  expect(nowLine({ ...base, isWorking: false, jobs: [job({ id: 'a', title: '측정 128판', startedAt: 3 })] })).toEqual({ text: '뒤에서 도는 일을 기다리는 중 — 측정 128판', since: 3 })
  expect(nowLine(base)).toEqual({ text: '결과를 읽거나 다음을 정하는 중', since: 5 })
  // 함께 있으면 할 일 목록이 이긴다; 턴이 끝났고 도는 일이 있으면 기다림이 이긴다
  expect(nowLine({ ...base, tasks, step, tool }).text).toBe('시험 쓰기')
  expect(nowLine({ ...base, tasks, isWorking: false, jobs: [job({ id: 'a', title: '가' }), job({ id: 'b', title: '나' })] }).text).toBe('뒤에서 도는 일을 기다리는 중 — 가 외 1개')
  expect(nowLine({ ...base, isWorking: false })).toEqual({ text: '사용자의 말을 기다리는 중', since: null })
})

test('now-view T7 최근 끝난 일 — 시각과 함께 최근 5개, 실패는 실패라고', () => {
  const at = (minute: number) => Date.UTC(2026, 10, 16, 10, minute)
  let done: DoneEntry[] = []
  ;[46, 47, 56, 58, 59, 62, 65].forEach((minute, i) => {
    done = applyDone(done, { at: at(minute), text: i === 5 ? '여섯째 실패' : `일 ${i + 1} 끝`, isOk: i !== 5 })
  })
  expect(done).toHaveLength(5)
  const block = nowBlock({ now: { text: 'x', since: null }, board: NO_JOBS, done, at: at(70), offsetMinutes: 0, formatDuration })
  expect(block.done).toEqual(['10:56 일 3 끝', '10:58 일 4 끝', '10:59 일 5 끝', '11:02 여섯째 실패', '11:05 일 7 끝'])
  expect(block.done.filter(line => line.includes('실패'))).toHaveLength(1)
  // 사람의 시계로 적는다(서울: +540분)
  expect(nowBlock({ now: { text: 'x', since: at(46) }, board: NO_JOBS, done: [], at: at(70), offsetMinutes: 540, formatDuration }).now).toBe('x (19:46부터)')
})

test('now-view T8 터미널 탭에서 시작한 명령도 뒤에서 도는 일이다', async ($, on) => {
  nowEngine(on)
  await start($)
  await spoken($, '검사 돌려')
  await $.tool.call({ tool: 'mcp__terminal__run_in_terminal', command: 'bash remaining.sh', title: '남은 검사 7개' } as never)
  await turnEnd($, 'answer', 3_000)
  const running = await drawnText($)
  expect(running).toContain('남은 검사 7개')
  expect(running).toContain('터미널 탭')
  expect(running).not.toContain('사용자 차례')
  await spoken($, '멈춰')
  await $.tool.call({ tool: 'mcp__terminal__stop_terminal_tab', tab_id: 'c1' } as never)
  await turnEnd($, 'answer', 1_000)
  const stopped = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(stopped, /^뒤에서 도는 일/)).toBeUndefined()
  expect(await text(stopped, /남은 검사 7개 멈춤$/)).toBeDefined()
  await stopped.unmount()
})

test('now-view T10 다른 기기에서 보는 화면에도 뒤에서 도는 일과 끝난 일이 보인다', async ($, on) => {
  const env = engine(on, {})
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  const hostPlan = { slug: 'p', isArchived: false, ...plan({ title: '작업 세션 계획', status: 'in_progress', steps: ['[x] a', 'b', 'c'] }) }
  const jobs: JobBoard = { jobs: [job({ id: 'bg1', title: '측정 128판', line: '끝난 판: 10 / 64', done: 10, total: 64 })], extra: 0 }
  const doneLog: DoneEntry[] = [{ at: 1_000_000, text: '일 1 끝', isOk: true }, { at: 1_000_000, text: '일 2 실패', isOk: false }]
  await $.session.receive({
    origin: { kind: 'peer' },
    text: envelope(
      mirrorText({
        kind: 'state',
        body: JSON.stringify({
          snapshot: { plans: [hostPlan], dreamsText: null, cwd: '/host', root: '/host' },
          live: { isWorking: false, turnStartedAt: 0, tool: null, hasEnded: true },
          jobs,
          doneLog,
          sentAt: 1,
        }),
      }),
    ),
  })
  const drawn = await drawnText($)
  // 0.2.29+ — '지금 하는 일' 한 줄은 그리지 않는다(단계 상세의 '지금 진행'이 맡는다). 뒤에서 도는 일과 그 진행은 그대로.
  expect(drawn).not.toContain('지금 하는 일')
  expect(drawn).toContain('측정 128판')
  expect(drawn).toContain('끝난 판: 10 / 64')
  expect(drawn).toContain('일 1 끝')
  expect(drawn).toContain('일 2 실패')
  expect(drawn).not.toContain('사용자 차례')
})

test('now-view T10b 거울로 보내는 글에 출력 파일 위치는 없다', async ($, on) => {
  const env = nowEngine(on)
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_host' })
  await start($)
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'hello', address: 'session_viewer' })) })
  await spoken($, '측정 돌려 줘')
  await $.tool.call({ tool: 'Bash', command: 'npm run measure', description: '측정 128판', run_in_background: true } as never)
  await turnEnd($, 'answer', 5_000)
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'hello', address: 'session_viewer2' })) })
  const wire = env.sent.map(one => one.text).join('\n')
  expect(wire).toContain('측정 128판')
  expect(wire).not.toContain('/tmp/tasks/')
})

test('now-view T11 진행 줄은 한 줄 · 120자, 제어 문자 없음', () => {
  const long = progressOf('가'.repeat(300))
  expect(long.line.length).toBe(120)
  expect(long.line.endsWith('…')).toBe(true)
  expect(progressOf('\u001b[32m통과\u001b[0m 3/9').line).toBe('통과 3/9')
  expect(progressOf('\r 10/64\r 11/64')).toEqual({ line: '11/64', done: 11, total: 64 })
  expect(/[\u0000-\u001f]/.test(progressOf('a\tb\u0007c\r\n').line)).toBe(false)
})

test('now-view T12 읽는 양 — 끝부분만 읽고, 도는 일은 여덟 개까지 기억한다', async ($, on) => {
  // 끝부분만: 큰 글에서도 끝 4천 자만 남긴다
  const big = `${'줄\n'.repeat(100_000)}끝난 판: 10 / 64\n`
  expect(tailOf(big).length).toBeLessThanOrEqual(4000)
  expect(progressOf(tailOf(big))).toMatchObject({ done: 10, total: 64 })
  // 여덟이 모두 도는 중이면 아홉째는 세기만 한다
  let board = NO_JOBS
  for (let i = 1; i <= 9; i += 1) board = applyJobEvent(board, { kind: 'start', job: job({ id: `j${i}`, title: `일 ${i}` }) })
  expect(board.jobs).toHaveLength(8)
  expect(board.extra).toBe(1)
  const block = nowBlock({ now: { text: 'x', since: null }, board, done: [], at: 1_000_000, offsetMinutes: 0, formatDuration })
  expect(block.jobs.at(-1)?.text).toBe('외 1개')
  // 모르는 이름표의 끝 알림은 세어 둔 것부터 줄인다
  expect(applyJobEvent(board, { kind: 'end', id: 'unknown' }).extra).toBe(0)
  // 같은 이름표로 두 번 시작해도 한 줄
  expect(applyJobEvent(applyJobEvent(NO_JOBS, { kind: 'start', job: job({ id: 'a', title: '가' }) }), { kind: 'start', job: job({ id: 'a', title: '가' }) }).jobs).toHaveLength(1)

  // 화면: 출력 파일이 바뀌었을 때만 읽고, 큰 파일은 통째로 읽지 않는다
  const clock = mock.clock(on, { now: 1_000_000 })
  const env = nowEngine(on, true)
  env.outputs['/tmp/tasks/bg1.output'] = { text: '끝난 판: 10 / 64\n', mtimeMs: 1 }
  env.outputs['/tmp/tasks/bg2.output'] = { text: 'x', mtimeMs: 1, size: 9_000_000 }
  env.proc.stdout = '끝난 판: 3 / 9\n'
  await start($)
  await spoken($, '둘 다 돌려')
  await $.tool.call({ tool: 'Bash', command: 'a', description: '작은 출력', run_in_background: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'b', description: '큰 출력', run_in_background: true } as never)
  await turnEnd($, 'answer', 1_000)
  await clock.advance(3000)
  const drawn = await drawnText($)
  expect(drawn).toContain('끝난 판: 10 / 64')
  expect(drawn).toContain('끝난 판: 3 / 9')
  expect(env.reads).toEqual(['/tmp/tasks/bg1.output'])
  expect(env.processes.some(argv => argv[0] === 'tail' && argv.at(-1) === '/tmp/tasks/bg2.output')).toBe(true)
  // 바뀌지 않았으면 다시 읽지 않는다
  await clock.advance(3000)
  expect(env.reads).toHaveLength(1)
})

test('now-view T13 끝났는지 모르면 끝났다고 그리지 않는다', () => {
  const quiet = job({ id: 'a', title: '조용한 일', output: '/tmp/a.output', startedAt: 0, changedAt: 0 })
  const block = nowBlock({ now: { text: 'x', since: null }, board: { jobs: [quiet], extra: 0 }, done: [], at: 5 * 60_000 + 1, offsetMinutes: 0, formatDuration })
  expect(block.jobs[0]?.isStale).toBe(true)
  expect(block.jobs[0]?.text).toContain('끝난 듯')
  expect(block.done).toEqual([])
  // 출력 파일이 없는 일(터미널 탭)은 조용해도 끝난 듯이 아니다
  const tab = nowBlock({ now: { text: 'x', since: null }, board: { jobs: [job({ id: 'tab:c1', title: '탭', kind: 'terminal', startedAt: 0, changedAt: 0 })], extra: 0 }, done: [], at: 10 * 60_000, offsetMinutes: 0, formatDuration })
  expect(tab.jobs[0]?.isStale).toBe(false)
  // 끝난 듯이어도 차례는 사용자에게 넘어가지 않는다
  expect(turnStateOf({ isWorking: false, hasEnded: true, blocks: [], agents: 0, background: false, jobs: 1 })).toBe('background')
})

test('now-view T14 순수 단계 — 같은 입력 같은 출력, 입력을 바꾸지 않는다', () => {
  const board: JobBoard = { jobs: [job({ id: 'a', title: '가' })], extra: 0 }
  const frozen = JSON.stringify(board)
  const done: DoneEntry[] = [{ at: 1, text: '일 끝', isOk: true }]
  const doneFrozen = JSON.stringify(done)
  const twice = <T,>(run: () => T) => expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  twice(() => jobStartOf('Bash', { command: 'x', run_in_background: true }, { result: { backgroundTaskId: 'q' }, text: '' }, 1))
  twice(() => jobEndOf({ text: NOTICE('a', 'completed', 'done (exit code 0)') }))
  twice(() => applyJobEvent(board, { kind: 'progress', id: 'a', line: '1/2', done: 1, total: 2, at: 9 }))
  twice(() => applyJobEvent(board, { kind: 'end', id: 'a' }))
  twice(() => applyDone(done, { at: 2, text: '둘 끝', isOk: true }))
  twice(() => progressOf('3 / 4'))
  twice(() => nowLine({ tasks: [], step: null, tool: null, jobs: board.jobs, extra: 0, isWorking: false, turnStartedAt: 0 }))
  twice(() => nowBlock({ now: { text: 'x', since: 1 }, board, done, at: 99, offsetMinutes: 0, formatDuration }))
  expect(JSON.stringify(board)).toBe(frozen)
  expect(JSON.stringify(done)).toBe(doneFrozen)
  // 끝 알림 읽기
  expect(jobEndOf({ text: NOTICE('a', 'completed', 'x completed (exit code 0)') })).toEqual({ id: 'a', how: 'done' })
  expect(jobEndOf({ text: NOTICE('a', 'failed', 'x failed (exit code 2)') })).toEqual({ id: 'a', how: 'failed' })
  expect(jobEndOf({ text: NOTICE('a', 'killed', 'x was stopped') })).toEqual({ id: 'a', how: 'stopped' })
  expect(jobEndOf({ text: '<task-notification>done</task-notification>' })).toEqual({ id: null, how: 'done' })
  expect(jobEndOf({ text: '그냥 한 말' })).toBeNull()
  expect(jobEndOf({ tool: 'TaskStop', input: { task_id: 'a' } })).toEqual({ id: 'a', how: 'stopped' })
  expect(jobEndOf({ tool: 'Read', input: {} })).toBeNull()
  expect(findJob(board, null)?.id).toBe('a')
  expect(findJob(board, 'nope')).toBeUndefined()
})

// ── mirror-no-reask: 보는 세션은 스스로 다시 묻지 않고, 사람이 '다시 요청'을 누른다 ───────────

import { isMirrorAskDue, mirrorLineText } from './model'

test('mirror-no-reask T2 다시 요청 버튼은 누를 때 한 번 묻는다', async ($, on) => {
  const env = engine(on, {})
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  expect(env.sent).toHaveLength(1)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'mirror-ask' }))?.text).toBe('다시 요청')
  await ui.press({ key: 'mirror-ask' })
  expect(env.sent).toHaveLength(2)
  expect(env.sent[1]?.text).toBe('SCV-MIRROR HELLO session_viewer')
  expect(env.toasts.filter(toast => toast.includes('다시 요청했습니다'))).toHaveLength(1)
  // 못 보냈으면 못 보냈다고 알린다
  env.delivery.isDelivered = false
  await ui.press({ key: 'mirror-ask' })
  expect(env.toasts.some(toast => toast.includes('보내지 못했습니다'))).toBe(true)
  await ui.unmount()
})

test('mirror-no-reask T3 10분 넘게 받지 못했으면 거울 줄이 그 사실을 말한다', () => {
  const base = { host: 'session_host', name: '작업 세션', formatDuration }
  expect(mirrorLineText({ ...base, receivedAt: 1_000_000, at: 1_030_000 })).toBe('거울: 작업 세션 (session_host) · 30초 전 받음')
  expect(mirrorLineText({ ...base, receivedAt: 1_000_000, at: 1_000_000 + 11 * 60_000 })).toBe(
    '거울: 작업 세션 (session_host) · 11분 0초 전 받음 · 10분 넘게 소식 없음(쉬는 중이거나 끊김)',
  )
  expect(mirrorLineText({ ...base, receivedAt: 0, at: 1_000_000 + 11 * 60_000 })).toBe('거울: 작업 세션 (session_host) · 상태를 기다리는 중')
  expect(mirrorLineText({ host: 'session_host', receivedAt: 1_000_000, at: 1_001_000, formatDuration })).toBe('거울: session_host · 1초 전 받음')
})

test('mirror-no-reask T4 스스로 묻는 것은 상태를 못 받은 동안 주소가 달라졌을 때뿐이다', () => {
  expect(isMirrorAskDue({ at: 1_000_000, from: 'a' }, 'a')).toBe(false)
  expect(isMirrorAskDue({ at: 0, from: 'a' }, 'a')).toBe(false)
  expect(isMirrorAskDue({ at: 0, from: 'a' }, 'b')).toBe(true)
  expect(isMirrorAskDue({ at: 1_000_000, from: 'a' }, 'b')).toBe(false)
})

// ── parallel-steps plan ──────────────────────────────────────────────────────

const statesOf = (steps: string[], reported: { step: number; state: 'doing' | 'done' | 'blocked' }[], extra = '') => {
  const file = plan({ title: 'p', status: 'in_progress', steps })
  const parsed = parsePlan({ slug: 'a', ...file, planText: file.planText + extra })

  return deriveStages(mergeMarks(parsed, reported.map(one => ({ plan: 'a', note: '', at: 0, ...one })))).stages.map(stage => stage.state)
}

test('parallel-steps T1 두 단계의 시작을 차례로 알리면 둘 다 진행 중이다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  await signal($, 1, 'done')
  const second = await signal($, 2, 'doing')
  const fourth = await signal($, 4, 'doing')
  expect(second.deny).toBeUndefined()
  expect(fourth.deny).toBeUndefined()
  expect(String(fourth.result)).toContain('진행 중: 2 · 4단계')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^완료 \d/)).toBe('완료 1 · 진행 2 · 막힘 0 · 대기 2 — 단계를 누르면 자세히')
  expect(String(await text(ui, /단계 진행 중 · 막힘/)).startsWith('2 · 4단계 진행 중')).toBe(true)
  expect((await ui.findAll({ type: 'Text', text: /지금 여기/ })).length).toBe(2)
  await ui.unmount()
})

test('parallel-steps T2 한 단계가 끝나도 다른 단계는 진행 중으로 남는다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  await signal($, 1, 'done')
  await signal($, 2, 'doing')
  await signal($, 4, 'doing')
  const ended = await signal($, 2, 'done')
  expect(String(ended.result)).toContain('2/5')
  expect(String(ended.result)).toContain('진행 중: 4단계')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^완료 \d/)).toBe('완료 2 · 진행 1 · 막힘 0 · 대기 2 — 단계를 누르면 자세히')
  await ui.unmount()

  const reported = [
    { step: 1, state: 'done' as const },
    { step: 2, state: 'done' as const },
    { step: 4, state: 'doing' as const },
  ]
  expect(statesOf(FIVE, reported)).toEqual(['done', 'done', 'waiting', 'doing', 'waiting'])
  // 알린 진행이 없어지면 첫 단계 규칙이 돌아온다
  expect(statesOf(FIVE, [...reported.slice(0, 2), { step: 4, state: 'done' }])).toEqual(['done', 'done', 'doing', 'done', 'waiting'])
})

test('parallel-steps T3 이미 끝난 단계에 시작 · 막힘을 보내면 거절한다', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  await signal($, 1, 'done')

  expect((await signal($, 1, 'doing')).deny).toContain('1단계는 이미 끝났습니다')
  expect((await signal($, 1, 'blocked', '이유')).deny).toContain('1단계는 이미 끝났습니다')
  expect(store.get('signals:/work')).toEqual([{ plan: 'a', step: 1, state: 'done', note: '', at: 1_000_000, evidence: { files: [], output: DONE_OUTPUT } }])
})

test('parallel-steps T4 뒤 단계의 막힘도 받는다 — 진행 중인 다른 단계는 그대로', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  await start($)
  await signal($, 1, 'done')
  await signal($, 2, 'doing')
  await signal($, 4, 'doing')
  expect((await signal($, 4, 'blocked', '시험 실패')).deny).toBeUndefined()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(String(await text(ui, /단계 막힘 · /)).startsWith('4단계 막힘 · 2단계 진행 중')).toBe(true)
  expect(await text(ui, /시험 실패/)).toBe('d — 시험 실패')
  await ui.unmount()
  expect(
    statesOf(FIVE, [
      { step: 1, state: 'done' },
      { step: 2, state: 'doing' },
      { step: 4, state: 'blocked' },
    ]),
  ).toEqual(['done', 'doing', 'waiting', 'blocked', 'waiting'])
})

test('parallel-steps T5 손으로 남은 표시는 뒤 단계를 열지 않는다 — 알린 단계만 연다', () => {
  expect(statesOf(['[x] a', 'b', '[~] c'], [])).toEqual(['done', 'doing', 'waiting'])
  expect(statesOf(['[x] a', 'b', 'c'], [{ step: 3, state: 'doing' }])).toEqual(['done', 'waiting', 'doing'])
  expect(statesOf(['[x] a', 'b', 'c'], [], '\n## 변경 이력\n\n- **2026-11-16 진행** — 3단계 시작: 먼저 함\n')).toEqual(['done', 'waiting', 'doing'])
})

test('parallel-steps T6 맨 위 한 줄은 이어진 번호를 줄여 말한다', () => {
  const line = (doing: number[], total = 14) =>
    headline(
      Array.from({ length: total }, (_, i) => st(`s${i + 1}`, doing.includes(i + 1) ? 'doing' : i + 1 < Math.min(...doing, total + 1) ? 'done' : 'waiting')),
      [],
      { kind: 'unknown' },
      String,
    )
  expect(line([5]).startsWith('5단계 진행 중 · ')).toBe(true)
  expect(line([5, 6]).startsWith('5 · 6단계 진행 중 · ')).toBe(true)
  expect(line([6, 7, 8, 9, 10, 11, 12, 13]).startsWith('6~13단계 진행 중 · ')).toBe(true)
  expect(line([2, 4, 5, 6]).startsWith('2 · 4~6단계 진행 중 · ')).toBe(true)
  expect(headline([st('a', 'waiting'), st('b', 'waiting')], [], { kind: 'unknown' }, String).startsWith('시작 전 · ')).toBe(true)
  expect(activeSteps([st('a', 'done'), st('b', 'doing'), st('c', 'waiting'), st('d', 'blocked'), st('e', 'doing')])).toEqual([
    { state: 'blocked', steps: [4] },
    { state: 'doing', steps: [2, 5] },
  ])
})

test('parallel-steps T7 작업은 가장 늦게 시작해 아직 끝나지 않은 단계에 적힌다', () => {
  const last = (list: { plan: string; step: number }[]) => list[list.length - 1]?.step
  const first = nextStarted([], { plan: 'a', step: 2, state: 'doing' })
  const second = nextStarted(first, { plan: 'a', step: 4, state: 'doing' })
  const third = nextStarted(second, { plan: 'a', step: 4, state: 'done' })
  const fourth = nextStarted(third, { plan: 'a', step: 2, state: 'blocked' })
  expect([last(first), last(second), last(third), last(fourth)]).toEqual([2, 4, 2, undefined])
  expect(nextStarted(second, { plan: 'a', step: 2, state: 'doing' })).toEqual([
    { plan: 'a', step: 4 },
    { plan: 'a', step: 2 },
  ])
})

test('parallel-steps T8 사용자 차례 · 답 기다림은 진행 중인 단계 모두에 덧칠된다', () => {
  const stages = [st('a', 'done'), st('b', 'doing'), st('c', 'waiting'), st('d', 'doing')]
  expect(applyTurn(stages, 'yourTurn').map(stage => stage.state)).toEqual(['done', 'yourTurn', 'waiting', 'yourTurn'])
  expect(applyBlocks(stages, [{ kind: 'waiting', title: '', detail: '' }]).map(stage => stage.state)).toEqual(['done', 'blocked', 'waiting', 'blocked'])
})

// ── step evidence: '끝'에는 증거 · 누르면 증거와 실제 진행 (계획 20261117-wookiya1364-checks-not-comments 4단계) ─────────
import { judgeEvidence, liveOf } from './model'

type FakeFile = { text?: string; base64?: string; mtimeMs: number; size?: number; real?: string }

// The project's files a step sends as evidence or as its log, answered by stat and read; the project root is /work.
const evidenceFiles = (on: Parameters<TestBody>[1], files: Record<string, FakeFile>) => {
  on('fs.stat', (_, e) => {
    if (e.path === '/work') return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: '/work' } } as never
    const found = files[e.path]
    if (!found) return { deny: `ENOENT ${e.path}` }

    return { value: { kind: 'file', size: found.size ?? (found.text ?? found.base64 ?? '').length, mtimeMs: found.mtimeMs, isLink: false, realPath: found.real ?? e.path } } as never
  })
  for (const [path, found] of Object.entries(files)) {
    JOB_OUTPUTS.files[path] = { text: found.text ?? '', mtimeMs: found.mtimeMs, base64: found.base64, size: found.size ?? (found.text ?? found.base64 ?? '').length }
  }
}

const doneWith = ($: Engine, step: number, extra: Record<string, unknown>) =>
  $.tool.call({ tool: STEP_TOOL, plan: 'a', step, state: 'done', ...extra } as never) as Promise<{ deny?: string; result?: unknown }>
const doingWith = ($: Engine, step: number, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: STEP_TOOL, plan: 'a', step, state: 'doing', ...extra } as never) as Promise<{ deny?: string; result?: unknown }>
const lastState = (store: Map<string, unknown>, step: number) =>
  ((store.get('signals:/work') as { step: number; state: string }[] | undefined) ?? []).filter(one => one.step === step).pop()?.state

test('step-evidence T11 증거 없는 끝은 거절하고 단계는 진행 중 그대로', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  evidenceFiles(on, {})
  await start($)
  await doingWith($, 2)
  const answered = await doneWith($, 2, {})
  expect(answered.deny).toContain('끝에는 증거가 필요합니다')
  expect(lastState(store, 2)).toBe('doing')
})

test('step-evidence T12 단계 시작 전에 생긴 파일은 받지 않고, 시작 뒤 파일은 받는다', async ($, on) => {
  const { store, clock } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  evidenceFiles(on, { '/work/old.png': { base64: 'AA', mtimeMs: 500_000 }, '/work/new.png': { base64: 'AA', mtimeMs: 1_500_000 } })
  await start($)
  await doingWith($, 2)
  clock.at = 2_000_000
  expect((await doneWith($, 2, { evidence: ['old.png'] })).deny).toContain('단계 시작 전에 생긴 파일입니다(옛 파일): old.png')
  expect((await doneWith($, 2, { evidence: ['new.png'] })).deny).toBeUndefined()
  expect(lastState(store, 2)).toBe('done')
})

test('step-evidence T13 프로젝트 밖 · 없는 파일은 이유를 달리해 거절한다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  evidenceFiles(on, { '/etc/passwd': { text: 'x', mtimeMs: 9_000_000 }, '/work/link.png': { base64: 'AA', mtimeMs: 9_000_000, real: '/tmp/elsewhere.png' } })
  await start($)
  await doingWith($, 1)
  const outside = await doneWith($, 1, { evidence: ['/etc/passwd'] })
  const linked = await doneWith($, 1, { evidence: ['link.png'] })
  const missing = await doneWith($, 1, { evidence: ['missing.png'] })
  expect(outside.deny).toContain('프로젝트 밖 파일은 증거로 받지 않습니다: /etc/passwd')
  expect(linked.deny).toContain('프로젝트 밖 파일은 증거로 받지 않습니다: link.png')
  expect(missing.deny).toContain('증거 파일이 없습니다: missing.png')
  expect(outside.deny).not.toBe(missing.deny)
})

test('step-evidence T14 명령 출력 발췌도 증거다 — 빈 글은 아니다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  evidenceFiles(on, {})
  await start($)
  expect((await doneWith($, 1, { output: '   ' })).deny).toContain('끝에는 증거가 필요합니다')
  expect((await doneWith($, 1, { output: '통과 21 · 실패 0' })).deny).toBeUndefined()
  // 순수 판정: 출력은 끝부분 1200자만 남는다
  const kept = judgeEvidence([], 'x'.repeat(2000), [], undefined)
  expect(kept.isOk && kept.evidence.output?.length).toBe(1200)
})

test('step-evidence T15 끝난 단계를 누르면 그림 · 글 앞부분 · 출력이 보인다', async ($, on) => {
  const { clock } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  evidenceFiles(on, { '/work/shot.png': { base64: 'iVBORw0KGgo=', mtimeMs: 1_200_000 }, '/work/result.txt': { text: '정확도 0.91 · 손실 0.12', mtimeMs: 1_200_000 } })
  await start($)
  await doingWith($, 1)
  clock.at = 1_300_000
  expect((await doneWith($, 1, { evidence: ['shot.png', 'result.txt'], output: '통과 21 · 실패 0' })).deny).toBeUndefined()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'step-1' })
  const drawn = await drawnText($)
  const pictures = (drawn.match(/data:image\/png;base64,iVBORw0KGgo=/g) ?? []).length
  const textPart = (drawn.match(/정확도 0\.91 · 손실 0\.12/g) ?? []).length
  const outputPart = (drawn.match(/통과 21 · 실패 0/g) ?? []).length
  expect([pictures, textPart, outputPart]).toEqual([1, 1, 1])
  expect(drawn).toContain('▸ shot.png 열기')
  await ui.unmount()
})

test('step-evidence T16 진행 중 단계를 누르면 로그 최근 줄 · 진행률 · 주소 버튼이 보이고 주소는 읽지 않는다', async ($, on) => {
  const { processes } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  evidenceFiles(on, { '/work/train.log': { text: 'load data\nepoch 1/10 loss 0.90\nepoch 3/10 loss 0.42\n', mtimeMs: 1_100_000 } })
  await start($)
  await doingWith($, 1, { log: 'train.log', url: 'https://example.test/run/7' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'step-1' })
  await ui.press({ key: 'step-1' })
  const drawn = await drawnText($)
  expect(drawn).toContain('epoch 3/10 loss 0.42')
  expect(drawn).toContain('"width":"30%"')
  expect(drawn).toContain('▸ 진행 화면 열기 — https://example.test/run/7')
  // 주소는 읽지 않는다: 모드는 웹을 읽는 길($.web)을 쓰지 않고, 여는 명령으로만 넘긴다
  expect(processes.filter(argv => argv.includes('https://example.test/run/7'))).toEqual([])
  await ui.press({ key: 'live-url' })
  expect(processes.some(argv => argv.includes('https://example.test/run/7'))).toBe(true)
  await ui.unmount()
  // 순수: 진행 줄 읽기
  expect(liveOf('a\nstep 45%\n').ratio).toBe(0.45)
  expect(liveOf('no numbers here\n').ratio).toBeNull()
})

test('step-evidence T17 지금 하는 일 카드는 없다', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  evidenceFiles(on, {})
  await start($)
  await doingWith($, 1)
  const drawn = await drawnText($)
  expect(drawn).not.toContain('지금 하는 일')
})

test('a dictionary that is the source: the functions a step writes are the dictionary names it declares (core 0.98.0+)', () => {
  const catalog = { grade: { role: '등급', kind: '고르기' }, add: { role: '더한다', kind: '세기' }, cnt: { role: '센다', kind: '세기' } }
  expect(definedFromCatalog('pub fn grade(g: u8) -> u8 {\n  g\n}', catalog)).toEqual([{ name: 'grade', tier: 'pure', role: '등급', kind: '고르기' }])
  expect(definedFromCatalog('export const add = (a, b) => a + b\ncnt() {\n}', catalog).map(one => one.name)).toEqual(['add', 'cnt'])
  expect(definedFromCatalog('return grade(3)', catalog)).toEqual([])
})

// ── pane 0.3.0: cards on top · the fold · ask mode · gears ──────────────────────
import { askModeView, gearCommand, gearResultView, gearRows, gearRunArgv, paneSections, parseAskMode, parseGears, pluginRoot } from './model'

const CORE_DIR = '/home/u/.claude/plugins/cache/scv-claude-code/scv/0.102.0'
const INSTALLED = JSON.stringify({ plugins: { 'scv@scv-claude-code': [{ scope: 'user', installPath: CORE_DIR }], 'other@x': [{ scope: 'user', installPath: '/x' }] } })
const GEAR_INDEX = [
  'ci-gate\ttooth\tpure\tresults\tverdict\t결과를 판정\t',
  'ci-run\ttooth\teffect\tnone\tresults\tCI 명령을 돌림\t\trepo=core; os=mac',
  'group-subjects\tgear\tpure\tsubjects\tgroups\t제목을 종류별로 묶음\t',
  'make-list\tgear\tpure\tnone\tlines\t목록을 만듦\t',
  'release-ci\tgear\teffect\tnone\tverdict\t릴리스 전 CI 를 다 돌림\t릴리스\trepo=core; os=mac; jobs=4',
].join('\n')
const withProject = (kit: { extra: Record<string, string> }, opts: { settings?: string; index?: string | null; isInstalled?: boolean } = {}) => {
  kit.extra['scv/scv_settings.json'] = opts.settings ?? '{"SCV_LANG":"korean"}'
  if (opts.index !== null) kit.extra['scv/gears/INDEX.tsv'] = opts.index ?? GEAR_INDEX
  if (opts.isInstalled !== false) kit.extra['.claude/plugins/installed_plugins.json'] = INSTALLED
}
const has = async (ui: { find: (q: { type: 'Button'; key: string }) => Promise<unknown> }, key: string) => Boolean(await ui.find({ type: 'Button', key }))

test('pane T14 계획이 없어도 컨텍스트 · 사용 한도 · 묻기 방식 · 기어가 나온다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  on('session.usage', () => ({ value: { rateLimits: LIMITS } }) as never)
  await start($)
  const drawn = await drawnText($)

  expect(drawn).toContain('사용 한도')
  expect(drawn).toContain('5시간 72%')
  expect(drawn).toContain('묻기 방식')
  expect(drawn).toContain('저장해 둔 일(기어) 3')
  expect(drawn).toContain('진행 중인 SCV 계획이 없습니다')
})

test('pane T15 위 칸의 순서와 더 보기 — 접으면 안 보이고, 누르면 보이고, 다시 그려도 남는다', async ($, on) => {
  const kit = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE, tests: ['T1 하나'] }) })
  withProject(kit)
  kit.store.delete('scv-dashboard:more')
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const folded = await drawnText($)

  // the fold's own label names the folded cards, so a line only those cards draw is looked for
  expect(folded).not.toContain('시험 펼치기')
  expect(folded).not.toContain('예상 완료 시간')
  expect(folded.indexOf('묻기 방식')).toBeGreaterThan(-1)
  expect(folded.indexOf('묻기 방식')).toBeLessThan(folded.indexOf('저장해 둔 일(기어) 3'))
  expect(folded.indexOf('저장해 둔 일(기어) 3')).toBeLessThan(folded.indexOf('단계 흐름'))
  await ui.press({ key: 'more-toggle' })
  const opened = await drawnText($)
  expect(opened).toContain('시험 펼치기')
  expect(opened).toContain('예상 완료 시간')
  expect(kit.store.get('scv-dashboard:more')).toBe(true)
  expect(await drawnText($)).toContain('시험 펼치기')
  await ui.unmount()
})

test('pane T16 막힌 작업은 접혀 있어도 위에 보인다', async ($, on) => {
  const kit = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] a', '[!] b', 'c'] }) })
  withProject(kit)
  kit.store.delete('scv-dashboard:more')
  await start($)
  const drawn = await drawnText($)

  expect(drawn).toContain('막힌 작업 1')
  expect(drawn).not.toContain('시험 펼치기')
})

test('pane T17 묻기 방식의 이름과 뜻 — 값 없음 · ends · 모르는 값', async ($, on) => {
  expect(parseAskMode(null)).toBe('all')
  expect(parseAskMode('{"SCV_ASK_MODE":" ENDS "}')).toBe('ends')
  expect(parseAskMode('{"SCV_ASK_MODE":"sometimes"}')).toBe('all')
  expect(parseAskMode('not json')).toBe('all')
  expect(askModeView('all').name).toBe('전부 묻기')
  expect(askModeView('ends').name).toBe('처음 · 끝에만 묻기')
  expect(askModeView('all').next).toBe('ends')
  const kit = engine(on, {})
  withProject(kit, { settings: '{"SCV_ASK_MODE":"ends"}' })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await text(ui, /^처음 · 끝에만 묻기$/)).toBe('처음 · 끝에만 묻기')
  expect((await ui.find({ type: 'Button', key: 'ask-mode-switch' }))?.text).toBe('전부 묻기로 바꾸기')
  await ui.unmount()
})

test('pane T18 묻기 방식 바꾸기 — 본체의 설정 명령을 프로젝트 폴더에서 고른 값으로 한 번 부른다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'ask-mode-switch' })
  const ran = kit.runs.filter(one => one.argv[1]?.endsWith('/ask-mode.sh'))

  expect(ran).toHaveLength(1)
  expect(ran[0]?.argv).toEqual(['bash', `${CORE_DIR}/scripts/ask-mode.sh`, 'ends'])
  expect(ran[0]?.cwd).toBe('/work')
  expect(await text(ui, /^묻기 방식을 바꿈/)).toBe('묻기 방식을 바꿈 — 다음 메시지부터 처음 · 끝에만 묻기')
  await ui.unmount()
})

test('pane T18b 본체 설치를 못 찾으면 명령을 돌리지 않고 입력창에 넣는다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit, { isInstalled: false })
  const { fills } = promptEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'ask-mode-switch' })

  expect(kit.runs.filter(one => one.argv[1]?.endsWith('/ask-mode.sh'))).toHaveLength(0)
  expect(fills).toEqual([{ text: '/scv:ask-mode ends', mode: 'replace' }])
  expect(await text(ui, /^바로 바꾸지 못해/)).toBe('바로 바꾸지 못해 입력창에 넣음: /scv:ask-mode ends')
  await ui.unmount()
})

test('pane T19 기어 목록 — 기어만(톱니 제외), 접힌 줄은 역할 문장, 펼치면 이름 · 값 · 정할 값', async ($, on) => {
  expect(parseGears(GEAR_INDEX).map(one => one.name)).toEqual(['group-subjects', 'make-list', 'release-ci'])
  expect(parseGears(GEAR_INDEX)[2]).toEqual({ name: 'release-ci', mark: 'effect', takes: 'none', gives: 'verdict', does: '릴리스 전 CI 를 다 돌림', args: ['repo=core', 'os=mac', 'jobs=4'], words: ['릴리스'] })
  expect(parseGears(null)).toEqual([])
  const kit = engine(on, {})
  withProject(kit)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const folded = await drawnText($)

  expect(folded).toContain('릴리스 전 CI 를 다 돌림')
  expect(folded).toContain('하려는 일을 그냥 말해도')
  expect(folded).not.toContain('없음 → verdict')
  expect(folded).not.toContain('repo=core')
  expect(folded).not.toContain('ci-gate')
  expect(folded).not.toContain('ci-run')
  await ui.press({ key: 'gear-open-release-ci' })
  const opened = await drawnText($)
  expect(opened).toContain('이름 release-ci')
  expect(opened).toContain('없음 → verdict')
  expect(opened).toContain('정할 값 repo=core · os=mac · jobs=4')
  expect(opened).toContain('이럴 때: 릴리스')
  await ui.press({ key: 'gear-open-release-ci' })
  expect(await drawnText($)).not.toContain('정할 값')
  await ui.unmount()
})

test('pane T19b 기어 목록 파일이 없는 프로젝트는 안내 한 줄이고 창이 깨지지 않는다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit, { index: null })
  await start($)
  const drawn = await drawnText($)

  expect(drawn).toContain('저장해 둔 일(기어) 0')
  expect(drawn).toContain('이 프로젝트에 기어가 없습니다')
})

test('pane T20 쓰기 — 부작용 있는 기어는 쓰기만, 누르면 입력창에 그 기어의 명령이 들어간다', async ($, on) => {
  const rows = gearRows(parseGears(GEAR_INDEX), true, true)
  expect(rows.map(one => one.direct)).toEqual(['input', 'run', null])
  expect(gearRows(parseGears(GEAR_INDEX), false, true).map(one => one.direct)).toEqual([null, null, null])
  expect(gearRows(parseGears(GEAR_INDEX), true, false).map(one => one.direct)).toEqual([null, 'run', null])
  expect(gearCommand('release-ci')).toBe('/scv:gear run release-ci')
  expect(gearCommand('bad name; rm')).toBe(null)
  const kit = engine(on, {})
  withProject(kit)
  const { fills } = promptEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await has(ui, 'gear-use-release-ci')).toBe(true)
  await ui.press({ key: 'gear-open-release-ci' })
  expect(await has(ui, 'gear-run-release-ci')).toBe(false)
  await ui.press({ key: 'gear-open-make-list' })
  expect(await has(ui, 'gear-run-make-list')).toBe(true)
  await ui.press({ key: 'gear-use-release-ci' })
  expect(fills).toEqual([{ text: '/scv:gear run release-ci', mode: 'replace' }])
  expect(kit.runs.filter(one => one.argv[1]?.endsWith('/gear.sh'))).toHaveLength(0)
  await ui.unmount()
})

test('pane T21 바로 실행 — 본체 기어 실행기를 30초 제한으로 부르고 출력을 칸에 보인다', async ($, on) => {
  expect(gearRunArgv(CORE_DIR, 'make-list')).toEqual(['bash', `${CORE_DIR}/scripts/gear.sh`, 'run', 'make-list'])
  expect(gearResultView(0, 'a\nb\n', '')).toEqual(['a', 'b'])
  expect(gearResultView(0, '', '')).toEqual(['끝남 — 출력 없음'])
  expect(gearResultView(1, '', 'GEAR_ERROR: 없음')).toEqual(['실패 — 종료 코드 1', 'GEAR_ERROR: 없음'])
  expect(gearResultView(0, '1\n2\n3\n4', '', 2)).toEqual(['1', '2', '… 외 2줄'])
  const kit = engine(on, {})
  withProject(kit)
  kit.proc.stdout = '하나\n둘\n'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'gear-open-make-list' })
  await ui.press({ key: 'gear-run-make-list' })
  const ran = kit.runs.filter(one => one.argv[1]?.endsWith('/gear.sh'))

  expect(ran).toHaveLength(1)
  expect(ran[0]).toEqual({ argv: ['bash', `${CORE_DIR}/scripts/gear.sh`, 'run', 'make-list'], cwd: '/work', stdin: '', timeoutMs: 30_000 })
  expect(await text(ui, /^│ 하나$/)).toBe('│ 하나')
  kit.procEnd.exitCode = 1
  kit.procEnd.stderr = 'GEAR_ERROR: 톱니 파일이 없다'
  await ui.press({ key: 'gear-run-make-list' })
  expect(await text(ui, /^│ 실패/)).toBe('│ 실패 — 종료 코드 1')
  await ui.unmount()
})

test('pane T21b 표시 칸이 없는 예전 목록 파일이면 바로 실행이 없다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit, { index: 'make-list\tgear\t-\tnone\tlines\t목록을 만듦\t' })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'gear-open-make-list' })
  expect(await has(ui, 'gear-run-make-list')).toBe(false)
  expect(await has(ui, 'gear-use-make-list')).toBe(true)
  // the session asked SCV once to write the index again (a newer core fills the mark in)
  expect(kit.runs.filter(one => one.argv[1]?.endsWith('/gear.sh')).map(one => one.argv.slice(2))).toEqual([['index']])
  await ui.unmount()
})

test('pane T22 입력 칸에 적은 글은 표준 입력으로만 가고 명령에 섞이지 않는다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  kit.proc.stdout = 'feat 1\n'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'gear-open-group-subjects' })
  await ui.input({ key: 'gear-input-group-subjects', text: 'feat: a; rm -rf "x" count=9' })
  const ran = kit.runs.filter(one => one.argv[1]?.endsWith('/gear.sh'))

  expect(ran).toHaveLength(1)
  expect(ran[0]?.argv).toEqual(['bash', `${CORE_DIR}/scripts/gear.sh`, 'run', 'group-subjects'])
  expect(ran[0]?.stdin).toBe('feat: a; rm -rf "x" count=9')
  await ui.unmount()
})

test('pane T23 확인을 기다리는 기어 실행이 있으면 기어 칸에 알린다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  kit.extraDirs['scv/journal/.gear-run'] = ['abcd1234', 'ffff0000']
  kit.extra['.gear-run/abcd1234/kind'] = 'confirm\n'
  kit.extra['.gear-run/ffff0000/kind'] = 'text\n'
  await start($)

  expect(await drawnText($)).toContain('확인 기다림 1')
})

test('pane T23b 설치 폴더 찾기와 칸 목록 — 순수부', async () => {
  expect(pluginRoot(INSTALLED, '/work')).toBe(CORE_DIR)
  expect(pluginRoot(JSON.stringify({ plugins: { 'scv@m': [{ scope: 'user', installPath: '/u' }, { scope: 'project', projectPath: '/work', installPath: '/p' }] } }), '/work')).toBe('/p')
  expect(pluginRoot('{"plugins":{"other@x":[{"scope":"user","installPath":"/x"}]}}', '/work')).toBe(null)
  expect(pluginRoot(null, '/work')).toBe(null)
  expect(pluginRoot('broken', '/work')).toBe(null)
  expect(paneSections({ plan: false, blocks: false, project: true })).toEqual(['limits', 'askMode', 'gears'])
  expect(paneSections({ plan: true, blocks: true, project: true })).toEqual(['limits', 'askMode', 'gears', 'blocks', 'steps', 'more'])
  expect(paneSections({ plan: true, blocks: false, project: false })).toEqual(['limits', 'steps', 'more'])
})

// ── pane 0.3.1: a gear for what is being typed · one line per gear ───────────────
import { gearCatalog, gearMatch, hintLine, submitWithGear, usedGear, wordsOf } from './model'

const WORDY = [
  'commit-groups\tgear\tpure\tsubjects\tgroups\t커밋 제목을 종류별로 묶음\t커밋 제목 묶음',
  'release-check\tgear\teffect\tnone\tverdict\t릴리스 전에 CI 명령을 다 돌리고 실패가 없을 때만 통과를 알림\t릴리스 CI 시험 검사\trepo=core; os=mac',
].join('\n')
const TEN = Array.from({ length: 10 }, (_, i) => `gear-${String.fromCharCode(97 + i)}\tgear\teffect\tnone\tlines\t${String.fromCharCode(97 + i)} 일을 함\t낱말${i} 일감${i}`).join('\n')
const BAND = { plugin: 'scv-dashboard', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 60 } } as const
const bandText = async ($: Engine) => JSON.stringify(await $.ui.render({ ...BAND, surface: 'desktop' } as never))
// the box changed with no edit of the person's (the engine's own noun for it is not in the test's types)
const boxIs = ($: Engine, text: string) =>
  ($.prompt as unknown as { change: (box: unknown) => Promise<unknown> }).change({ text, cursor: text.length, origin: { kind: 'app' } })

test('gear-match T1~T5 낱말이 둘 이상 겹칠 때만, 조사가 붙어도, 가장 많이 겹친 것 하나', async () => {
  const gears = parseGears(WORDY)
  expect(wordsOf('릴리스 전에, 시험(다) 돌려줘!')).toEqual(['릴리스', '전에', '시험', '돌려줘'])
  expect(gearMatch('릴리스 전에 시험 다 돌려줘', gears)?.gear.name).toBe('release-check')
  expect(gearMatch('릴리스 전에 시험 다 돌려줘', gears)?.hits).toEqual(['릴리스', '시험'])
  expect(gearMatch('릴리스를 하기 전에 검사를 해줘', gears)?.gear.name).toBe('release-check')
  expect(gearMatch('시험 삼아 화면 색을 바꿔 봐', gears)).toBe(null)
  expect(gearMatch('안녕', gears)).toBe(null)
  expect(gearMatch('', gears)).toBe(null)
  expect(gearMatch('/scv:gear run release-check 릴리스 시험', gears)).toBe(null)
  expect(gearMatch('릴리스', gears)).toBe(null)
  const two = parseGears(['a-small\tgear\tpure\tnone\tx\t작은 것\t릴리스 시험', 'b-big\tgear\tpure\tnone\tx\t큰 것\t릴리스 시험 리눅스 검사'].join('\n'))
  expect(gearMatch('릴리스 전에 리눅스에서 시험하고 검사해', two)?.gear.name).toBe('b-big')
})

test('gear-match T6 · T7 치면 입력창 위에 한 줄, 맞는 것이 없으면 아무것도', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit, { index: WORDY })
  await start($)
  expect(await bandText($)).not.toContain('저장해 둔 방법')
  await boxIs($, '릴리스 전에 시험 다 돌려줘')
  const shown = await bandText($)
  expect(shown).toContain('저장해 둔 방법이 있음: 릴리스 전에 CI 명령을 다 돌리고')
  expect(shown).toContain('안 씀')
  await boxIs($, '화면 색을 바꿔 줘')
  expect(await bandText($)).not.toContain('저장해 둔 방법')
  await boxIs($, '')
  expect(await bandText($)).not.toContain('저장해 둔 방법')
})

test('gear-match T8 맞는 기어가 뜬 채로 보내면 글 끝에 한 줄이 붙고, 그 기어가 최근 맨 앞에 온다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit, { index: WORDY })
  const went: string[] = []
  on('prompt.submit', (_, e) => {
    went.push(e.text)
    return { text: e.text }
  })
  await start($)
  await boxIs($, '릴리스 전에 시험 다 돌려줘')
  await bandText($)
  await $.prompt.submit(typed('릴리스 전에 시험 다 돌려줘'))

  expect(went).toHaveLength(1)
  expect(went[0]?.startsWith('릴리스 전에 시험 다 돌려줘\n\n[SCV 기어]')).toBe(true)
  expect(went[0]).toContain('/scv:gear run release-check')
  expect(kit.store.get('scv-dashboard:gear-recent:/work')).toEqual(['release-check'])
  expect(await bandText($)).not.toContain('저장해 둔 방법')
})

test('gear-match T9 안 씀을 누르면 붙이지 않는다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit, { index: WORDY })
  const went: string[] = []
  on('prompt.submit', (_, e) => {
    went.push(e.text)
    return { text: e.text }
  })
  await start($)
  await boxIs($, '릴리스 전에 시험 다 돌려줘')
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  await band.press({ key: 'gear-hint-dismiss' })
  expect(await bandText($)).not.toContain('저장해 둔 방법')
  await $.prompt.submit(typed('릴리스 전에 시험 다 돌려줘'))

  expect(went).toEqual(['릴리스 전에 시험 다 돌려줘'])
  await band.unmount()
})

test('gear-match T10 맞는 것이 없거나, 한 줄을 그린 적이 없거나, 명령이면 글이 그대로 간다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit, { index: WORDY })
  const went: string[] = []
  on('prompt.submit', (_, e) => {
    went.push(e.text)
    return { text: e.text }
  })
  await start($)
  await $.prompt.submit(typed('화면 색을 바꿔 줘'))
  // the text fits a gear, but no line was drawn above the box (a surface without that band): nothing is added
  await $.prompt.submit(typed('릴리스 전에 시험 다 돌려줘'))
  expect(submitWithGear('/scv:status', null, false)).toBe('/scv:status')
  expect(submitWithGear('x', parseGears(WORDY)[0] ?? null, true)).toBe('x')

  expect(went).toEqual(['화면 색을 바꿔 줘', '릴리스 전에 시험 다 돌려줘'])
})

test('gear-list T13 · T14 기어 10개는 5줄과 모두 보기, 최근 쓴 것이 앞에', async ($, on) => {
  const gears = parseGears(TEN)
  expect(gearCatalog(gears, [], false).shown.map(one => one.name)).toEqual(['gear-a', 'gear-b', 'gear-c', 'gear-d', 'gear-e'])
  expect(gearCatalog(gears, ['gear-h', 'gone'], false).shown[0]?.name).toBe('gear-h')
  expect(gearCatalog(gears, [], false).hidden).toBe(5)
  expect(gearCatalog(gears, [], true).shown).toHaveLength(10)
  expect(usedGear(['a', 'b'], 'b')).toEqual(['b', 'a'])
  const kit = engine(on, {})
  withProject(kit, { index: TEN })
  promptEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const uses = async () => (await Promise.all('abcdefghij'.split('').map(c => has(ui, `gear-use-gear-${c}`)))).filter(Boolean).length

  expect(await uses()).toBe(5)
  expect((await ui.find({ type: 'Button', key: 'gears-all' }))?.text).toBe('10개 모두 보기')
  await ui.press({ key: 'gears-all' })
  expect(await uses()).toBe(10)
  await ui.press({ key: 'gear-use-gear-h' })
  const drawn = await drawnText($)
  expect(drawn.indexOf('h 일을 함')).toBeLessThan(drawn.indexOf('a 일을 함'))
  await ui.unmount()
})

test('gear-list T15 역할 문장이 길면 접힌 줄은 줄이고, 펼치면 전문', async ($, on) => {
  const long = '아주 긴 역할 문장입니다 '.repeat(6).trim()
  const rows = gearRows(parseGears(`long-one\tgear\teffect\tnone\tx\t${long}\t`), true, true)
  expect(rows[0]?.title.length).toBeLessThanOrEqual(34)
  expect(rows[0]?.title.endsWith('…')).toBe(true)
  expect(rows[0]?.does).toBe(long)
  expect(hintLine(parseGears(WORDY)[1]!)).toBe('저장해 둔 방법이 있음: 릴리스 전에 CI 명령을 다 돌리고 실패가 없을 때만 통과를 알림')
  const kit = engine(on, {})
  withProject(kit, { index: `long-one\tgear\teffect\tnone\tx\t${long}\t` })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await drawnText($)).not.toContain(long)
  await ui.press({ key: 'gear-open-long-one' })
  expect(await drawnText($)).toContain(long)
  await ui.unmount()
})


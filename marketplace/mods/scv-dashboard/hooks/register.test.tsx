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

// The output files of background jobs the now-view tests set up, and the ones the mod read.
const JOB_OUTPUTS: { files: Record<string, { text: string; mtimeMs: number; size?: number; base64?: string }>; reads: string[] } = { files: {}, reads: [] }

// record: an archived plan's ARCHIVED_AT.md
type Files = Record<string, { planText: string; testsText: string; record?: string }>

const engine = (
  on: On,
  files: Files,
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
  // what SCV's own `ask` prints for a gear, by gear name (none set: the command prints what every other one does)
  const asks: Record<string, string> = {}
  // the commands the pane started and reads as they run (a gear run from the pane): what each was started with, and
  // how the next ones go — the pieces written, the exit code, and for one that does not end by itself a gate it
  // waits at until the test opens it (then `after` is written and it ends). None queued: it writes what every
  // command here prints and ends as they do. ended: how many of them were ended (ran out, or were told to stop).
  const spawns: { argv: string[]; cwd?: string; input?: string }[] = []
  const spawnPlans: { pieces?: string[]; err?: string; code?: number; gate?: Promise<void>; after?: string[] }[] = []
  const spawnEnds = { count: 0 }
  // SCV's gear commands in the order they were started, by either way: 'run …' waited for, 'spawn …' read as it runs
  const gearCalls: string[] = []
  on('process.spawn', async function* (_: unknown, e: { argv: readonly string[]; cwd?: string; input?: string }) {
    spawns.push({ argv: [...e.argv], cwd: e.cwd, input: e.input })
    const at = e.argv.findIndex(word => word.endsWith('/scripts/gear.sh'))
    if (at >= 0) gearCalls.push(`spawn ${e.argv.slice(at + 1).join(' ')}`)
    const how = spawnPlans.shift() ?? { pieces: [proc.stdout], err: procEnd.stderr, code: procEnd.exitCode }
    try {
      for (const text of how.pieces ?? []) if (text) yield { stream: 'stdout' as const, text }
      if (how.err) yield { stream: 'stderr' as const, text: how.err }
      if (how.gate) {
        await how.gate
        for (const text of how.after ?? []) yield { stream: 'stdout' as const, text }
      }

      return { value: { code: how.code ?? 0, signal: null } }
    } finally {
      spawnEnds.count += 1
    }
  } as never)
  // more files this project holds, by the end of their path (settings, gear index, a gear run's state, the installed list)
  const extra: Record<string, string> = {}
  // folders listed for the gear-run state, by the end of their path
  const extraDirs: Record<string, string[]> = {}
  // files listed in a folder (name and when it last changed), by the end of the folder's path
  const extraFiles: Record<string, { name: string; mtimeMs: number }[]> = {}
  // compactions that reached the engine itself (the mod's own answer never does), and what the engine answers
  const compactions: { trigger: string; instructions?: string }[] = []
  on('session.compact', (_, e) => {
    compactions.push({ trigger: e.trigger, instructions: e.instructions })
    return { messages: e.messages, tokensBefore: 500_000, tokensAfter: 40_000 } as never
  })
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
            : [
                ...(Object.entries(extraDirs).find(([end]) => e.path.endsWith(end))?.[1] ?? []).map(dir),
                ...(Object.entries(extraFiles).find(([end]) => e.path.endsWith(end))?.[1] ?? []).map(one => ({ ...dir(one.name), kind: 'file' as const, mtimeMs: one.mtimeMs })),
              ],
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
    // SCV's own gear commands answer as SCV does: `ask` with the gear's values (when the test set them), `confirm`
    // with the tag it was given and whether the answer was the go-ahead
    const isGear = e.argv[1]?.endsWith('/scripts/gear.sh') === true
    if (isGear) gearCalls.push(`run ${e.argv.slice(2).join(' ')}`)
    const asked = isGear && e.argv[2] === 'ask' ? asks[e.argv[3] ?? ''] : undefined
    const tag = isGear && e.argv[2] === 'confirm' ? /\[기어 확인 ([0-9a-f]{8}:[0-9]+)\]/.exec(e.argv[4] ?? '')?.[1] : undefined
    const stdout = asked ?? (tag ? `${e.argv[6] === '실행' ? 'GEAR_CONFIRMED' : 'GEAR_DECLINED'}: ${tag}\n` : proc.stdout)
    return { value: { exitCode: procEnd.exitCode, stdout, stderr: procEnd.stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: 'local-id' }))
  on('session.send', (_, e) => {
    if (!delivery.isDelivered) return { isDelivered: false, reason: 'no such session' } as never
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true }
  })
  on('session.receive', (_, e) => ({ text: e.text }))

  return { opened, processes, clock, panes, store, notices, copies, toasts, notify, proc, sent, delivery, runs, procEnd, extra, extraDirs, extraFiles, compactions, env, asks, spawns, spawnPlans, spawnEnds, gearCalls }
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
  engine(on, {}, { at: 1_000_000 },{
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

// ── the session look-back card is gone ───────────────────────────────────────

test('no-lookback T1 회고 요약 칸은 없다 — 요약 파일이 남아 있어도 칸 · 버튼 · 접는 줄의 이름에 나오지 않는다', async ($, on) => {
  // The project still holds the summary file an older version drew a card from.
  const leftover = JSON.stringify({ date: '20261022', summary: '아직 셀 것이 없음(보관된 계획 0개) · 개선점: 완료 기준 비율 0/7(0%)', report: 'scv/x.html' })
  const kit = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['a'] }) })
  kit.extra['latest.json'] = leftover
  kit.extra['scv/x.html'] = '<h1>보고서</h1>'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const drawn = await drawnText($)

  expect(drawn).toContain('접기 — 진행률 · 시험 결과 · 변경 이력')
  for (const gone of ['아직 셀 것이 없음', '개선점', '보고서 열기', '2026-10-22']) expect(drawn).not.toContain(gone)
  expect((await ui.findAll({ type: 'Button' })).map(button => String(button.props.label ?? '')).filter(label => /보고서|개선점/.test(label))).toEqual([])
  await ui.unmount()
  // Nothing of it travels to a viewer either: the state a session sends holds no report.
  await $.session.receive(hello())
  const sent = kit.sent[kit.sent.length - 1]?.text.replace(/^SCV-MIRROR STATE /, '') ?? '{}'
  expect(Object.keys(JSON.parse(sent).snapshot).filter(key => /report/i.test(key))).toEqual([])
})

test('no-lookback T2 계획이 없는 화면에도 회고 요약 칸은 없다', async ($, on) => {
  const kit = engine(on, {})
  kit.extra['latest.json'] = JSON.stringify({ date: '20261022', summary: '아직 셀 것이 없음 · 개선점: 하나', report: 'scv/x.html' })
  await start($)
  const drawn = await drawnText($)

  expect(drawn).toContain('진행 중인 SCV 계획이 없습니다')
  for (const gone of ['아직 셀 것이 없음', '개선점', '보고서 열기']) expect(drawn).not.toContain(gone)
})

// ── step-signal plan ─────────────────────────────────────────────────────────

// Five steps named a to e. Each line names the pure function it builds, so a step may end with no file to show:
// the function list is its proof.
const FIVE = ['a — `fa`', 'b — `fb`', 'c — `fc`', 'd — `fd`', 'e — `fe`']

const COMPOSE = { model: 'claude-test', promptModel: 'claude-test', surfaces: ['desktop'], tools: [], outputStyle: null, traits: [] } as const

// A done signal carries proof since 0.2.29; these tests send a command's output with it, and stand on the
// functions their step lines name.
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
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] a', 'b — `fb`', 'c', 'd', 'e'] }) })
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
  engine(on, {}, { at: 1_000_000 },{ z: plan({ title: 'z', status: 'done', steps: FIVE }) })
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
  // what the prompt box holds: a test may change it between presses
  const box = { text: draft }
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }) as never)
  on('prompt.fill', (_, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled } as never
  })
  on('prompt.suggest', (_, e) => {
    suggestions.push(e.text)
    return { isShown: true } as never
  })

  return { fills, suggestions, box }
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
  const state = { snapshot: { plans: [hostPlan], cwd: '/host', root: '/host' } }
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

// A viewer session mirroring session_host, with the host's state (plan p) already drawn.
const startViewer = async ($: Engine, on: On) => {
  const env = engine(on, {})
  env.proc.stdout = JSON.stringify({ sessionId: 'local-id', bridgeSessionId: 'session_viewer' })
  await start($)
  await $.command.run({ command: 'scv-mirror', args: 'session_host' } as never)
  const hostPlan = { slug: 'p', isArchived: false, ...PLANNED().p }
  const state = { snapshot: { plans: [hostPlan], cwd: '/host', root: '/host' } }
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body: JSON.stringify(state) })) })

  return env
}

const hello = (address = 'session_viewer') => ({ origin: { kind: 'peer' as const }, text: envelope(mirrorText({ kind: 'hello', address })) })

// ── mirror-first-ask: a fresh mirror shows no older plan, and a state held up on the way does not draw over a newer one ──

const stateOf = (title: string, sentAt?: number) =>
  JSON.stringify({ snapshot: { plans: [{ slug: 'p', isArchived: false, ...plan({ title, status: 'in_progress', steps: ['a', 'b'] }) }], cwd: '/host', root: '/host' }, ...(sentAt === undefined ? {} : { sentAt }) })

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
  const env = engine(on, PLANNED(), undefined, {}, true)
  await start($)
  await $.session.receive(hello())
  const pushed = parseMirror(env.sent[0]?.text ?? '')

  expect(pushed?.kind === 'state' ? JSON.parse(pushed.body).sentAt : null).toBe(1_000_000)
  await clock.advance(60_000)
  expect(env.sent).toHaveLength(1)
})

test('mirror-two-way T1 ACT 메시지는 봉투 안에서도 읽히고, 모르는 형태는 버린다', () => {
  const fill = { kind: 'act' as const, address: 'session_v', act: { do: 'fill' as const, slug: 'a' } }

  expect(parseMirror(envelope(mirrorText(fill)))).toEqual(fill)
  // The only act is fill; the report act an older version knew is dropped like any other unknown one.
  expect(parseMirror(envelope('SCV-MIRROR ACT session_v {"do":"open-report"}'))).toBeNull()
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
  const env = engine(on, files, undefined, {}, true)
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
  const env = engine(on, files, undefined, {}, true)
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
  const env = engine(on, {}, undefined, {}, true)
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
  const env = engine(on, {}, undefined, {}, true)
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
  const env = engine(on, {}, undefined, {}, true)
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

test('mirror-two-way T9 ACT 는 모델에 안 가고, 모델의 SendMessage 는 여전히 검사받는다', async ($, on) => {
  engine(on, PLANNED())
  on('tool.check', () => ({ decision: 'ask' as const }))
  await start($)
  const got = await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'act', address: 'session_x', act: { do: 'fill', slug: 'p' } })) })

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
  const state = { snapshot: { plans: [hostPlan], cwd: '/host', root: '/host' }, hostName: '맥프로_aitmcenter' }
  await $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body: JSON.stringify(state) })) })

  expect(await drawnText($)).toContain('거울: 맥프로_aitmcenter (session_host)')
})

test('mirror-plan-in-view T1 거울 칸은 작업 세션이 보고 있는 계획을 따라 그린다', async ($, on) => {
  await startViewer($, on)
  const first = { slug: 'a', isArchived: false, ...plan({ title: '대본 통화', status: 'in_progress', steps: ['초안'] }) }
  const second = { slug: 'b', isArchived: false, ...plan({ title: 'STT 연결', status: 'in_progress', steps: ['다리', '확인'] }) }
  const state = { snapshot: { plans: [first, second], cwd: '/host', root: '/host' }, inView: 'b' }
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
  const env = engine(on, files, undefined, {}, true, { 'INDEX.md': INDEX_MD, 'compare.md': COMPARE_MD })
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
  // Step 2 has ended and the detail has moved on to step 3: the flow's lines carry no function list, so only step
  // 3's detail shows lists now.
  const all = async (pattern: RegExp) => (await ui.findAll({ type: 'Text', text: pattern })).map(one => one.text)
  expect(await all(/^새로 만듦 /)).toEqual(['새로 만듦 0'])
  expect(await all(/^가져다 씀 /)).toEqual(['가져다 씀 3'])
  expect(await all(/^• scv_step_active_plan \(/)).toEqual([])
  // what it does: once, where step 3's detail describes the function it used
  expect(await all(/^구현 중인/)).toEqual(['구현 중인 계획 이름 하나를 고른다'])
  expect(await text(ui, /^• scv_step_line$/)).toBe('• scv_step_line')
  expect(await text(ui, /^도구 이름과 계획/)).toBe('도구 이름과 계획 이름으로 매 턴 안내 한 줄을 만든다')
  expect(await text(ui, /^첫 버전이/)).toBe('첫 버전이 둘째 버전보다 낮으면 참(숫자로 비교, 접미사는 무시)')
  // Kept per project, so a new session still shows what each step did.
  expect(env.store.get('functions:/work')).toBeDefined()
  // The finished step keeps its lists: pressed, its detail under the flow shows what it made.
  await ui.press({ key: 'step-2' })
  expect(await all(/^새로 만듦 /)).toEqual(['새로 만듦 2'])
  expect(await all(/^가져다 씀 /)).toEqual(['가져다 씀 0'])
  expect(await all(/^• scv_step_active_plan \(/)).toEqual(['• scv_step_active_plan (고르기)'])
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
  engine(on, {}, undefined, {
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
  engine(on, {}, { at: 1_000_000 }, archived)
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
      text: envelope(mirrorText({ kind: 'state', body: JSON.stringify({ snapshot: { plans: [hostPlan], cwd: '/host', root: '/host' }, live, sentAt }) })),
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
  const env = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] a', 'b', 'c'] }) }, { at: 1_000_000 },{}, isClockMocked)
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
          snapshot: { plans: [hostPlan], cwd: '/host', root: '/host' },
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
import { backgroundSteps, bigIndexOf, doingWord, evidenceKind, isBackgroundSignal, isDrawable, judgeEvidence, liveOf, proofView, signalAnswer, turnPicture } from './model'

// Three steps: the first names the pure functions it builds; the other two name none, so they have a screen to show.
const MIXED = ['순수부 만들기 — `fa`, `fb`', '화면 그리기', '훈련 돌리기']
const NOT_VISIBLE = '증거는 눈으로 볼 수 있는 것만 받습니다 — 화면 사진 · 영상 · 차트(이미지 · html)를 붙이세요. 소스코드와 글 파일은 증거가 아닙니다'
const NEEDS_SCREEN = '이 단계는 보여 줄 화면이 필요합니다 — 화면 사진 · 영상 · 차트를 evidence 로 붙이세요'

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

test('step-evidence T11 함수도 그림도 없는 단계의 끝은 거절하고 단계는 진행 중 그대로 — 명령 출력만으로도 못 끝낸다', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: MIXED }) })
  evidenceFiles(on, {})
  await start($)
  await doingWith($, 2)
  const bare = await doneWith($, 2, {})
  const outputOnly = await doneWith($, 2, { output: '통과 21 · 실패 0' })
  expect(bare.deny).toContain(NEEDS_SCREEN)
  expect(outputOnly.deny).toContain(NEEDS_SCREEN)
  expect(outputOnly.deny).toContain('output 만으로는 끝낼 수 없습니다')
  expect(lastState(store, 2)).toBe('doing')
  // 순수 판정: 함수 이름도 파일도 없으면 거절, 출력이 있어도 같다
  const refused = judgeEvidence([], undefined, [], undefined, [])
  expect(!refused.isOk && refused.reason.startsWith(NEEDS_SCREEN)).toBe(true)
  expect(judgeEvidence([], '통과', [], undefined).isOk).toBe(false)
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
  evidenceFiles(on, { '/etc/shot.png': { base64: 'AA', mtimeMs: 9_000_000 }, '/work/link.png': { base64: 'AA', mtimeMs: 9_000_000, real: '/tmp/elsewhere.png' } })
  await start($)
  await doingWith($, 1)
  const outside = await doneWith($, 1, { evidence: ['/etc/shot.png'] })
  const linked = await doneWith($, 1, { evidence: ['link.png'] })
  const missing = await doneWith($, 1, { evidence: ['missing.png'] })
  expect(outside.deny).toContain('프로젝트 밖 파일은 증거로 받지 않습니다: /etc/shot.png')
  expect(linked.deny).toContain('프로젝트 밖 파일은 증거로 받지 않습니다: link.png')
  expect(missing.deny).toContain('증거 파일이 없습니다: missing.png')
  expect(outside.deny).not.toBe(missing.deny)
})

test('step-evidence T14 함수가 있는 단계는 파일 없이 끝난다 — 함수 목록이 증거, 명령 출력은 함께 보일 뿐', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: MIXED }) })
  evidenceFiles(on, {})
  await start($)
  await doingWith($, 1)
  expect((await doneWith($, 1, {})).deny).toBeUndefined()
  expect(lastState(store, 1)).toBe('done')
  expect((store.get('signals:/work') as { evidence?: unknown }[])[0]?.evidence).toEqual({ files: [] })
  // The finished step's proof names its functions, not a missing file.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'step-1' })
  expect(await text(ui, /^화면이 없는 단계/)).toBe('화면이 없는 단계 — 순수 함수 2개가 증거입니다: fa · fb')
  expect(await text(ui, /^증거 없음/)).toBeUndefined()
  await ui.unmount()
  // 순수 판정: 함수 이름이 있으면 파일 없이 통과하고, 출력은 끝부분 1200자만 남는다
  expect(judgeEvidence([], undefined, [], undefined, ['fa'])).toEqual({ isOk: true, evidence: { files: [] } })
  const kept = judgeEvidence([], 'x'.repeat(2000), [], undefined, ['fa'])
  expect(kept.isOk && kept.evidence.output?.length).toBe(1200)
  expect(judgeEvidence([], '   ', [], undefined, ['fa'])).toEqual({ isOk: true, evidence: { files: [] } })
})

test('step-evidence T15 끝난 단계를 누르면 그림과 출력이 보이고, 영상 · html · pdf 는 여는 버튼이다', async ($, on) => {
  const { clock, processes } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: MIXED }) })
  evidenceFiles(on, {
    '/work/shot.png': { base64: 'iVBORw0KGgo=', mtimeMs: 1_200_000 },
    '/work/run.mp4': { base64: 'AAAA', mtimeMs: 1_200_000 },
    '/work/chart.html': { text: '<h1>정확도 0.91</h1>', mtimeMs: 1_200_000 },
    '/work/report.pdf': { base64: 'JVBERi0=', mtimeMs: 1_200_000 },
  })
  await start($)
  await doingWith($, 2)
  clock.at = 1_300_000
  expect((await doneWith($, 2, { evidence: ['shot.png', 'run.mp4', 'chart.html', 'report.pdf'], output: '통과 21 · 실패 0' })).deny).toBeUndefined()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'step-2' })
  const drawn = await drawnText($)
  const pictures = (drawn.match(/data:image\/png;base64,iVBORw0KGgo=/g) ?? []).length
  const outputPart = (drawn.match(/통과 21 · 실패 0/g) ?? []).length
  expect([pictures, outputPart]).toEqual([1, 1])
  // Only the picture is drawn: a video, a page and a pdf are neither drawn nor read into the pane.
  expect((drawn.match(/data:image\//g) ?? []).length).toBe(1)
  expect(drawn).not.toContain('정확도 0.91')
  for (const name of ['shot.png', 'run.mp4', 'chart.html', 'report.pdf']) expect(drawn).toContain(`▸ ${name} 열기`)
  await ui.press({ key: 'evidence-2' })
  expect(processes.some(argv => argv.includes('/work/chart.html'))).toBe(true)
  await ui.unmount()
})

test('step-evidence T18 소스코드 · 글 · 설정 · 스크립트 파일은 증거로 받지 않는다 — 하나라도 섞이면 거절', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: MIXED }) })
  const at = { mtimeMs: 1_200_000 }
  evidenceFiles(on, { '/work/shot.png': { base64: 'AA', ...at }, '/work/src/view.ts': { text: 'x', ...at }, '/work/notes.md': { text: 'x', ...at }, '/work/run.sh': { text: 'x', ...at } })
  await start($)
  await doingWith($, 2)
  for (const path of ['src/view.ts', 'notes.md', 'run.sh', 'settings.json', 'result.txt', 'train.log', 'page.htm', 'Makefile']) {
    expect((await doneWith($, 2, { evidence: [path] })).deny).toContain(`${NOT_VISIBLE}: ${path}`)
  }
  // One source file among pictures refuses the whole report, and a step that names functions is refused the same.
  expect((await doneWith($, 2, { evidence: ['shot.png', 'src/view.ts'] })).deny).toContain(`${NOT_VISIBLE}: src/view.ts`)
  expect((await doneWith($, 1, { evidence: ['src/view.ts'], output: '통과' })).deny).toContain(`${NOT_VISIBLE}: src/view.ts`)
  expect(lastState(store, 2)).toBe('doing')
  // 순수: 이름으로 종류를 정한다 — 그림 · 영상 · 문서만, 대소문자 무관
  expect(['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg'].map(evidenceKind)).toEqual(Array(6).fill('image'))
  expect(['a.mp4', 'a.webm', 'a.MOV'].map(evidenceKind)).toEqual(Array(3).fill('video'))
  expect(['a.html', 'a.pdf'].map(evidenceKind)).toEqual(['document', 'document'])
  expect(['a.ts', 'a.md', 'a.json', 'a.sh', 'a.txt', 'a.htm', 'png', 'a.png.txt'].map(evidenceKind)).toEqual(Array(8).fill(null))
})

test('step-evidence T19 함수가 없는 단계는 그림 하나로 끝난다 — 영상 · html · pdf 도 받는다', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: MIXED }) })
  const at = { mtimeMs: 1_200_000 }
  evidenceFiles(on, { '/work/shot.png': { base64: 'AA', ...at }, '/work/run.webm': { base64: 'AA', ...at }, '/work/chart.html': { text: '<p>x</p>', ...at } })
  await start($)
  await doingWith($, 2)
  expect((await doneWith($, 2, { evidence: ['shot.png'] })).deny).toBeUndefined()
  expect(lastState(store, 2)).toBe('done')
  expect((store.get('signals:/work') as { step: number; evidence?: unknown }[]).find(one => one.step === 2)?.evidence).toEqual({ files: [{ path: 'shot.png', size: 2, kind: 'image' }] })
  await doingWith($, 3)
  expect((await doneWith($, 3, { evidence: ['run.webm', 'chart.html'] })).deny).toBeUndefined()
  expect((store.get('signals:/work') as { step: number; evidence?: { files: { kind: string }[] } }[]).find(one => one.step === 3)?.evidence?.files.map(file => file.kind)).toEqual(['video', 'document'])
})

test('step-evidence T20 옛 기록에 남은 소스 파일 증거는 여는 버튼으로 나오지 않는다', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: MIXED }) })
  evidenceFiles(on, { '/work/shot.png': { base64: 'iVBORw0KGgo=', mtimeMs: 1 } })
  // A record an older version kept: a source file and a text file beside a picture, and a step with only source files.
  store.set('signals:/work', [
    { plan: 'a', step: 2, state: 'done', note: '', at: 1, evidence: { files: [{ path: 'src/view.ts', size: 1, kind: 'other' }, { path: 'shot.png', size: 12, kind: 'image' }, { path: 'result.txt', size: 1, kind: 'text' }] } },
    { plan: 'a', step: 3, state: 'done', note: '', at: 2, evidence: { files: [{ path: 'src/train.py', size: 1, kind: 'other' }], output: '통과' } },
  ])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'step-2' })
  let drawn = await drawnText($)
  expect(drawn).toContain('▸ shot.png 열기')
  expect(drawn).not.toContain('view.ts')
  expect(drawn).not.toContain('result.txt')
  await ui.press({ key: 'step-3' })
  drawn = await drawnText($)
  expect(drawn).not.toContain('train.py')
  expect(drawn).toContain('증거 없음 — 이 단계는 끝 보고에 볼 수 있는 증거가 붙지 않았습니다')
  expect(await ui.find({ type: 'Button', key: 'evidence-0' })).toBeUndefined()
  await ui.unmount()
  // 순수: 볼 수 있는 파일만 남고, 종류는 이름으로 다시 정한다
  expect(proofView({ files: [{ path: 'a.ts', size: 1, kind: 'image' }, { path: 'b.mp4', size: 2, kind: 'image' }] }, [])).toEqual({ files: [{ path: 'b.mp4', size: 2, kind: 'video' }], output: '', note: '', isMissing: false })
  expect(proofView(undefined, ['fa'])).toEqual({ files: [], output: '', note: '화면이 없는 단계 — 순수 함수 1개가 증거입니다: fa', isMissing: false })
  expect(proofView(undefined, []).isMissing).toBe(true)
})

test('step-evidence T23 증거 그림의 크게 보기를 누르면 창 전체가 그 그림이 되고, 닫으면 단계 흐름으로 돌아온다', async ($, on) => {
  const { store, processes } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: MIXED }) })
  evidenceFiles(on, { '/work/shot.png': { base64: 'iVBORw0KGgo=', mtimeMs: 1 }, '/work/chart.svg': { base64: 'PHN2Zy8+', mtimeMs: 1 }, '/work/run.mp4': { base64: 'AA', mtimeMs: 1 } })
  store.set('signals:/work', [
    { plan: 'a', step: 2, state: 'done', note: '', at: 1, evidence: { files: [{ path: 'shot.png', size: 12, kind: 'image' }, { path: 'run.mp4', size: 2, kind: 'video' }, { path: 'chart.svg', size: 8, kind: 'image' }] } },
  ])
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'step-2' })
  // 그림에만 크게 보기가 붙는다 — 영상은 여는 버튼뿐
  expect(await ui.find({ type: 'Button', key: 'evidence-big-0' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'evidence-big-1' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'evidence-big-2' })).toBeDefined()
  const small = (await ui.findAll({ type: 'Svg' })).map(one => String(one.props.source ?? ''))
  expect(small.some(source => source.includes('width="1280"'))).toBe(false)

  await ui.press({ key: 'evidence-big-0' })
  let drawn = await drawnText($)
  expect(drawn).toContain('증거 크게 보기 — 2. 화면 그리기')
  expect(drawn).toContain('shot.png (1/2)')
  expect(drawn).not.toContain('단계 흐름')
  const big = await ui.findAll({ type: 'Svg' })
  expect(big.length).toBe(1)
  expect(String(big[0]?.props.source ?? '')).toContain('width="1280" height="800"')
  expect(String(big[0]?.props.source ?? '')).toContain('data:image/png;base64,iVBORw0KGgo=')
  expect(big[0]?.props.width).toBeUndefined()

  // 다음은 영상을 건너뛰어 둘째 그림으로, 한 번 더 누르면 처음으로 돈다
  await ui.press({ key: 'big-next' })
  drawn = await drawnText($)
  expect(drawn).toContain('chart.svg (2/2)')
  expect(drawn).toContain('data:image/svg+xml;base64,PHN2Zy8+')
  await ui.press({ key: 'big-next' })
  expect(await drawnText($)).toContain('shot.png (1/2)')
  await ui.press({ key: 'big-prev' })
  expect(await drawnText($)).toContain('chart.svg (2/2)')
  await ui.press({ key: 'big-open' })
  expect(processes.some(argv => argv.includes('/work/chart.svg'))).toBe(true)

  await ui.press({ key: 'big-close' })
  drawn = await drawnText($)
  expect(drawn).toContain('단계 흐름')
  expect(drawn).not.toContain('증거 크게 보기')
  expect(drawn).toContain('▸ shot.png 열기')
  // 크게 본 채로 다른 단계를 고르면 크게 보기는 풀린다
  await ui.press({ key: 'evidence-big-2' })
  expect(await drawnText($)).toContain('증거 크게 보기')
  await ui.press({ key: 'big-back' })
  await ui.press({ key: 'step-1' })
  expect(await drawnText($)).not.toContain('증거 크게 보기')
  await ui.unmount()

  // 순수: 어느 그림을 크게 보는지, 다음 · 이전
  const files = [{ path: 'a.png', size: 1, kind: 'image' }, { path: 'b.mp4', size: 1, kind: 'video' }, { path: 'c.svg', size: 1, kind: 'image' }, { path: 'd.png', size: 200 * 1024, kind: 'image' }] as const
  expect(files.map(isDrawable)).toEqual([true, false, true, false])
  expect(bigIndexOf({ plan: 'a', step: 1, index: 2 }, 'a', 1, files)).toBe(2)
  expect(bigIndexOf(null, 'a', 1, files)).toBeNull()
  expect(bigIndexOf({ plan: 'a', step: 1, index: 0 }, 'b', 1, files)).toBeNull()
  expect(bigIndexOf({ plan: 'a', step: 1, index: 0 }, 'a', 2, files)).toBeNull()
  expect(bigIndexOf({ plan: 'a', step: 1, index: 0 }, 'a', null, files)).toBeNull()
  expect(bigIndexOf({ plan: 'a', step: 1, index: 1 }, 'a', 1, files)).toBeNull()
  expect(bigIndexOf({ plan: 'a', step: 1, index: 3 }, 'a', 1, files)).toBeNull()
  expect(bigIndexOf({ plan: 'a', step: 1, index: 9 }, 'a', 1, files)).toBeNull()
  expect([turnPicture(0, files, 1), turnPicture(2, files, 1), turnPicture(0, files, -1), turnPicture(1, files, 1)]).toEqual([2, 0, 2, 1])
  expect(turnPicture(0, [files[0]], 1)).toBe(0)
})

test('step-evidence T21 끝난 단계의 함수 목록은 단계를 눌렀을 때 아래 상세에 그대로 — 단계 흐름 줄에는 문장과 상태만', async ($, on) => {
  const pipeline = ['`fa` | 글을 읽어 값으로 정리한다 | 글 → 값 | 순수', '`fb` | 값을 줄로 만든다 | 값 → 줄 | 순수']
  const files = { a: plan({ title: 'p', status: 'in_progress', steps: MIXED, pipeline }) }
  engine(on, files)
  evidenceFiles(on, { '/work/shot.png': { base64: 'AA', mtimeMs: 1_200_000 } })
  on('tool.call', () => ({ result: {} }))
  await start($)
  await doingWith($, 1)
  await $.tool.call({ tool: 'Write', file_path: '/work/src/pure.sh', content: '# @pure\n# 역할: 글을 읽어 값으로 정리한다\n# 종류: 읽기\nfa() {\n  :\n}\n' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const all = async (pattern: RegExp) => (await ui.findAll({ type: 'Text', text: pattern })).map(one => one.text)
  // In progress: the list is in the step's detail.
  expect(await all(/^• fa \(/)).toEqual(['• fa (읽기)'])
  expect(await all(/^새로 만듦 /)).toEqual(['새로 만듦 1'])

  // Done, and the work moves to step 2: the detail is now step 2's. Step 1's line in the flow is its sentence and
  // its state alone — no function list under it.
  await doneWith($, 1, {})
  await doingWith($, 2)
  expect(await text(ui, /^2\. 화면 그리기 — /)).toBe('2. 화면 그리기 — 진행 중')
  expect(await all(/^• f[ab]/)).toEqual([])
  expect(await all(/^값을 줄로/)).toEqual([])
  expect(await all(/^새로 만듦 /)).toEqual([])
  expect(await text(ui, /^순수함수 없음/)).toBe('순수함수 없음')
  await doneWith($, 2, { evidence: ['shot.png'] })
  await doingWith($, 3)
  await doneWith($, 3, { evidence: ['shot.png'] })
  // Every step is done: no detail is open, and the flow shows no function at all.
  expect(await text(ui, /^\d\. .* — 완료$/)).toBeUndefined()
  expect(await all(/^• f[ab]/)).toEqual([])
  expect(await all(/^하는 일$/)).toEqual([])
  expect(await all(/^새로 만듦 /)).toEqual([])
  // Pressed, the finished step shows its detail under the flow: what it builds, and what it made — kept after done.
  await ui.press({ key: 'step-1' })
  expect(await text(ui, /^1\. 순수부 만들기 — /)).toBe('1. 순수부 만들기 — 완료')
  expect(await all(/^하는 일$/)).toEqual(['하는 일'])
  expect(await all(/^• fa \(/)).toEqual(['• fa (읽기)'])
  expect(await all(/^• fb/)).toEqual(['• fb'])
  expect(await all(/^값을 줄로/)).toEqual(['값을 줄로 만든다'])
  expect(await all(/^새로 만듦 /)).toEqual(['새로 만듦 1'])
  // A finished step with no function says so in its detail, and still lists nothing on its line.
  await ui.press({ key: 'step-2' })
  expect(await text(ui, /^순수함수 없음/)).toBe('순수함수 없음')
  expect(await all(/^• f[ab]/)).toEqual([])
  await ui.unmount()
})

test('step-evidence T22 뒤에서 도는 단계는 진행 중(백그라운드) — background 인자 · log · url 어느 것이든, 단계마다 따로', async ($, on) => {
  const { store } = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  evidenceFiles(on, { '/work/train.log': { text: 'epoch 1/10\n', mtimeMs: 1_100_000 } })
  await start($)
  const front = await doingWith($, 1)
  const byFlag = await doingWith($, 2, { background: true })
  const byLog = await doingWith($, 3, { log: 'train.log' })
  const byUrl = await doingWith($, 4, { url: 'https://example.test/run/7' })
  expect(String(front.result)).toContain('진행 중: 1단계')
  expect(String(front.result)).not.toContain('백그라운드')
  expect(String(byFlag.result)).toContain('진행 중: 1단계 · 진행 중(백그라운드): 2단계')
  expect(String(byLog.result)).toContain('진행 중: 1단계 · 진행 중(백그라운드): 2 · 3단계')
  expect(String(byUrl.result)).toContain('진행 중: 1단계 · 진행 중(백그라운드): 2~4단계')
  expect((store.get('signals:/work') as { step: number; background?: boolean }[]).map(one => one.background)).toEqual([undefined, true, undefined, undefined])

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const lines = (await ui.findAll({ type: 'Text', text: /지금 여기/ })).map(one => one.text)
  expect(lines).toEqual(['진행 중  ◀ 지금 여기', '진행 중(백그라운드)  ◀ 지금 여기', '진행 중(백그라운드)  ◀ 지금 여기', '진행 중(백그라운드)  ◀ 지금 여기'])
  await ui.press({ key: 'step-2' })
  expect(await text(ui, /^2\. b — /)).toBe('2. b — 진행 중(백그라운드)')
  await ui.press({ key: 'step-1' })
  expect(await text(ui, /^1\. a — /)).toBe('1. a — 진행 중')
  // false, or anything that is not true, is the conversation's own work; a step that ends leaves the background.
  await doingWith($, 5, { background: false })
  await doneWith($, 2, {})
  expect((await ui.findAll({ type: 'Text', text: /지금 여기/ })).map(one => one.text)).toEqual([
    '진행 중  ◀ 지금 여기',
    '진행 중(백그라운드)  ◀ 지금 여기',
    '진행 중(백그라운드)  ◀ 지금 여기',
    '진행 중  ◀ 지금 여기',
  ])
  await ui.unmount()

  // 순수: 낱말 · 판정 · 답 글
  expect([doingWord(false), doingWord(true)]).toEqual(['진행 중', '진행 중(백그라운드)'])
  const sig = (extra: Record<string, unknown>) => ({ plan: 'a', step: 1, state: 'doing' as const, note: '', at: 0, ...extra })
  expect([sig({}), sig({ background: true }), sig({ source: { log: 'x.log' } }), sig({ source: { url: 'https://x.test' } }), sig({ background: false })].map(isBackgroundSignal)).toEqual([false, true, true, true, false])
  expect(isBackgroundSignal({ ...sig({ background: true }), state: 'done' })).toBe(false)
  expect(isBackgroundSignal({ ...sig({ background: true }), state: 'blocked' })).toBe(false)
  expect(isBackgroundSignal(undefined)).toBe(false)
  expect(backgroundSteps([sig({}), { ...sig({ background: true }), step: 3 }, { ...sig({ source: { log: 'l' } }), step: 2 }, { ...sig({ background: true }), plan: 'other', step: 5 }], 'a')).toEqual([2, 3])
  expect(applySignal([], { plan: 'a', step: 1, state: 'doing', background: true }, 5)).toEqual([{ plan: 'a', step: 1, state: 'doing', note: '', at: 5, background: true }])
  expect(applySignal([], { plan: 'a', step: 1, state: 'done', background: true }, 5)).toEqual([{ plan: 'a', step: 1, state: 'done', note: '', at: 5 }])
  const stages = [st('a', 'doing'), st('b', 'doing'), st('c', 'waiting')]
  expect(signalAnswer({ plan: 'a', step: 2, state: 'doing' }, stages, [2])).toBe('기록함: a 2단계 시작 — 진행 0/3 · 진행 중: 1단계 · 진행 중(백그라운드): 2단계')
  expect(signalAnswer({ plan: 'a', step: 2, state: 'doing' }, stages, [1, 2])).toBe('기록함: a 2단계 시작 — 진행 0/3 · 진행 중(백그라운드): 1 · 2단계')
  expect(signalAnswer({ plan: 'a', step: 2, state: 'doing' }, stages)).toBe('기록함: a 2단계 시작 — 진행 0/3 · 진행 중: 1 · 2단계')
})

test('step-evidence T23 차례가 끝나도 뒤에서 도는 단계는 사용자 차례가 아니라 진행 중(백그라운드)로 남는다 — 다른 단계는 전처럼 사용자 차례', async ($, on) => {
  engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE }) })
  evidenceFiles(on, {})
  turnEngine(on)
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await doingWith($, 1)
  await doingWith($, 2, { background: true })
  await turnEnd($, 'answer', 5_000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.findAll({ type: 'Text', text: /지금 여기/ })).map(one => one.text)).toEqual(['사용자 차례  ◀ 지금 여기', '진행 중(백그라운드)  ◀ 지금 여기'])
  expect(String(await text(ui, /단계 사용자 차례/)).startsWith('1단계 사용자 차례 · 2단계 진행 중 · ')).toBe(true)
  await ui.unmount()

  // 순수: 뒤에서 도는 단계만 그대로 두고, 일하는 중 · 막힘의 덧칠은 전과 같다
  const stages = [st('a', 'done'), st('b', 'doing'), st('c', 'doing'), st('d', 'blocked'), st('e', 'waiting')]
  expect(applyTurn(stages, 'yourTurn', [3]).map(stage => stage.state)).toEqual(['done', 'yourTurn', 'doing', 'blocked', 'waiting'])
  expect(applyTurn(stages, 'yourTurn').map(stage => stage.state)).toEqual(['done', 'yourTurn', 'yourTurn', 'blocked', 'waiting'])
  expect(applyTurn(stages, 'working', [3]).map(stage => stage.state)).toEqual(['done', 'doing', 'doing', 'blocked', 'waiting'])
  expect(applyBlocks(stages, [{ kind: 'waiting', title: '', detail: '' }]).map(stage => stage.state)).toEqual(['done', 'blocked', 'blocked', 'blocked', 'waiting'])
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
import { askModeView, gearCommand, gearLaunchArgv, gearRows, gearRunArgv, paneSections, parseAskMode, parseGears, pluginRoot } from './model'

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

test('pane T20 기어 줄의 버튼 — 창이 돌릴 수 있으면 [실행], 아니면 [대화로]. 펼친 칸의 [Claude 에게 시키기]는 입력창에 명령만 넣는다', async ($, on) => {
  // 0.4.0: the pane runs a gear marked pure, effect or outward itself; the others go to the conversation
  const rows = gearRows(parseGears(GEAR_INDEX), true)
  expect(rows.map(one => one.direct)).toEqual(['run', 'run', 'run'])
  expect(gearRows(parseGears(GEAR_INDEX), false).map(one => one.direct)).toEqual([null, null, null])
  expect(gearRows(parseGears('a\tgear\tjudge\tnone\tx\t판단\t\nb\tgear\t-\tnone\tx\t예전\t'), true).map(one => one.direct)).toEqual([null, null])
  expect(gearCommand('release-ci')).toBe('/scv:gear run release-ci')
  expect(gearCommand('bad name; rm')).toBe(null)
  const kit = engine(on, {})
  withProject(kit)
  const { fills } = promptEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // folded: the one button on the line runs the gear
  expect((await ui.find({ type: 'Button', key: 'gear-run-release-ci' }))?.text).toBe('실행')
  expect(await has(ui, 'gear-use-release-ci')).toBe(false)
  // opened: no second run button — a quieter one hands the gear to Claude
  await ui.press({ key: 'gear-open-release-ci' })
  expect((await ui.find({ type: 'Button', key: 'gear-use-release-ci' }))?.text).toBe('Claude 에게 시키기')
  expect(await ui.findAll({ type: 'Button', key: 'gear-run-release-ci' })).toHaveLength(1)
  await ui.press({ key: 'gear-use-release-ci' })
  expect(fills).toEqual([{ text: '/scv:gear run release-ci', mode: 'replace' }])
  expect(kit.runs.filter(one => one.argv[1]?.endsWith('/gear.sh'))).toHaveLength(0)
  expect(kit.spawns).toHaveLength(0)
  await ui.unmount()
})

// 0.4.0: a run from the pane is read as it runs (no 30-second limit), under the fixed launcher
test('pane T21 바로 실행 — 본체 기어 실행기를 프로젝트 폴더에서 부르고 출력을 칸에 보인다', async ($, on) => {
  expect(gearRunArgv(CORE_DIR, 'make-list')).toEqual(['bash', `${CORE_DIR}/scripts/gear.sh`, 'run', 'make-list'])
  expect(gearRunArgv(CORE_DIR, 'bad name; rm')).toBe(null)
  const kit = engine(on, {})
  withProject(kit)
  kit.asks['make-list'] = 'GEAR_ASK: make-list\nnone\n'
  kit.proc.stdout = '하나\n둘\n'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'gear-open-make-list' })
  await ui.press({ key: 'gear-run-make-list' })

  expect(kit.spawns).toHaveLength(1)
  expect(kit.spawns[0]).toEqual({ argv: gearLaunchArgv(['bash', `${CORE_DIR}/scripts/gear.sh`, 'run', 'make-list']), cwd: '/work', input: '' })
  expect(await text(ui, /^│ 하나$/)).toBe('│ 하나')
  kit.procEnd.exitCode = 1
  kit.procEnd.stderr = 'GEAR_ERROR: 톱니 파일이 없다'
  await ui.press({ key: 'gear-run-make-list' })
  expect(await text(ui, /^│ 실패/)).toBe('│ 실패 — 종료 코드 1')
  expect(await text(ui, /^│ GEAR_ERROR/)).toBe('│ GEAR_ERROR: 톱니 파일이 없다')
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
  kit.asks['group-subjects'] = 'GEAR_ASK: group-subjects\ninput\tsubjects\n'
  kit.proc.stdout = 'feat 1\n'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'gear-open-group-subjects' })
  // 0.4.0: the field is in the values block a press on the run button opens
  await ui.press({ key: 'gear-run-group-subjects' })
  await ui.input({ key: 'gear-input-group-subjects', text: 'feat: a; rm -rf "x" count=9' })
  const ran = kit.spawns

  expect(ran).toHaveLength(1)
  expect(ran[0]?.argv).toEqual(gearLaunchArgv(['bash', `${CORE_DIR}/scripts/gear.sh`, 'run', 'group-subjects']))
  expect(ran[0]?.input).toBe('feat: a; rm -rf "x" count=9')
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
  expect(shown).toContain('저장해 둔 방법이 있음: 릴리스 전에 CI 명령을 다 돌리고 실패가 없을 때만 통과를 알림')
  expect(shown).toContain('"사용함"')
  expect(shown).toContain('"사용안함"')
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

test('gear-match T9 사용안함을 누르면 붙이지 않는다', async ($, on) => {
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
  // no SCV found here: each line's button hands the gear to the conversation (0.4.0: with SCV found it would run it)
  withProject(kit, { index: TEN, isInstalled: false })
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
  const rows = gearRows(parseGears(`long-one\tgear\teffect\tnone\tx\t${long}\t`), true)
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

test('gear-match T17 사용함을 누르면 입력창의 글이 그 기어의 한 줄과 함께 바로 가고, 입력창이 비워진다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit, { index: WORDY })
  const { fills } = promptEngine(on, '릴리스 전에 시험 다 돌려줘')
  const went: string[] = []
  on('prompt.submit', (_, e) => {
    went.push(e.text)
    return { text: e.text }
  })
  await start($)
  await boxIs($, '릴리스 전에 시험 다 돌려줘')
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  await band.press({ key: 'gear-hint-use' })

  expect(went).toHaveLength(1)
  expect(went[0]?.startsWith('릴리스 전에 시험 다 돌려줘\n\n[SCV 기어]')).toBe(true)
  expect(went[0]?.match(/\[SCV 기어\]/g)).toHaveLength(1)
  expect(fills).toEqual([{ text: '', mode: 'replace' }])
  expect(kit.store.get('scv-dashboard:gear-recent:/work')).toEqual(['release-check'])
  expect(await bandText($)).not.toContain('저장해 둔 방법')
  await band.unmount()
})

test('gear-match T18 설명이 길어도 자르지 않고, 한 줄이 이미 붙은 글에는 또 붙이지 않는다', async () => {
  const long = '아주 긴 역할 문장입니다 '.repeat(8).trim()
  const gear = parseGears(`long-one\tgear\teffect\tnone\tx\t${long}\t낱말 둘`)[0]!
  expect(hintLine(gear)).toBe(`저장해 둔 방법이 있음: ${long}`)
  const once = submitWithGear('해 줘', gear, false)
  expect(submitWithGear(once, gear, false)).toBe(once)
})

// ── pane 0.3.3: a long conversation made light ───────────────────────────────────
import { DEFAULT_LIGHT, lastTurns, lightDue, lightMessages, lightNote, parseLight, recordTail, resumeBrief } from './model'

const RECORD = ['---', 'slug: x', '---', '', '# 대화', '', '## Turn 1 — t', '', '**User**: 첫 요청', '', '**Claude Code**: 첫 답', '', '## Turn 2 — t', '', '**User**: 둘째 요청', '', '**Claude Code**: 둘째 답'].join('\n')
const endTurn = ($: Engine) => $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as never)
const settle = () => new Promise<void>(done => setTimeout(done, 80))
const SAID = [
  { role: 'user', text: '요청', toolUses: [] },
  { role: 'assistant', text: '답', toolUses: [] },
]
// how full the conversation is (it drops to 8% once a compaction stood), the turn's end, and the compact command as
// the engine runs it: a compaction of the main conversation, the person's kind
const withUsage = ($: Engine, on: On, percent: number, kit: { compactions: unknown[] }, done = { count: 0 }) => {
  on('session.usage', () => ({ value: { rateLimits: [], context: { percent: done.count > 0 ? 8 : percent } } }) as never)
  on('turn.complete', () => ({ text: '', reason: 'answer' as const }))
  on('command.run', async (_, e) => {
    if (e.command !== 'compact') return { text: '' }
    await ($.session as unknown as { compact: (e: unknown) => Promise<unknown> }).compact({ trigger: 'manual', instructions: e.args, messages: SAID })
    done.count += 1

    return { text: '' }
  })

  return kit
}

test('light T1 순수부 — 기준 · 최근 턴 · 기록 끝 · 바꿔 끼울 글', async () => {
  expect(parseLight(undefined)).toEqual(DEFAULT_LIGHT)
  expect(parseLight({ isOn: false, percent: 30 })).toEqual({ isOn: false, percent: 30 })
  expect(parseLight({ isOn: 'yes', percent: 500 })).toEqual(DEFAULT_LIGHT)
  expect(lightDue(DEFAULT_LIGHT, 49, false, 0, 1)).toBe(false)
  expect(lightDue(DEFAULT_LIGHT, 50, false, 0, 1)).toBe(true)
  expect(lightDue(DEFAULT_LIGHT, 80, true, 0, 1)).toBe(false)
  expect(lightDue({ isOn: false, percent: 50 }, 80, false, 0, 1)).toBe(false)
  expect(lightDue(DEFAULT_LIGHT, null, false, 0, 1)).toBe(false)
  expect(lightDue(DEFAULT_LIGHT, 80, false, 1_000, 60_000)).toBe(false)
  expect(lightDue(DEFAULT_LIGHT, 80, false, 1_000, 400_000)).toBe(true)
  const said = [
    { role: 'user' as const, text: '첫 요청' },
    { role: 'assistant' as const, text: '' },
    { role: 'user' as const, text: '', toolResults: [{}] },
    { role: 'assistant' as const, text: '첫 답' },
    { role: 'user' as const, text: '둘째 요청' },
    { role: 'assistant' as const, text: '둘째 답' },
  ]
  expect(lastTurns(said, 1)).toEqual([{ role: 'user', text: '둘째 요청' }, { role: 'assistant', text: '둘째 답' }])
  expect(lastTurns(said).map(one => one.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  expect(recordTail(RECORD)).toBe(RECORD)
  expect(recordTail(RECORD, 60).startsWith('## Turn 2')).toBe(true)
  expect(recordTail(null)).toBe('')
  const brief = resumeBrief({ recordPath: 'scv/conversations/a.md', tail: '## Turn 2', plans: [{ title: '계획 하나', status: 'in_progress', done: 2, total: 5 }] })
  expect(brief).toContain('scv/conversations/a.md')
  expect(brief).toContain('계획 하나 (in_progress, 단계 2/5)')
  expect(brief).toContain('## Turn 2')
  const after = lightMessages(brief, lastTurns(said, 1))
  expect(after.map(one => one.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  expect(after[0]?.text).toBe(brief)
  expect(lightNote({ kind: 'records', before: 62, after: 8, ms: 1200 })).toBe('기록으로 바꿔 끼워 가볍게 함 62% → 8% · 1초')
  expect(lightNote({ kind: 'records', before: 62, after: 62, ms: 1200 })).toBe('기록으로 바꿔 끼워 가볍게 함 62% · 1초')
  expect(lightNote({ kind: 'summary', before: null, after: null, ms: 70_000 })).toBe('요약해서 가볍게 함 · 70초')
  expect(lightNote({ kind: 'skipped', before: 62, after: null, ms: 1 })).toBe('가볍게 하지 못함 — 다음 턴 끝에 다시 봄')
})

test('light T2 턴이 끝날 때 기준을 넘으면 기록으로 바꿔 끼운다 — 모델 요약은 부르지 않는다', async ($, on) => {
  const kit = engine(on, { a: plan({ title: '계획 하나', status: 'in_progress', steps: FIVE }) })
  withProject(kit)
  withUsage($, on, 62, kit)
  kit.extraFiles['scv/conversations'] = [{ name: 'old.md', mtimeMs: 1 }, { name: 'new.md', mtimeMs: 9 }]
  kit.extra['scv/conversations/new.md'] = RECORD
  kit.extra['scv/conversations/old.md'] = '옛 기록'
  await start($)
  await endTurn($)
  await settle()

  expect(kit.compactions).toHaveLength(0)
  expect(await drawnText($)).toContain('기록으로 바꿔 끼워 가볍게 함 62% → 8%')
})

test('light T3 기록이 없으면 자동 요약으로 넘어간다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  withUsage($, on, 62, kit)
  await start($)
  await endTurn($)
  await settle()

  expect(kit.compactions).toHaveLength(1)
  expect(kit.compactions[0]?.trigger).toBe('manual')
  expect(kit.compactions[0]?.instructions).toContain('진행 중인 SCV 계획')
  expect(await drawnText($)).toContain('요약해서 가볍게 함 62% → 8%')
})

test('light T4 기준 아래거나 꺼 두면 아무것도 하지 않는다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  withUsage($, on, 40, kit)
  await start($)
  await endTurn($)
  await settle()
  expect(kit.compactions).toHaveLength(0)
  expect(await drawnText($)).not.toContain('가볍게 함 ')
})

test('light T5 창의 한 줄과 끄기 버튼 — 끄면 기준을 넘어도 그대로 두고, 다음 세션에도 남는다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  withUsage($, on, 62, kit)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await drawnText($)).toContain('컨텍스트가 50% 를 넘으면 자동으로 비우기 — 기록으로 이어 감')
  await ui.press({ key: 'light-toggle' })
  expect(await drawnText($)).toContain('대화가 길어져도 그대로 둠')
  expect(kit.store.get('scv-dashboard:light')).toEqual({ isOn: false, percent: 50 })
  await endTurn($)
  await settle()
  expect(kit.compactions).toHaveLength(0)
  await ui.unmount()
})

test('light T6 사람이 친 정리나 엔진의 자동 정리는 건드리지 않는다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  kit.extraFiles['scv/conversations'] = [{ name: 'new.md', mtimeMs: 9 }]
  kit.extra['scv/conversations/new.md'] = RECORD
  await start($)
  await ($.session as unknown as { compact: (e: unknown) => Promise<unknown> }).compact({ trigger: 'manual', messages: SAID })

  expect(kit.compactions).toEqual([{ trigger: 'manual', instructions: undefined }])
})


// ── pane 0.5.0: the mark on a bar · the folder and branch the session works in ───
import { LIGHT_MAX, LIGHT_MIN, branchOfHead, gitDirOf, lightBarSvg, moveLight, parseBranches, shortPath, switchNote } from './model'

test('light T7 기준 막대 — ◀ ▶ 로 5% 씩 옮기고, 옮긴 기준이 남고, 그 기준으로 요약한다', async ($, on) => {
  expect(moveLight(DEFAULT_LIGHT, 55)).toEqual({ isOn: true, percent: 55 })
  expect(moveLight(DEFAULT_LIGHT, 57)).toEqual({ isOn: true, percent: 55 })
  expect(moveLight(DEFAULT_LIGHT, 0).percent).toBe(LIGHT_MIN)
  expect(moveLight(DEFAULT_LIGHT, 200).percent).toBe(LIGHT_MAX)
  expect(lightBarSvg(50, 62)).toContain('#f85149')
  expect(lightBarSvg(70, 62)).toContain('#4f8cff')
  expect(lightBarSvg(70, null)).not.toContain('#4f8cff')

  const kit = engine(on, {})
  withProject(kit)
  withUsage($, on, 62, kit)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await drawnText($)).toContain('기준 50%')
  await ui.press({ key: 'light-up' })
  await ui.press({ key: 'light-up' })
  await ui.press({ key: 'light-up' })
  await ui.press({ key: 'light-up' })
  expect(await drawnText($)).toContain('컨텍스트가 70% 를 넘으면 자동으로 비우기')
  expect(kit.store.get('scv-dashboard:light')).toEqual({ isOn: true, percent: 70 })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('비우기 기준 70% · 지금 62%')
  await endTurn($)
  await settle()
  expect(kit.compactions).toHaveLength(0)
  await ui.press({ key: 'light-down' })
  await ui.press({ key: 'light-down' })
  expect(kit.store.get('scv-dashboard:light')).toEqual({ isOn: true, percent: 60 })
  await endTurn($)
  await settle()
  expect(kit.compactions).toHaveLength(1)
  await ui.unmount()
})

test('place T1 순수부 — 브랜치 읽기 · 워크트리 · 목록 · 폴더 줄임 · 바꾼 뒤 한 줄', async () => {
  expect(branchOfHead('ref: refs/heads/feat/x\n')).toEqual({ name: 'feat/x', isBranch: true })
  expect(branchOfHead('0123456789abcdef0123456789abcdef01234567\n')).toEqual({ name: '0123456', isBranch: false })
  expect(branchOfHead('')).toBe(null)
  expect(branchOfHead(null)).toBe(null)
  expect(gitDirOf('gitdir: /repo/.git/worktrees/w\n', '/w')).toBe('/repo/.git/worktrees/w')
  expect(gitDirOf('gitdir: ../.git/modules/m\n', '/repo/m')).toBe('/repo/m/../.git/modules/m')
  expect(gitDirOf(null, '/w')).toBe(null)
  expect(parseBranches('main\n  feat/x\n(HEAD detached at 0123456)\nmain\n\n')).toEqual(['main', 'feat/x'])
  expect(shortPath('/home/u/work/app', '/home/u')).toBe('~/work/app')
  expect(shortPath('/home/u', '/home/u')).toBe('~')
  expect(shortPath('/home/user2/app', '/home/u')).toBe('/home/user2/app')
  expect(shortPath('/work', null)).toBe('/work')
  expect(switchNote({ from: 'main', to: 'feat/x', exitCode: 0, stderr: '' })).toBe('브랜치를 바꿈: main → feat/x')
  expect(switchNote({ from: 'main', to: 'feat/x', exitCode: 1, stderr: '\nerror: 바꿀 수 없음\n다음 줄' })).toBe('브랜치를 바꾸지 못함 — error: 바꿀 수 없음')
  expect(switchNote({ from: 'main', to: 'feat/x', exitCode: null, stderr: '' })).toBe('브랜치를 바꾸지 못함')
})

test('place T2 창 맨 위에 폴더와 브랜치 — 브랜치를 누르면 목록이 열리고, 고르면 git 이 바꾼다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  kit.extra['/work/.git/HEAD'] = 'ref: refs/heads/main\n'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^\/work$/)).toBe('/work')
  expect((await ui.find({ type: 'Button', key: 'branch-open' }))?.props.label).toBe('main ▾')
  expect(await ui.find({ type: 'Select', key: 'branch-pick' })).toBeUndefined()

  kit.proc.stdout = 'main\nfeat/x\n'
  await ui.press({ key: 'branch-open' })
  expect(kit.processes.at(-1)).toEqual(['git', 'branch', '--format=%(refname:short)'])
  expect(kit.runs.at(-1)?.cwd).toBe('/work')
  const picker = await ui.find({ type: 'Select', key: 'branch-pick' })
  expect(picker?.props.value).toBe('main')
  expect((picker?.props.options as { value: string }[]).map(one => one.value)).toEqual(['main', 'feat/x'])

  kit.proc.stdout = ''
  kit.extra['/work/.git/HEAD'] = 'ref: refs/heads/feat/x\n'
  await ui.select({ key: 'branch-pick', value: 'feat/x' })
  await settle()
  expect(kit.processes.at(-1)).toEqual(['git', 'switch', 'feat/x'])
  expect(kit.runs.at(-1)?.cwd).toBe('/work')
  expect((await ui.find({ type: 'Button', key: 'branch-open' }))?.props.label).toBe('feat/x ▾')
  expect(await drawnText($)).toContain('브랜치를 바꿈: main → feat/x')
  expect(await ui.find({ type: 'Select', key: 'branch-pick' })).toBeUndefined()
  await ui.unmount()
})

test('place T3 git 이 거절하면 이유를 보이고 브랜치는 그대로 — 턴이 도는 중에는 바꾸지 않는다', async ($, on) => {
  const kit = engine(on, {})
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  withProject(kit)
  kit.extra['/work/.git/HEAD'] = 'ref: refs/heads/main\n'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  kit.proc.stdout = 'main\nfeat/x\n'
  await ui.press({ key: 'branch-open' })
  kit.procEnd.exitCode = 1
  kit.procEnd.stderr = 'error: Your local changes would be overwritten\n'
  await ui.select({ key: 'branch-pick', value: 'feat/x' })
  await settle()
  expect(await drawnText($)).toContain('브랜치를 바꾸지 못함 — error: Your local changes would be overwritten')
  expect((await ui.find({ type: 'Button', key: 'branch-open' }))?.props.label).toBe('main ▾')

  kit.procEnd.exitCode = 0
  kit.procEnd.stderr = ''
  await ui.press({ key: 'branch-open' })
  await $.turn.start({ text: '일', turnId: 't9' })
  const before = kit.processes.length
  await ui.select({ key: 'branch-pick', value: 'feat/x' })
  await settle()
  expect(kit.processes.slice(before).some(argv => argv[1] === 'switch')).toBe(false)
  expect(await drawnText($)).toContain('턴이 도는 중에는 브랜치를 바꾸지 않음')
  await ui.unmount()
})

test('place T4 git 저장소가 아니면 폴더만 보인다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await text(ui, /^\/work$/)).toBe('/work')
  expect(await ui.find({ type: 'Button', key: 'branch-open' })).toBeUndefined()
  expect(await drawnText($)).not.toContain('브랜치')
  await ui.unmount()
})

test('place T5 워크트리는 .git 파일을 따라가 읽고, 브랜치 없는 커밋은 그 앞 일곱 글자로 보인다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  kit.extra['/work/.git'] = 'gitdir: /repo/.git/worktrees/w\n'
  kit.extra['/repo/.git/worktrees/w/HEAD'] = '0123456789abcdef0123456789abcdef01234567\n'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'branch-open' }))?.props.label).toBe('0123456 (브랜치 없음) ▾')
  await ui.unmount()
})


// ── pane 0.4.0: a gear run from the pane, with no model ──────────────────────────
import { argChoices, confirmLines, confirmStop, gearPaste, hintNote, outwardSteps, parseAsk, runPlan, runView } from './model'

const GEAR_SH = `${CORE_DIR}/scripts/gear.sh`
const DIRECT = [
  'push-tags\ttooth\toutward\tnone\tlines\t태그를 원격에 올림\t',
  'tidy\tgear\teffect\tnone\tlines\t임시 파일을 치움\t정리 임시 파일 치움',
  'ci-all\tgear\teffect\tnone\tverdict\t시험을 다 돌림\t시험 전부 돌림\tos=mac',
  'count-lines\tgear\tpure\tlines\tlines\t줄 수를 셈\t줄 수 세기\tcount=4',
  'ship\tgear\toutward\tnone\tlines\t태그를 올려 내보냄\t내보내기 태그 올림',
  'review\tgear\tjudge\tnone\ttext\t바뀐 것을 읽고 판단함\t검토 판단 읽기',
].join('\n')
const DIRECT_ASKS: Record<string, string> = {
  tidy: 'GEAR_ASK: tidy\nnone\n',
  'ci-all': 'GEAR_ASK: ci-all\narg\tos\tmac\topen\t돌릴 곳: mac · linux\n',
  'count-lines': 'GEAR_ASK: count-lines\narg\tcount\t4\topen\t한 번에 겹쳐 돌릴 시험 수\ninput\tlines\n',
  ship: 'GEAR_ASK: ship\nnone\n',
}
// what SCV prints when a run stops before a step that reaches outside (exit code 11)
const STOP_AT = (token: string, step: number, of: number, tooth: string, does: string) =>
  [
    `GEAR_CONFIRM: ${token}`,
    `GEAR_STEP: ${step}/${of} ${tooth} — ${does}`,
    '=== 밖으로 나가는 단계 ===',
    `사용자에게 선택 도구로 물어라 — 질문 글 끝에 [기어 확인 ${token}:${step}] 를 그대로 넣고, 보기는 "실행" 과 "실행하지 않음" 둘.`,
    `"실행" 답이 온 뒤에만: bash "${GEAR_SH}" resume ${token}`,
    '=== 이 단계가 돌릴 글 ===',
    'git push --tags',
    '',
  ].join('\n')
// a project with the gears above, SCV installed, and SCV's `ask` answering for each gear
const directKit = (on: On, isClockMocked = false) => {
  const kit = engine(on, {}, { at: 1_000_000 },{}, isClockMocked)
  withProject(kit, { index: DIRECT })
  Object.assign(kit.asks, DIRECT_ASKS)

  return kit
}
// every text sent to Claude while the test runs
const sends = (on: On) => {
  const went: string[] = []
  on('prompt.submit', (_, e) => {
    went.push(e.text)
    return { text: e.text }
  })

  return went
}
const labelOf = async (ui: { find: (q: { type: 'Button'; key: string }) => Promise<{ text?: string } | undefined> }, key: string) =>
  (await ui.find({ type: 'Button', key }))?.text

test('direct T7 설명에서 버튼 보기를 뽑는다 — 보기가 둘 이상이고 기본값이 그중 하나일 때만', () => {
  expect(argChoices('돌릴 곳: mac · linux', 'mac')).toEqual({ kind: 'buttons', choices: ['mac', 'linux'], picked: 'mac' })
  expect(argChoices('저장소: core · claude · codex · selftest', 'core')).toEqual({ kind: 'buttons', choices: ['core', 'claude', 'codex', 'selftest'], picked: 'core' })
  expect(argChoices('한 번에 겹쳐 돌릴 시험 수', '4')).toEqual({ kind: 'field' })
  expect(argChoices('모양: json · text', 'yaml')).toEqual({ kind: 'field' })
  expect(argChoices('', '')).toEqual({ kind: 'field' })
  // the values come from what SCV's own `ask` printed; anything else is not read as values
  expect(parseAsk(DIRECT_ASKS['count-lines'])).toEqual({
    name: 'count-lines',
    args: [{ name: 'count', value: '4', isOpen: true, desc: '한 번에 겹쳐 돌릴 시험 수' }],
    hasInput: true,
    inputKind: 'lines',
  })
  expect(parseAsk('GEAR_ASK: x\narg\trepo\tcore\tfixed\t저장소: core · claude\n')?.args[0]?.isOpen).toBe(false)
  expect(parseAsk(DIRECT_ASKS.tidy)).toEqual({ name: 'tidy', args: [], hasInput: false, inputKind: null })
  expect(parseAsk('usage: gear.sh …')).toBe(null)
  expect(parseAsk('')).toBe(null)
})

test('direct T8 누른 뒤 할 일을 정한다 — 바로 실행 · 값 칸 · 확인 · 대화로', () => {
  const pick = [{ name: 'os', value: 'mac', isOpen: true, desc: '돌릴 곳: mac · linux' }]
  const type = [{ name: 'count', value: '4', isOpen: true, desc: '한 번에 겹쳐 돌릴 시험 수' }]
  const none = { args: [], hasInput: false, chosen: null, canType: true }

  expect(runPlan({ mark: 'pure', ...none })).toBe('run')
  expect(runPlan({ mark: 'effect', ...none })).toBe('run')
  expect(runPlan({ mark: 'effect', ...none, args: pick })).toBe('values')
  expect(runPlan({ mark: 'outward', ...none })).toBe('confirm')
  expect(runPlan({ mark: 'judge', ...none })).toBe('chat')
  // a surface with no field: buttons still work there, a value to type (or data to put in) goes to the conversation
  expect(runPlan({ mark: 'effect', ...none, args: pick, canType: false })).toBe('values')
  expect(runPlan({ mark: 'effect', ...none, args: type, canType: false })).toBe('chat')
  expect(runPlan({ mark: 'pure', ...none, hasInput: true, canType: false })).toBe('chat')
  expect(runPlan({ mark: 'pure', ...none, hasInput: true })).toBe('values')
  // with the values set: it runs, and a gear that reaches outside still asks first
  expect(runPlan({ mark: 'effect', ...none, args: pick, chosen: { os: 'linux' } })).toBe('run')
  expect(runPlan({ mark: 'outward', ...none, args: pick })).toBe('values')
  expect(runPlan({ mark: 'outward', ...none, args: pick, chosen: { os: 'linux' } })).toBe('confirm')
  // a value the gear's own file fixed is not asked for; a mark this pane does not know is never run here
  expect(runPlan({ mark: 'effect', ...none, args: [{ ...pick[0]!, isOpen: false }] })).toBe('run')
  expect(runPlan({ mark: '-', ...none })).toBe('chat')
  // the gear's own line: a run button where the pane handles it, the conversation for a gear with a judgment step
  expect(gearRows(parseGears(DIRECT), true).map(one => one.direct)).toEqual(['run', 'run', 'run', 'run', null])
})

test('direct T9 값이 없는 기어는 누르는 즉시 창이 돌린다 — 입력창에 아무것도 넣지 않고 보내지도 않는다', async ($, on) => {
  const kit = directKit(on)
  const { fills } = promptEngine(on)
  const went = sends(on)
  kit.proc.stdout = '치운 파일 3개\n'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // the gear's line is folded: its one button is 실행, and a press runs the gear and opens the line to show the result
  expect(await labelOf(ui, 'gear-run-tidy')).toBe('실행')
  expect(await drawnText($)).not.toContain('이름 tidy')
  await ui.press({ key: 'gear-run-tidy' })

  expect(await drawnText($)).toContain('이름 tidy')
  expect(kit.spawns).toEqual([{ argv: gearLaunchArgv(['bash', GEAR_SH, 'run', 'tidy']), cwd: '/work', input: '' }])
  expect(fills).toHaveLength(0)
  expect(went).toHaveLength(0)
  expect(await text(ui, /^│ 끝남$/)).toBe('│ 끝남')
  expect(await text(ui, /^│ 치운/)).toBe('│ 치운 파일 3개')
  // a quick run is not announced
  expect(kit.notices).toHaveLength(0)
  await ui.unmount()
})

test('direct T10 고를 값은 버튼으로 정하고 실행한다 — 고른 값이 낱말 하나로 붙고, 값 안내는 기어 목록이 바뀔 때만 다시 읽는다', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const kit = directKit(on, true)
  const asked = () => kit.gearCalls.filter(one => one === 'run ask ci-all').length
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // pressed on the folded line: the line opens with the values block
  await ui.press({ key: 'gear-run-ci-all' })

  // the values block: nothing has run, the value now is the one picked
  expect(kit.spawns).toHaveLength(0)
  expect(await has(ui, 'gear-run-ci-all')).toBe(false)
  expect(await labelOf(ui, 'gear-pick-ci-all-os-0')).toBe('● mac')
  expect(await labelOf(ui, 'gear-pick-ci-all-os-1')).toBe('○ linux')
  expect(await has(ui, 'gear-chat-ci-all')).toBe(true)
  await ui.press({ key: 'gear-pick-ci-all-os-1' })
  expect(await labelOf(ui, 'gear-pick-ci-all-os-1')).toBe('● linux')
  await ui.press({ key: 'gear-go-ci-all' })
  expect(kit.spawns).toHaveLength(1)
  expect(kit.spawns[0]?.argv).toEqual(gearLaunchArgv(['bash', GEAR_SH, 'run', 'ci-all', 'os=linux']))
  // the value as it stood adds no word
  await ui.press({ key: 'gear-run-ci-all' })
  await ui.press({ key: 'gear-go-ci-all' })
  expect(kit.spawns[1]?.argv).toEqual(gearLaunchArgv(['bash', GEAR_SH, 'run', 'ci-all']))
  expect(asked()).toBe(1)
  // the gear index reads differently: what was kept is dropped, and the next press asks SCV again
  kit.extra['scv/gears/INDEX.tsv'] = `${DIRECT}\nmore\tgear\tpure\tnone\tlines\t새 기어\t`
  await clock.advance(3000)
  await ui.press({ key: 'gear-run-ci-all' })
  expect(asked()).toBe(2)
  await ui.unmount()
})

test('direct T11 적어야 하는 값은 낱말 하나의 값으로, 넣을 자료는 표준 입력으로만 간다', async ($, on) => {
  const kit = directKit(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'gear-open-count-lines' })
  await ui.press({ key: 'gear-run-count-lines' })
  expect(kit.spawns).toHaveLength(0)
  await ui.input({ key: 'gear-arg-count-lines-count', text: '7', kind: 'change' })
  await ui.input({ key: 'gear-input-count-lines', text: '첫 줄\n둘째 줄', kind: 'change' })
  await ui.press({ key: 'gear-go-count-lines' })

  expect(kit.spawns).toHaveLength(1)
  expect(kit.spawns[0]).toEqual({ argv: gearLaunchArgv(['bash', GEAR_SH, 'run', 'count-lines', 'count=7']), cwd: '/work', input: '첫 줄\n둘째 줄' })
  // spaces, quotes and a semicolon in a value: still the value part of one word, and never in the launcher's text
  const odd = '7; rm -rf "x" $(id) \'y\''
  await ui.press({ key: 'gear-run-count-lines' })
  await ui.input({ key: 'gear-arg-count-lines-count', text: odd, kind: 'change' })
  await ui.input({ key: 'gear-input-count-lines', text: 'count=9; echo "$HOME"' })
  const argv = kit.spawns[1]?.argv ?? []
  expect(kit.spawns).toHaveLength(2)
  expect(argv).toEqual(gearLaunchArgv(['bash', GEAR_SH, 'run', 'count-lines', `count=${odd}`]))
  expect(argv).toHaveLength(gearLaunchArgv(['bash', GEAR_SH, 'run', 'count-lines']).length + 1)
  expect(argv[2]).toBe(gearLaunchArgv([])[2])
  expect(argv[2]).not.toContain('rm -rf')
  expect(kit.spawns[1]?.input).toBe('count=9; echo "$HOME"')
  // a name `ask` did not list, or a value the gear's own file fixed, is never made into a word
  const listed = [{ name: 'count', value: '4', isOpen: true, desc: '' }, { name: 'repo', value: 'core', isOpen: false, desc: '' }]
  expect(gearRunArgv(CORE_DIR, 'count-lines', { count: '7', repo: 'x', other: 'y' }, listed)).toEqual(['bash', GEAR_SH, 'run', 'count-lines', 'count=7'])
  await ui.unmount()
})

test('direct T12 밖으로 나가는 기어는 확인을 거친다 — 취소면 아무것도 돌지 않고, 실행이면 본체의 확인 기록 뒤에만 그 단계가 돈다', async ($, on) => {
  expect(outwardSteps('flow: tidy | push-tags\nin: none\n\n# ship\nflow: 본문의 줄', DIRECT)).toEqual([{ name: 'push-tags', does: '태그를 원격에 올림' }])
  expect(outwardSteps(null, DIRECT)).toEqual([])
  expect(confirmLines([{ name: 'push-tags', does: '태그를 원격에 올림' }], ['os=linux'])).toEqual([
    '밖으로 나가는 단계 1개 — [실행]을 누르기 전에는 아무것도 돌지 않음',
    '· push-tags — 태그를 원격에 올림',
    '값: os=linux',
  ])
  expect(confirmStop(STOP_AT('ab12cd34', 2, 2, 'push-tags', '태그를 원격에 올림'))).toEqual({
    token: 'ab12cd34',
    step: '2',
    tooth: 'push-tags',
    label: '2/2 push-tags — 태그를 원격에 올림',
    script: ['git push --tags'],
  })
  expect(confirmStop('GEAR_CONFIRM: ../x\n[기어 확인 ../x:1]')).toBe(null)
  const kit = directKit(on)
  kit.extra['scv/gears/ship/GEAR.md'] = 'flow: tidy | push-tags\nin: none\nout: lines\n\n# ship\n'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'gear-run-ship' })

  // the question comes first: what goes out, and nothing has run
  const question = await drawnText($)
  expect(question).toContain('밖으로 나가는 단계 1개')
  expect(question).toContain('· push-tags — 태그를 원격에 올림')
  expect(kit.spawns).toHaveLength(0)
  // 취소: nothing runs, nothing is written down
  await ui.press({ key: 'gear-confirm-no-ship' })
  expect(kit.spawns).toHaveLength(0)
  expect(kit.gearCalls.filter(one => one.includes('confirm'))).toHaveLength(0)
  expect(await drawnText($)).toContain('실행하지 않음 — 아무것도 돌지 않았습니다')
  // 실행: the run stops before the step (11), SCV's confirm command writes the go-ahead down, then resume runs the step
  kit.spawnPlans.push({ pieces: [STOP_AT('ab12cd34', 2, 2, 'push-tags', '태그를 원격에 올림')], code: 11 }, { pieces: ['v1.0 올림\n'], code: 0 })
  await ui.press({ key: 'gear-run-ship' })
  await ui.press({ key: 'gear-confirm-yes-ship' })
  expect(kit.gearCalls.slice(-3)).toEqual(['spawn run ship', 'run confirm --question SCV 창에서 받은 답 [기어 확인 ab12cd34:2] --answer 실행', 'spawn resume ab12cd34'])
  expect(await text(ui, /^│ v1/)).toBe('│ v1.0 올림')
  // a stop at a step the pane's question did not name: one press does not cover it — the card asks again, and
  // 취소 there writes the refusal down and runs nothing more
  kit.spawnPlans.push({ pieces: [STOP_AT('ffff0001', 3, 3, 'delete-remote', '원격 가지를 지움')], code: 11 })
  await ui.press({ key: 'gear-run-ship' })
  await ui.press({ key: 'gear-confirm-yes-ship' })
  expect(kit.gearCalls.at(-1)).toBe('spawn run ship')
  const again = await drawnText($)
  expect(again).toContain('다음 단계도 밖으로 나감 — 3/3 delete-remote — 원격 가지를 지움')
  expect(again).toContain('git push --tags')
  await ui.press({ key: 'gear-confirm-no-ship' })
  expect(kit.gearCalls.at(-1)).toBe('run confirm --question SCV 창에서 받은 답 [기어 확인 ffff0001:3] --answer 실행하지 않음')
  expect(kit.gearCalls.filter(one => one.startsWith('spawn resume'))).toEqual(['spawn resume ab12cd34'])
  // 실행 there goes on from that step: the go-ahead is written down, then resume
  kit.spawnPlans.push({ pieces: [STOP_AT('ffff0002', 3, 3, 'delete-remote', '원격 가지를 지움')], code: 11 }, { pieces: ['지움\n'], code: 0 })
  await ui.press({ key: 'gear-run-ship' })
  await ui.press({ key: 'gear-confirm-yes-ship' })
  await ui.press({ key: 'gear-confirm-yes-ship' })
  expect(kit.gearCalls.slice(-2)).toEqual(['run confirm --question SCV 창에서 받은 답 [기어 확인 ffff0002:3] --answer 실행', 'spawn resume ffff0002'])
  await ui.unmount()
})

test('direct T13 판단 단계가 든 기어는 창이 돌리지 않는다 — 기어 줄의 버튼이 [대화로]이고 입력창에 기어 명령을 넣는다', async ($, on) => {
  const kit = directKit(on)
  const { fills } = promptEngine(on)
  const went = sends(on)
  // an older SCV: it does not print this gear's values
  delete kit.asks.tidy
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await labelOf(ui, 'gear-use-review')).toBe('대화로')
  expect(await has(ui, 'gear-run-review')).toBe(false)
  await ui.press({ key: 'gear-use-review' })

  expect(kit.spawns).toHaveLength(0)
  expect(kit.gearCalls).toHaveLength(0)
  expect(fills).toEqual([{ text: '/scv:gear run review', mode: 'replace' }])
  expect(went).toHaveLength(0)
  // a gear the pane would run, but whose values SCV could not say: the press goes to the conversation too, and
  // from then on its line says so
  expect(await labelOf(ui, 'gear-run-tidy')).toBe('실행')
  await ui.press({ key: 'gear-run-tidy' })
  expect(kit.spawns).toHaveLength(0)
  expect(fills).toHaveLength(2)
  expect(fills[1]?.text).toContain('/scv:gear run tidy')
  expect(await labelOf(ui, 'gear-use-tidy')).toBe('대화로')
  expect(await has(ui, 'gear-run-tidy')).toBe(false)
  await ui.press({ key: 'gear-use-tidy' })
  expect(kit.gearCalls).toEqual(['run ask tidy'])
  expect(went).toHaveLength(0)
  await ui.unmount()
})

test('direct T14 오래 도는 실행 — 도는 동안 끝 줄과 걸린 시간, 끝나면 결과와 알림 한 번, 멈추면 멈췄다고', async ($, on) => {
  expect(runView({ tail: '받는 중 1/3\n받는 중 2/3\n', elapsedMs: 45_000, exitCode: null, isStopped: false })).toEqual(['돌리는 중 · 45초', '받는 중 2/3'])
  expect(runView({ tail: '', elapsedMs: 200, exitCode: null, isStopped: false })).toEqual(['돌리는 중', '아직 출력 없음'])
  expect(runView({ tail: 'a\n\u001b[32mRELEASE_OK\u001b[0m\n', elapsedMs: 72_000, exitCode: 0, isStopped: false })).toEqual(['끝남 · 1분 12초', 'a', 'RELEASE_OK'])
  expect(runView({ tail: '', elapsedMs: 0, exitCode: 0, isStopped: false })).toEqual(['끝남 — 출력 없음'])
  expect(runView({ tail: 'GEAR_ERROR: 없음\n', elapsedMs: 0, exitCode: 1, isStopped: false })).toEqual(['실패 — 종료 코드 1', 'GEAR_ERROR: 없음'])
  expect(runView({ tail: '받는 중 2/3\n', elapsedMs: 5_000, exitCode: null, isStopped: true })).toEqual(['멈춤 — 누른 대로 멈춤 · 5초', '받는 중 2/3'])
  expect(runView({ tail: Array.from({ length: 15 }, (_, i) => `줄 ${i + 1}`).join('\n'), elapsedMs: 0, exitCode: 0, isStopped: false }).slice(0, 3)).toEqual(['끝남', '… 앞 3줄 줄임', '줄 4'])
  const clock = mock.clock(on, { now: 1_000_000 })
  const kit = directKit(on, true)
  const gates: (() => void)[] = []
  const held = () => new Promise<void>(open => gates.push(open))
  const told = () => kit.notices.filter(one => one.includes('기어'))
  // the running step's output, as SCV keeps it in the run's state folder until the step ends
  const stepFile = { mtimeMs: 0 }
  on('fs.stat', (_, e) =>
    stepFile.mtimeMs > 0 && /scv\/journal\/\.gear-run\/(aa11bb22|zz99zz99)\/next$/.test(e.path)
      ? ({ value: { kind: 'file', size: 20, mtimeMs: stepFile.mtimeMs, isLink: false } } as never)
      : { deny: `ENOENT ${e.path}` },
  )
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'gear-open-tidy' })
  // a run that does not end by itself: it goes on behind, and the card follows it — SCV hands nothing on until
  // the step ends, so the last line comes from the state folder that appeared with the run
  kit.spawnPlans.push({ gate: held(), after: ['치운 파일 3개\n'], code: 0 })
  await ui.press({ key: 'gear-run-tidy' })
  expect(await drawnText($)).toContain('│ 아직 출력 없음')
  // two state folders appeared: SCV writes the gear's name in each (`name`), so another gear's run — started
  // elsewhere at the same moment — is not taken for this one. (`given`, the values a run was started with, is
  // there only when values were given: this run has none, and the pane never reads it.)
  kit.extraDirs['scv/journal/.gear-run'] = ['zz99zz99', 'aa11bb22']
  kit.extra['scv/journal/.gear-run/zz99zz99/name'] = 'ci-all\n'
  kit.extra['scv/journal/.gear-run/zz99zz99/next'] = '남의 실행이 쓴 줄\n'
  kit.extra['scv/journal/.gear-run/aa11bb22/name'] = 'tidy\n'
  kit.extra['scv/journal/.gear-run/aa11bb22/next'] = '셈 1/20\n셈 2/20\n'
  stepFile.mtimeMs = 5
  await clock.advance(45_000)
  const running = await drawnText($)
  expect(running).toContain('│ 돌리는 중 · 45초')
  expect(running).toContain('│ 셈 2/20')
  expect(running).not.toContain('남의 실행이 쓴 줄')
  expect(await has(ui, 'gear-stop-tidy')).toBe(true)
  expect(await has(ui, 'gear-run-tidy')).toBe(false)
  expect(told()).toHaveLength(0)
  // it ends: the result stays on the card, and it is announced once
  gates[0]?.()
  await settle()
  const ended = await drawnText($)
  expect(ended).toContain('│ 끝남 · 45초')
  expect(ended).toContain('│ 치운 파일 3개')
  expect(await has(ui, 'gear-stop-tidy')).toBe(false)
  expect(told()).toHaveLength(1)
  expect(told()[0]).toContain('기어 끝남 — 임시 파일을 치움')
  // 멈춤: the card says so at once, the command is told to end, and what it writes afterwards changes nothing
  // (this one writes a line itself before it hangs: that line is the one shown)
  kit.spawnPlans.push({ pieces: ['받는 중 1/3\n'], gate: held(), after: ['늦은 줄\n'], code: 0 })
  await ui.press({ key: 'gear-run-tidy' })
  await clock.advance(6_000)
  expect(await drawnText($)).toContain('│ 받는 중 1/3')
  await ui.press({ key: 'gear-stop-tidy' })
  expect(await drawnText($)).toContain('│ 멈춤 — 누른 대로 멈춤 · 6초')
  expect(await has(ui, 'gear-run-tidy')).toBe(true)
  gates[1]?.()
  await settle()
  const stopped = await drawnText($)
  expect(stopped).toContain('│ 멈춤 — 누른 대로 멈춤 · 6초')
  expect(stopped).not.toContain('늦은 줄')
  expect(kit.spawnEnds.count).toBe(2)
  expect(told()).toHaveLength(1)
  await ui.unmount()
})

test('direct T15 사용함 — 창이 돌릴 수 있으면 창이 돌리고 보내지 않는다, 판단 단계가 든 기어는 전처럼 한 줄과 함께 간다', async ($, on) => {
  const gears = parseGears(DIRECT)
  expect(hintNote(gears.find(one => one.name === 'tidy')!, true)).toBe('사용함: 창에서 바로 돌림 · 그대로 보내도 이 방법으로 합니다')
  expect(hintNote(gears.find(one => one.name === 'review')!, true)).toBe('그대로 보내도 이 방법으로 합니다')
  expect(hintNote(gears.find(one => one.name === 'tidy')!, false)).toBe('그대로 보내도 이 방법으로 합니다')
  const kit = directKit(on)
  const { fills, box } = promptEngine(on)
  const went = sends(on)
  await start($)
  // a gear with nothing to set, effect: the pane runs it — no text is sent and the prompt box is left as it is
  box.text = '임시 파일 정리해 줘'
  await boxIs($, box.text)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  await band.press({ key: 'gear-hint-use' })
  expect(kit.spawns.map(one => one.argv)).toEqual([gearLaunchArgv(['bash', GEAR_SH, 'run', 'tidy'])])
  expect(went).toHaveLength(0)
  expect(fills).toHaveLength(0)
  expect(await bandText($)).not.toContain('저장해 둔 방법')
  expect(await drawnText($)).toContain('│ 끝남')
  // sent afterwards as it is, the text is not given the gear's line: the pane already ran it
  await $.prompt.submit(typed(box.text))
  expect(went).toEqual(['임시 파일 정리해 줘'])
  await band.unmount()
  // a gear with a judgment step: as before 0.4.0 — the text goes now, with the gear's line at its end
  box.text = '바뀐 것 검토하고 판단해 줘'
  await boxIs($, box.text)
  const second = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  await second.press({ key: 'gear-hint-use' })
  expect(kit.spawns).toHaveLength(1)
  expect(went).toHaveLength(2)
  expect(went[1]).toBe(
    '바뀐 것 검토하고 판단해 줘\n\n[SCV 기어] 이 요청에 맞는 저장해 둔 방법이 있음: review — 이 기어로 해 주세요(/scv:gear run review). 값은 위 요청에서 읽고, 없는 값은 물어 주세요.',
  )
  expect(fills).toEqual([{ text: '', mode: 'replace' }])
  await second.unmount()
})

test('direct T15b 사용함 — 값이 필요하면 창에 값 칸이 뜨고, Claude 에게 맡기기를 누르면 적어 둔 글이 한 줄과 함께 간다', async ($, on) => {
  const kit = directKit(on)
  const { fills, box } = promptEngine(on)
  const went = sends(on)
  await start($)
  box.text = '시험 전부 돌려 줘'
  await boxIs($, box.text)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' } as never)
  await band.press({ key: 'gear-hint-use' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // the values block is open in the pane: nothing ran, nothing was sent
  expect(await labelOf(ui, 'gear-pick-ci-all-os-0')).toBe('● mac')
  expect(kit.spawns).toHaveLength(0)
  expect(went).toHaveLength(0)
  expect(kit.opened.length).toBeGreaterThan(1)
  await ui.press({ key: 'gear-chat-ci-all' })
  expect(kit.spawns).toHaveLength(0)
  expect(went).toEqual([
    '시험 전부 돌려 줘\n\n[SCV 기어] 이 요청에 맞는 저장해 둔 방법이 있음: ci-all — 이 기어로 해 주세요(/scv:gear run ci-all). 값은 위 요청에서 읽고, 없는 값은 물어 주세요.',
  ])
  expect(fills).toEqual([{ text: '', mode: 'replace' }])
  expect(await has(ui, 'gear-go-ci-all')).toBe(false)
  await ui.unmount()
  await band.unmount()
})

test('direct T16 결과를 대화에 붙이기는 누를 때만 — 입력창에 들어가고 보내지는 않는다', async ($, on) => {
  expect(gearPaste('tidy', ['끝남', '치운 파일 3개'])).toBe('기어 tidy 를 SCV 창에서 돌린 결과:\n끝남\n치운 파일 3개')
  const kit = directKit(on)
  const { fills, box } = promptEngine(on)
  const went = sends(on)
  kit.proc.stdout = '치운 파일 3개\n'
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'gear-open-tidy' })
  expect(await has(ui, 'gear-paste-tidy')).toBe(false)
  await ui.press({ key: 'gear-run-tidy' })

  // not pressed: the prompt box is as it was
  expect(fills).toHaveLength(0)
  await ui.press({ key: 'gear-paste-tidy' })
  expect(fills).toEqual([{ text: '기어 tidy 를 SCV 창에서 돌린 결과:\n끝남\n치운 파일 3개', mode: 'replace' }])
  // what the person already typed stays, the result after it
  box.text = '이 결과를 보고'
  await ui.press({ key: 'gear-paste-tidy' })
  expect(fills[1]).toEqual({ text: '\n\n기어 tidy 를 SCV 창에서 돌린 결과:\n끝남\n치운 파일 3개', mode: 'append' })
  expect(went).toHaveLength(0)
  expect(kit.spawns).toHaveLength(1)
  await ui.unmount()
})

// ── after pane 0.5.0: the word dictionary card ─────────────────────────────────────────
import { MIRROR_ACTS, actLabel, fromMirrorLine, checkWord, formsLine, isActText, parseAct, parseWords, wireTail, wordLine, wordsAddArgv, wordsCommand, wordsFold, wordsFormKind, wordsRemoveArgv, wordsSaid } from './model'

const WORDS_SH = `${CORE_DIR}/scripts/words.sh`
const WORDS_TSV = ['# 피할 말\t바꿀 말\t변형\t메모', '', '재다\t측정하다\t잰, 재서, 재 본\t단위가 있는 값에', '돌리다\t실행하다\t\t', '까먹다\t잊다\t까먹은, 까먹어서\t'].join('\n')
// a project with SCV installed and this dictionary file (null: no file yet)
const wordsKit = (on: On, words: string | null = WORDS_TSV, opts: { isInstalled?: boolean } = {}) => {
  const kit = engine(on, {})
  withProject(kit, opts)
  if (words !== null) kit.extra['scv/words/WORDS.tsv'] = words

  return kit
}
const wordsRuns = (kit: { runs: { argv: string[]; cwd?: string }[] }) => kit.runs.filter(one => one.argv[1]?.endsWith('/scripts/words.sh'))
const hasInput = async (ui: { find: (q: { type: 'Input'; key: string }) => Promise<unknown> }, key: string) => Boolean(await ui.find({ type: 'Input', key }))
// the card is folded to its one line until that line is pressed
const openWords = (ui: { press: (q: { key: string }) => Promise<unknown> }) => ui.press({ key: 'words-toggle' })

test('words T1 순수부 — 사전 읽기 · 접기 · 저장 전 검사 · 명령의 낱말 · 본체가 한 말', () => {
  expect(parseWords(WORDS_TSV)).toEqual([
    { avoid: '재다', use: '측정하다', forms: ['잰', '재서', '재 본'], note: '단위가 있는 값에' },
    { avoid: '돌리다', use: '실행하다', forms: [], note: '' },
    { avoid: '까먹다', use: '잊다', forms: ['까먹은', '까먹어서'], note: '' },
  ])
  expect(parseWords(null)).toEqual([])
  // the avoided word is the key (a later line replaces); a line without both words is skipped
  expect(parseWords('재다\t측정\r\n재다\t계측\t잰\n빈말\t\n\t없음\n한 칸뿐\n  # 들여 쓴 주석\t x')).toEqual([{ avoid: '재다', use: '계측', forms: ['잰'], note: '' }])
  expect(wordLine({ avoid: '재다', use: '측정하다' })).toBe('재다 → 측정하다')
  expect(formsLine({ forms: ['잰', '재서'] })).toBe('잰 · 재서')
  expect(formsLine({ forms: [] })).toBe(null)
  const ten = parseWords(Array.from({ length: 10 }, (_, i) => `말${i}\t바꿈${i}`).join('\n'))
  expect(wordsFold(ten, false).shown).toHaveLength(8)
  expect(wordsFold(ten, false).hidden).toBe(2)
  expect(wordsFold(ten, true).hidden).toBe(0)

  expect(checkWord({ avoid: ' 재다 ', use: '측정하다', forms: '잰 ,재서,, 재 본' })).toEqual({ isOk: true, word: { avoid: '재다', use: '측정하다', forms: '잰, 재서, 재 본' } })
  expect(checkWord({ avoid: '', use: '측정' })).toEqual({ isOk: false, reason: '저장하지 않음 — 피할 말과 바꿀 말을 모두 적어 주세요' })
  expect(checkWord({ avoid: '재\t다', use: '측정' }).isOk).toBe(false)
  expect(checkWord({ avoid: '재다', use: '측\n정' }).isOk).toBe(false)
  expect(checkWord({ avoid: '재다', use: '재다' }).isOk).toBe(false)
  expect(checkWord({ avoid: '가'.repeat(81), use: '측정' }).isOk).toBe(false)
  expect(checkWord({ avoid: 7, use: '측정' }).isOk).toBe(false)

  // every typed text is one word of the command, after its own flag
  expect(wordsAddArgv(CORE_DIR, { avoid: '재다', use: '측정하다', forms: '' })).toEqual(['bash', WORDS_SH, 'add', '--avoid', '재다', '--use', '측정하다'])
  expect(wordsAddArgv(CORE_DIR, { avoid: '재다', use: '측정하다', forms: '잰, 재서' }, '메모')).toEqual(['bash', WORDS_SH, 'add', '--avoid', '재다', '--use', '측정하다', '--forms', '잰, 재서', '--note', '메모'])
  expect(wordsRemoveArgv(CORE_DIR, '재다')).toEqual(['bash', WORDS_SH, 'remove', '재다'])
  expect(wordsCommand({ avoid: '재다', use: '측정하다' })).toBe('/scv:words add 재다 → 측정하다')

  expect(wordsSaid({ exitCode: 0, stdout: 'WORDS_SAVED: 재다 → 측정하다\n', stderr: '' })).toEqual({ kind: 'done', line: '저장함: 재다 → 측정하다' })
  expect(wordsSaid({ exitCode: 0, stdout: 'WORDS_REMOVED: 재다\n', stderr: '' })).toEqual({ kind: 'done', line: '지움: 재다' })
  expect(wordsSaid({ exitCode: 2, stdout: '', stderr: 'WORDS_ERROR: 탭은 넣을 수 없음\n' })).toEqual({ kind: 'error', line: '사전을 바꾸지 못함 — 탭은 넣을 수 없음' })
  expect(wordsSaid({ exitCode: 1, stdout: 'WORDS_ERROR: 없는 말\n', stderr: '' }).kind).toBe('error')
  // an SCV without the command (no such file, or it prints something else), or a run that never started
  expect(wordsSaid({ exitCode: 127, stdout: '', stderr: 'bash: words.sh: No such file or directory\n' })).toEqual({ kind: 'none' })
  expect(wordsSaid({ exitCode: 0, stdout: '사용법: …\n', stderr: '' })).toEqual({ kind: 'none' })
  expect(wordsSaid({ exitCode: 1, stdout: 'WORDS_SAVED: 재다 → 측정\n', stderr: '' })).toEqual({ kind: 'none' })
  expect(wordsSaid(undefined)).toEqual({ kind: 'none' })

  // where the card takes a new entry: its own form, the slash command (no field here), a line (no field, a mirror)
  expect(wordsFormKind({ controls: true, input: true, isMirror: false })).toBe('form')
  expect(wordsFormKind({ controls: true, input: true, isMirror: true })).toBe('form')
  expect(wordsFormKind({ controls: true, input: false, isMirror: false })).toBe('command')
  expect(wordsFormKind({ controls: true, input: false, isMirror: true })).toBe('none')
  expect(wordsFormKind({ controls: false, input: true, isMirror: true })).toBe('hidden')
  expect(paneSections({ plan: false, blocks: false, project: true, words: true })).toEqual(['limits', 'askMode', 'gears', 'words'])
  // with a plan: right under the steps, above 'more'
  expect(paneSections({ plan: true, blocks: false, project: true, words: true })).toEqual(['limits', 'askMode', 'gears', 'steps', 'words', 'more'])
  expect(paneSections({ plan: true, blocks: true, project: true, words: true })).toEqual(['limits', 'askMode', 'gears', 'blocks', 'steps', 'words', 'more'])
  expect(paneSections({ plan: true, blocks: false, project: false, words: true })).toEqual(['limits', 'steps', 'more'])
})

test('words T2 사전이 비어도 칸이 있다 — 무엇을 위한 것인지 한 줄과 예, 그리고 넣는 칸', async ($, on) => {
  wordsKit(on, null)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openWords(ui)
  const drawn = await drawnText($)

  expect(await labelOf(ui, 'words-toggle')).toBe('▾ 낱말 사전 0')
  expect(drawn).toContain('예: 재다 → 측정하다')
  expect(drawn.indexOf('저장해 둔 일(기어)')).toBeLessThan(drawn.indexOf('낱말 사전 0'))
  expect(await hasInput(ui, 'words-avoid-0')).toBe(true)
  expect(await hasInput(ui, 'words-use-0')).toBe(true)
  expect(await hasInput(ui, 'words-forms-0')).toBe(true)
  expect(await labelOf(ui, 'words-save')).toBe('저장')
  expect((await ui.find({ type: 'Input', key: 'words-avoid-0' }))?.props.label).toBe('피할 말')
  expect((await ui.find({ type: 'Input', key: 'words-use-0' }))?.props.label).toBe('바꿀 말')
  expect((await ui.find({ type: 'Input', key: 'words-forms-0' }))?.props.label).toBe('변형(쉼표로)')
  await ui.unmount()
})

test('words T3 낱말마다 한 줄 — 피할 말 → 바꿀 말, 아래에 변형. 변형이 없으면 Claude 가 채운다고 하고 채우기는 입력창에 명령을 넣는다', async ($, on) => {
  wordsKit(on)
  const { fills } = promptEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openWords(ui)
  const drawn = await drawnText($)

  expect(await labelOf(ui, 'words-toggle')).toBe('▾ 낱말 사전 3')
  expect(await text(ui, /^재다 →/)).toBe('재다 → 측정하다')
  expect(await text(ui, /^잰 ·/)).toBe('잰 · 재서 · 재 본')
  expect(await text(ui, /^돌리다 →/)).toBe('돌리다 → 실행하다')
  expect(await text(ui, /^변형 없음/)).toBe('변형 없음 — Claude 가 채움')
  expect(drawn).not.toContain('피할 말\\t')
  expect(drawn).not.toContain('단위가 있는 값에')
  // only the entry without forms has the button
  expect(await has(ui, 'words-fill-0')).toBe(false)
  expect(await labelOf(ui, 'words-fill-1')).toBe('채우기')
  expect(await labelOf(ui, 'words-edit-0')).toBe('고치기')
  expect(await labelOf(ui, 'words-remove-0')).toBe('지우기')
  await ui.press({ key: 'words-fill-1' })
  expect(fills).toEqual([{ text: '/scv:words fill', mode: 'replace' }])
  expect(await text(ui, /^입력창에 넣음: \/scv:words fill/)).toBe('입력창에 넣음: /scv:words fill — 보내면 Claude 가 빈 변형을 채웁니다')
  await ui.unmount()
})

test('words T4 저장 — 본체의 사전 명령을 프로젝트 폴더에서, 적은 글은 낱말 하나씩의 값으로 부르고, 한 말을 칸에 보인다', async ($, on) => {
  const kit = wordsKit(on, null)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openWords(ui)
  // quotes, a semicolon, a command substitution: each still one word after its flag
  const avoid = '재"다; rm -rf x'
  const use = "측정 '하다' $(id)"
  await ui.input({ key: 'words-avoid-0', text: avoid, kind: 'change' })
  await ui.input({ key: 'words-use-0', text: use, kind: 'change' })
  kit.proc.stdout = `WORDS_SAVED: ${avoid} → ${use}\n`
  kit.extra['scv/words/WORDS.tsv'] = `${avoid}\t${use}\t\t\n`
  await ui.press({ key: 'words-save' })
  await settle()

  expect(wordsRuns(kit)).toHaveLength(1)
  expect(wordsRuns(kit)[0]?.argv).toEqual(['bash', WORDS_SH, 'add', '--avoid', avoid, '--use', use])
  expect(wordsRuns(kit)[0]?.cwd).toBe('/work')
  expect(await text(ui, /^저장함/)).toBe(`저장함: ${avoid} → ${use}`)
  // read again: the entry is listed, the card stays unfolded, and the form is a new, empty one
  expect(await labelOf(ui, 'words-toggle')).toBe('▾ 낱말 사전 1')
  expect(await hasInput(ui, 'words-avoid-0')).toBe(false)
  expect(await hasInput(ui, 'words-avoid-1')).toBe(true)
  // with forms, saved by Enter in the last field: the list goes as one word, tidied
  await ui.input({ key: 'words-avoid-1', text: '돌리다', kind: 'change' })
  await ui.input({ key: 'words-use-1', text: '실행하다' })
  kit.proc.stdout = 'WORDS_SAVED: 돌리다 → 실행하다\n'
  await ui.input({ key: 'words-forms-1', text: '돌린 ,돌려서,, 돌리는' })
  await settle()
  expect(wordsRuns(kit)).toHaveLength(2)
  expect(wordsRuns(kit)[1]?.argv).toEqual(['bash', WORDS_SH, 'add', '--avoid', '돌리다', '--use', '실행하다', '--forms', '돌린, 돌려서, 돌리는'])
  await ui.unmount()
})

test('words T5 본체가 거절하면 그 이유를 보이고 적은 글은 남는다 — 빈 칸이면 아예 부르지 않는다', async ($, on) => {
  const kit = wordsKit(on)
  const { fills } = promptEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openWords(ui)
  await ui.press({ key: 'words-save' })
  await settle()
  expect(wordsRuns(kit)).toHaveLength(0)
  expect(await text(ui, /^저장하지 않음/)).toBe('저장하지 않음 — 피할 말과 바꿀 말을 모두 적어 주세요')

  await ui.input({ key: 'words-avoid-0', text: '재다', kind: 'change' })
  await ui.input({ key: 'words-use-0', text: '계측하다', kind: 'change' })
  kit.procEnd.exitCode = 2
  kit.procEnd.stderr = 'WORDS_ERROR: 바꿀 말이 다른 낱말의 피할 말입니다\n'
  await ui.press({ key: 'words-save' })
  await settle()
  expect(wordsRuns(kit)).toHaveLength(1)
  expect(await text(ui, /^사전을 바꾸지 못함/)).toBe('사전을 바꾸지 못함 — 바꿀 말이 다른 낱말의 피할 말입니다')
  // refused: nothing goes to the prompt box, and the form is the same one
  expect(fills).toHaveLength(0)
  expect(await hasInput(ui, 'words-avoid-0')).toBe(true)
  await ui.unmount()
})

test('words T6 지우기는 그 자리에서 한 번 묻는다 — 취소면 아무것도 부르지 않고, 지우기면 본체 명령으로 지운다', async ($, on) => {
  const kit = wordsKit(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openWords(ui)
  await ui.press({ key: 'words-remove-0' })
  expect(await text(ui, /^지울까요/)).toBe('지울까요?')
  expect(await labelOf(ui, 'words-remove-yes')).toBe('지우기')
  expect(await labelOf(ui, 'words-remove-no')).toBe('취소')
  // the asked entry's own buttons are gone while it is asked about
  expect(await has(ui, 'words-remove-0')).toBe(false)
  await ui.press({ key: 'words-remove-no' })
  expect(wordsRuns(kit)).toHaveLength(0)
  expect(await drawnText($)).not.toContain('지울까요?')

  await ui.press({ key: 'words-remove-0' })
  kit.proc.stdout = 'WORDS_REMOVED: 재다\n'
  kit.extra['scv/words/WORDS.tsv'] = WORDS_TSV.split('\n').filter(line => !line.startsWith('재다')).join('\n')
  await ui.press({ key: 'words-remove-yes' })
  await settle()
  expect(wordsRuns(kit)).toHaveLength(1)
  expect(wordsRuns(kit)[0]?.argv).toEqual(['bash', WORDS_SH, 'remove', '재다'])
  expect(wordsRuns(kit)[0]?.cwd).toBe('/work')
  expect(await text(ui, /^지움/)).toBe('지움: 재다')
  expect(await labelOf(ui, 'words-toggle')).toBe('▾ 낱말 사전 2')
  expect(await drawnText($)).not.toContain('재다 → 측정하다')
  await ui.unmount()
})

test('words T7 본체를 못 찾거나 사전 명령이 없는 옛 본체면 입력창에 명령을 넣고 그렇게 말한다', async ($, on) => {
  const kit = wordsKit(on, null, { isInstalled: false })
  const { fills } = promptEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openWords(ui)
  await ui.input({ key: 'words-avoid-0', text: '재다', kind: 'change' })
  await ui.input({ key: 'words-use-0', text: '측정하다', kind: 'change' })
  await ui.press({ key: 'words-save' })
  await settle()

  expect(wordsRuns(kit)).toHaveLength(0)
  expect(fills).toEqual([{ text: '/scv:words add 재다 → 측정하다', mode: 'replace' }])
  expect(await text(ui, /^바로 저장하지 못해/)).toBe('바로 저장하지 못해 입력창에 넣음: /scv:words add 재다 → 측정하다')
  await ui.unmount()
})

test('words T7b 옛 본체 — 명령이 돌았지만 저장했다는 말이 없으면 입력창으로 넘긴다(지우기도)', async ($, on) => {
  const kit = wordsKit(on)
  const { fills } = promptEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openWords(ui)
  kit.procEnd.exitCode = 127
  kit.procEnd.stderr = `bash: ${WORDS_SH}: No such file or directory\n`
  await ui.input({ key: 'words-avoid-0', text: '살피다', kind: 'change' })
  await ui.input({ key: 'words-use-0', text: '확인하다', kind: 'change' })
  await ui.press({ key: 'words-save' })
  await settle()
  expect(wordsRuns(kit)).toHaveLength(1)
  expect(fills).toEqual([{ text: '/scv:words add 살피다 → 확인하다', mode: 'replace' }])

  await ui.press({ key: 'words-remove-0' })
  await ui.press({ key: 'words-remove-yes' })
  await settle()
  expect(fills[1]).toEqual({ text: '/scv:words remove 재다', mode: 'replace' })
  expect(await text(ui, /^바로 지우지 못해/)).toBe('바로 지우지 못해 입력창에 넣음: /scv:words remove 재다')
  await ui.unmount()
})

test('words T8 여덟 줄까지 보이고 나머지는 N개 더 보기 — 고치기는 그 낱말을 칸에 열고, 메모는 남고, 피할 말을 바꾸면 옛 줄은 지운다', async ($, on) => {
  const many = Array.from({ length: 11 }, (_, i) => `말${i}\t바꿈${i}\t변형${i}\t${i === 2 ? '남길 메모' : ''}`).join('\n')
  const kit = wordsKit(on, many)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openWords(ui)
  expect(await text(ui, /^말7 →/)).toBe('말7 → 바꿈7')
  expect(await text(ui, /^말8 →/)).toBeUndefined()
  expect(await labelOf(ui, 'words-all')).toBe('3개 더 보기')
  await ui.press({ key: 'words-all' })
  expect(await text(ui, /^말10 →/)).toBe('말10 → 바꿈10')
  expect(await has(ui, 'words-all')).toBe(false)

  // 고치기: the entry's own words are in the fields
  await ui.press({ key: 'words-edit-2' })
  expect(await text(ui, /^고치기 —/)).toBe('고치기 — 말2 → 바꿈2')
  expect((await ui.find({ type: 'Input', key: 'words-avoid-1' }))?.props.value).toBe('말2')
  expect((await ui.find({ type: 'Input', key: 'words-use-1' }))?.props.value).toBe('바꿈2')
  expect((await ui.find({ type: 'Input', key: 'words-forms-1' }))?.props.value).toBe('변형2')
  // saved as it stands: nothing is run
  await ui.press({ key: 'words-save' })
  await settle()
  expect(wordsRuns(kit)).toHaveLength(0)
  expect(await text(ui, /^바뀐 것이 없어/)).toBe('바뀐 것이 없어 그대로 둠')
  // the other word changed: the same key is saved again, with its note
  await ui.press({ key: 'words-edit-2' })
  await ui.input({ key: 'words-use-3', text: '새 바꿈', kind: 'change' })
  kit.proc.stdout = 'WORDS_SAVED: 말2 → 새 바꿈\n'
  await ui.press({ key: 'words-save' })
  await settle()
  expect(wordsRuns(kit).map(one => one.argv.slice(2))).toEqual([['add', '--avoid', '말2', '--use', '새 바꿈', '--forms', '변형2', '--note', '남길 메모']])
  // the avoided word changed: the new entry goes in, then the old one is taken out
  await ui.press({ key: 'words-edit-2' })
  await ui.input({ key: 'words-avoid-5', text: '새말', kind: 'change' })
  kit.proc.stdout = 'WORDS_SAVED: 새말 → 바꿈2\n'
  await ui.press({ key: 'words-save' })
  await settle()
  expect(wordsRuns(kit).slice(1).map(one => one.argv.slice(2))).toEqual([['add', '--avoid', '새말', '--use', '바꿈2', '--forms', '변형2', '--note', '남길 메모'], ['remove', '말2']])
  // 취소 leaves the form empty again
  await ui.press({ key: 'words-edit-0' })
  expect(await labelOf(ui, 'words-edit-cancel')).toBe('취소')
  await ui.press({ key: 'words-edit-cancel' })
  expect(await text(ui, /^낱말 추가$/)).toBe('낱말 추가')
  await ui.unmount()
})

test('words T9 기본은 접힘 — 한 줄만 보이고, 누르면 펼치고, 다시 누르면 접힌다. 접혀도 방금 한 일의 결과 줄은 남는다', async ($, on) => {
  const kit = wordsKit(on)
  const { fills } = promptEngine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const isFolded = async () => {
    const drawn = await drawnText($)
    for (const gone of ['재다 → 측정하다', '잰 · 재서 · 재 본', '변형 없음', 'Claude 가 왼쪽 말이나', '낱말 추가']) expect(drawn).not.toContain(gone)
    for (const key of ['words-edit-0', 'words-remove-0', 'words-fill-1', 'words-save', 'words-all']) expect(await has(ui, key)).toBe(false)
    expect(await hasInput(ui, 'words-avoid-0')).toBe(false)
  }

  expect(await labelOf(ui, 'words-toggle')).toBe('▸ 낱말 사전 3')
  await isFolded()
  await openWords(ui)
  expect(await labelOf(ui, 'words-toggle')).toBe('▾ 낱말 사전 3')
  expect(await text(ui, /^Claude 가 왼쪽/)).toBe('Claude 가 왼쪽 말이나 그 변형을 쓰려 할 때 오른쪽 말로 바꿔 씁니다')
  expect(await text(ui, /^재다 →/)).toBe('재다 → 측정하다')
  expect(await text(ui, /^낱말 추가$/)).toBe('낱말 추가')
  expect(await has(ui, 'words-save')).toBe(true)
  expect(await hasInput(ui, 'words-avoid-0')).toBe(true)
  await openWords(ui)
  expect(await labelOf(ui, 'words-toggle')).toBe('▸ 낱말 사전 3')
  await isFolded()
  // folding and unfolding ran nothing and put nothing into the prompt box
  expect(wordsRuns(kit)).toHaveLength(0)
  expect(fills).toHaveLength(0)

  // a removal done while unfolded: its result line stays under the one line after the card is folded
  await openWords(ui)
  await ui.press({ key: 'words-remove-0' })
  kit.proc.stdout = 'WORDS_REMOVED: 재다\n'
  kit.extra['scv/words/WORDS.tsv'] = WORDS_TSV.split('\n').filter(line => !line.startsWith('재다')).join('\n')
  await ui.press({ key: 'words-remove-yes' })
  await settle()
  await openWords(ui)
  expect(await labelOf(ui, 'words-toggle')).toBe('▸ 낱말 사전 2')
  expect(await text(ui, /^지움/)).toBe('지움: 재다')
  expect(await drawnText($)).not.toContain('돌리다 → 실행하다')
  await ui.unmount()
})

test('words T10 자리 — 계획이 없으면 안내 두 줄 바로 아래, 계획이 있으면 단계 흐름 아래 · 더 보기 위', async ($, on) => {
  wordsKit(on)
  await start($)
  const none = await drawnText($)
  const at = (drawn: string, part: string) => {
    expect(drawn).toContain(part)

    return drawn.indexOf(part)
  }

  expect(at(none, '저장해 둔 일(기어) 3')).toBeLessThan(at(none, '진행 중인 SCV 계획이 없습니다'))
  expect(at(none, '진행 중인 SCV 계획이 없습니다')).toBeLessThan(at(none, '확인한 곳: /work/scv/promote'))
  expect(at(none, '확인한 곳: /work/scv/promote')).toBeLessThan(at(none, '▸ 낱말 사전 3'))
  // drawn once, and no other line stands between the two lines and it
  expect(none.split('낱말 사전 3')).toHaveLength(2)
  expect(none.slice(at(none, '확인한 곳: /work/scv/promote'), at(none, '▸ 낱말 사전 3'))).not.toContain('"type":"Text"')
})

test('words T10b 자리 — 계획이 있을 때: 묻기 방식 · 기어 · 단계 흐름 다음에 낱말 사전, 그 다음이 더 보기', async ($, on) => {
  const kit = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: FIVE, tests: ['T1 하나'] }) })
  withProject(kit)
  kit.extra['scv/words/WORDS.tsv'] = WORDS_TSV
  kit.store.delete('scv-dashboard:more')
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const order = async () => {
    const drawn = await drawnText($)

    return ['묻기 방식', '저장해 둔 일(기어) 3', '단계 흐름', '단계를 누르면 자세히', '낱말 사전 3', '"key":"more-toggle"'].map(part => {
      expect(drawn).toContain(part)

      return drawn.indexOf(part)
    })
  }
  const sorted = (list: number[]) => [...list].sort((a, b) => a - b)

  expect(await labelOf(ui, 'words-toggle')).toBe('▸ 낱말 사전 3')
  expect(await order()).toEqual(sorted(await order()))
  // folded: no line stands between it and the 'more' button
  const folded = await drawnText($)
  expect(folded.slice(folded.indexOf('낱말 사전 3'), folded.indexOf('"key":"more-toggle"'))).not.toContain('"type":"Text"')
  // unfolded, and with 'more' open: the same place — the folded cards come after the dictionary
  await openWords(ui)
  await ui.press({ key: 'more-toggle' })
  expect(await order()).toEqual(sorted(await order()))
  const opened = await drawnText($)
  expect(opened.indexOf('낱말 추가')).toBeGreaterThan(opened.indexOf('단계를 누르면 자세히'))
  expect(opened.indexOf('낱말 추가')).toBeLessThan(opened.indexOf('"key":"more-toggle"'))
  expect(opened.indexOf('"key":"more-toggle"')).toBeLessThan(opened.indexOf('예상 완료 시간'))
  await ui.unmount()
})

// ── after pane 0.5.0: the mirror can press things ────────────────────────────────

// What a working session that takes presses sends: its project as read, its switches and notes, its gear state.
const HOST_STATE = (over: Record<string, unknown> = {}, shot: Record<string, unknown> = {}) => ({
  snapshot: { plans: [{ slug: 'p', isArchived: false, ...PLANNED().p }], cwd: '/host', root: '/host', settingsText: '{"SCV_ASK_MODE":"all"}', gearsText: DIRECT, wordsText: WORDS_TSV, core: '/host/scv-core', gearWaits: 0, ...shot },
  contextFill: 40,
  place: { home: '/home/h', branch: { name: 'main', isBranch: true } },
  acts: MIRROR_ACTS,
  light: { isOn: true, percent: 50 },
  lightSaid: null,
  branchPick: null,
  placeNote: null,
  paneNote: null,
  wordsNote: null,
  gearRuns: {},
  gearForms: {},
  gearOpen: null,
  gearAsks: {},
  gearRecent: [],
  gearLive: [],
  ...over,
})
const hostSends = ($: Engine, state: unknown) => $.session.receive({ origin: { kind: 'peer' }, text: envelope(mirrorText({ kind: 'state', body: JSON.stringify(state) })) })
// a viewer session whose working session takes presses, with that session's state drawn
const startPresser = async ($: Engine, on: On, over: Record<string, unknown> = {}) => {
  const env = await startViewer($, on)
  await hostSends($, HOST_STATE(over))

  return env
}
// the acts this session sent to the working session, as their JSON
const actsOf = (env: { sent: { to: string; text: string }[] }) =>
  env.sent.filter(one => one.text.startsWith('SCV-MIRROR ACT session_viewer ')).map(one => one.text.replace('SCV-MIRROR ACT session_viewer ', ''))
const WAITING = '작업 세션에 보냄 — 반영을 기다림'

test('mirror-press T1 ACT 는 칸마다 모양을 검사한다 — 모르는 일 · 빠진 칸 · 기어 이름이 아닌 글 · 사전에 못 넣는 글은 버린다', () => {
  const ok = (act: unknown) => parseAct(JSON.stringify(act))
  expect(ok({ do: 'fill', slug: 'p' })).toEqual({ do: 'fill', slug: 'p' })
  expect(ok({ do: 'askMode', to: 'ends' })).toEqual({ do: 'askMode', to: 'ends' })
  expect(ok({ do: 'askMode', to: 'sometimes' })).toBeNull()
  expect(ok({ do: 'lightSwitch', isOn: false })).toEqual({ do: 'lightSwitch', isOn: false })
  expect(ok({ do: 'lightSwitch', isOn: 'no' })).toBeNull()
  expect(ok({ do: 'lightMark', percent: 65 })).toEqual({ do: 'lightMark', percent: 65 })
  expect(ok({ do: 'lightMark', percent: 500 })).toBeNull()
  expect(ok({ do: 'lightMark', percent: '65' })).toBeNull()
  expect(ok({ do: 'gearPress', name: 'tidy', canType: true })).toEqual({ do: 'gearPress', name: 'tidy', canType: true })
  expect(ok({ do: 'gearPress', name: '../x', canType: true })).toBeNull()
  expect(ok({ do: 'gearPress', name: 'tidy; rm -rf x', canType: true })).toBeNull()
  expect(ok({ do: 'gearPress', name: 'tidy' })).toBeNull()
  // values: argument names of SCV's own shape, each a text; anything else drops the whole act
  expect(ok({ do: 'gearSubmit', name: 'ci-all', values: { os: 'linux; echo "x"' }, input: '자료' })).toEqual({ do: 'gearSubmit', name: 'ci-all', values: { os: 'linux; echo "x"' }, input: '자료' })
  expect(ok({ do: 'gearSubmit', name: 'ci-all', values: { 'os --flag': 'x' }, input: '' })).toBeNull()
  expect(ok({ do: 'gearSubmit', name: 'ci-all', values: { os: 7 }, input: '' })).toBeNull()
  expect(ok({ do: 'gearSubmit', name: 'ci-all', values: ['os=linux'], input: '' })).toBeNull()
  expect(ok({ do: 'gearSubmit', name: 'ci-all', values: { os: 'a'.repeat(2001) }, input: '' })).toBeNull()
  expect(ok({ do: 'gearSubmit', name: 'ci-all', values: {} })).toBeNull()
  expect(ok({ do: 'gearConfirm', name: 'ship', isYes: true })).toEqual({ do: 'gearConfirm', name: 'ship', isYes: true })
  expect(ok({ do: 'gearConfirm', name: 'ship', isYes: 'yes' })).toBeNull()
  expect(ok({ do: 'gearStop', name: 'tidy' })).toEqual({ do: 'gearStop', name: 'tidy' })
  expect(ok({ do: 'branchList', isOpen: true })).toEqual({ do: 'branchList', isOpen: true })
  expect(ok({ do: 'branchPick', to: 'feat/x' })).toEqual({ do: 'branchPick', to: 'feat/x' })
  expect(ok({ do: 'branchPick', to: '--orphan' })).toBeNull()
  expect(ok({ do: 'branchPick', to: 'a b' })).toBeNull()
  expect(ok({ do: 'wordsSave', avoid: ' 재다 ', use: '측정하다', forms: '잰,재서', was: null })).toEqual({ do: 'wordsSave', avoid: '재다', use: '측정하다', forms: '잰, 재서', was: null })
  expect(ok({ do: 'wordsSave', avoid: '재\t다', use: '측정하다', forms: '', was: null })).toBeNull()
  expect(ok({ do: 'wordsSave', avoid: '재다', use: '', forms: '', was: null })).toBeNull()
  expect(ok({ do: 'wordsSave', avoid: '재다', use: '측정', forms: '', was: 7 })).toBeNull()
  expect(ok({ do: 'wordsRemove', avoid: '재다' })).toEqual({ do: 'wordsRemove', avoid: '재다' })
  expect(ok({ do: 'wordsRemove', avoid: '재\n다' })).toBeNull()
  // nothing else a message carried goes on
  expect(ok({ do: 'gearStop', name: 'tidy', argv: ['rm', '-rf', '/'] })).toEqual({ do: 'gearStop', name: 'tidy' })
  expect(ok({ do: 'shell', command: 'id' })).toBeNull()
  expect(ok(['gearStop'])).toBeNull()
  expect(parseAct('{not json')).toBeNull()

  // a delivery with the mark of an act that parses to none is still told apart from a plain message
  expect(isActText(envelope('SCV-MIRROR ACT session_v {"do":"shell"}'))).toBe(true)
  expect(isActText(envelope('그냥 메시지'))).toBe(false)
  expect(actLabel({ do: 'askMode', to: 'ends' })).toBe('묻기 방식 → 처음 · 끝에만 묻기')
  expect(actLabel({ do: 'gearConfirm', name: 'ship', isYes: false })).toBe('기어 확인 — ship: 취소')
  expect(actLabel({ do: 'wordsSave', avoid: '재다', use: '측정하다', forms: '', was: null })).toBe('낱말 저장 — 재다 → 측정하다')
  // what the working session's pane keeps: what was pressed in the mirror, and when (17:40 in Seoul)
  expect(fromMirrorLine({ do: 'gearStop', name: 'tidy' }, Date.parse('2026-10-23T08:40:00Z'), KST)).toBe('거울에서: 기어 멈춤 — tidy · 17:40')
  // a run's output goes to a viewer as the lines a card shows
  expect(wireTail(Array.from({ length: 40 }, (_, i) => `줄 ${i + 1}`).join('\n')).split('\n')).toHaveLength(12)
  expect(wireTail('a\n\u001b[32mRELEASE_OK\u001b[0m\n')).toBe('a\nRELEASE_OK')
})

test('mirror-press T2 누를 수 있다고 말하지 않은 작업 세션(옛 버전)의 상태에는 버튼이 없고, 말한 상태에는 버튼과 안내 한 줄이 있다', async ($, on) => {
  await startViewer($, on)
  const { acts: _acts, ...old } = HOST_STATE()
  await hostSends($, old)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openWords(ui)
  const before = await drawnText($)

  // the cards are drawn as before, with nothing to press
  expect(before).toContain('묻기 방식')
  expect(before).toContain('저장해 둔 일(기어) 5')
  expect(before).toContain('낱말 사전 3')
  expect(before).not.toContain('여기서 누르면')
  for (const key of ['ask-mode-switch', 'light-toggle', 'light-up', 'branch-open', 'gear-run-tidy', 'words-remove-0', 'words-edit-0', 'words-save']) expect(await has(ui, key)).toBe(false)
  expect(await hasInput(ui, 'words-avoid-0')).toBe(false)

  await hostSends($, HOST_STATE())
  expect(await text(ui, /^여기서 누르면/)).toBe('여기서 누르면 작업 세션에 메시지 한 줄이 남습니다.')
  for (const key of ['ask-mode-switch', 'light-toggle', 'light-up', 'light-down', 'branch-open', 'gear-run-tidy', 'words-remove-0', 'words-edit-0', 'words-save']) expect(await has(ui, key)).toBe(true)
  // what only the working session's own prompt box can take stays off the mirror
  for (const key of ['gear-use-review', 'words-fill-1']) expect(await has(ui, key)).toBe(false)
  await ui.unmount()
})

test('mirror-press T3 거울에서 묻기 방식 · 자동 비우기 · 기준 · 브랜치를 누르면 작업 세션으로 ACT 가 가고, 여기서는 아무것도 돌지 않는다', async ($, on) => {
  const env = await startPresser($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const ranBefore = env.runs.length

  await ui.press({ key: 'ask-mode-switch' })
  expect(actsOf(env)).toEqual(['{"do":"askMode","to":"ends"}'])
  expect(env.sent.at(-1)?.to).toContain('session_host')
  expect(await text(ui, /^작업 세션에 보냄/)).toBe(WAITING)
  // the working session's answer: its state as it then stands — the waiting line goes, its own line shows
  await hostSends($, HOST_STATE({ paneNote: '묻기 방식을 바꿈 — 다음 메시지부터 처음 · 끝에만 묻기' }, { settingsText: '{"SCV_ASK_MODE":"ends"}' }))
  const answered = await drawnText($)
  expect(answered).not.toContain(WAITING)
  expect(answered).toContain('묻기 방식을 바꿈 — 다음 메시지부터 처음 · 끝에만 묻기')
  expect(await labelOf(ui, 'ask-mode-switch')).toBe('전부 묻기로 바꾸기')

  await ui.press({ key: 'light-toggle' })
  await ui.press({ key: 'light-up' })
  await ui.press({ key: 'light-down' })
  expect(actsOf(env).slice(1)).toEqual(['{"do":"lightSwitch","isOn":false}', '{"do":"lightMark","percent":55}', '{"do":"lightMark","percent":45}'])
  // this session's own switch is not touched
  expect(env.store.get('scv-dashboard:light')).toBeUndefined()
  // the mark at the end of its bar: a press changes nothing there, so nothing is sent
  await hostSends($, HOST_STATE({ light: { isOn: true, percent: 95 } }))
  expect(await drawnText($)).toContain('기준 95%')
  await ui.press({ key: 'light-up' })
  expect(actsOf(env)).toHaveLength(4)

  await ui.press({ key: 'branch-open' })
  expect(actsOf(env).at(-1)).toBe('{"do":"branchList","isOpen":true}')
  await hostSends($, HOST_STATE({ branchPick: ['main', 'feat/x'] }))
  expect(((await ui.find({ type: 'Select', key: 'branch-pick' }))?.props.options as { value: string }[]).map(one => one.value)).toEqual(['main', 'feat/x'])
  // the branch already checked out: nothing would change, nothing is sent
  await ui.select({ key: 'branch-pick', value: 'main' })
  await settle()
  expect(actsOf(env)).toHaveLength(5)
  await ui.select({ key: 'branch-pick', value: 'feat/x' })
  await settle()
  expect(actsOf(env).at(-1)).toBe('{"do":"branchPick","to":"feat/x"}')
  // the working session decides: its answer line is shown as it is
  await hostSends($, HOST_STATE({ placeNote: '턴이 도는 중에는 브랜치를 바꾸지 않음 — 턴이 끝난 뒤 다시 눌러 주세요' }))
  expect(await drawnText($)).toContain('턴이 도는 중에는 브랜치를 바꾸지 않음')
  await ui.press({ key: 'branch-open' })
  expect(actsOf(env).at(-1)).toBe('{"do":"branchList","isOpen":true}')

  // no command ran in this session for any of these presses (only its own address was looked up)
  expect(env.runs.slice(ranBefore).every(one => one.argv[0] === 'sh')).toBe(true)
  // a send that fails says so
  env.delivery.isDelivered = false
  await ui.press({ key: 'ask-mode-switch' })
  expect(await text(ui, /^작업 세션에 못 보냄/)).toBe('작업 세션에 못 보냄: no such session')
  await ui.unmount()
})

test('mirror-press T4 거울에서 기어 — 실행 · 값 정하기 · 밖으로 나가는 일의 확인 · 멈춤이 ACT 로 가고, 고른 값과 적은 글은 실행을 누를 때 한 번에 간다', async ($, on) => {
  const env = await startPresser($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'gear-run-tidy' })
  expect(actsOf(env)).toEqual(['{"do":"gearPress","name":"tidy","canType":true}'])
  expect(env.spawns).toHaveLength(0)
  expect(await text(ui, /^작업 세션에 보냄/)).toBe(WAITING)
  // it runs there: the card follows it, and 멈춤 goes there too
  await hostSends($, HOST_STATE({ gearRuns: { tidy: { startedAt: 1_000_000, endedAt: null, tail: '치우는 중 1/3', exitCode: null, isStopped: false } }, gearLive: ['tidy'], gearOpen: 'tidy', gearRecent: ['tidy'] }))
  const running = await drawnText($)
  expect(running).toContain('· 돌리는 중')
  expect(running).toContain('│ 치우는 중 1/3')
  expect(running).not.toContain('끊김')
  expect(await has(ui, 'gear-run-tidy')).toBe(false)
  await ui.press({ key: 'gear-stop-tidy' })
  expect(actsOf(env).at(-1)).toBe('{"do":"gearStop","name":"tidy"}')
  // ended there: its result lines, and no button that would fill this session's own prompt box
  await hostSends($, HOST_STATE({ gearRuns: { tidy: { startedAt: 1_000_000, endedAt: 1_002_000, tail: '치운 파일 3개', exitCode: 0, isStopped: false } }, gearOpen: 'tidy', gearRecent: ['tidy'] }))
  expect(await text(ui, /^│ 치운/)).toBe('│ 치운 파일 3개')
  expect(await has(ui, 'gear-paste-tidy')).toBe(false)
  expect(await has(ui, 'gear-use-tidy')).toBe(false)

  // values: the block the working session opened is drawn here; a pick stays here, and goes with the run
  const sentBefore = actsOf(env).length
  await hostSends($, HOST_STATE({ gearForms: { 'ci-all': { kind: 'values', from: 'card', picked: { os: 'mac' } } }, gearAsks: { 'ci-all': DIRECT_ASKS['ci-all'] }, gearOpen: 'ci-all', gearRecent: ['ci-all'] }))
  expect(await labelOf(ui, 'gear-pick-ci-all-os-0')).toBe('● mac')
  await ui.press({ key: 'gear-pick-ci-all-os-1' })
  expect(await labelOf(ui, 'gear-pick-ci-all-os-1')).toBe('● linux')
  expect(actsOf(env)).toHaveLength(sentBefore)
  expect(await has(ui, 'gear-chat-ci-all')).toBe(false)
  await ui.press({ key: 'gear-go-ci-all' })
  expect(actsOf(env).at(-1)).toBe('{"do":"gearSubmit","name":"ci-all","values":{"os":"linux"},"input":""}')

  // typed values and the data: typed here, sent once — never per keystroke
  await hostSends($, HOST_STATE({ gearForms: { 'count-lines': { kind: 'values', from: 'card', picked: {} } }, gearAsks: { 'count-lines': DIRECT_ASKS['count-lines'] }, gearOpen: 'count-lines', gearRecent: ['count-lines'] }))
  const typedBefore = actsOf(env).length
  await ui.input({ key: 'gear-arg-count-lines-count', text: '7; rm -rf "x"', kind: 'change' })
  await ui.input({ key: 'gear-input-count-lines', text: '첫 줄\n둘째 줄', kind: 'change' })
  expect(actsOf(env)).toHaveLength(typedBefore)
  await ui.press({ key: 'gear-go-count-lines' })
  expect(JSON.parse(actsOf(env).at(-1) ?? '{}')).toEqual({ do: 'gearSubmit', name: 'count-lines', values: { count: '7; rm -rf "x"' }, input: '첫 줄\n둘째 줄' })
  expect(env.spawns).toHaveLength(0)

  // the question before a gear that reaches outside: 실행 · 취소 go there
  const confirm = { kind: 'confirm', from: 'card', picked: {}, input: '', lines: ['밖으로 나가는 단계 1개 — [실행]을 누르기 전에는 아무것도 돌지 않음', '· push-tags — 태그를 원격에 올림'], teeth: ['push-tags'], wait: null, startedAt: 1_000_000 }
  await hostSends($, HOST_STATE({ gearForms: { ship: confirm }, gearOpen: 'ship', gearRecent: ['ship'] }))
  expect(await drawnText($)).toContain('· push-tags — 태그를 원격에 올림')
  await ui.press({ key: 'gear-confirm-yes-ship' })
  expect(actsOf(env).at(-1)).toBe('{"do":"gearConfirm","name":"ship","isYes":true}')
  await ui.press({ key: 'gear-confirm-no-ship' })
  expect(actsOf(env).at(-1)).toBe('{"do":"gearConfirm","name":"ship","isYes":false}')
  // a gear whose block is open there: a press on its folded line only opens it here — nothing is sent
  await ui.press({ key: 'gear-open-ship' })
  const folded = actsOf(env).length
  await ui.press({ key: 'gear-run-ship' })
  expect(actsOf(env)).toHaveLength(folded)
  expect(await has(ui, 'gear-confirm-yes-ship')).toBe(true)
  expect(env.gearCalls).toHaveLength(0)
  await ui.unmount()
})

test('mirror-press T5 거울에서 낱말 — 저장은 적은 글이 누를 때 한 번에, 지우기는 물어본 뒤에 ACT 로 간다', async ($, on) => {
  const env = await startPresser($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await openWords(ui)
  // unfolding is this session's own: nothing went to the working session
  expect(actsOf(env)).toHaveLength(0)
  await ui.input({ key: 'words-avoid-0', text: '살피다', kind: 'change' })
  await ui.input({ key: 'words-use-0', text: '확인"하다"; x', kind: 'change' })
  expect(actsOf(env)).toHaveLength(0)
  await ui.press({ key: 'words-save' })
  await settle()

  expect(actsOf(env).map(one => JSON.parse(one))).toEqual([{ do: 'wordsSave', avoid: '살피다', use: '확인"하다"; x', forms: '', was: null }])
  expect(await text(ui, /^작업 세션에 보냄/)).toBe(WAITING)
  expect(wordsRuns(env)).toHaveLength(0)
  // a draft that could not be an entry is not sent
  await ui.press({ key: 'words-save' })
  await settle()
  expect(actsOf(env)).toHaveLength(1)
  expect(await text(ui, /^저장하지 않음/)).toBe('저장하지 않음 — 피할 말과 바꿀 말을 모두 적어 주세요')
  // 고치기 with nothing changed sends nothing; a change goes with the entry's key
  await ui.press({ key: 'words-edit-0' })
  await ui.press({ key: 'words-save' })
  await settle()
  expect(actsOf(env)).toHaveLength(1)
  await ui.press({ key: 'words-edit-0' })
  await ui.input({ key: 'words-use-4', text: '계측하다', kind: 'change' })
  await ui.press({ key: 'words-save' })
  await settle()
  expect(JSON.parse(actsOf(env).at(-1) ?? '{}')).toEqual({ do: 'wordsSave', avoid: '재다', use: '계측하다', forms: '잰, 재서, 재 본', was: '재다' })

  await ui.press({ key: 'words-remove-0' })
  expect(actsOf(env)).toHaveLength(2)
  await ui.press({ key: 'words-remove-no' })
  expect(actsOf(env)).toHaveLength(2)
  await ui.press({ key: 'words-remove-0' })
  await ui.press({ key: 'words-remove-yes' })
  await settle()
  expect(actsOf(env).at(-1)).toBe('{"do":"wordsRemove","avoid":"재다"}')
  expect(wordsRuns(env)).toHaveLength(0)
  // the working session's own line after it did the work
  await hostSends($, HOST_STATE({ wordsNote: '지움: 재다' }, { wordsText: WORDS_TSV.split('\n').filter(line => !line.startsWith('재다')).join('\n') }))
  const after = await drawnText($)
  expect(after).toContain('지움: 재다')
  expect(after).toContain('낱말 사전 2')
  expect(after).not.toContain(WAITING)
  await ui.unmount()
})

test('mirror-press T6 거울의 낱말 사전 — 단계 흐름 아래에 접힌 채 있고, 접고 펴도 작업 세션에 보내는 글이 없다', async ($, on) => {
  const env = await startViewer($, on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // a working session that did not read a dictionary: no card
  expect(await has(ui, 'words-toggle')).toBe(false)
  await hostSends($, HOST_STATE())
  const folded = await drawnText($)

  expect(await labelOf(ui, 'words-toggle')).toBe('▸ 낱말 사전 3')
  expect(folded).not.toContain('재다 → 측정하다')
  expect(await has(ui, 'words-save')).toBe(false)
  expect(folded.indexOf('저장해 둔 일(기어) 5')).toBeLessThan(folded.indexOf('단계 흐름'))
  expect(folded.indexOf('단계 흐름')).toBeLessThan(folded.indexOf('낱말 사전 3'))
  expect(folded.indexOf('낱말 사전 3')).toBeLessThan(folded.indexOf('"key":"more-toggle"'))

  const sentBefore = env.sent.length
  await openWords(ui)
  expect(await labelOf(ui, 'words-toggle')).toBe('▾ 낱말 사전 3')
  expect(await text(ui, /^재다 →/)).toBe('재다 → 측정하다')
  expect(await has(ui, 'words-save')).toBe(true)
  // the working session's next state does not fold it again
  await hostSends($, HOST_STATE())
  expect(await labelOf(ui, 'words-toggle')).toBe('▾ 낱말 사전 3')
  await openWords(ui)
  expect(await labelOf(ui, 'words-toggle')).toBe('▸ 낱말 사전 3')
  expect(await drawnText($)).not.toContain('재다 → 측정하다')
  expect(env.sent).toHaveLength(sentBefore)
  expect(actsOf(env)).toHaveLength(0)
  expect(wordsRuns(env)).toHaveLength(0)
  // folded, the working session's own result line still shows under the one line
  await hostSends($, HOST_STATE({ wordsNote: '지움: 재다' }, { wordsText: WORDS_TSV.split('\n').filter(line => !line.startsWith('재다')).join('\n') }))
  expect(await labelOf(ui, 'words-toggle')).toBe('▸ 낱말 사전 2')
  expect(await text(ui, /^지움/)).toBe('지움: 재다')
  await ui.unmount()
})

// ── the working session does what a mirror pressed ──

// a working session (the gears above, SCV installed, the dictionary) that session_viewer mirrors
const hostKit = async ($: Engine, on: On) => {
  const kit = directKit(on)
  kit.extra['scv/words/WORDS.tsv'] = WORDS_TSV
  await start($)
  await $.session.receive(hello())

  return kit
}
const actFrom = ($: Engine, act: unknown, address = 'session_viewer') =>
  $.session.receive({ origin: { kind: 'peer' as const }, text: envelope(`SCV-MIRROR ACT ${address} ${JSON.stringify(act)}`) })
// the state sent last, as the viewer reads it
const lastSent = (kit: { sent: { to: string; text: string }[] }) => {
  const parsed = parseMirror(kit.sent.at(-1)?.text ?? '')

  return (parsed?.kind === 'state' ? JSON.parse(parsed.body) : {}) as Record<string, any>
}

test('mirror-act T1 작업 세션은 시청자의 ACT 를 자기 버튼과 같은 함수로 하고, 상태를 바로 보내고, 자기 칸에 거울에서 온 일을 적는다', async ($, on) => {
  const kit = await hostKit($, on)
  expect(kit.sent).toHaveLength(1)
  expect(lastSent(kit).acts).toBe(MIRROR_ACTS)

  kit.extra['scv/scv_settings.json'] = '{"SCV_ASK_MODE":"ends"}'
  const got = await actFrom($, { do: 'askMode', to: 'ends' })
  expect(got.consumed).toBe('scv mirror act')
  const ran = kit.runs.filter(one => one.argv[1]?.endsWith('/ask-mode.sh'))
  expect(ran).toHaveLength(1)
  expect(ran[0]?.argv).toEqual(['bash', `${CORE_DIR}/scripts/ask-mode.sh`, 'ends'])
  expect(ran[0]?.cwd).toBe('/work')
  // answered at once — no 10-second gap, though the clock has not moved since the first send
  expect(kit.sent).toHaveLength(2)
  expect(kit.sent[1]?.to).toContain('session_viewer')
  expect(lastSent(kit).paneNote).toBe('묻기 방식을 바꿈 — 다음 메시지부터 처음 · 끝에만 묻기')
  expect(lastSent(kit).snapshot.settingsText).toBe('{"SCV_ASK_MODE":"ends"}')
  const drawn = await drawnText($)
  expect(drawn).toContain('거울에서: 묻기 방식 → 처음 · 끝에만 묻기')
  // the same act again changes nothing: no command, but the viewer still gets its answer
  await actFrom($, { do: 'askMode', to: 'ends' })
  expect(kit.runs.filter(one => one.argv[1]?.endsWith('/ask-mode.sh'))).toHaveLength(1)
  expect(kit.sent).toHaveLength(3)

  await actFrom($, { do: 'lightSwitch', isOn: false })
  expect(kit.store.get('scv-dashboard:light')).toEqual({ isOn: false, percent: 50 })
  await actFrom($, { do: 'lightMark', percent: 67 })
  expect(kit.store.get('scv-dashboard:light')).toEqual({ isOn: false, percent: 65 })
  expect(lastSent(kit).light).toEqual({ isOn: false, percent: 65 })
  expect(await drawnText($)).toContain('거울에서: 비우기 기준 → 65%')
  expect(kit.sent).toHaveLength(5)
})

test('mirror-act T2 시청자가 아닌 세션의 ACT, 모양이 틀린 ACT, 이 세션에 없는 기어 · 브랜치 · 낱말은 아무것도 하지 않는다 — 모델에도 가지 않는다', async ($, on) => {
  const kit = await hostKit($, on)
  const calls = () => kit.runs.filter(one => one.argv[0] !== 'sh').length + kit.spawns.length
  const before = calls()

  // not a viewer of this session: taken off the conversation, nothing done, nothing sent back
  const stranger = await actFrom($, { do: 'askMode', to: 'ends' }, 'session_other')
  expect(stranger.consumed).toBe('scv mirror act')
  expect(calls()).toBe(before)
  expect(kit.sent).toHaveLength(1)
  expect(kit.store.get('scv-dashboard:light')).toBeUndefined()
  await actFrom($, { do: 'gearPress', name: 'tidy', canType: true }, 'session_other')
  expect(kit.spawns).toHaveLength(0)

  // malformed or unknown: dropped — and never passed on to the model
  for (const bad of [{ do: 'gearPress', name: '../x', canType: true }, { do: 'shell', command: 'id' }, { do: 'gearSubmit', name: 'ci-all', values: { 'os; id': 'x' }, input: '' }, { do: 'branchPick', to: '--orphan' }]) {
    const got = await actFrom($, bad)
    expect(got.consumed).toBe('scv mirror act (unknown)')
  }
  expect(calls()).toBe(before)
  // well-formed, but a name this session does not list itself
  await actFrom($, { do: 'gearPress', name: 'no-such-gear', canType: true })
  await actFrom($, { do: 'gearStop', name: 'no-such-gear' })
  await actFrom($, { do: 'wordsRemove', avoid: '없는 말' })
  expect(kit.spawns).toHaveLength(0)
  expect(wordsRuns(kit)).toHaveLength(0)
  expect(lastSent(kit).wordsNote).toBe('지우지 않음 — 사전에 없는 말: 없는 말')
  kit.proc.stdout = 'main\nfeat/x\n'
  await actFrom($, { do: 'branchPick', to: 'feat/none' })
  expect(kit.processes.some(argv => argv[1] === 'switch')).toBe(false)
  expect(lastSent(kit).placeNote).toBe('브랜치를 바꾸지 않음 — 이 저장소에 없는 이름: feat/none')
  // a plain message from another session still reaches the model
  const plain = await $.session.receive({ origin: { kind: 'peer' }, text: envelope('안녕') })
  expect(plain.consumed).toBeUndefined()
})

test('mirror-act T3 거울에서 온 기어 실행 — 바로 돌리기 · 값 받아 돌리기 · 확인 · 멈춤이 창의 버튼과 같은 명령으로 간다', async ($, on) => {
  const kit = await hostKit($, on)
  kit.extra['scv/gears/ship/GEAR.md'] = 'flow: tidy | push-tags\nin: none\nout: lines\n\n# ship\n'
  kit.proc.stdout = '치운 파일 3개\n'
  await actFrom($, { do: 'gearPress', name: 'tidy', canType: true })
  await settle()
  expect(kit.spawns).toEqual([{ argv: gearLaunchArgv(['bash', GEAR_SH, 'run', 'tidy']), cwd: '/work', input: '' }])
  expect(kit.sent.length).toBeGreaterThan(1)
  expect(await drawnText($)).toContain('거울에서: 기어 실행 — tidy')
  expect(lastSent(kit).gearOpen).toBe('tidy')

  // values: the press opens the block here (and in the state), the submit carries what the viewer set
  await actFrom($, { do: 'gearPress', name: 'ci-all', canType: true })
  expect(kit.spawns).toHaveLength(1)
  expect(lastSent(kit).gearForms['ci-all']).toEqual({ kind: 'values', from: 'card', picked: { os: 'mac' } })
  expect(lastSent(kit).gearAsks['ci-all']).toBe(DIRECT_ASKS['ci-all'])
  await actFrom($, { do: 'gearSubmit', name: 'ci-all', values: { os: 'linux' }, input: '' })
  await settle()
  expect(kit.spawns[1]?.argv).toEqual(gearLaunchArgv(['bash', GEAR_SH, 'run', 'ci-all', 'os=linux']))
  // a typed value is the value part of one word, the data goes in on standard input — and a name SCV did not list adds no word
  const odd = '7; rm -rf "x" $(id)'
  await actFrom($, { do: 'gearPress', name: 'count-lines', canType: true })
  await actFrom($, { do: 'gearSubmit', name: 'count-lines', values: { count: odd, other: 'y' }, input: 'count=9; echo "$HOME"' })
  await settle()
  expect(kit.spawns[2]).toEqual({ argv: gearLaunchArgv(['bash', GEAR_SH, 'run', 'count-lines', `count=${odd}`]), cwd: '/work', input: 'count=9; echo "$HOME"' })
  // a gear that needs typing, pressed from a surface with no field: handed to this session's prompt box, not run
  await actFrom($, { do: 'gearPress', name: 'count-lines', canType: false })
  expect(kit.spawns).toHaveLength(3)

  // a gear that reaches outside: the question first; 취소 runs nothing; 실행 goes through SCV's own confirm record
  await actFrom($, { do: 'gearPress', name: 'ship', canType: true })
  expect(lastSent(kit).gearForms.ship.kind).toBe('confirm')
  expect(lastSent(kit).gearForms.ship.lines).toContain('· push-tags — 태그를 원격에 올림')
  expect(kit.spawns).toHaveLength(3)
  await actFrom($, { do: 'gearConfirm', name: 'ship', isYes: false })
  expect(kit.spawns).toHaveLength(3)
  expect(lastSent(kit).paneNote).toBe('실행하지 않음 — 아무것도 돌지 않았습니다')
  kit.spawnPlans.push({ pieces: [STOP_AT('ab12cd34', 2, 2, 'push-tags', '태그를 원격에 올림')], code: 11 }, { pieces: ['v1.0 올림\n'], code: 0 })
  await actFrom($, { do: 'gearPress', name: 'ship', canType: true })
  await actFrom($, { do: 'gearConfirm', name: 'ship', isYes: true })
  await settle()
  expect(kit.gearCalls.slice(-3)).toEqual(['spawn run ship', 'run confirm --question SCV 창에서 받은 답 [기어 확인 ab12cd34:2] --answer 실행', 'spawn resume ab12cd34'])
  // a confirm for a gear with no question open does nothing
  const calls = kit.gearCalls.length
  await actFrom($, { do: 'gearConfirm', name: 'tidy', isYes: true })
  expect(kit.gearCalls).toHaveLength(calls)

  // 멈춤: a run under way is told to end, and the state says it was stopped
  let open = () => {}
  kit.spawnPlans.push({ pieces: ['받는 중 1/3\n'], gate: new Promise<void>(done => (open = done)), after: ['늦은 줄\n'], code: 0 })
  await actFrom($, { do: 'gearPress', name: 'tidy', canType: true })
  await settle()
  expect(lastSent(kit).gearLive).toEqual(['tidy'])
  expect(lastSent(kit).gearRuns.tidy.exitCode).toBe(null)
  await actFrom($, { do: 'gearStop', name: 'tidy' })
  expect(lastSent(kit).gearRuns.tidy.isStopped).toBe(true)
  expect(lastSent(kit).gearLive).toEqual([])
  expect(await drawnText($)).toContain('거울에서: 기어 멈춤 — tidy')
  open()
  await settle()
})

test('mirror-act T4 거울에서 온 브랜치 바꾸기 — 목록을 열고, 고르면 git 이 바꾸고, 턴이 도는 중이면 바꾸지 않고 그렇게 답한다', async ($, on) => {
  turnEngine(on)
  const kit = directKit(on)
  kit.extra['/work/.git/HEAD'] = 'ref: refs/heads/main\n'
  await start($)
  await $.session.receive(hello())
  kit.proc.stdout = 'main\nfeat/x\n'
  await actFrom($, { do: 'branchList', isOpen: true })
  expect(kit.processes.filter(argv => argv[0] === 'git')).toEqual([['git', 'branch', '--format=%(refname:short)']])
  expect(kit.runs.find(one => one.argv[0] === 'git')?.cwd).toBe('/work')
  expect(lastSent(kit).branchPick).toEqual(['main', 'feat/x'])
  // asked to open what is open: nothing is listed again
  const listed = kit.processes.filter(argv => argv[1] === 'branch').length
  await actFrom($, { do: 'branchList', isOpen: true })
  expect(kit.processes.filter(argv => argv[1] === 'branch')).toHaveLength(listed)

  // not while a turn runs: the working session decides, and its line goes back
  await $.turn.start({ text: '일', turnId: 't9' })
  await actFrom($, { do: 'branchPick', to: 'feat/x' })
  expect(kit.processes.some(argv => argv[1] === 'switch')).toBe(false)
  expect(lastSent(kit).placeNote).toBe('턴이 도는 중에는 브랜치를 바꾸지 않음 — 턴이 끝난 뒤 다시 눌러 주세요')
  await turnEnd($, 'answer', 1000)
  await settle()

  kit.extra['/work/.git/HEAD'] = 'ref: refs/heads/feat/x\n'
  const got = await actFrom($, { do: 'branchPick', to: 'feat/x' })
  expect(got.consumed).toBe('scv mirror act')
  const switched = kit.runs.filter(one => one.argv[1] === 'switch')
  expect(switched).toHaveLength(1)
  expect(switched[0]?.argv).toEqual(['git', 'switch', 'feat/x'])
  expect(switched[0]?.cwd).toBe('/work')
  expect(lastSent(kit).placeNote).toBe('브랜치를 바꿈: main → feat/x')
  expect(lastSent(kit).place.branch).toEqual({ name: 'feat/x', isBranch: true })
  expect(lastSent(kit).branchPick).toBe(null)
  expect(await drawnText($)).toContain('거울에서: 브랜치 → feat/x')
  await actFrom($, { do: 'branchList', isOpen: false })
  expect(lastSent(kit).branchPick).toBe(null)
})

test('mirror-act T5 거울에서 온 낱말 저장 · 지우기 — 본체의 사전 명령을 낱말 하나씩의 값으로 부르고, 한 말을 상태에 실어 보낸다', async ($, on) => {
  const kit = await hostKit($, on)
  expect(lastSent(kit).snapshot.wordsText).toBe(WORDS_TSV)
  const use = '확인"하다"; rm -rf x'
  kit.proc.stdout = `WORDS_SAVED: 살피다 → ${use}\n`
  kit.extra['scv/words/WORDS.tsv'] = `${WORDS_TSV}\n살피다\t${use}\t\t`
  await actFrom($, { do: 'wordsSave', avoid: '살피다', use, forms: '', was: null })

  expect(wordsRuns(kit)).toHaveLength(1)
  expect(wordsRuns(kit)[0]?.argv).toEqual(['bash', WORDS_SH, 'add', '--avoid', '살피다', '--use', use])
  expect(wordsRuns(kit)[0]?.cwd).toBe('/work')
  expect(lastSent(kit).wordsNote).toBe(`저장함: 살피다 → ${use}`)
  expect(lastSent(kit).snapshot.wordsText).toContain('살피다')
  expect(await drawnText($)).toContain('거울에서: 낱말 저장 — 살피다 →')

  kit.proc.stdout = 'WORDS_REMOVED: 재다\n'
  await actFrom($, { do: 'wordsRemove', avoid: '재다' })
  expect(wordsRuns(kit)[1]?.argv).toEqual(['bash', WORDS_SH, 'remove', '재다'])
  expect(lastSent(kit).wordsNote).toBe('지움: 재다')
  // the script's refusal goes back as the card's line
  kit.procEnd.exitCode = 2
  kit.procEnd.stderr = 'WORDS_ERROR: 이미 바꿀 말로 쓰는 낱말\n'
  await actFrom($, { do: 'wordsSave', avoid: '실행하다', use: '돌리다', forms: '', was: null })
  expect(lastSent(kit).wordsNote).toBe('사전을 바꾸지 못함 — 이미 바꿀 말로 쓰는 낱말')
})

test('mirror-act T6 다른 세션을 거울로 보는 세션은 받은 ACT 를 하지 않는다 — 그 칸의 값은 제 것이 아니다', async ($, on) => {
  const env = await startPresser($, on)
  // a third session says hello to this viewer, then presses
  await $.session.receive(hello('session_third'))
  const before = env.runs.filter(one => one.argv[0] !== 'sh').length
  const got = await actFrom($, { do: 'askMode', to: 'ends' }, 'session_third')

  expect(got.consumed).toBe('scv mirror act')
  expect(env.runs.filter(one => one.argv[0] !== 'sh')).toHaveLength(before)
  expect(env.store.get('scv-dashboard:light')).toBeUndefined()
})

test('mirror-act T7 거울을 끄면 이 세션의 칸은 제 값으로 돌아온다 — 받아 둔 비우기 기준 · 기어 상태를 쓰지 않는다', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, tokens: 80000, percent: 40 }, rateLimits: [] } }) as never)
  const env = await startPresser($, on, { light: { isOn: false, percent: 80 }, paneNote: '작업 세션의 한 줄', gearRuns: { tidy: { startedAt: 1, endedAt: 2, tail: '남의 결과', exitCode: 0, isStopped: false } }, gearOpen: 'tidy' })
  expect(await drawnText($)).toContain('대화가 길어져도 그대로 둠')
  expect(await drawnText($)).toContain('남의 결과')
  env.store.set('scv-dashboard:light', { isOn: true, percent: 60 })
  withProject(env, { index: DIRECT })
  await $.command.run({ command: 'scv-mirror', args: 'stop' } as never)
  const drawn = await drawnText($)

  expect(drawn).toContain('컨텍스트가 60% 를 넘으면 자동으로 비우기')
  expect(drawn).not.toContain('작업 세션의 한 줄')
  expect(drawn).not.toContain('남의 결과')
  expect(drawn).not.toContain('여기서 누르면')
})

// ── after pane 0.5.0: a long conversation is cleared, not summarized ──────────────
import { jobLines, jobsBrief, lightWay, parseClearKept, wasCleared } from './model'

const CLEAR_KEY = 'scv-dashboard:clear:/work'
// The engine around a clear. How full the conversation is: `percent`, 3% once it was cleared, 8% once a compaction
// stood. The clear command, by `clear`: 'runs' — the session ends as a clear and starts anew 1.2 s later, as the
// engine does it (what the session-start hooks hand the model is kept in firstText); 'refused' — the command is
// rejected; 'idle' — the command returns and nothing was cleared. The compact command runs a compaction of the
// main conversation, the person's kind (what the conversation reads as afterwards is kept in replaced).
// hasTurns: the kit under it already answers the turn's start and end.
const clearEngine = ($: Engine, on: On, kit: ReturnType<typeof engine>, opts: { percent?: number; clear?: 'runs' | 'refused' | 'idle'; hasTurns?: boolean } = {}) => {
  const seen = { commands: [] as string[], cleared: 0, compacted: 0, firstText: [] as string[], replaced: [] as { role: string; text: string }[] }
  on('session.cwd', () => ({ value: '/work' }))
  on('store.delete', (_, e) => {
    kit.store.delete(e.key)

    return { value: undefined }
  })
  on('session.usage', () => ({ value: { rateLimits: [], context: { percent: seen.cleared > 0 ? 3 : seen.compacted > 0 ? 8 : (opts.percent ?? 62) } } }) as never)
  if (!opts.hasTurns) turnEngine(on)
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('command.run', async (_, e) => {
    seen.commands.push(e.command)
    if (e.command === 'clear' && opts.clear === 'refused') throw new Error('the command is refused')
    if (e.command === 'clear' && opts.clear !== 'idle') {
      kit.clock.at += 1_200
      await $.session.end({ reason: 'clear', sessionId: 'local-id', resume: { id: 'local-id' } } as never)
      seen.cleared += 1
      const started = await $.classic.SessionStart({ source: 'clear' } as never)
      seen.firstText.push(...(started.additionalContext ?? []))
    }
    if (e.command === 'compact') {
      const done = (await ($.session as unknown as { compact: (e: unknown) => Promise<unknown> }).compact({ trigger: 'manual', instructions: e.args, messages: SAID })) as { messages?: { role: string; text: string }[] }
      seen.replaced = done.messages ?? []
      seen.compacted += 1
    }

    return { text: '' }
  })

  return seen
}
const withRecord = (kit: ReturnType<typeof engine>) => {
  kit.extraFiles['scv/conversations'] = [{ name: 'new.md', mtimeMs: 9 }]
  kit.extra['scv/conversations/new.md'] = RECORD
}

test('clear T1 순수부 — 어느 길로 갈지 · 비워졌는지 · 맡겨 둔 값 · 남은 일의 줄 · 결과 한 줄', async () => {
  expect(lightWay(true, true)).toBe('clear')
  expect(lightWay(true, false)).toBe('summary')
  expect(lightWay(false, true)).toBe('none')
  expect(wasCleared({ isEndSeen: true, idBefore: 'a', idAfter: 'a' })).toBe(true)
  expect(wasCleared({ isEndSeen: false, idBefore: 'a', idAfter: 'b' })).toBe(true)
  expect(wasCleared({ isEndSeen: false, idBefore: 'a', idAfter: 'a' })).toBe(false)
  expect(wasCleared({ isEndSeen: false, idBefore: null, idAfter: 'b' })).toBe(false)

  const board: JobBoard = { jobs: [job({ id: 'bg1', title: '측정 128판', output: '/tmp/tasks/bg1.output' }), job({ id: 'w1', title: 'PR 확인 지켜보기', kind: 'watch' }), job({ id: 'tab:c1', title: '서버 띄우기', kind: 'terminal' })], extra: 2 }
  expect(jobLines(board)).toEqual(['- 명령: 측정 128판 — 출력 파일 /tmp/tasks/bg1.output', '- 감시: PR 확인 지켜보기', '- 터미널 탭의 명령: 서버 띄우기', '- 그 밖에 2개 — 이름을 적어 두지 못함'])
  expect(jobLines(NO_JOBS)).toEqual([])
  expect(jobsBrief(NO_JOBS)).toBeNull()
  expect(jobsBrief(board)?.split('\n')).toHaveLength(5)
  expect(jobsBrief(board)?.startsWith('[SCV 뒤에서 도는 일]')).toBe(true)

  expect(parseClearKept({ before: 62, at: 1_000, board }, 2_000)).toEqual({ before: 62, at: 1_000, board })
  expect(parseClearKept({ before: 62, at: 1_000, board }, 1_000 + 3 * 60_000)).toBeNull()
  expect(parseClearKept(undefined, 2_000)).toBeNull()
  expect(parseClearKept({ before: '62', at: 1_000, board: { jobs: [{ id: 1 }, board.jobs[1]], extra: 'x' } }, 2_000)).toEqual({ before: null, at: 1_000, board: { jobs: [board.jobs[1]], extra: 0 } })

  expect(lightNote({ kind: 'cleared', before: 62, after: 3, ms: 1200 })).toBe('비움 62% → 3% · 1초')
  expect(lightNote({ kind: 'cleared', before: 62, after: null, ms: 400 })).toBe('비움 62% · 1초')
  expect(lightNote({ kind: 'records', before: 62, after: 8, ms: 1200, isClearFailed: true })).toBe('비우지 못해 기록으로 바꿔 끼워 가볍게 함 62% → 8% · 1초')
  expect(lightNote({ kind: 'summary', before: 62, after: 8, ms: 70_000, isClearFailed: true })).toBe('비우지 못해 요약해서 가볍게 함 62% → 8% · 70초')
  expect(lightNote({ kind: 'skipped', before: 62, after: null, ms: 1, isClearFailed: true })).toBe('비우지 못했고 기록으로 바꿔 끼우지도 못함 — 다음 턴 끝에 다시 봄')
  expect(actLabel({ do: 'lightSwitch', isOn: false })).toBe('자동 비우기 → 끔')
  expect(actLabel({ do: 'lightMark', percent: 65 })).toBe('비우기 기준 → 65%')
})

test('clear T6 (가) 턴 끝에 기준을 넘으면 비우기 명령이 한 번 돌고 요약 명령은 돌지 않는다 — 창은 비웠다고 적는다', async ($, on) => {
  const kit = engine(on, { a: plan({ title: '계획 하나', status: 'in_progress', steps: FIVE }) })
  withProject(kit)
  withRecord(kit)
  const seen = clearEngine($, on, kit)
  await start($)
  await endTurn($)
  await settle()

  expect(seen.commands).toEqual(['clear'])
  expect(kit.compactions).toHaveLength(0)
  const drawn = await drawnText($)
  expect(drawn).toContain('비움 62% → 3% · 1초')
  expect(drawn).not.toContain('비우지 못')
  expect(kit.store.has(CLEAR_KEY)).toBe(false)
  // within five minutes of it nothing is tried again, whatever the figure
  await endTurn($)
  await settle()
  expect(seen.commands).toEqual(['clear'])
})

test('clear T6 (나) 비우기 명령이 거절되면 요약 명령이 한 번 돌아 대화가 기록으로 바뀐다 — 창은 넘어갔다고 적는다', async ($, on) => {
  const kit = engine(on, { a: plan({ title: '계획 하나', status: 'in_progress', steps: FIVE }) })
  withProject(kit)
  withRecord(kit)
  const seen = clearEngine($, on, kit, { clear: 'refused' })
  await start($)
  await endTurn($)
  await settle()

  expect(seen.commands).toEqual(['clear', 'compact'])
  expect(seen.cleared).toBe(0)
  // the mod answered the compaction from SCV's record: the engine's own summary never ran
  expect(kit.compactions).toHaveLength(0)
  expect(seen.replaced[0]?.text).toContain('[SCV 이어 하기]')
  expect(seen.replaced[0]?.text).toContain('## Turn 2')
  const drawn = await drawnText($)
  expect(drawn).toContain('비우지 못해 기록으로 바꿔 끼워 가볍게 함 62% → 8% · 1초')
  expect(drawn).not.toContain('비움 ')
  expect(kit.store.has(CLEAR_KEY)).toBe(false)
  expect(seen.firstText).toEqual([])
})

test('clear T6 (다) 비우기 명령이 돌았다고만 하고 비워지지 않았으면 비웠다고 적지 않는다 — 기록으로 넘어간다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  withRecord(kit)
  const seen = clearEngine($, on, kit, { clear: 'idle' })
  await start($)
  await endTurn($)
  await settle()

  expect(seen.commands).toEqual(['clear', 'compact'])
  const drawn = await drawnText($)
  expect(drawn).toContain('비우지 못해 기록으로 바꿔 끼워 가볍게 함 62% → 8%')
  expect(drawn).not.toContain('비움 ')
})

test('clear T7 턴이 도는 중 · 기준 아래 · 꺼짐이면 아무것도 돌지 않고, 기록이 없으면 비우지 않고 엔진 요약으로 간다', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  withRecord(kit)
  const opts: { percent?: number } = { percent: 40 }
  const seen = clearEngine($, on, kit, opts)
  await start($)
  // under the mark
  await endTurn($)
  await settle()
  expect(seen.commands).toEqual([])
  // over the mark, a turn of the main conversation running: a subagent's turn ending is not the turn's end
  opts.percent = 62
  await $.turn.start({ text: '일해 줘', turnId: 't1' } as never)
  await turnEnd($, 'answer', 1, 'agent-1')
  await settle()
  expect(seen.commands).toEqual([])
  expect(lightDue(DEFAULT_LIGHT, 62, true, 0, 1)).toBe(false)
  // switched off
  kit.store.set('scv-dashboard:light', { isOn: false, percent: 50 })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'light-toggle' })
  await ui.press({ key: 'light-toggle' })
  await ui.press({ key: 'light-toggle' })
  expect(kit.store.get('scv-dashboard:light')).toEqual({ isOn: false, percent: 50 })
  await endTurn($)
  await settle()
  expect(seen.commands).toEqual([])
  // on again, and no conversation record in the project: no clear — the engine's summary, as before
  await ui.press({ key: 'light-toggle' })
  kit.extraFiles['scv/conversations'] = []
  await endTurn($)
  await settle()
  expect(seen.commands).toEqual(['compact'])
  expect(kit.compactions).toHaveLength(1)
  expect(await drawnText($)).toContain('요약해서 가볍게 함 62% → 8%')
  expect(await drawnText($)).not.toContain('비우지 못')
  await ui.unmount()
})

test('clear T8 비운 뒤 첫 글에 뒤에서 도는 일이 한 줄씩 실린다 — 남은 일이 없으면 그 묶음이 없고, 기록은 싣지 않는다', async ($, on) => {
  const kit = nowEngine(on)
  withProject(kit)
  withRecord(kit)
  const seen = clearEngine($, on, kit, { hasTurns: true })
  await start($)
  await spoken($, '측정 돌리고 PR 도 지켜봐 줘')
  await $.tool.call({ tool: 'Bash', command: 'npm run measure', description: '측정 128판', run_in_background: true } as never)
  await $.tool.call({ tool: 'Monitor', command: 'gh pr checks 591 --watch', description: 'PR 591 확인 지켜보기' } as never)
  await endTurn($)
  await settle()

  expect(seen.commands).toEqual(['clear'])
  expect(seen.firstText).toHaveLength(1)
  const lines = (seen.firstText[0] ?? '').split('\n')
  expect(lines[0]?.startsWith('[SCV 뒤에서 도는 일]')).toBe(true)
  expect(lines.slice(1)).toEqual(['- 명령: 측정 128판 — 출력 파일 /tmp/tasks/bg1.output', '- 감시: PR 591 확인 지켜보기'])
  // SCV's own session-start hook carries the record's end: the mod carries none of it
  expect(seen.firstText[0]).not.toContain('## Turn')
  expect(seen.firstText[0]).not.toContain('둘째 요청')
  expect(await drawnText($)).toContain('비움 62% → 3% · 1초')
  // a clear the person types afterwards, a compaction, a resume: nothing of the mod's is added
  expect((await $.classic.SessionStart({ source: 'clear' } as never)).additionalContext ?? []).toEqual([])
  expect((await $.classic.SessionStart({ source: 'compact' } as never)).additionalContext ?? []).toEqual([])
  expect((await $.classic.SessionStart({ source: 'resume' } as never)).additionalContext ?? []).toEqual([])
})

test('clear T8 남은 일 없이 비우면 첫 글에 아무것도 싣지 않는다', async ($, on) => {
  const kit = nowEngine(on)
  withProject(kit)
  withRecord(kit)
  const seen = clearEngine($, on, kit, { hasTurns: true })
  await start($)
  await spoken($, '고쳐 줘')
  await endTurn($)
  await settle()

  expect(seen.commands).toEqual(['clear'])
  expect(seen.cleared).toBe(1)
  expect(seen.firstText).toEqual([])
  expect(await drawnText($)).toContain('비움 62% → 3% · 1초')
})

test('clear T9 창의 글자가 비우기로 보인다 — 스위치 줄 · 기준 표시 · 한 뒤의 결과 한 줄', async ($, on) => {
  const kit = engine(on, {})
  withProject(kit)
  withRecord(kit)
  clearEngine($, on, kit)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const line = await text(ui, /^컨텍스트가 /)
  expect(line).toBe('컨텍스트가 50% 를 넘으면 자동으로 비우기 — 기록으로 이어 감')
  expect(line).not.toContain('요약')
  expect(await text(ui, /기준 \d+%$/)).toBe('비우기 기준 50%')
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('비우기 기준 50% · 지금 62%')
  expect(await drawnText($)).not.toContain('요약')
  await endTurn($)
  await settle()
  expect(await text(ui, /^비움 /)).toBe('비움 62% → 3% · 1초')
  await ui.unmount()
})

test('clear T6 (라) 창에서 돌리던 기어는 이 모드가 돌린 비우기에 멈추지 않는다 — 사람이 친 비우기에는 전처럼 멈춘다', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  const kit = directKit(on, true)
  withRecord(kit)
  const seen = clearEngine($, on, kit)
  let open = () => {}
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'gear-open-tidy' })
  kit.spawnPlans.push({ gate: new Promise<void>(done => (open = done)), after: ['치운 파일 3개\n'], code: 0 })
  await ui.press({ key: 'gear-run-tidy' })
  await endTurn($)
  await settle()

  expect(seen.commands).toEqual(['clear'])
  expect(kit.spawnEnds.count).toBe(0)
  expect(await has(ui, 'gear-stop-tidy')).toBe(true)
  await $.session.end({ reason: 'clear', sessionId: 'local-id', resume: { id: 'local-id' } } as never)
  await settle()
  expect(kit.spawnEnds.count).toBe(0)
  expect(await has(ui, 'gear-stop-tidy')).toBe(false)
  open()
  await settle()
  expect(kit.spawnEnds.count).toBe(1)
  expect(await drawnText($)).not.toContain('치운 파일 3개')
  await ui.unmount()
})

// ── the list kept before a clear: the subagents are on it, the work known to have ended is not ──────────────
import { agentJobs, flightOf, hasEnded, stillRunning, tabsOf } from './model'

const TABS_TOOL = 'mcp__terminal__list_terminal_tabs'
// A row of the terminal's tab list, as the desktop app answers it.
const tabRow = (id: string, isRunning: boolean | null) => ({ tab_id: id, title: `탭 ${id}`, cwd: '/work', opened_by: 'claude', is_running_command: isRunning })
const SUB = '코어 합치기와 클로드 래퍼 맞춤'
const inFlight = (id: string, type: string, description: string) => ({ id, type, status: 'running', description })
const stop = ($: Engine, tasks?: unknown[]) => $.classic.Stop({ stop_hook_active: false, ...(tasks ? { background_tasks: tasks } : {}) } as never)
const spawnBehind = ($: Engine, description: string) =>
  $.agent.spawn({ tool_use_id: `u-${description}`, prompt: 'do', description, subagentType: 'general-purpose', parentModel: 'm', background: true, fork: false } as never)

// A turn engine whose tool calls answer like the real ones: a command sent to the background (bg1, bg2 …), a
// terminal tab per command (c1, c2 …), and the terminal's own tab list (asked: how many times; isDown: no such tool).
// The session would ask the person before the tab list is read: only a call that is let through reaches it.
const flightKit = (on: On) => {
  const kit = engine(on, { a: plan({ title: 'p', status: 'in_progress', steps: ['[x] a', 'b', 'c'] }) })
  turnEngine(on)
  agentEngine(on)
  on('fs.stat', (_, e) => ({ deny: `ENOENT ${e.path}` }))
  on('classic.Stop', () => ({}) as never)
  on('tool.check', (_, e) => ({ decision: e.tool === TABS_TOOL ? ('ask' as const) : ('allow' as const) }))
  const tabs: ReturnType<typeof tabRow>[] = []
  const list = { asked: 0, isDown: false }
  let serial = 0
  on('tool.call', (_, e) => {
    const input = e as unknown as Record<string, unknown>
    if (e.tool === 'Bash' && input.run_in_background === true) {
      serial += 1

      return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `bg${serial}` }, text: BG_TEXT(`bg${serial}`, `/tmp/tasks/bg${serial}.output`) } as never
    }
    if (e.tool.endsWith('run_in_terminal')) {
      tabs.push(tabRow(`c${tabs.length + 1}`, true))

      return { result: {}, text: JSON.stringify({ tab_id: `c${tabs.length}`, cwd: '/work' }) } as never
    }
    if (e.tool.endsWith('list_terminal_tabs')) {
      list.asked += 1
      if (list.isDown) throw new Error('no such tool')

      return { result: {}, text: JSON.stringify(tabs, null, 2) } as never
    }

    return { result: {} }
  })

  return { ...kit, tabs, list }
}

test('clear T10 순수부 — 하위 작업이 한 줄로 실리고, 끝난 것을 아는 일(끝난 탭 명령 · 끝난 명령)만 빠지고, 모르는 일은 남는다', () => {
  const at = 1_000_000
  // what the real app held on 2026-11-25: three tab commands and a command that had ended, a subagent that ran
  const board: JobBoard = {
    jobs: [
      job({ id: 'tab:c66', title: '맥 · 리눅스 검사', kind: 'terminal' }),
      job({ id: 'tab:c67', title: '실제 세션 두 번', kind: 'terminal' }),
      job({ id: 'tab:c68', title: '기어 검사', kind: 'terminal' }),
      job({ id: 'bg7', title: '전체 시험', output: '/tmp/tasks/bg7.output' }),
    ],
    extra: 0,
  }
  const team = [{ id: 'ag-1', name: SUB, tool: 'Bash', target: 'git merge', at: at + 50_000 }]
  expect(agentJobs(team)).toEqual([{ id: 'ag-1', title: SUB, kind: 'agent', startedAt: at + 50_000, changedAt: at + 50_000 }])
  expect(agentJobs([])).toEqual([])
  const tabs = tabsOf({ text: JSON.stringify([tabRow('c66', false), tabRow('c67', false), tabRow('c68', false)], null, 2) })
  expect(tabs).toEqual([{ id: 'c66', isRunning: false }, { id: 'c67', isRunning: false }, { id: 'c68', isRunning: false }])
  // the engine's list at two stops: the command in flight, then the subagent alone
  const first = flightOf(null, [inFlight('bg7', 'shell', '전체 시험')], at + 10_000)
  const flight = flightOf(first, [inFlight('ag-1', 'subagent', SUB)], at + 60_000)
  expect(flight).toEqual({ ever: ['bg7', 'ag-1'], now: ['ag-1'], at: at + 60_000 })
  const all: JobBoard = { jobs: [...board.jobs, ...agentJobs(team)], extra: 0 }
  expect(jobLines(stillRunning(all, { flight, tabs }))).toEqual([`- 하위 작업: ${SUB} — 알림의 task-id ag-1`])
  expect(jobsBrief(stillRunning(all, { flight, tabs }))?.split('\n')).toHaveLength(2)
  expect(jobsBrief(stillRunning(board, { flight, tabs }))).toBeNull()
  expect(stillRunning({ jobs: board.jobs, extra: 2 }, { flight, tabs }).extra).toBe(2)

  // nothing known: nothing is taken off
  expect(stillRunning(all, { flight: null, tabs: [] })).toEqual(all)
  const facts = { flight, tabs: [...tabs, { id: 'c70', isRunning: true }, { id: 'c71', isRunning: null }] }
  // a tab's command: only a listed tab with no command running is an end
  expect(hasEnded(job({ id: 'tab:c66', title: 't', kind: 'terminal' }), facts)).toBe(true)
  expect(hasEnded(job({ id: 'tab:c70', title: 't', kind: 'terminal' }), facts)).toBe(false)
  expect(hasEnded(job({ id: 'tab:c71', title: 't', kind: 'terminal' }), facts)).toBe(false)
  expect(hasEnded(job({ id: 'tab:c99', title: 't', kind: 'terminal' }), facts)).toBe(false)
  expect(hasEnded(job({ id: 'tab:1000000', title: 't', kind: 'terminal' }), facts)).toBe(false)
  // any other job: named in flight at an earlier stop, not at the last one, and not moved since
  expect(hasEnded(job({ id: 'bg7', title: 'c' }), facts)).toBe(true)
  expect(hasEnded(job({ id: 'bg7', title: 'c', changedAt: at + 60_001 }), facts)).toBe(false)
  expect(hasEnded(job({ id: 'bash-1000000', title: 'c' }), facts)).toBe(false)
  expect(hasEnded(job({ id: 'w1', title: 'w', kind: 'watch' }), facts)).toBe(false)
  expect(hasEnded(job({ id: 'ag-1', title: SUB, kind: 'agent', changedAt: at + 50_000 }), facts)).toBe(false)
  // a subagent whose end was not heard: named before, gone from the next stop's list
  const later = flightOf(flight, [], at + 90_000)
  expect(later).toEqual({ ever: ['bg7', 'ag-1'], now: [], at: at + 90_000 })
  expect(jobLines(stillRunning(all, { flight: later, tabs }))).toEqual([])

  // a stop that gives no list says nothing; rows without an id are not read
  expect(flightOf(flight, undefined, at + 99_000)).toBe(flight)
  expect(flightOf(null, undefined, at)).toBeNull()
  expect(flightOf(null, [{ id: 7 }, null, inFlight('a', 'shell', ''), inFlight('a', 'shell', '')], at)).toEqual({ ever: ['a'], now: ['a'], at })
  // the tab list in the shapes a tool answer comes in; anything else is no tab
  expect(tabsOf({ result: [tabRow('c1', true)] })).toEqual([{ id: 'c1', isRunning: true }])
  expect(tabsOf({ result: [{ type: 'text', text: JSON.stringify([tabRow('c2', null)]) }] })).toEqual([{ id: 'c2', isRunning: null }])
  expect(tabsOf({ result: {}, text: 'no tabs' })).toEqual([])
  expect(tabsOf({})).toEqual([])

  // the kept values hold a subagent's line across the clear
  const kept = { before: 62, at: 1_000, board: stillRunning(all, { flight, tabs }) }
  expect(parseClearKept(kept, 2_000)).toEqual(kept)
})

test('clear T11 비우기 전에 끝난 일은 첫 글에서 빠지고 도는 하위 작업은 실린다 — 끝난 탭 명령 셋 · 끝난 명령 하나 · 도는 하위 작업 하나', async ($, on) => {
  const kit = flightKit(on)
  withProject(kit)
  withRecord(kit)
  const opts = { percent: 40, hasTurns: true }
  const seen = clearEngine($, on, kit, opts)
  await start($)
  // morning: three commands in terminal tabs and one in the background; the turn stops with them running
  await spoken($, '검사 셋과 전체 시험을 돌려 줘')
  await signal($, 2, 'doing')
  await $.tool.call({ tool: 'mcp__terminal__run_in_terminal', command: 'bash a.sh', title: '맥 · 리눅스 검사' } as never)
  await $.tool.call({ tool: 'mcp__terminal__run_in_terminal', command: 'bash b.sh', title: '실제 세션 두 번' } as never)
  await $.tool.call({ tool: 'mcp__terminal__run_in_terminal', command: 'bash c.sh', title: '기어 검사' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: '전체 시험', run_in_background: true } as never)
  await stop($, [inFlight('bg1', 'shell', '전체 시험')])
  await endTurn($)
  await settle()
  expect(seen.commands).toEqual([])
  // the tabs were read as the turn ended (the mod's own call, let through without asking the person)
  expect(kit.list.asked).toBe(1)
  // they all end and no end is heard: the tabs stay open with no command in them, no notice reaches the mod
  for (const tab of kit.tabs) tab.is_running_command = false
  kit.clock.at += 8 * 3_600_000
  // evening: a subagent is sent to the background, and the turn stops over the mark with it alone in flight
  await spoken($, '코어를 합치고 래퍼를 맞춰 줘')
  await spawnBehind($, SUB)
  await stop($, [inFlight(`ag-${SUB}`, 'subagent', SUB)])
  opts.percent = 62
  await endTurn($)
  await settle()

  expect(seen.commands).toEqual(['clear'])
  expect(seen.firstText).toHaveLength(1)
  const lines = (seen.firstText[0] ?? '').split('\n')
  expect(lines[0]?.startsWith('[SCV 뒤에서 도는 일]')).toBe(true)
  expect(lines.slice(1)).toEqual([`- 하위 작업: ${SUB} — 알림의 task-id ag-${SUB}`])
  expect(kit.list.asked).toBe(2)
  // the pane's own list is as it was (only what the new conversation is told changed), and the mod's own looks
  // at the tabs are not the step's work: the turn's own calls are (the tab commands in a row count once, then Bash)
  const drawn = await drawnText($)
  expect(drawn).toContain('뒤에서 도는 일 4')
  expect(drawn).toContain('▸ 도구 호출 2건')
  // the model's own call of the tab list is judged as ever
  expect((await $.tool.check({ tool: TABS_TOOL, input: {} } as never)).decision).toBe('ask')
})

test('clear T12 끝났는지 모르는 일은 첫 글에 남는다 — 탭 목록을 못 받은 탭 명령 · 엔진이 이름을 부른 적 없는 명령', async ($, on) => {
  const kit = flightKit(on)
  withProject(kit)
  withRecord(kit)
  const seen = clearEngine($, on, kit, { hasTurns: true })
  kit.list.isDown = true
  await start($)
  await spoken($, '검사와 전체 시험을 돌려 줘')
  await $.tool.call({ tool: 'mcp__terminal__run_in_terminal', command: 'bash a.sh', title: '맥 · 리눅스 검사' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: '전체 시험', run_in_background: true } as never)
  // the stop gives no list of work in flight
  await stop($)
  await endTurn($)
  await settle()

  expect(seen.commands).toEqual(['clear'])
  expect(kit.list.asked).toBe(1)
  expect((seen.firstText[0] ?? '').split('\n').slice(1)).toEqual(['- 터미널 탭의 명령: 맥 · 리눅스 검사', '- 명령: 전체 시험 — 출력 파일 /tmp/tasks/bg1.output'])
})

test('clear T13 끝이 들린 하위 작업은 싣지 않고, 탭 명령이 없으면 탭 목록을 묻지 않는다', async ($, on) => {
  const kit = flightKit(on)
  withProject(kit)
  withRecord(kit)
  const seen = clearEngine($, on, kit, { hasTurns: true })
  await start($)
  await spoken($, '둘로 나눠서 해 줘')
  await spawnBehind($, '문서 고치기')
  await spawnBehind($, SUB)
  // the first one's run ends before the turn does
  await turnEnd($, 'answer', 1, 'ag-문서 고치기')
  await endTurn($)
  await settle()

  expect(seen.commands).toEqual(['clear'])
  expect(kit.list.asked).toBe(0)
  expect((seen.firstText[0] ?? '').split('\n').slice(1)).toEqual([`- 하위 작업: ${SUB} — 알림의 task-id ag-${SUB}`])
})

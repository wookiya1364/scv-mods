import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { AgentState, Expanded, Live, Mirror, Permit, Plan, PlanFile, Since, Snapshot, StageState, StepSignal, Stopped, TestRun, UsageLimit, Viewers, WorkEntry } from '../types'
import type { MirrorAct } from './model'
import {
  STEP_TOOL,
  isMirrorDue,
  isOwnAddress,
  isViewerOf,
  hostLabel,
  mirrorAddress,
  sessionName,
  mirrorText,
  parseMirror,
  agentLines,
  ancestorsOf,
  applyAgentEvent,
  applyBlocks,
  applySignal,
  applyTaskEvent,
  barColor,
  buildAlertText,
  buildStepPrompt,
  checkSignal,
  classifyTurnEnd,
  countStages,
  describeRole,
  nodeIconSvg,
  deriveStages,
  describeTool,
  estimateEta,
  eventsSince,
  findBlocks,
  formatDuration,
  headline,
  isMainLoop,
  isTestCommand,
  logWork,
  mergeMarks,
  mergeTests,
  nextAction,
  parseDreams,
  parsePlans,
  parseTestOutput,
  permissionWaitOf,
  pickPlan,
  planPromptFill,
  recordStepTimes,
  runFor,
  stageRole,
  statusWords,
  suggestNext,
  summarizeAway,
  usageAlerts,
  usageLine,
  estimateFromDurations,
  stepDurationsFromSignals,
} from './model'

const PANE = 'scv-dashboard'
const TITLE = 'SCV'
const REFRESH_MS = 3000
// A working session sends a changed state no sooner than this after its last send; an unchanged one is not sent.
// Each send is a row in the viewer's app (the app draws one per delivery from another computer, consumed or not).
const MIRROR_GAP_MS = 10_000
// A viewer that heard nothing for this long asks again, in case the working session lost it.
const MIRROR_ASK_MS = 10 * 60_000
const MIRROR_MISSES = 3

const snapshot = atom({ plugin: 'scv-dashboard', key: 'snapshot' } as const, { plans: [], dreamsText: null, cwd: '', root: '' } as Snapshot)
const chosen = atom({ plugin: 'scv-dashboard', key: 'chosen' } as const, null as string | null)
// The plan the working session has in view, for a viewer that has not picked one itself.
const hostInView = atom({ plugin: 'scv-dashboard', key: 'host-in-view' } as const, null as string | null)

const chosenSlug = async ($: Api) => (await read($, chosen)) ?? (await read($, hostInView))
const expanded = atom({ plugin: 'scv-dashboard', key: 'expanded' } as const, { steps: false, tests: false, blocks: true, dreams: false } as Expanded)
const runs = atom({ plugin: 'scv-dashboard', key: 'runs' } as const, [])
const waiting = atom({ plugin: 'scv-dashboard', key: 'waiting' } as const, null as string | null)
const live = atom({ plugin: 'scv-dashboard', key: 'live' } as const, { isWorking: false, turnStartedAt: 0, tool: null } as Live)
const tasks = atom({ plugin: 'scv-dashboard', key: 'tasks' } as const, [])
const history = atom({ plugin: 'scv-dashboard', key: 'history' } as const, [])
const now = atom({ plugin: 'scv-dashboard', key: 'now' } as const, 0)
const note = atom({ plugin: 'scv-dashboard', key: 'note' } as const, null as string | null)
const focusStep = atom({ plugin: 'scv-dashboard', key: 'focusStep' } as const, null as number | null)
const stepLog = atom({ plugin: 'scv-dashboard', key: 'stepLog' } as const, {} as Record<string, WorkEntry[]>)
const signals = atom({ plugin: 'scv-dashboard', key: 'signals' } as const, [] as StepSignal[])
const permit = atom({ plugin: 'scv-dashboard', key: 'permit' } as const, null as Permit | null)
const stopped = atom({ plugin: 'scv-dashboard', key: 'stopped' } as const, null as Stopped | null)
const agents = atom({ plugin: 'scv-dashboard', key: 'agents' } as const, [] as AgentState[])
const since = atom({ plugin: 'scv-dashboard', key: 'since' } as const, null as Since | null)
const limits = atom({ plugin: 'scv-dashboard', key: 'limits' } as const, [] as UsageLimit[])
const mirror = atom({ plugin: 'scv-dashboard', key: 'mirror' } as const, null as Mirror | null)
const viewers = atom({ plugin: 'scv-dashboard', key: 'viewers' } as const, {} as Viewers)

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

// The project the pane follows: the nearest folder at or above the working folder that holds an scv folder,
// as SCV itself finds it — so a session that moved into a subfolder still sees its plans. Else the folder itself.
const projectOf = async ($: Api, cwd: string) => {
  if (!cwd.startsWith('/')) return cwd
  for (const dir of ancestorsOf(cwd)) {
    const entries = await $.fs.list(dir).catch(() => [])
    if (entries.some(entry => entry.name === 'scv' && entry.kind === 'dir')) return dir
  }

  return cwd
}

// The entry of the pipeline: the session's SCV files, read and never written.
// With no plan in progress, the plans already archived stand in, newest first.
const readSources = async ($: Api, cwd: string): Promise<Omit<Snapshot, 'root'>> => {
  const scv = cwd ? `${cwd}/scv` : 'scv'
  const active = await readPlans($, `${scv}/promote`, false)
  const plans = active.length > 0 ? active : (await readPlans($, `${scv}/archive`, true)).sort((a, b) => b.slug.localeCompare(a.slug))

  const dreamsText = await readText($, `${scv}/dreams/latest.json`)
  const report = parseDreams(dreamsText)?.reportPath
  const reportHtml = report ? await readText($, report.startsWith('/') ? report : `${cwd ? `${cwd}/` : ''}${report}`) : null

  return { plans, dreamsText, reportHtml, cwd }
}

// Test runs and step signals are kept in the mod's own store, per project folder, so a new session
// (or another session on this computer) still shows them.
const runsKey = (cwd: string) => `runs:${cwd}`
const signalsKey = (cwd: string) => `signals:${cwd}`

const loadSignals = async ($: Api, cwd: string) => {
  const kept = await $.store.get(signalsKey(cwd)).catch(() => undefined)
  if (Array.isArray(kept)) await update($, signals, () => kept as StepSignal[])
}

// The plan on screen (or the one named) with Claude's step signals merged into its marks.
const planInView = async ($: Api, slug?: string): Promise<Plan | undefined> => {
  const plan = pickPlan(parsePlans((await read($, snapshot)).plans), slug ?? (await chosenSlug($)))

  return plan && mergeMarks(plan, await read($, signals))
}

// The session's root does not move with a shell `cd`, only with /cd or the host; the project is looked up again then.
const sessionRoot = async ($: Api, fallback: string) => (await $.session.root().catch(() => '')) || fallback

const loadRuns = async ($: Api, project: string) => {
  const kept = await $.store.get(runsKey(project)).catch(() => undefined)
  await update($, runs, () => (Array.isArray(kept) ? (kept as TestRun[]) : []))
}

const refresh = async ($: Api) => {
  const at = await $.clock.now()
  // A viewer session draws the working session's state, so its own files are not read; only its clock moves.
  const mirrored = await read($, mirror)
  if (mirrored) {
    await update($, now, () => at)
    if (at - Math.max(mirrored.at, mirrored.askedAt) > MIRROR_ASK_MS) await askMirror($, mirrored.host)

    return
  }
  const current = await read($, snapshot)
  const root = await sessionRoot($, current.root)
  const project = root === current.root && current.cwd ? current.cwd : await projectOf($, root)
  if (current.cwd && project !== current.cwd) await loadRuns($, project)
  const next = { ...(await readSources($, project)), root }
  await update($, snapshot, () => next)
  await update($, now, () => at)
  await loadSignals($, next.cwd)
  await checkUsage($, at)
  const plan = await planInView($)
  if (plan) {
    const done = countStages(deriveStages(plan).stages).done
    await update($, history, list => recordStepTimes(list, plan.slug, done, at))
  }
}

// Notes the next-action buttons leave (copied, put in the prompt box) show under them; others are errors.
const isActionNote = (message: string) => message.startsWith('복사') || message.startsWith('입력창')

// The person's minutes ahead of UTC, so a reset time reads in their own clock.
const offsetAt = (at: number) => -new Date(at).getTimezoneOffset()

// The usage windows, read each refresh (free without a breakdown); a window past 90% is announced once.
const checkUsage = async ($: Api, at: number) => {
  const usage = await $.session.usage().catch(() => undefined)
  const windows: UsageLimit[] = (usage?.rateLimits ?? []).map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, ...(limit.resetsAt ? { resetsAt: limit.resetsAt } : {}) }))
  await update($, limits, () => windows)
  if (!windows.some(limit => limit.percentUsed >= 90)) return
  const kept = await $.store.get('usageAlerted').catch(() => undefined)
  const due = usageAlerts(windows, Array.isArray(kept) ? (kept as string[]) : [], offsetAt(at))
  if (due.texts.length === 0) return
  await $.store.set('usageAlerted', due.alerted).catch(() => undefined)
  for (const text of due.texts) await alert($, text)
}

// What the person can do next on the plan in view, as the pane says it.
const actionInView = async ($: Api, slug?: string) => {
  const plan = await planInView($, slug)
  if (!plan || (slug && plan.slug !== slug)) return null
  const derived = deriveStages(plan)
  const run = runFor(plan, await read($, runs))
  const blocks = findBlocks(derived.stages, run, await read($, waiting), await read($, permit), await read($, stopped))

  return nextAction(plan.slug, plan.status, applyBlocks(derived.stages, blocks), blocks)
}

// Puts a command in this session's prompt box, keeping what the person typed; whether the box took it.
const fillPrompt = async ($: Api, command: string) => {
  const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const filled = await $.prompt.fill(planPromptFill(command, box.text)).catch(() => ({ isFilled: false }))

  return filled.isFilled
}

// Opens this session's dreams report on this computer; the note says so when it could not.
// A viewer opens the copy the working session sent, on its own device: the file itself lives on the other computer.
const openMirroredReport = async ($: Api, html: string | null | undefined) => {
  if (!html) return void update($, note, () => '작업 세션이 보고서를 아직 보내지 않았습니다')
  const opened = await $.process
    .run(['sh', '-c', 'f="$(mktemp -d)/scv-report.html" && printf %s "$1" > "$f" && { xdg-open "$f" || open "$f"; }', 'sh', html])
    .catch(() => undefined)
  await update($, note, () => (opened?.exitCode === 0 ? null : '보고서를 이 기기에서 열지 못했습니다'))
}

const openReport = async ($: Api) => {
  const shot = await read($, snapshot)
  if (await read($, mirror)) return openMirroredReport($, shot.reportHtml)
  const path = parseDreams(shot.dreamsText)?.reportPath
  if (!path) return
  const full = path.startsWith('/') ? path : `${shot.cwd}/${path}`
  for (const opener of ['xdg-open', 'open']) {
    const opened = await $.process.run([opener, full]).catch(() => undefined)
    if (opened?.exitCode === 0) return void update($, note, () => null)
  }
  await update($, note, () => `보고서를 열지 못했습니다: ${full}`)
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

// One alert per event: the host's notification, else the system's own (the desktop app has no terminal to ring),
// then Claude's own notification tool, which reaches the phone while Remote Control is connected and skips itself
// when the person is at the screen, and a toast. A way that fails leaves the others to go.
const alert = async ($: Api, text: string) => {
  const line = buildAlertText([text])
  const sent = await $.ui.notify(line, { title: 'SCV' }).catch(() => undefined)
  if (!sent?.isSent) {
    for (const argv of [
      ['osascript', '-e', `display notification ${JSON.stringify(line)} with title "SCV"`],
      ['notify-send', 'SCV', line],
    ]) {
      const ran = await $.process.run(argv).catch(() => undefined)
      if (ran?.exitCode === 0) break
    }
  }
  try {
    await $.tool.call({ tool: 'PushNotification', message: buildAlertText([`SCV: ${line}`]), status: 'proactive' })
  } catch {
    // no such tool in this session, or it declined: the computer has been told
  }
  try {
    await $.ui.toast(`SCV: ${line}`)
  } catch {
    // a toast is a courtesy; the alert has been raised
  }
}

// Calls the mod makes itself (its phone notification) are not the work it watches.
const OWN_TOOLS = new Set<string>([STEP_TOOL, 'PushNotification'])

const isOwnCall = (origin: { plugin: string }) => origin.plugin === 'scv-dashboard' || origin.plugin.startsWith('scv-dashboard@')

const openPane = ($: Api) => $.ui.open({ id: PANE, title: TITLE })

// Where other sessions reach this one, read from the session files Claude Code keeps for each running session.
const sessionFiles = async ($: Api) =>
  (
    await $.process
      .run(['sh', '-c', 'for f in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/sessions/*.json; do cat "$f"; echo; done'])
      .catch(() => undefined)
  )?.stdout ?? ''

const ownAddress = async ($: Api) => mirrorAddress(await sessionFiles($), await $.session.id())

// The working session's state a viewer session draws from; the viewer's own choices and clock stay its own.
const mirrorState = async ($: Api) => ({
  snapshot: await read($, snapshot),
  runs: await read($, runs),
  waiting: await read($, waiting),
  live: await read($, live),
  tasks: await read($, tasks),
  history: await read($, history),
  stepLog: await read($, stepLog),
  signals: await read($, signals),
  permit: await read($, permit),
  stopped: await read($, stopped),
  agents: await read($, agents),
  since: await read($, since),
  limits: await read($, limits),
  hostName: sessionName(await sessionFiles($), await $.session.id()),
  inView: (await planInView($))?.slug ?? null,
})

type MirrorState = Awaited<ReturnType<typeof mirrorState>>

// Takes a state another session sent, while this session is mirroring; anything else is dropped.
const takeMirror = async ($: Api, body: string) => {
  const mirrored = await read($, mirror)
  if (!mirrored) return
  let state: MirrorState
  try {
    state = JSON.parse(body) as MirrorState
  } catch {
    return
  }
  if (!Array.isArray(state?.snapshot?.plans)) return
  await update($, snapshot, () => state.snapshot)
  await update($, runs, () => state.runs ?? [])
  await update($, waiting, () => state.waiting ?? null)
  await update($, live, () => state.live ?? { isWorking: false, turnStartedAt: 0, tool: null })
  await update($, tasks, () => state.tasks ?? [])
  await update($, history, () => state.history ?? [])
  await update($, stepLog, () => state.stepLog ?? {})
  await update($, signals, () => state.signals ?? [])
  await update($, permit, () => state.permit ?? null)
  await update($, stopped, () => state.stopped ?? null)
  await update($, agents, () => state.agents ?? [])
  await update($, since, () => state.since ?? null)
  await update($, limits, () => state.limits ?? [])
  await update($, hostInView, () => (typeof state.inView === 'string' ? state.inView : null))
  const at = await $.clock.now()
  const name = typeof state.hostName === 'string' ? state.hostName : (mirrored.name ?? null)
  if (mirrored.at === 0) $.ui.toast(`SCV: ${hostLabel(mirrored.host, name)} 의 상태를 받았습니다`)
  await update($, mirror, value => (value ? { ...value, at, name } : value))
}

// Sends the state to each viewer when it changed and the gap passed (isMirrorDue); a viewer that keeps failing is let go.
// The viewers live in the session's state, so a reload of the mod keeps sending to them.
let isPushing = false

const pushMirror = async ($: Api) => {
  if (isPushing || Object.keys(await read($, viewers)).length === 0) return
  isPushing = true
  try {
    const body = JSON.stringify(await mirrorState($))
    const at = await $.clock.now()
    for (const [address, last] of Object.entries(await read($, viewers))) {
      if (!isMirrorDue(last, body, at, MIRROR_GAP_MS)) continue
      const sent = await $.session
        .send({ to: { sessionId: address }, text: mirrorText({ kind: 'state', body }) })
        .catch((error: unknown) => ({ isDelivered: false as const, reason: String(error) }))
      await update($, viewers, value => {
        const { [address]: current, ...rest } = value
        if (!current) return value
        if (sent.isDelivered) return { ...rest, [address]: { sent: body, at, misses: 0 } }

        return current.misses + 1 >= MIRROR_MISSES ? rest : { ...rest, [address]: { ...current, misses: current.misses + 1 } }
      })
    }
  } finally {
    isPushing = false
  }
}

// Does what a viewer pressed, on this side: only for a viewer this session sends to, and the command to fill is the
// one this session works out for that plan itself — the message names the plan, never the command.
const takeAct = async ($: Api, address: string, act: MirrorAct) => {
  if (!(address in (await read($, viewers)))) return
  if (act.do === 'open-report') return openReport($)
  const command = (await actionInView($, act.slug))?.command
  if (!command) return
  const isFilled = await fillPrompt($, command)
  await update($, note, () => (isFilled ? `입력창에 넣음 (거울에서): ${command}` : `입력창에 못 넣음 — ${command}`))
}

// Asks the working session to send its state here; `previous` is the mirror as it stood, for a failed ask to put back.
const askMirror = async ($: Api, host: string) => {
  const own = await ownAddress($)
  const previous = await read($, mirror)
  const at = await $.clock.now()
  // A pick made for another session's plans would hide the plan this one is working in.
  if (previous?.host !== host) await update($, chosen, () => null)
  await update($, mirror, value => ({ host, at: value?.host === host ? value.at : 0, askedAt: at }))
  const sent = await $.session.send({ to: { sessionId: host }, text: mirrorText({ kind: 'hello', address: own.address }) })

  return { own, sent, previous }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const root = await sessionRoot($, e.cwd)
    const project = await projectOf($, root)
    await update($, snapshot, value => ({ ...value, cwd: project, root }))
    const kept = await $.store.get(runsKey(project)).catch(() => undefined)
    if (Array.isArray(kept)) await update($, runs, () => kept as TestRun[])
    await loadSignals($, project)
    await $.command.register({ name: 'scv-dashboard', description: 'Open the SCV dashboard pane' })
    await $.command.register({ name: 'scv-mirror', description: "Draw another session's SCV pane here: /scv-mirror <address>, or /scv-mirror stop", argumentHint: '<address> | stop' })
    await $.tool.register(STEP_TOOL_SPEC).catch(() => undefined)
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($).then(() => pushMirror($)).catch(() => undefined))
    void openPane($).catch(() => undefined)

    return started
  })

  on('prompt.submit', async ($, e, next) => {
    // A viewer session only draws the working session's pane; what the person types here would reach another Claude
    // that knows nothing of the work, so it is stopped. Slash commands (/scv-mirror stop) still run.
    const kind = (e as { origin?: { kind?: string } }).origin?.kind
    const mirrored = await read($, mirror)
    if (mirrored && !e.command && !e.isMeta && (kind === 'composer' || kind === 'bridge')) {
      return { drop: `이 세션은 ${mirrored.host} 의 SCV 칸만 보여 주는 거울입니다 — 대화는 작업 세션 창에서 하세요. 이 세션을 다시 쓰려면 /scv-mirror stop` }
    }
    const submitted = await next(e)
    // The person's own message (not one a plugin sent) starts a new 'while you were away'.
    const origin = (e as { origin?: { kind?: string } }).origin
    if (origin?.kind !== 'plugin' && !e.isMeta) {
      const plan = await planInView($)
      const at = await $.clock.now()
      const doneSteps = plan ? deriveStages(plan).stages.flatMap((stage, i) => (stage.state === 'done' ? [i] : [])) : []
      await update($, since, () => ({ at, slug: plan?.slug ?? '', doneSteps }))
    }
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (!isOpen) await openPane($)

    return submitted
  })

  // Sent from a Remote Control viewer, the answer is the only part that reaches it, so it says how to see the pane there.
  on('command.run', { command: 'scv-dashboard' }, async $ => {
    const { isPlaced } = await openPane($)
    const own = await ownAddress($)
    const reach = own.isRemote ? '' : ' (Remote Control이 꺼져 있어 이 컴퓨터 안에서만 닿습니다)'

    return {
      text: `SCV dashboard ${isPlaced ? 'is open' : 'is not drawn here'}. 이 세션을 다른 기기 앱에서 보려면, 그 기기에서 연 다른 세션에서: /scv-mirror ${own.address}${reach}`,
    }
  })

  on('command.run', { command: 'scv-mirror' }, async ($, e) => {
    const asked = e.args.trim().split(/\s+/)[0] ?? ''
    if (!asked) {
      const mirrored = await read($, mirror)
      if (mirrored) {
        const plan = await planInView($)
        const count = plan ? countStages(deriveStages(plan).stages) : undefined
        const got = mirrored.at ? `${formatDuration(Math.max(0, (await $.clock.now()) - mirrored.at))} 전 받음` : '아직 받은 상태 없음'

        return { text: `거울 중: ${hostLabel(mirrored.host, mirrored.name)} · ${got}${plan && count ? ` · ${plan.title} ${count.done}/${count.total}` : ''}` }
      }
      const own = await ownAddress($)

      return { text: `사용법: /scv-mirror <작업 세션 주소> — 작업 세션에서 /scv-dashboard 를 치면 주소가 나옵니다. 이 세션 주소: ${own.address}` }
    }
    if (asked === 'stop' || asked === 'off') {
      const mirrored = await read($, mirror)
      await update($, mirror, () => null)
      await update($, hostInView, () => null)
      if (mirrored) {
        const own = await ownAddress($)
        await $.session.send({ to: { sessionId: mirrored.host }, text: mirrorText({ kind: 'bye', address: own.address }) }).catch(() => undefined)
      }
      await refresh($).catch(() => undefined)

      return { text: mirrored ? `거울 끔 — 이 세션의 SCV 칸은 이제 이 폴더를 보여 줍니다.` : '거울이 켜져 있지 않습니다.' }
    }
    // One's own address mirrors nothing; it is refused before anything is sent, and the mirror as it stands stays.
    const self = await ownAddress($)
    if (isOwnAddress(asked, { address: self.address, localId: await $.session.id() })) {
      return {
        text: `이건 이 세션 자신의 주소입니다 — 거울은 다른 세션의 칸을 여기에 그립니다. 보고 싶은 다른 세션에서 /scv-dashboard 를 쳐서 나온 주소를 넣으세요. 이 세션을 다른 기기에서 보려면, 그 기기에서 연 다른 세션에서: /scv-mirror ${self.address}`,
      }
    }
    // A session that mirrors this one would only copy it back: the two would freeze, each drawing the other.
    if (isViewerOf(asked, await read($, viewers))) {
      return {
        text: `그 세션은 지금 이 세션을 거울로 보고 있습니다 — 서로 거울을 걸면 두 칸 모두 멈춥니다. 거울은 작업 세션이 아닌 다른 세션에서 겁니다. 이미 서로 걸려 있다면 한쪽에서 /scv-mirror stop`,
      }
    }
    const { own, sent, previous } = await askMirror($, asked)
    await openPane($).catch(() => undefined)
    if (!sent.isDelivered) {
      await update($, mirror, () => previous)

      return { text: `거울 요청을 보내지 못했습니다: ${sent.reason}` }
    }
    const reach = own.isRemote ? '' : ' 이 세션은 Remote Control이 꺼져 있어, 같은 컴퓨터의 작업 세션에서만 받을 수 있습니다.'

    return { text: `거울 요청을 보냈습니다 → ${asked}. 상태가 오면 SCV 칸이 그 세션을 보여 줍니다.${reach}` }
  })

  // A Remote Control app joins after session.start, so the pane is opened again for it.
  on('session.attach', async ($, e, next) => {
    const attached = await next(e)
    if (e.surface !== 'mobile') await openPane($).catch(() => undefined)

    return attached
  })

  // Mirror messages between sessions are taken here and never reach the model; every other delivery goes on.
  on('session.receive', async ($, e, next) => {
    const message = e.origin.kind === 'peer' && !e.agentId ? parseMirror(e.text) : null
    if (!message) return next(e)
    if (message.kind === 'hello') {
      const isNew = !(message.address in (await read($, viewers)))
      await update($, viewers, value => ({ ...value, [message.address]: { sent: '', at: 0, misses: 0 } }))
      if (isNew) $.ui.toast(`SCV: 다른 세션이 이 세션의 칸을 봅니다 (${message.address})`)
      await pushMirror($)
    } else if (message.kind === 'bye') {
      await update($, viewers, ({ [message.address]: _gone, ...rest }) => rest)
    } else if (message.kind === 'act') {
      await takeAct($, message.address, message.act)
    } else {
      await takeMirror($, message.body)
    }

    return { consumed: `scv mirror ${message.kind}` }
  })

  // Only the main conversation's turns move 'working / resting'; a subagent's run is a turn of its own loop.
  on('turn.start', async ($, e, next) => {
    if (!isMainLoop(e)) {
      const at = await $.clock.now()
      await update($, agents, list => applyAgentEvent(list, { kind: 'start', id: e.agentId ?? '', name: '', at }))

      return next(e)
    }
    const at = await $.clock.now()
    await update($, live, value => ({ ...value, isWorking: true, turnStartedAt: at }))
    await update($, stopped, () => null)
    await update($, permit, () => null)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (!isMainLoop(e)) {
      await update($, agents, list => applyAgentEvent(list, { kind: 'end', id: e.agentId ?? '' }))

      return ended
    }
    await update($, live, value => ({ ...value, isWorking: false, tool: null }))
    await update($, permit, () => null)
    const end = classifyTurnEnd(e.reason, e.durationMs)
    if (end.kind === 'stopped') {
      const at = await $.clock.now()
      await update($, stopped, () => ({ why: end.why, at }))
      await alert($, buildAlertText([end.why === 'error' ? '오류로 멈춤' : '거절로 멈춤', formatDuration(e.durationMs)]))
    }
    if (e.reason === 'answer') {
      const action = await actionInView($)
      const command = action ? suggestNext(action) : null
      if (command) await $.prompt.suggest({ text: command }).catch(() => undefined)
    }
    if (end.kind === 'done') {
      const plan = await planInView($)
      const count = plan ? countStages(deriveStages(plan).stages) : undefined
      await alert($, buildAlertText(['끝났어요', formatDuration(e.durationMs), plan && count ? `${plan.title} ${count.done}/${count.total}` : null]))
    }

    return ended
  })

  // A permission prompt about to be shown: the work waits on the person. A settings hook that answered
  // it means no prompt; the mod's own phone notification never asks the person about itself.
  on('classic.PermissionRequest', async ($, e, next) => {
    const answered = await next(e)
    if (answered?.decision || OWN_TOOLS.has(e.tool_name)) return answered
    const input = (e.tool_input ?? {}) as Record<string, unknown>
    const waitingFor = permissionWaitOf(e.tool_name, input, await $.clock.now())
    await update($, permit, () => waitingFor)
    await alert($, buildAlertText([`허락 기다림 — ${waitingFor.tool}${waitingFor.target ? `: ${waitingFor.target}` : ''}`]))

    return answered
  })

  // A subagent that started: named by the task it was given.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (!started.deny && started.agentId) {
      const id = started.agentId
      const at = await $.clock.now()
      await update($, agents, list => applyAgentEvent(list, { kind: 'start', id, name: e.description || e.subagentType, at }))
    }

    return started
  })

  // The mod's own phone notification asks no permission; the person's calls to it are judged as ever.
  on('tool.check', { tool: 'PushNotification' }, ($, e, next) => (isOwnCall(next.origin) ? { decision: 'allow' as const } : next(e)))

  // The mod's own mirror messages ask no permission (auto mode has no verdict for a send nobody typed); the model's are judged as ever.
  on('tool.check', { tool: 'SendMessage' }, ($, e, next) => (isOwnCall(next.origin) ? { decision: 'allow' as const } : next(e)))

  // Claude's instructions carry the step signal only while a plan is in progress.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const text = buildStepPrompt(parsePlans((await read($, snapshot)).plans))

    return text ? { sections: [...composed.sections, { id: 'scv-dashboard:step-signal', text, scope: 'session' as const }] } : composed
  })

  // The mod's own tool asks no permission; every other tool's verdict is left as it is.
  on('tool.check', { tool: STEP_TOOL_NAME }, () => ({ decision: 'allow' as const }))

  // Signals are written one at a time, so two sent together cannot both build on the same old record.
  let signalQueue: Promise<unknown> = Promise.resolve()
  const oneAtATime = <T,>(work: () => Promise<T>): Promise<T> => {
    const run = signalQueue.then(work, work)
    signalQueue = run.catch(() => undefined)

    return run
  }

  on('tool.call', { tool: STEP_TOOL_NAME }, ($, e) => oneAtATime(async () => {
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
  }))

  on('tool.call', async ($, e, next) => {
    if (OWN_TOOLS.has(e.tool)) return next(e)
    const input = e as unknown as Record<string, unknown>
    const at = await $.clock.now()
    // The main conversation's tool is the 'now' line; a subagent's goes on that agent's own line.
    const isMain = isMainLoop(e)
    if (isMain) {
      await update($, live, value => ({ ...value, tool: { name: e.tool, target: describeTool(e.tool, input), startedAt: at } }))
      await update($, tasks, list => applyTaskEvent(list, e.tool, input))
    } else {
      await update($, agents, list => applyAgentEvent(list, { kind: 'tool', id: e.agentId ?? '', tool: e.tool, target: describeTool(e.tool, input), at }))
    }
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
      // allowed and run, or refused: either way the prompt is gone
      await update($, permit, value => (value?.tool === e.tool ? null : value))
      if (isMain) await update($, live, value => (value.tool?.startedAt === at ? { ...value, tool: null } : value))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Select = 'Select' in elements ? elements.Select : undefined
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const shot = await read($, snapshot)
    const plans = parsePlans(shot.plans)
    const picked = pickPlan(plans, await chosenSlug($))
    const reported = await read($, signals)
    const plan = picked && mergeMarks(picked, reported)
    const open = await read($, expanded)
    const at = await read($, now)
    const state = await read($, live)
    const todo = await read($, tasks)
    const asked = await read($, waiting)
    const asking = await read($, permit)
    const halted = await read($, stopped)
    const sinceAt = await read($, since)
    const team = await read($, agents)
    const allRuns = await read($, runs)
    const dreams = parseDreams(shot.dreamsText)
    const message = await read($, note)
    const mirrored = await read($, mirror)
    const mirrorLine = mirrored ? (
      <Text color="#4f8cff">
        {`거울: ${hostLabel(mirrored.host, mirrored.name)} · ${mirrored.at ? `${formatDuration(Math.max(0, at - mirrored.at))} 전 받음` : '상태를 기다리는 중'}`}
      </Text>
    ) : null

    const toggle = (key: keyof Expanded) => () => void update($, expanded, value => ({ ...value, [key]: !value[key] }))

    // Mirroring, a press goes to the working session, which does it on its own side; the note says where it went.
    const sendAct = async (act: MirrorAct, sentNote: string | null) => {
      if (!mirrored) return
      const own = await ownAddress($)
      const sent = await $.session
        .send({ to: { sessionId: mirrored.host }, text: mirrorText({ kind: 'act', address: own.address, act }) })
        .catch((error: unknown) => ({ isDelivered: false as const, reason: String(error) }))
      await update($, note, () => (sent.isDelivered ? sentNote : `작업 세션에 못 보냄: ${sent.reason}`))
    }

    // The next command into the prompt box, keeping what the person typed; where the box will not take it, copied.
    const fillNext = async (command: string) => {
      if (mirrored) return plan && sendAct({ do: 'fill', slug: plan.slug }, `입력창(작업 세션)에 넣으라고 보냄: ${command}`)
      if (await fillPrompt($, command)) return void (await update($, note, () => `입력창에 넣음: ${command}`))
      const copied = await $.ui.copy({ text: command, surface: e.surface }).catch(() => ({ isCopied: false }))
      await update($, note, () => (copied.isCopied ? `입력창에 못 넣어 복사함: ${command}` : `입력창에 못 넣음 — ${command}`))
    }

    const openDreamsReport = () => openReport($)

    const card = (children: RenderChildren, color = '#30363d') => (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginBottom={1}>
        {children}
      </Box>
    )

    if (!plan) {
      return (
        <Box flexDirection="column">
          {mirrorLine}
          <Text bold>SCV 대시보드</Text>
          <Text dimColor>이 폴더에 진행 중인 SCV 계획이 없습니다. /scv:promote 로 계획을 만들면 여기에 보입니다.</Text>
          <Text dimColor>{`확인한 곳: ${shot.cwd || '(작업 폴더 모름)'}/scv/promote`}</Text>
          {dreamsPart()}
        </Box>
      )
    }

    const derived = deriveStages(plan)
    const isEstimated = derived.isEstimated
    const run = runFor(plan, allRuns)
    const rows = mergeTests(plan, run)
    const blocks = findBlocks(derived.stages, run, asked, asking, halted)
    const stages = applyBlocks(derived.stages, blocks)
    const here = stages.findIndex(stage => stage.state === 'doing' || stage.state === 'blocked')
    const focused = (await read($, focusStep)) ?? (here >= 0 ? here : null)
    const focusedStage = focused === null ? undefined : stages[focused]
    const work = focused === null ? [] : ((await read($, stepLog))[`${plan.slug}#${focused}`] ?? [])
    const count = countStages(stages)
    // Step times from Claude's signals survive a new session; the times seen in this session are the fallback.
    const durations = stepDurationsFromSignals(reported, plan.slug)
    const eta =
      durations.length > 0
        ? estimateFromDurations(durations, count.total - count.done)
        : estimateEta(await read($, history), plan.slug, count.total - count.done)
    const action = nextAction(plan.slug, plan.status, stages, blocks)
    const percent = count.total ? Math.round((count.done / count.total) * 100) : 0
    const current = stages.find(stage => stage.state === 'doing' || stage.state === 'blocked')
    const doneTasks = todo.filter(task => task.status === 'completed').length
    const doingTask = todo.find(task => task.status === 'in_progress')
    const away = sinceAt
      ? summarizeAway(
          eventsSince({ slug: plan.slug, stages, runs: allRuns, waiting: asked, permit: asking, stopped: halted }, sinceAt),
          at - sinceAt.at,
          formatDuration,
        )
      : null
    const agentRows = agentLines(team, at, formatDuration)
    const usage = usageLine(await read($, limits), offsetAt(at))

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
                {dreams.reportPath && <Button key="dreams-report" label="보고서 열기" onPress={() => void openDreamsReport()} />}
              </Box>
              {message && !isActionNote(message) && <Text color="#f85149">{message}</Text>}
            </>
          ) : (
            <Text dimColor>아직 드림 없음 — /scv:dreams 로 만들 수 있습니다.</Text>
          )}
        </>,
      )
    }

    return (
      <Box flexDirection="column">
        {mirrorLine}
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
                <Box flexDirection="row" gap={1}>
                  <Button key="next-fill" label="입력창에 넣기" onPress={() => void fillNext(action.command ?? '')} />
                  <Button
                    key="next-copy"
                    label="명령 복사"
                    onPress={() =>
                      void $.ui.copy({ text: action.command ?? '', surface: e.surface }).then(copied =>
                        update($, note, () => (copied.isCopied ? `복사함: ${action.command}` : `복사 못 함 — ${action.command}`)),
                      )
                    }
                  />
                </Box>
              ) : null}
            </Box>
            {message && isActionNote(message) ? <Text dimColor>{message}</Text> : null}
          </>,
          barColor(stages, blocks),
        )}

        {away
          ? card(
              <>
                <Text bold>{away.title}</Text>
                {away.lines.map(line => (
                  <Text>{line}</Text>
                ))}
              </>,
            )
          : null}

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
              <Text color={halted ? STATE_COLOR.blocked : state.isWorking ? '#4f8cff' : '#8b949e'}>
                {halted
                  ? `멈춤 — ${halted.why === 'error' ? '오류' : '거절'}`
                  : state.isWorking
                    ? `일하는 중 · ${formatDuration(at - state.turnStartedAt)}`
                    : '쉬는 중'}
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
            {agentRows.map(line => (
              <Text dimColor>{`└ ${line}`}</Text>
            ))}
            {usage ? (
              <Box flexDirection="row" gap={1}>
                <Text bold>사용 한도</Text>
                <Text dimColor>{usage}</Text>
              </Box>
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
                ) : focusedStage.role ? (
                  <Text>{`• ${focusedStage.role}`}</Text>
                ) : (
                  <Text>{`• ${focusedStage.name}`}</Text>
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

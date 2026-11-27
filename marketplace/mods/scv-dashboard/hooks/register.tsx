import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { ActNote, AgentState, BigProof, DoneEntry, Evidence, Expanded, GearAsks, GearForm, GearRun, GearWait, JobBoard, Live, Mirror, Permit, Plan, PlanFile, Since, Snapshot, StageState, StepFunctions, StepSignal, Stopped, TestRun, UsageLimit, ViewPicks, Viewers, WordsView, WorkEntry } from '../types'
import type { FileFact, MirrorAct } from './model'
import { LANG_OPTIONS, cleanLang, langChoice, langFromSettings, langSaveArgv, packFile, packFor, packRequest, parsePack, sayElements, toLang } from './lang'
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
  applyTurn,
  isBackgroundStart,
  turnStateOf,
  applyTaskEvent,
  barColor,
  buildAlertText,
  buildStepPrompt,
  checkSignal,
  BIG_HEIGHT,
  BIG_WIDTH,
  bigIndexOf,
  IMAGE_DRAW_BYTES,
  imageSvg,
  isDrawable,
  turnPicture,
  judgeEvidence,
  lastSignalOf,
  liveOf,
  classifyTurnEnd,
  countStages,
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
  signalAnswer,
  backgroundSteps,
  doingWord,
  proofView,
  mergeTests,
  nextAction,
  parsePlans,
  parseTestOutput,
  permissionWaitOf,
  pickPlan,
  planPromptFill,
  recordStepTimes,
  runFor,
  definedFromCatalog,
  extractMarked,
  parseCatalog,
  recordFunctions,
  stepFunctionView,
  firstClause,
  functionBullet,
  usedNames,
  writtenCode,
  archivedAtOf,
  nextStarted,
  statusWords,
  titleOf,
  returnLine,
  suggestNext,
  summarizeAway,
  usageAlerts,
  usageLine,
  contextLine,
  estimateFromDurations,
  stepDurationsFromSignals,
  pickerPlans,
  applyDone,
  applyJobEvent,
  doneLine,
  findJob,
  jobEndOf,
  jobStartOf,
  newlyDone,
  nowBlock,
  nowLine,
  progressOf,
  tailOf,
  isMirrorAskDue,
  mirrorLineText,
  askModeView,
  gearCatalog,
  gearCommand,
  gearMatch,
  gearRows,
  gearRunArgv,
  hintLine,
  hintNote,
  argChoices,
  confirmLines,
  confirmStop,
  cutLine,
  gearConfirmArgv,
  gearLaunchArgv,
  gearPaste,
  gearResumeArgv,
  isGearName,
  outwardSteps,
  parseAsk,
  runPlan,
  runView,
  stopLines,
  lastTurns,
  lightDue,
  lightMessages,
  lightNote,
  lightWay,
  wasCleared,
  parseClearKept,
  jobsBrief,
  afterClearBrief,
  listToolOf,
  repinBrief,
  repinOf,
  REPIN_PROMPT,
  keepTalk,
  talkPage,
  storedTalkPage,
  typedBy,
  isEchoOf,
  isTalkOutput,
  swapOutput,
  NO_TALK,
  TALK_COMMAND,
  TALK_STORED,
  agentJobs,
  flightOf,
  tabsOf,
  stillRunning,
  paneSections,
  parseLight,
  moveLight,
  lightFromSettings,
  lightSaveArgv,
  lightLabel,
  lightSaidParts,
  lightBarSvg,
  LIGHT_STEP,
  NO_PLACE,
  branchOfHead,
  gitDirOf,
  parseBranches,
  shortPath,
  switchNote,
  recordTail,
  resumeBrief,
  DEFAULT_LIGHT,
  parseAskMode,
  parseGears,
  pluginRoot,
  submitWithGear,
  usedGear,
  MIRROR_ACTS,
  MIRROR_ACTS_LANG,
  MIRROR_ACTS_MIN,
  fromMirrorLine,
  isActText,
  parseAct,
  wireTail,
  checkWord,
  formsLine,
  parseWords,
  wordLine,
  wordsAddArgv,
  wordsCommand,
  wordsFold,
  wordsFormKind,
  wordsRemoveArgv,
  wordsRemoveCommand,
  wordsSaid,
} from './model'
import type { AskMode, BranchNow, ClearKept, Talk, ConfirmStop, Flight, JobEnd, LightSettings, PaneSection, Place, RunPlan, StepFunctionView, TabSeen, WordDraft } from './model'

const PANE = 'scv-dashboard'
const TITLE = 'SCV'
const REFRESH_MS = 3000
// A working session sends a changed state no sooner than this after its last send; an unchanged one is not sent.
// Each send is a row in the viewer's app (the app draws one per delivery from another computer, consumed or not).
const MIRROR_GAP_MS = 10_000
const MIRROR_MISSES = 3

const snapshot = atom({ plugin: 'scv-dashboard', key: 'snapshot' } as const, { plans: [], cwd: '', root: '' } as Snapshot)
const chosen = atom({ plugin: 'scv-dashboard', key: 'chosen' } as const, null as string | null)
// The plan the working session has in view, for a viewer that has not picked one itself.
const hostInView = atom({ plugin: 'scv-dashboard', key: 'host-in-view' } as const, null as string | null)

const chosenSlug = async ($: Api) => (await read($, chosen)) ?? (await read($, hostInView))
const expanded = atom({ plugin: 'scv-dashboard', key: 'expanded' } as const, { steps: false, tests: false, blocks: true } as Expanded)
const runs = atom({ plugin: 'scv-dashboard', key: 'runs' } as const, [])
const waiting = atom({ plugin: 'scv-dashboard', key: 'waiting' } as const, null as string | null)
// The work turns left running (a command in the background, a watch, a terminal tab's command) until its end is heard.
const jobs = atom({ plugin: 'scv-dashboard', key: 'jobs' } as const, { jobs: [], extra: 0 } as JobBoard)
// What finished lately: a job that ended, a task of the task list that was completed.
const doneLog = atom({ plugin: 'scv-dashboard', key: 'doneLog' } as const, [] as DoneEntry[])
const live = atom({ plugin: 'scv-dashboard', key: 'live' } as const, { isWorking: false, turnStartedAt: 0, tool: null } as Live)
const tasks = atom({ plugin: 'scv-dashboard', key: 'tasks' } as const, [])
const history = atom({ plugin: 'scv-dashboard', key: 'history' } as const, [])
const now = atom({ plugin: 'scv-dashboard', key: 'now' } as const, 0)
const note = atom({ plugin: 'scv-dashboard', key: 'note' } as const, null as string | null)
// What the ask-mode and gear cards say after a press.
const paneNote = atom({ plugin: 'scv-dashboard', key: 'paneNote' } as const, null as string | null)
// The gears run from the pane itself, by gear name: each one's run (under way or ended), the block open under it
// (values to set, or the question before a gear that reaches outside), and what SCV said each gear needs set.
const gearRuns = atom({ plugin: 'scv-dashboard', key: 'gearRuns' } as const, {} as Record<string, GearRun>)
const gearForms = atom({ plugin: 'scv-dashboard', key: 'gearForms' } as const, {} as Record<string, GearForm>)
const gearAsks = atom({ plugin: 'scv-dashboard', key: 'gearAsks' } as const, { index: null, byName: {} } as GearAsks)
// The fold of the cards under '더 보기' is kept across sessions, by this key in the mod's store.
const MORE_KEY = 'scv-dashboard:more'
// A run from the pane that took this long is a long one: its end is announced.
const GEAR_RUN_MS = 30_000
// The gear that fits what is being typed (its name), and the one the person turned down for this text.
const gearHint = atom({ plugin: 'scv-dashboard', key: 'gearHint' } as const, null as string | null)
const gearDismissed = atom({ plugin: 'scv-dashboard', key: 'gearDismissed' } as const, null as string | null)
// The gear card: which gear's line is open, whether all are listed, and the gears used lately (newest first).
const gearOpen = atom({ plugin: 'scv-dashboard', key: 'gearOpen' } as const, null as string | null)
const gearsAll = atom({ plugin: 'scv-dashboard', key: 'gearsAll' } as const, false)
const gearRecent = atom({ plugin: 'scv-dashboard', key: 'gearRecent' } as const, [] as string[])
const recentKey = (project: string) => `scv-dashboard:gear-recent:${project}`
// The gear whose line this session really drew above the prompt box: only then is a sent text given its line
// (a surface that draws no such band must not have its text changed by a hint nobody saw).
const drawnHint = { name: null as string | null }

// A long conversation made light: the switch and its mark (kept across sessions), what the last pass came to, and
// the pass under way (pending: this mod asked for it; kind: how a compaction was answered; lastAt: when the last one
// ended; isClearing: the clear command of this mod is out; isCleared: a clear was seen while it was).
const light = atom({ plugin: 'scv-dashboard', key: 'light' } as const, DEFAULT_LIGHT as LightSettings)
const lightSaid = atom({ plugin: 'scv-dashboard', key: 'lightSaid' } as const, null as string | null)
// The last exchanges of the main conversation, whole: shown again to the person right after a clear of this mod's.
// talkRun.typed: what the turn now running began with (null between turns).
// shownTalk: the page of them the conversation shows now, in the output row of this mod's own command.
// storedTalk: the trimmed page the conversation stores for that row, which other screens and the model read.
// talkRow.isNext: that command's echo was just stored, so the output row comes next.
const talks = atom({ plugin: 'scv-dashboard', key: 'talks' } as const, [] as Talk[])
const shownTalk = atom({ plugin: 'scv-dashboard', key: 'shownTalk' } as const, '' as string)
const storedTalk = atom({ plugin: 'scv-dashboard', key: 'storedTalk' } as const, '' as string)
const talkRun = { typed: null as string | null }
const talkRow = { isNext: false }
const LIGHT_KEY = 'scv-dashboard:light'
// The switch and its mark being written to the project's settings file: pending — writes asked for and not yet
// over; gen — goes up with each one, so a reading of the file begun before a write is not taken for the newest;
// tail — the writes in a row, each after the one before it.
const lightWrite = { pending: 0, gen: 0, tail: Promise.resolve() as Promise<unknown> }
const LIGHT_UNSAVED = '설정 파일에 저장하지 못함 — 다시 눌러 주세요'
// The pane's language (after 0.6.2). langPack: the saved table of a language the pane carries none for, as its
// project file reads (key: the project and language it was read for). langPick: the language row open — its list,
// or the box for another language's name. langNote: what the last pick came to. langTyped: the name being typed.
// langSaid: the step that says a text in the language, built once per language and saved table. langWrite: the
// writes of the setting, one after another.
const langPack = atom({ plugin: 'scv-dashboard', key: 'langPack' } as const, { key: '', text: null } as { key: string; text: string | null })
const langPick = atom({ plugin: 'scv-dashboard', key: 'langPick' } as const, null as 'list' | 'other' | null)
const langNote = atom({ plugin: 'scv-dashboard', key: 'langNote' } as const, null as string | null)
const langTyped = { name: '' }
const langSaid = { key: '\u0000', say: (text: string) => text }
const langWrite = { tail: Promise.resolve() as Promise<unknown> }
// Where the session works: the person's home folder (to write a folder as '~/…') and the branch checked out.
const place = atom({ plugin: 'scv-dashboard', key: 'place' } as const, NO_PLACE as Place)
// The branches to pick from, while the person has the branch line open; and what the last change came to.
const branchPick = atom({ plugin: 'scv-dashboard', key: 'branchPick' } as const, null as string[] | null)
const placeNote = atom({ plugin: 'scv-dashboard', key: 'placeNote' } as const, null as string | null)
const lightRun = { pending: false, kind: 'summary' as 'records' | 'summary', lastAt: 0, isClearing: false, isCleared: false }
// The background work the engine named as in flight at the main conversation's stops, as this copy of the module
// heard it: what tells an end nobody heard, before a clear.
const flightRun = { seen: null as Flight | null }
// The terminal's own list of its tabs, which says whether a command runs in each; and what it answered when the
// main conversation's last turn ended (none: the board held no tab's command then, or there was no answer).
const TABS_TOOL = 'mcp__terminal__list_terminal_tabs'
const tabsRun = { seen: [] as TabSeen[] }
// What a clear of this mod's keeps for the conversation after it, by the folder the session runs in: the store
// outlasts the session, which goes on under another id (whether this session's state does is not known).
const clearKey = (cwd: string) => `scv-dashboard:clear:${cwd}`
// What the summarizer is told when the records cannot stand in (no conversation record in this project).
const LIGHT_INSTRUCTIONS =
  '진행 중인 SCV 계획과 그 단계, 사용자가 정한 것, 아직 남은 일, 바꾼 파일과 돌린 명령의 결과, 기록 파일(scv/conversations)의 자리를 남겨라. 사용자의 요청 문장은 그대로 남겨라.'

// The newest conversation record of the project (SCV writes one per conversation, a turn at a time), or null.
const newestRecord = async ($: Api, cwd: string) => {
  const dir = `${cwd ? `${cwd}/` : ''}scv/conversations`
  const files = (await $.fs.list(dir).catch(() => []))
    .filter(one => one.kind === 'file' && one.name.endsWith('.md'))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  const first = files[0]
  if (!first) return null
  const text = await readText($, `${dir}/${first.name}`)

  return text ? { path: `${dir}/${first.name}`, text } : null
}

const percentNow = async ($: Api) => {
  const usage = await $.session.usage().catch(() => undefined)

  return typeof usage?.context?.percent === 'number' ? usage.context.percent : null
}

// The clear this mod asked for was seen: the pass is over, and the pane says so with how full the conversation
// was and is. Called where the clear is first seen and again once the command returns (the figure is newer then).
const sayCleared = async ($: Api, before: number | null, at: number) => {
  const endedAt = await $.clock.now()
  const after = await percentNow($)
  lightRun.pending = false
  lightRun.lastAt = endedAt
  await update($, lightSaid, () => lightNote({ kind: 'cleared', before, after, ms: endedAt - at }))
}

// A conversation starts after a clear. When this mod kept values for it (its own clear, moments ago): the clear is
// taken as seen, the pane says so, and the work the turns left running comes back as the text to hand the new
// conversation — null when no work was left, and for a clear this mod kept nothing for (the person's own).
// The tool the task list was last made with, when it sends the whole list at once (the list is shown again with it
// after a clear). The module's own: a reload starts it over, and the next call of such a tool sets it again.
const listRun = { tool: null as string | null }

const afterClear = async ($: Api): Promise<string | null> => {
  const key = clearKey(await $.session.cwd().catch(() => ''))
  const kept = parseClearKept(await $.store.get(key).catch(() => undefined), await $.clock.now())
  if (!kept) return null
  await $.store.delete(key).catch(() => undefined)
  lightRun.isCleared = lightRun.isClearing
  await sayCleared($, kept.before, kept.at)

  return afterClearBrief(jobsBrief(kept.board), repinBrief(kept.repin))
}

// Asks the terminal for its tabs when the board holds a tab's command, as a turn of the main conversation ends —
// while the turn's own hook runs, where the mod's call is let through without a dialog. No such tool, a refusal or
// a failure: no tabs are known.
const readTabs = async ($: Api) => {
  const hasTab = !(await read($, mirror)) && (await read($, jobs)).jobs.some(job => job.kind === 'terminal')
  tabsRun.seen = hasTab ? tabsOf(await $.tool.call({ tool: TABS_TOOL } as never).catch(() => ({}))) : []
}

// The work still running, for the conversation after a clear: the board's jobs and the subagents, without the ones
// known to have ended — by the engine's in-flight list, and for a terminal tab's command by the terminal's tabs as
// read when the turn ended. The board itself is not changed.
const runningBoard = async ($: Api): Promise<JobBoard> => {
  const board = await read($, jobs)

  return stillRunning({ jobs: [...board.jobs, ...agentJobs(await read($, agents))], extra: board.extra }, { flight: flightRun.seen, tabs: tabsRun.seen })
}

// Shows the last exchanges in the emptied conversation, for the person to read: the mod runs its own command, whose
// output row every surface draws (a notice row is stored, and the desktop app does not draw it), and that row is
// drawn with the page in place of its words. No hook of a mod answers a command the mod itself runs, so the row the
// engine stores holds its own line for an unanswered command: the session.append hook replaces those words with the
// trimmed page (one plain line, then each exchange's first and last part), which other screens and the model read. No turn starts. No exchange, a refusal or a failure: nothing is shown.
const showTalk = async ($: Api, page: string, stored: string) => {
  if (page === '') return
  await update($, shownTalk, () => page)
  await update($, storedTalk, () => stored)
  await $.command.run({ command: TALK_COMMAND }).catch(() => undefined)
}

// Clears the conversation as the person's /clear would. The last exchanges, read before it, are shown again in the
// emptied conversation once the clear was seen. What the new conversation and the pane's line need goes to
// the store first. True only when a clear was really seen — the command having returned is no proof, and a command
// that was refused, failed or changed nothing is false (the caller then goes the other way).
const clearNow = async ($: Api, before: number | null, at: number, recordPath: string | null): Promise<boolean> => {
  const key = clearKey(await $.session.cwd().catch(() => ''))
  const idBefore = await $.session.id().catch(() => null)
  const remembered = await read($, talks)
  const page = talkPage(remembered, recordPath)
  const stored = storedTalkPage(remembered)
  const repin = repinOf(await read($, tasks), listRun.tool)
  const kept: ClearKept = { before, at, board: await runningBoard($), ...(repin ? { repin } : {}) }
  await $.store.set(key, kept).catch(() => undefined)
  lightRun.isClearing = true
  lightRun.isCleared = false
  await $.command.run({ command: 'clear' }).catch(() => undefined)
  const isCleared = wasCleared({ isEndSeen: lightRun.isCleared, idBefore, idAfter: await $.session.id().catch(() => null) })
  lightRun.isClearing = false
  lightRun.isCleared = false
  await $.store.delete(key).catch(() => undefined)
  if (isCleared) await sayCleared($, before, at)
  if (isCleared) await showTalk($, page, stored)
  // The list from before the clear is shown again by the model, in a turn this prompt starts (the app draws the list
  // only for a call the model makes in a turn). Not awaited: the call resolves when that turn starts, and this runs
  // while the turn before it is still ending.
  if (isCleared && repin) void $.prompt.submit({ text: REPIN_PROMPT }).catch(() => undefined)

  return isCleared
}

// When a turn ends: at or over the mark the conversation is made light. With a conversation record in the project
// it is cleared (the new conversation starts from the record's end, which SCV's own session-start hook carries).
// When the clear does not happen, or there is no record, the mod runs the compact command as the person would (a
// compaction this mod raised itself would skip its own hook), and the session.compact hook below answers it from
// SCV's own record — no model; with no record the engine's summary runs. Never while a turn runs.
const maybeLighten = async ($: Api) => {
  if (lightRun.pending || (await read($, mirror))) return
  const before = await percentNow($)
  const at = await $.clock.now()
  const isDue = lightDue(await read($, light), before, (await read($, live)).isWorking, lightRun.lastAt, at)
  const record = isDue ? await newestRecord($, (await read($, snapshot)).cwd).catch(() => null) : null
  const way = lightWay(isDue, recordTail(record?.text) !== '')
  if (way === 'none') return
  lightRun.pending = true
  const isClearFailed = way === 'clear' && !(await clearNow($, before, at, record?.path ?? null))
  if (way === 'clear' && !isClearFailed) return void (await refresh($).catch(() => undefined))
  lightRun.kind = 'summary'
  const ran = await $.command
    .run({ command: 'compact', args: LIGHT_INSTRUCTIONS })
    .then(() => true)
    .catch(() => false)
  const stood = ran || (await $.session.compact({ instructions: LIGHT_INSTRUCTIONS }).then(done => 'messages' in done && !!done.messages).catch(() => false))
  const endedAt = await $.clock.now()
  lightRun.pending = false
  lightRun.lastAt = endedAt
  const after = stood ? await percentNow($) : null
  await update($, lightSaid, () => lightNote({ kind: stood ? lightRun.kind : 'skipped', before, after, ms: endedAt - at, isClearFailed }))
  await refresh($).catch(() => undefined)
}

// One more use of a gear: to the front of the lately-used list, kept per project across sessions.
const noteGearUse = async ($: Api, name: string) => {
  const list = await update($, gearRecent, recent => usedGear(recent, name))
  const project = (await read($, snapshot)).cwd
  await $.store.set(recentKey(project), list).catch(() => undefined)
}

// The gear that fits the prompt box's text as it stands, if one does. An emptied box forgets a turned-down gear.
const fitGear = async ($: Api, text: string) => {
  if (await read($, mirror)) return
  const fit = gearMatch(text, parseGears((await read($, snapshot)).gearsText))
  if (text.trim() === '' && (await read($, gearDismissed)) !== null) await update($, gearDismissed, () => null)
  const name = fit?.gear.name ?? null
  if ((await read($, gearHint)) !== name) await update($, gearHint, () => name)
}
const focusStep = atom({ plugin: 'scv-dashboard', key: 'focusStep' } as const, null as number | null)
// The proof picture a person pressed to see large; while it stands, the pane draws that picture alone.
const bigProof = atom({ plugin: 'scv-dashboard', key: 'bigProof' } as const, null as BigProof | null)
const stepLog = atom({ plugin: 'scv-dashboard', key: 'stepLog' } as const, {} as Record<string, WorkEntry[]>)
// The functions each step made and called, by `<plan>#<step index>`; kept per project like the step signals.
const stepFunctions = atom({ plugin: 'scv-dashboard', key: 'stepFunctions' } as const, {} as Record<string, StepFunctions>)
// Whether a step's tool calls show under its functions (folded by default).
const showCalls = atom({ plugin: 'scv-dashboard', key: 'showCalls' } as const, false)
// The steps this session said it started (scv_step doing) and has not yet said are done or blocked, oldest first;
// its work goes to the last one. Steps worked on at the same time are all here.
const startedSteps = atom({ plugin: 'scv-dashboard', key: 'startedSteps' } as const, [] as { plan: string; step: number }[])
const signals = atom({ plugin: 'scv-dashboard', key: 'signals' } as const, [] as StepSignal[])
const permit = atom({ plugin: 'scv-dashboard', key: 'permit' } as const, null as Permit | null)
const stopped = atom({ plugin: 'scv-dashboard', key: 'stopped' } as const, null as Stopped | null)
const agents = atom({ plugin: 'scv-dashboard', key: 'agents' } as const, [] as AgentState[])
const since = atom({ plugin: 'scv-dashboard', key: 'since' } as const, null as Since | null)
const limits = atom({ plugin: 'scv-dashboard', key: 'limits' } as const, [] as UsageLimit[])
// How full the context window is, 0 to 100, from the same free usage read; null before the first reply.
const contextFill = atom({ plugin: 'scv-dashboard', key: 'contextFill' } as const, null as number | null)
const mirror = atom({ plugin: 'scv-dashboard', key: 'mirror' } as const, null as Mirror | null)
const viewers = atom({ plugin: 'scv-dashboard', key: 'viewers' } as const, {} as Viewers)
// The word dictionary card: what SCV's command said after the last save or removal, and how the person left the card.
const wordsNote = atom({ plugin: 'scv-dashboard', key: 'wordsNote' } as const, null as string | null)
const NO_WORDS_VIEW: WordsView = { isOpen: false, edit: null, asking: null, isAll: false, gen: 0 }
const wordsView = atom({ plugin: 'scv-dashboard', key: 'wordsView' } as const, NO_WORDS_VIEW)
// What the person typed into the dictionary form. Kept outside the drawn state, so a keystroke redraws nothing.
const wordsTyped: { avoid?: string; use?: string; forms?: string } = {}
const clearWordsTyped = () => {
  delete wordsTyped.avoid
  delete wordsTyped.use
  delete wordsTyped.forms
}
// A viewer session: the acts its working session says it takes, the gear runs under way there, the values picked
// here for a gear's block (they travel when the block is submitted), and the line after a press sent there.
const hostActs = atom({ plugin: 'scv-dashboard', key: 'hostActs' } as const, 0)
const hostLive = atom({ plugin: 'scv-dashboard', key: 'hostLive' } as const, [] as string[])
const viewPicks = atom({ plugin: 'scv-dashboard', key: 'viewPicks' } as const, {} as ViewPicks)
const actNote = atom({ plugin: 'scv-dashboard', key: 'actNote' } as const, null as ActNote | null)
// The gear line the working session had open in the state taken last: its line opens here only when that changes,
// so a line the viewer opened or folded stays as the viewer left it.
const hostGear = { open: undefined as string | null | undefined }
// A working session: what a mirror last had it do, as its own pane says it.
const fromMirror = atom({ plugin: 'scv-dashboard', key: 'fromMirror' } as const, null as string | null)

const STATE_LABEL: Record<StageState, string> = { done: '완료', doing: '진행 중', blocked: '막힘', waiting: '대기', yourTurn: '사용자 차례' }
const STATE_MARK: Record<StageState, string> = { done: '●', doing: '◉', blocked: '●', waiting: '○', yourTurn: '◉' }
const STATE_COLOR: Record<StageState, string> = { done: '#3fb950', doing: '#e3b341', blocked: '#f85149', waiting: '#8b949e', yourTurn: '#a371f7' }
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
    if (!planText) continue
    const testsText = (await readText($, `${dir}/${entry.name}/TESTS.md`)) ?? ''
    const archivedAt = isArchived ? archivedAtOf(await readText($, `${dir}/${entry.name}/ARCHIVED_AT.md`)) : ''
    plans.push({ slug: entry.name, planText, testsText, isArchived, ...(archivedAt ? { archivedAt } : {}) })
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

  return {
    plans,
    cwd,
    catalog: await readCatalog($, `${scv}/core/catalog/pure`),
    settingsText: await readText($, `${scv}/scv_settings.json`),
    gearsText: await readText($, `${scv}/gears/INDEX.tsv`),
    wordsText: await readText($, `${scv}/words/WORDS.tsv`),
    gearWaits: await countGearWaits($, `${scv}/journal/.gear-run`),
  }
}

// Gear runs stopped before a tooth that reaches outside, waiting for the person's go-ahead (their state folders say so).
const countGearWaits = async ($: Api, dir: string) => {
  const runs = (await $.fs.list(dir).catch(() => [])).filter(one => one.kind === 'dir').slice(0, 8)
  const kinds = await Promise.all(runs.map(one => readText($, `${dir}/${one.name}/kind`)))

  return kinds.filter(kind => (kind ?? '').trim() === 'confirm').length
}

// Where the SCV plugin is installed, read from Claude's list of installed plugins; null when it is not found.
const findCore = async ($: Api, project: string) => {
  const home = await $.env.get('HOME').catch(() => undefined)
  if (!home) return null

  return pluginRoot(await readText($, `${home}/.claude/plugins/installed_plugins.json`), project)
}

// The project's pure-function dictionary, every kind file in it; none yet (no build) is an empty one.
const readCatalog = async ($: Api, dir: string) => {
  const entries = await $.fs.list(dir).catch(() => [])
  const texts: string[] = []
  // effects.md · notes.md (a dictionary that is the source, core 0.98.0+) are not pure-function kinds.
  for (const entry of entries.filter(one => one.kind === 'file' && one.name.endsWith('.md') && one.name !== 'effects.md' && one.name !== 'notes.md')) {
    const text = await readText($, `${dir}/${entry.name}`)
    if (text) texts.push(text)
  }

  return parseCatalog(texts)
}

// Test runs and step signals are kept in the mod's own store, per project folder, so a new session
// (or another session on this computer) still shows them.
const runsKey = (cwd: string) => `runs:${cwd}`
const signalsKey = (cwd: string) => `signals:${cwd}`
const functionsKey = (cwd: string) => `functions:${cwd}`

const loadSignals = async ($: Api, cwd: string) => {
  const kept = await $.store.get(signalsKey(cwd)).catch(() => undefined)
  if (Array.isArray(kept)) await update($, signals, () => kept as StepSignal[])
  const functions = await $.store.get(functionsKey(cwd)).catch(() => undefined)
  if (functions && typeof functions === 'object' && !Array.isArray(functions)) await update($, stepFunctions, () => functions as Record<string, StepFunctions>)
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

// The branch checked out where the session works, read from the repository's own HEAD file (no command run):
// the nearest folder at or above the session's that holds one; a worktree's '.git' file is followed.
const readBranch = async ($: Api, root: string): Promise<BranchNow | null> => {
  if (!root.startsWith('/')) return null
  for (const dir of ancestorsOf(root)) {
    const head = await readText($, `${dir}/.git/HEAD`)
    if (head) return branchOfHead(head)
    const linked = gitDirOf(await readText($, `${dir}/.git`), dir)
    if (linked) return branchOfHead(await readText($, `${linked}/HEAD`))
  }

  return null
}

const readPlace = async ($: Api, root: string) => {
  const home = (await read($, place)).home ?? (await $.env.get('HOME').catch(() => undefined)) ?? null
  const branch = await readBranch($, root)
  await update($, place, () => ({ home, branch }))
}

// A press on the branch line: the local branches are listed to pick from; a second press folds the list.
const listBranches = async ($: Api) => {
  const root = (await read($, snapshot)).root
  const ran = await $.process.run(['git', 'branch', '--format=%(refname:short)'], { ...(root ? { cwd: root } : {}), timeoutMs: 15_000 }).catch(() => undefined)

  return ran?.exitCode === 0 ? parseBranches(ran.stdout) : []
}

const openBranches = async ($: Api) => {
  if (await read($, branchPick)) return void (await update($, branchPick, () => null))
  const names = await listBranches($)
  if (names.length === 0) return void (await update($, placeNote, () => '브랜치 목록을 읽지 못함'))
  await update($, placeNote, () => null)
  await update($, branchPick, () => names)
}

// A branch picked: git changes to it (git itself refuses when a file not yet committed would be lost). Never
// while a turn runs — the work under way was started on the branch it found.
const switchBranch = async ($: Api, to: string) => {
  const from = (await read($, place)).branch?.name ?? null
  await update($, branchPick, () => null)
  if (to === from) return
  if ((await read($, live)).isWorking) return void (await update($, placeNote, () => '턴이 도는 중에는 브랜치를 바꾸지 않음 — 턴이 끝난 뒤 다시 눌러 주세요'))
  const root = (await read($, snapshot)).root
  const ran = await $.process.run(['git', 'switch', to], { ...(root ? { cwd: root } : {}), timeoutMs: 30_000 }).catch(() => undefined)
  await refresh($).catch(() => undefined)
  await update($, placeNote, () => switchNote({ from, to, exitCode: ran ? ran.exitCode : null, stderr: ran?.stderr ?? '' }))
}

const refresh = async ($: Api) => {
  const at = await $.clock.now()
  // A viewer session draws the working session's state, so its own files are not read; only its clock moves.
  const mirrored = await read($, mirror)
  if (mirrored) {
    await update($, now, () => at)
    // A viewer does not ask again because nothing came for a while: each ask is a row in the working session's
    // conversation, and a resting session has nothing to send. The person asks with the mirror line's button.
    // A session's Remote Control address is written down a little after it starts, so its first ask may carry the
    // local one, which another computer cannot reach. While nothing has come, a newer address asks again.
    if (!mirrored.at && isMirrorAskDue(mirrored, (await ownAddress($)).address)) await askMirror($, mirrored.host)

    return
  }
  const current = await read($, snapshot)
  const root = await sessionRoot($, current.root)
  const project = root === current.root && current.cwd ? current.cwd : await projectOf($, root)
  if (current.cwd && project !== current.cwd) await loadRuns($, project)
  const core = current.core && project === current.cwd ? current.core : await findCore($, project)
  const gen = lightWrite.gen
  const next = { ...(await readSources($, project)), root, core }
  await update($, snapshot, () => next)
  await syncLangPack($, next)
  await syncLight($, current, next, gen)
  await update($, now, () => at)
  await loadSignals($, next.cwd)
  await readPlace($, root)
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
  await update($, contextFill, () => (typeof usage?.context?.percent === 'number' ? usage.context.percent : null))
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

// ── the pane's language (after 0.6.2) ──────────────────────────────────────────────

const packKeyOf = (shot: Pick<Snapshot, 'cwd' | 'settingsText'>) => {
  const lang = langFromSettings(shot.settingsText)

  return lang && langChoice(lang).pick === 'other' ? { lang, key: `${shot.cwd}\n${lang}` } : null
}

// The saved table of the project's language, read with the project: only for a language the pane carries no
// table for. A language it carries (or none) keeps nothing.
const syncLangPack = async ($: Api, shot: Snapshot) => {
  const own = packKeyOf(shot)
  const text = own ? await readText($, `${shot.cwd ? `${shot.cwd}/` : ''}${packFile(own.lang)}`) : null
  await update($, langPack, one => (one.key === (own?.key ?? '') && one.text === text ? one : { key: own?.key ?? '', text }))
}

// The step that says a drawn text in the project's language. A viewer draws its working session's language, with
// no saved table (it reads no file), so a language the pane carries none for is English there.
const sayOf = async ($: Api) => {
  const shot = await read($, snapshot)
  const lang = langFromSettings(shot.settingsText)
  const own = packKeyOf(shot)
  const kept = await read($, langPack)
  const saved = own && kept.key === own.key ? kept.text : null
  const key = `${lang ?? ''}\n${saved ?? ''}`
  if (langSaid.key !== key) {
    langSaid.key = key
    langSaid.say = toLang(packFor(lang, parsePack(saved)))
  }

  return langSaid.say
}

// The session is asked, once per press, to translate the pane's table into a language it carries none for and to
// write it where the pane reads it. Where the message cannot be sent it goes into the prompt box.
const askPack = async ($: Api, lang: string) => {
  const text = packRequest({ lang, file: packFile(lang), source: `${$.plugin.root}/hooks/words.ts` })
  const isSent = await $.prompt.submit({ text, asUser: true }).then(
    () => true,
    () => false,
  )
  if (isSent) return void (await update($, langNote, () => `${lang} 번역을 Claude 에게 요청함 — 생길 때까지 영어로 보임`))
  const isFilled = await fillPrompt($, text)
  await update($, langNote, () => (isFilled ? '번역 요청을 보내지 못함 — 입력창에 넣음' : '번역 요청을 보내지 못함'))
}

// A pick of the language row: the project's SCV language, written through SCV's own settings command (one key,
// the writes one after another). The pane then reads the project again and draws in it; Claude answers in it from
// the next message. A language the pane carries no table for, with none saved yet, is asked for once here.
const setLang = async ($: Api, typed: string) => {
  const lang = cleanLang(typed)
  if (!lang) return void (await update($, langNote, () => '언어 이름으로 쓸 수 없는 글 — 글자와 숫자, 띄어쓰기만'))
  await update($, langPick, () => null)
  const job = langWrite.tail.then(async () => {
    const shot = await read($, snapshot)
    const was = langFromSettings(shot.settingsText)
    if (!shot.core || was === null || was === lang) return
    const ran = await $.process.run(langSaveArgv(shot.core, lang), { ...(shot.cwd ? { cwd: shot.cwd } : {}), timeoutMs: 15_000 }).catch(() => undefined)
    if (ran?.exitCode !== 0) return void (await update($, langNote, () => '언어를 바꾸지 못함 — 다시 눌러 주세요'))
    await refresh($)
    if (langChoice(lang).pick === 'other' && !(await read($, langPack)).text) return askPack($, lang)
    await update($, langNote, () => `언어를 바꿈 — 다음 메시지부터 ${langChoice(lang).name}`)
  })
  langWrite.tail = job.catch(() => undefined)
  await langWrite.tail
}

// A press switches the ask mode through SCV's own settings command, so the next message already follows it.
// Where the plugin is not found (or the command fails), the command goes into the prompt box instead.
const switchAskMode = async ($: Api, next: AskMode) => {
  const shot = await read($, snapshot)
  const ran = shot.core
    ? await $.process.run(['bash', `${shot.core}/scripts/ask-mode.sh`, next], { ...(shot.cwd ? { cwd: shot.cwd } : {}), timeoutMs: 15_000 }).catch(() => undefined)
    : undefined
  if (ran?.exitCode === 0) {
    await refresh($)
    const forced = /^ENV_VALUE: (.+)$/m.exec(ran.stdout)?.[1]

    return void (await update($, paneNote, () => (forced ? `설정은 바꿨지만 환경 변수가 먼저임: ${forced}` : `묻기 방식을 바꿈 — 다음 메시지부터 ${askModeView(next).name}`)))
  }
  const command = `/scv:ask-mode ${next}`
  const filled = await fillPrompt($, command)
  await update($, paneNote, () => (filled ? `바로 바꾸지 못해 입력창에 넣음: ${command}` : `바꾸지 못함 — 입력창에 ${command} 를 넣어 보내 주세요`))
}

// Whether this project keeps the switch and its mark in its own settings file: it has one, and SCV's settings
// command is there to write it. Elsewhere they stay in the store, as before 0.6.2.
const lightInFile = (shot: Pick<Snapshot, 'core' | 'settingsText'>) => (shot.core ? lightFromSettings(shot.settingsText) : null)

// The switch and its mark follow the project's settings file each time the project is read — after a clear and
// in a new session too. Not while a write is out or when one began after this reading did (the file read is the
// older one). A project that keeps none, come to from one that did, takes the store's.
const syncLight = async ($: Api, was: Snapshot, next: Snapshot, gen: number) => {
  if (lightWrite.pending > 0 || lightWrite.gen !== gen) return
  const kept = lightInFile(next)
  if (kept) return void (await update($, light, one => (one.isOn === kept.isOn && one.percent === kept.percent ? one : kept)))
  if (!lightInFile(was)) return
  const stored = await $.store.get(LIGHT_KEY).catch(() => undefined)
  await update($, light, () => parseLight(stored))
}

// The auto-clear switch and its mark, changed and kept: in the project's settings file through SCV's own settings
// command (the writes go one after another, each with the value the pane shows by then, so presses in a row end
// with the last one in the file), or in the store where the project keeps no settings file.
const setLight = async ($: Api, change: (one: LightSettings) => LightSettings) => {
  const was = await read($, light)
  const next = await update($, light, change)
  const shot = await read($, snapshot)
  const core = shot.core
  if (!core || !lightInFile(shot)) return void (await $.store.set(LIGHT_KEY, next).catch(() => undefined))
  lightWrite.pending += 1
  lightWrite.gen += 1
  const job = lightWrite.tail.then(async () => {
    for (const argv of lightSaveArgv(core, was, await read($, light))) {
      const ran = await $.process.run(argv, { ...(shot.cwd ? { cwd: shot.cwd } : {}), timeoutMs: 15_000 }).catch(() => undefined)
      if (ran?.exitCode !== 0) return void (await update($, lightSaid, () => LIGHT_UNSAVED))
    }
  })
  lightWrite.tail = job.catch(() => undefined)
  await lightWrite.tail
  lightWrite.pending -= 1
}

// ── the word dictionary (after 0.5.0) ──────────────────────────────────────────────

const runWords = ($: Api, shot: Snapshot, argv: string[]) =>
  $.process.run(argv, { ...(shot.cwd ? { cwd: shot.cwd } : {}), timeoutMs: 15_000 }).catch(() => undefined)

// 저장: the entry goes in through SCV's own dictionary command, each typed text one word of the command (never a
// shell text), in the project folder; the card then says what the command said. An entry opened with 고치기 keeps
// its note, and when its avoided word was changed the old entry goes once the new one is in. Where SCV is not
// found or has no such command, the slash command goes into the prompt box instead. Whether the entry was saved.
const saveWord = async ($: Api, draft: WordDraft, was: string | null): Promise<boolean> => {
  const checked = checkWord(draft)
  if (!checked.isOk) {
    await update($, wordsNote, () => checked.reason)

    return false
  }
  const word = checked.word
  const shot = await read($, snapshot)
  const entries = parseWords(shot.wordsText)
  const note = entries.find(one => one.avoid === (was ?? word.avoid))?.note ?? ''
  const said = wordsSaid(shot.core ? await runWords($, shot, wordsAddArgv(shot.core, word, note)) : undefined)
  if (said.kind === 'none') {
    const command = wordsCommand(word)
    const filled = await fillPrompt($, command)
    await update($, wordsNote, () => (filled ? `바로 저장하지 못해 입력창에 넣음: ${command}` : `저장하지 못함 — 입력창에 ${command} 를 넣어 보내 주세요`))

    return false
  }
  if (said.kind === 'done' && shot.core && was && was !== word.avoid && entries.some(one => one.avoid === was)) {
    await runWords($, shot, wordsRemoveArgv(shot.core, was))
  }
  await refresh($).catch(() => undefined)
  await update($, wordsNote, () => said.line)

  return said.kind === 'done'
}

// 지우기, after its question: only an entry the dictionary holds, through SCV's own command; else the slash command.
const removeWord = async ($: Api, avoid: string) => {
  const shot = await read($, snapshot)
  if (!parseWords(shot.wordsText).some(one => one.avoid === avoid)) return void (await update($, wordsNote, () => `지우지 않음 — 사전에 없는 말: ${avoid}`))
  const said = wordsSaid(shot.core ? await runWords($, shot, wordsRemoveArgv(shot.core, avoid)) : undefined)
  if (said.kind === 'none') {
    const command = wordsRemoveCommand(avoid)
    const filled = await fillPrompt($, command)

    return void (await update($, wordsNote, () => (filled ? `바로 지우지 못해 입력창에 넣음: ${command}` : `지우지 못함 — 입력창에 ${command} 를 넣어 보내 주세요`)))
  }
  await refresh($).catch(() => undefined)
  await update($, wordsNote, () => said.line)
}

// Opens a file or page the way the system opens it (a picture viewer, the browser); the note says when it could not.
const openThing = async ($: Api, target: string) => {
  for (const opener of ['xdg-open', 'open']) {
    const opened = await $.process.run([opener, target]).catch(() => undefined)
    if (opened?.exitCode === 0) return void update($, note, () => null)
  }
  await update($, note, () => `열지 못했습니다: ${target}`)
}

// The last part of a running step's log, read each time the pane is drawn (a large file by its end alone).
const logTail = async ($: Api, full: string) => {
  const stat = await $.fs.stat(full).catch(() => undefined)
  if (!stat || stat.kind !== 'file') return null
  return stat.size <= WHOLE_READ_BYTES
    ? tailOf((await readText($, full)) ?? '')
    : ((await $.process.run(['tail', '-c', '4000', full]).catch(() => undefined))?.stdout ?? '')
}

// A picture sent as evidence, drawn when small enough; null leaves it to the open button.
const evidencePicture = async ($: Api, full: string, size: number, width?: number, height?: number) => {
  if (size > IMAGE_DRAW_BYTES) return null
  const bytes = (await $.fs.read(full, { as: 'bytes' }).catch(() => undefined)) as { base64?: string } | undefined

  return bytes?.base64 ? imageSvg(bytes.base64, full, width, height) : null
}

// What a step's writing made and called, kept with the step: functions under a marker are made; known functions (the
// dictionary's, and those the plan's other steps made) it names are used.
const noteFunctions = async ($: Api, slug: string, step: number, code: string) => {
  const marked = extractMarked(code)
  if (marked.length === 0 && !code.trim()) return
  const shot = await read($, snapshot)
  const made = marked.length > 0 ? marked : definedFromCatalog(code, shot.catalog ?? {})
  const log = await read($, stepFunctions)
  const earlier = Object.entries(log)
    .filter(([key]) => key.startsWith(`${slug}#`) && key !== `${slug}#${step}`)
    .flatMap(([, found]) => found.made.map(one => one.name))
  const known = [...Object.keys(shot.catalog ?? {}), ...earlier]
  const used = usedNames(code, known, made.map(one => one.name))
  if (made.length === 0 && used.length === 0) return
  const next = recordFunctions(log, `${slug}#${step}`, { made, used })
  await update($, stepFunctions, () => next)
  await $.store.set(functionsKey(shot.cwd), next).catch(() => undefined)
}

// What the file system says of each path a step sent: found, inside the project (where it really lands), last change.
const fileFacts = async ($: Api, cwd: string, paths: readonly string[]): Promise<FileFact[]> =>
  Promise.all(
    paths.map(async path => {
      const full = path.startsWith('/') ? path : `${cwd}/${path}`
      const stat = await $.fs.stat(full, { resolve: true }).catch(() => undefined)
      const root = (await $.fs.stat(cwd, { resolve: true }).catch(() => undefined))?.realPath ?? cwd
      const real = stat?.realPath ?? full
      const isInside = real === root || real.startsWith(`${root}/`)

      return { path, isFound: stat !== undefined && stat.kind === 'file', isInside, mtimeMs: stat?.mtimeMs ?? 0, size: stat?.size ?? 0 }
    }),
  )

// The mod's own tool is not among the tool names the types know, so its hooks match it by pattern.
const STEP_TOOL_NAME = new RegExp(`^${STEP_TOOL}$`)

const STEP_TOOL_SPEC = {
  name: 'scv_step',
  description:
    "Report a step of an SCV plan's Suggested path so the SCV pane shows real progress: state doing (started), done (finished) or blocked (cannot go on — give the reason in note). done needs proof a person can look at: evidence, project files this step made or changed that show the result — a picture (png, jpg, jpeg, gif, webp, svg), a video (mp4, webm, mov) or a page to open (html, pdf). Any other file (source code, text, settings, a script) is refused, and so is a file outside the project or older than the step's start. A step whose plan line names pure functions (— `fn`, `fn`) may be done with no file: that function list is its proof and stays in the pane. A step that names none must send a file. output (an excerpt of a command's output) is shown beside the proof but passes nothing by itself. doing takes background: true for work that runs behind the conversation, and may name log (a project file the running work writes) and url (a page that shows its progress) — the pane then says 진행 중(백그라운드), shows the log's last lines and a button for the page; a doing with log or url counts as background work too. Steps worked on at the same time are each reported doing; the answer names every step now in progress, those in the background apart. Changes no file.",
  inputSchema: {
    type: 'object',
    properties: {
      plan: { type: 'string', description: 'The plan folder name under scv/promote' },
      step: { type: 'integer', minimum: 1, description: "The step's number in the plan's Suggested path, starting at 1" },
      state: { type: 'string', enum: ['doing', 'done', 'blocked'] },
      note: { type: 'string', description: 'One line; the reason when state is blocked' },
      evidence: { type: 'array', items: { type: 'string' }, description: 'done: project files this step made or changed that a person can look at — picture, video, html or pdf — relative to the project or absolute; source code and text files are refused' },
      output: { type: 'string', description: "done: an excerpt of a command's output that shows the result (e.g. the test summary); shown, but not enough by itself" },
      background: { type: 'boolean', description: 'doing: true when the work runs behind the conversation (a background command, a long job); the pane says 진행 중(백그라운드)' },
      log: { type: 'string', description: 'doing: a project file the running work writes, read for its last lines and progress' },
      url: { type: 'string', description: 'doing: a page that shows the progress (opened by a button, never read)' },
    },
    required: ['plan', 'step', 'state'],
    additionalProperties: false,
  },
}

// One alert per event: the host's notification, else the system's own (the desktop app has no terminal to ring),
// then Claude's own notification tool, which reaches the phone while Remote Control is connected and skips itself
// when the person is at the screen, and a toast. A way that fails leaves the others to go.
const alert = async ($: Api, text: string) => {
  const line = buildAlertText([(await sayOf($))(text)])
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

// Takes a job off the board when its end is heard, and writes the line it leaves in 'recently finished'.
const endJob = async ($: Api, end: JobEnd | null) => {
  if (!end) return
  const board = await read($, jobs)
  const ended = findJob(board, end.id)
  await update($, jobs, value => applyJobEvent(value, { kind: 'end', id: end.id }))
  if (!ended) return
  const at = await $.clock.now()
  await update($, doneLog, list => applyDone(list, doneLine(ended, end.how, at)))
}

// An output file up to this size is read whole and cut; a larger one is read by its end alone.
const WHOLE_READ_BYTES = 256 * 1024
// When each job's output file last changed, as this copy of the module saw it: an unchanged file is not read again.
const outputSeen = new Map<string, number>()

// Reads the last line of each running job's output, when the file changed since it was last read.
const readJobTails = async ($: Api) => {
  if (await read($, mirror)) return
  for (const job of (await read($, jobs)).jobs) {
    if (!job.output) continue
    const stat = await $.fs.stat(job.output).catch(() => undefined)
    if (!stat || outputSeen.get(job.id) === stat.mtimeMs) continue
    outputSeen.set(job.id, stat.mtimeMs)
    const tail =
      stat.size <= WHOLE_READ_BYTES
        ? tailOf((await readText($, job.output)) ?? '')
        : ((await $.process.run(['tail', '-c', '4000', job.output]).catch(() => undefined))?.stdout ?? '')
    const progress = progressOf(tail)
    if (!progress.line) continue
    const at = await $.clock.now()
    await update($, jobs, board => applyJobEvent(board, { kind: 'progress', id: job.id, at, ...progress }))
  }
}

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
  // A viewer draws the same jobs; where an output file sits on this computer is not its business.
  jobs: await read($, jobs).then(board => ({ jobs: board.jobs.map(({ output: _output, ...job }) => job), extra: board.extra })),
  doneLog: await read($, doneLog),
  tasks: await read($, tasks),
  history: await read($, history),
  stepLog: await read($, stepLog),
  stepFunctions: await read($, stepFunctions),
  signals: await read($, signals),
  permit: await read($, permit),
  stopped: await read($, stopped),
  agents: await read($, agents),
  since: await read($, since),
  limits: await read($, limits),
  contextFill: await read($, contextFill),
  place: await read($, place),
  hostName: sessionName(await sessionFiles($), await $.session.id()),
  inView: (await planInView($))?.slug ?? null,
  // After 0.5.0: what a viewer needs to draw the controls it may press, and what came of a press. acts: the acts this
  // session takes. A run's output goes as the lines a card shows; what SCV said each gear needs goes without the
  // gear index it was read under (the snapshot has that text already).
  acts: MIRROR_ACTS,
  light: await read($, light),
  lightSaid: await read($, lightSaid),
  branchPick: await read($, branchPick),
  placeNote: await read($, placeNote),
  paneNote: await read($, paneNote),
  wordsNote: await read($, wordsNote),
  gearRuns: await read($, gearRuns).then(all => Object.fromEntries(Object.entries(all).map(([name, run]) => [name, { ...run, tail: wireTail(run.tail) }]))),
  gearForms: await read($, gearForms),
  gearOpen: await read($, gearOpen),
  gearAsks: await read($, gearAsks).then(async kept => (kept.index === ((await read($, snapshot)).gearsText ?? null) ? kept.byName : {})),
  gearRecent: await read($, gearRecent),
  gearLive: [...liveRuns.keys()],
})

// sentAt: the working session's clock when it sent; a version before it sends none.
type MirrorState = Awaited<ReturnType<typeof mirrorState>> & { sentAt?: number }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const textOrNull = (value: unknown) => (typeof value === 'string' ? value : null)

// What a working session that takes presses sends with its state, taken as it stands there: the switches and notes
// of its cards, its gear runs and the blocks open under its gears. A state without the mark (an older working
// session) changes none of these — and this viewer then shows no control to press.
const takeControls = async ($: Api, state: Partial<MirrorState>) => {
  const acts = typeof state.acts === 'number' ? state.acts : 0
  await update($, hostActs, () => acts)
  if (acts < MIRROR_ACTS_MIN) return
  await update($, light, () => parseLight(state.light))
  await update($, lightSaid, () => textOrNull(state.lightSaid))
  await update($, branchPick, () => (Array.isArray(state.branchPick) ? state.branchPick.filter((one): one is string => typeof one === 'string') : null))
  await update($, placeNote, () => textOrNull(state.placeNote))
  await update($, paneNote, () => textOrNull(state.paneNote))
  await update($, wordsNote, () => textOrNull(state.wordsNote))
  await update($, gearRuns, () => (isRecord(state.gearRuns) ? (state.gearRuns as Record<string, GearRun>) : {}))
  await update($, gearForms, () => (isRecord(state.gearForms) ? (state.gearForms as Record<string, GearForm>) : {}))
  await update($, gearAsks, () => ({ index: state.snapshot?.gearsText ?? null, byName: isRecord(state.gearAsks) ? (state.gearAsks as Record<string, string>) : {} }))
  await update($, gearRecent, () => (Array.isArray(state.gearRecent) ? state.gearRecent.filter((one): one is string => typeof one === 'string') : []))
  await update($, hostLive, () => (Array.isArray(state.gearLive) ? state.gearLive.filter((one): one is string => typeof one === 'string') : []))
  const open = textOrNull(state.gearOpen)
  if (hostGear.open !== open) {
    hostGear.open = open
    await update($, gearOpen, () => open)
  }
  // a block that is gone there (run, answered, closed) takes the values picked for it here with it
  const blocks = await read($, gearForms)
  await update($, viewPicks, picks => (Object.keys(picks).every(name => blocks[name]?.kind === 'values') ? picks : Object.fromEntries(Object.entries(picks).filter(([name]) => blocks[name]?.kind === 'values'))))
}

// A viewer session lets go of what it drew of a working session's cards: before another session's state is asked
// for, and when the mirror is switched off (then its own switch and gear list come back from its store).
const dropControls = async ($: Api, isOwnAgain: boolean) => {
  hostGear.open = undefined
  await update($, hostActs, () => 0)
  await update($, hostLive, () => [])
  await update($, viewPicks, () => ({}))
  await update($, actNote, () => null)
  await update($, gearRuns, () => ({}))
  await update($, gearForms, () => ({}))
  await update($, gearOpen, () => null)
  await update($, gearAsks, () => ({ index: null, byName: {} }))
  await update($, branchPick, () => null)
  await update($, placeNote, () => null)
  await update($, paneNote, () => null)
  await update($, wordsNote, () => null)
  await update($, lightSaid, () => null)
  await update($, wordsView, () => NO_WORDS_VIEW)
  clearWordsTyped()
  typedValues.clear()
  if (!isOwnAgain) return
  const keptLight = await $.store.get(LIGHT_KEY).catch(() => undefined)
  const inFile = lightInFile(await read($, snapshot))
  await update($, light, () => inFile ?? parseLight(keptLight))
}

// Takes a state another session sent, while this session is mirroring; anything else is dropped.
// A state sent before the newest one taken (one held up on the way) is dropped too, so it cannot draw an older plan.
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
  const sentAt = typeof state.sentAt === 'number' ? state.sentAt : undefined
  if (sentAt !== undefined && mirrored.hostAt !== undefined && sentAt < mirrored.hostAt) return
  await update($, snapshot, () => state.snapshot)
  await update($, runs, () => state.runs ?? [])
  await update($, waiting, () => state.waiting ?? null)
  await update($, live, () => state.live ?? { isWorking: false, turnStartedAt: 0, tool: null })
  await update($, jobs, () => (Array.isArray(state.jobs?.jobs) ? { jobs: state.jobs.jobs, extra: Number(state.jobs.extra) || 0 } : { jobs: [], extra: 0 }))
  await update($, doneLog, () => (Array.isArray(state.doneLog) ? state.doneLog : []))
  await update($, tasks, () => state.tasks ?? [])
  await update($, history, () => state.history ?? [])
  await update($, stepLog, () => state.stepLog ?? {})
  await update($, stepFunctions, () => state.stepFunctions ?? {})
  await update($, signals, () => state.signals ?? [])
  await update($, permit, () => state.permit ?? null)
  await update($, stopped, () => state.stopped ?? null)
  await update($, agents, () => state.agents ?? [])
  await update($, since, () => state.since ?? null)
  await update($, limits, () => state.limits ?? [])
  await update($, contextFill, () => (typeof state.contextFill === 'number' ? state.contextFill : null))
  await update($, place, () => (state.place && typeof state.place === 'object' ? state.place : NO_PLACE))
  await update($, hostInView, () => (typeof state.inView === 'string' ? state.inView : null))
  await takeControls($, state)
  // the answer to a press sent from here has come (or a newer state has): the line that waited for it goes
  await update($, actNote, () => null)
  const at = await $.clock.now()
  const name = typeof state.hostName === 'string' ? state.hostName : (mirrored.name ?? null)
  if (mirrored.at === 0) $.ui.toast((await sayOf($))(`SCV: ${hostLabel(mirrored.host, name)} 의 상태를 받았습니다`))
  await update($, mirror, value => (value ? { ...value, at, name, ...(sentAt !== undefined ? { hostAt: sentAt } : {}) } : value))
}

// One pass: the state to each viewer when it changed and the gap passed (isMirrorDue); a viewer that keeps failing
// is let go. answerTo: a viewer whose press was just done here — it is sent the state now, changed or not and
// whatever the gap, so its pane shows what came of the press.
const pushPass = async ($: Api, answerTo?: string) => {
  const state = await mirrorState($)
  const body = JSON.stringify(state)
  const at = await $.clock.now()
  // The send time rides along but is not compared, so an unchanged state is still not sent again.
  const wire = JSON.stringify({ ...state, sentAt: at })
  for (const [address, last] of Object.entries(await read($, viewers))) {
    if (address !== answerTo && !isMirrorDue(last, body, at, MIRROR_GAP_MS)) continue
    const sent = await $.session
      .send({ to: { sessionId: address }, text: mirrorText({ kind: 'state', body: wire }) })
      .catch((error: unknown) => ({ isDelivered: false as const, reason: String(error) }))
    await update($, viewers, value => {
      const { [address]: current, ...rest } = value
      if (!current) return value
      if (sent.isDelivered) return { ...rest, [address]: { sent: body, at, misses: 0 } }

      return current.misses + 1 >= MIRROR_MISSES ? rest : { ...rest, [address]: { ...current, misses: current.misses + 1 } }
    })
  }
}

// Sends the state to the viewers, one pass at a time: a call made while a pass runs waits for it and then makes its
// own, so a viewer that just asked (or just pressed) is never left out because the timer's pass was under way.
// While a pass already waits its turn, a call that carries no answer adds none — that pass sends what is due.
// The viewers live in the session's state, so a reload of the mod keeps sending to them.
let pushChain: Promise<unknown> = Promise.resolve()
let pushesWaiting = 0

const pushMirror = ($: Api, answerTo?: string): Promise<void> => {
  if (pushesWaiting > 0 && !answerTo) return pushChain.then(() => undefined)
  pushesWaiting += 1
  const pass = pushChain.then(async () => {
    pushesWaiting -= 1
    if (Object.keys(await read($, viewers)).length > 0) await pushPass($, answerTo)
  })
  pushChain = pass.catch(() => undefined)

  return pass
}

// What a viewer pressed, done on this side with the functions this session's own buttons call. Every name is one
// this session lists itself (a gear of its index, a branch of its repository, an entry of its dictionary); a value
// only ever becomes a value — the value part of one command word, a field after its flag, or standard input.
const doAct = async ($: Api, act: Exclude<MirrorAct, { do: 'fill' }>) => {
  const shot = await read($, snapshot)
  const isListed = (name: string) => parseGears(shot.gearsText).some(one => one.name === name)
  switch (act.do) {
    case 'askMode':
      return parseAskMode(shot.settingsText) === act.to ? undefined : switchAskMode($, act.to)
    case 'lightSwitch':
      return setLight($, one => ({ ...one, isOn: act.isOn }))
    case 'lightMark':
      return setLight($, one => moveLight(one, act.percent))
    case 'gearPress':
      return isListed(act.name) ? pressRun($, act.name, act.canType) : undefined
    case 'gearSubmit':
      return isListed(act.name) ? submitValues($, act.name, { values: act.values, input: act.input }) : undefined
    case 'gearConfirm':
      return isListed(act.name) ? answerConfirm($, act.name, act.isYes) : undefined
    case 'gearStop':
      return isListed(act.name) ? stopGear($, act.name) : undefined
    case 'branchList':
      return Boolean(await read($, branchPick)) === act.isOpen ? undefined : openBranches($)
    case 'branchPick': {
      const names = (await read($, branchPick)) ?? (await listBranches($))
      if (!names.includes(act.to)) return void (await update($, placeNote, () => `브랜치를 바꾸지 않음 — 이 저장소에 없는 이름: ${act.to}`))

      return switchBranch($, act.to)
    }
    case 'wordsSave':
      return void (await saveWord($, { avoid: act.avoid, use: act.use, forms: act.forms }, act.was))
    case 'wordsRemove':
      return removeWord($, act.avoid)
    case 'lang':
      return setLang($, act.to)
  }
}

// Does what a viewer pressed, on this side: only for a viewer this session sends to. For the next command the
// message names the plan, never the command — this session works the command out for that plan itself. Any other
// act is done by doAct, noted in this session's own pane, and answered at once with the state as it then stands.
// A session that itself mirrors another draws that session's cards, so nothing there is its own to change.
const takeAct = async ($: Api, address: string, act: MirrorAct) => {
  if (!(address in (await read($, viewers)))) return
  if (act.do === 'fill') {
    const command = (await actionInView($, act.slug))?.command
    if (!command) return
    const isFilled = await fillPrompt($, command)

    return void (await update($, note, () => (isFilled ? `입력창에 넣음 (거울에서): ${command}` : `입력창에 못 넣음 — ${command}`)))
  }
  if (await read($, mirror)) return
  await doAct($, act).catch(() => undefined)
  const at = await $.clock.now()
  await update($, fromMirror, () => fromMirrorLine(act, at, offsetAt(at)))
  await pushMirror($, address)
}

// Asks the working session to send its state here; `previous` is the mirror as it stood, for a failed ask to put back.
// A fresh ask (the person typed /scv-mirror) starts over: what was drawn before is not shown as the host's state.
const askMirror = async ($: Api, host: string, isFresh = false) => {
  const own = await ownAddress($)
  const previous = await read($, mirror)
  const at = await $.clock.now()
  const isSame = !isFresh && previous?.host === host
  // A pick made for another session's plans, or an earlier one, would hide the plan the host is working in.
  if (!isSame) {
    await update($, chosen, () => null)
    await update($, hostInView, () => null)
    await dropControls($, false)
  }
  await update($, mirror, value => (isSame && value ? { ...value, askedAt: at, from: own.address } : { host, at: 0, askedAt: at, from: own.address }))
  const sent = await $.session.send({ to: { sessionId: host }, text: mirrorText({ kind: 'hello', address: own.address }) })

  return { own, sent, previous }
}

// Sent from a Remote Control viewer, the answer is the only part that reaches it, so it says how to see the pane there.
// A closed pane stays closed until one of these two commands opens it.
const openByCommand = async ($: Api) => {
  const { isPlaced } = await openPane($)
  const own = await ownAddress($)
  const reach = own.isRemote ? '' : ' (Remote Control이 꺼져 있어 이 컴퓨터 안에서만 닿습니다)'

  return {
    text: `SCV dashboard ${isPlaced ? 'is open' : 'is not drawn here'}. 이 세션을 다른 기기 앱에서 보려면, 그 기기에서 연 다른 세션에서: /scv-mirror ${own.address}${reach}`,
  }
}

// ── a gear run from the pane, with no model (0.4.0) ──────────────────────────

// What the person typed into a gear's fields, by gear then by field (an argument's name, or DATA_FIELD for the data
// that goes in on standard input). Kept outside the drawn state, so a keystroke redraws nothing.
const DATA_FIELD = '<data>'
const typedValues = new Map<string, Record<string, string>>()
const noteTyped = (name: string, field: string, value: string) => void typedValues.set(name, { ...typedValues.get(name), [field]: value })

// A run under way, as this copy of the module holds it: how to end it (ending the stream ends the child), what it
// wrote so far (out: standard output alone; all: with its error lines), and what of it was last copied to the drawn state.
// SCV hands a step's output on only when the step ends, so while a step runs its last line is read from the run's
// own state folder (dir; found as the folder that was not there before the start: before), an unchanged file not
// read again (fileAt: when the file read last had changed; fileTail: its end).
type LiveRun = {
  end: (() => void) | null
  out: string
  all: string
  isStopped: boolean
  flushedAt: number
  flushedLine: string
  before: string[]
  dir: string | null
  fileAt: number
  fileTail: string
}
const liveRuns = new Map<string, LiveRun>()
const KEEP_CHARS = 64 * 1024
// Where SCV keeps a run's state while it runs: a folder per run, the running step's output in `next` and `err`.
const gearStateDir = (cwd: string) => `${cwd ? `${cwd}/` : ''}scv/journal/.gear-run`

type GearFrom = 'card' | 'band'
// One run to start or go on with. first: the command to start (null when it goes on from a stop). wait: the stopped
// step the person just said yes to. teeth: the steps named in the text that yes was given on.
type GearGo = { name: string; from: GearFrom; startedAt: number; first: { argv: string[]; input: string } | null; wait: GearWait | null; teeth: string[] }

const closeForm = ($: Api, name: string) => update($, gearForms, ({ [name]: _closed, ...rest }) => rest)
const openForm = ($: Api, name: string, form: GearForm) => update($, gearForms, all => ({ ...all, [name]: form }))

// What a gear needs set, read once through SCV's own `ask` and kept while the gear index reads the same.
const readGearAsk = async ($: Api, shot: Snapshot, name: string) => {
  if (!shot.core || !isGearName(name)) return null
  const index = shot.gearsText ?? null
  const kept = await read($, gearAsks)
  const known = kept.index === index ? kept.byName[name] : undefined
  if (known !== undefined) return parseAsk(known)
  const ran = await $.process
    .run(['bash', `${shot.core}/scripts/gear.sh`, 'ask', name], { ...(shot.cwd ? { cwd: shot.cwd } : {}), timeoutMs: 15_000 })
    .catch(() => undefined)
  // the command could not be started (or did not end in time): nothing is kept, the next press tries again
  if (!ran) return null
  const asked = ran.exitCode === 0 ? parseAsk(ran.stdout) : null
  const isRead = asked !== null && asked.name === name
  // an answer that is not the gear's values (an older SCV has no `ask`) is kept as empty: the gear's line then
  // offers the conversation instead of a run
  await update($, gearAsks, value => ({ index, byName: { ...(value.index === index ? value.byName : {}), [name]: isRead ? ran.stdout : '' } }))

  return isRead ? asked : null
}

// Copies a run's last line into the drawn state: when it changed, and a second apart at most (the refresh timer
// brings the rest), so a command that writes fast does not redraw the pane for every piece.
const flushRun = async ($: Api, name: string, liveRun: LiveRun) => {
  const tail = liveRun.all.trim() ? tailOf(liveRun.all) : liveRun.fileTail
  const line = progressOf(tail).line
  if (line === liveRun.flushedLine) return
  const at = await $.clock.now()
  if (liveRun.flushedAt !== 0 && at - liveRun.flushedAt < 1000) return
  liveRun.flushedLine = line
  liveRun.flushedAt = at
  await update($, gearRuns, all => {
    const run = all[name]

    return run && run.exitCode === null && !run.isStopped ? { ...all, [name]: { ...run, tail } } : all
  })
}

// The end of the running step's output, from the run's state folder: the one of its two files (output, errors) that
// changed last. The folder is the one that appeared after the start (when SCV wrote the gear's name in it, that
// name must be this gear's). Read only when the file changed since the last look, and a large one by its end alone.
const readRunFile = async ($: Api, name: string, liveRun: LiveRun) => {
  const state = gearStateDir((await read($, snapshot)).cwd)
  if (!liveRun.dir) {
    const fresh = (await $.fs.list(state).catch(() => []))
      .filter(one => one.kind === 'dir' && !liveRun.before.includes(one.name))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const one of fresh) {
      const owner = await readText($, `${state}/${one.name}/name`)
      if (owner !== null && owner.trim() !== name) continue
      liveRun.dir = `${state}/${one.name}`
      break
    }
  }
  if (!liveRun.dir) return
  const files = await Promise.all(['next', 'err'].map(async file => ({ full: `${liveRun.dir}/${file}`, stat: await $.fs.stat(`${liveRun.dir}/${file}`).catch(() => undefined) })))
  const newest = files.filter(one => one.stat?.kind === 'file' && one.stat.size > 0).sort((a, b) => (b.stat?.mtimeMs ?? 0) - (a.stat?.mtimeMs ?? 0))[0]
  if (!newest?.stat || newest.stat.mtimeMs === liveRun.fileAt) return
  liveRun.fileAt = newest.stat.mtimeMs
  liveRun.fileTail =
    newest.stat.size <= WHOLE_READ_BYTES
      ? tailOf((await readText($, newest.full)) ?? '')
      : ((await $.process.run(['tail', '-c', '4000', newest.full]).catch(() => undefined))?.stdout ?? '')
}

// Each refresh: the runs under way are looked at again — the running step's last line, then the drawn state.
const flushRuns = async ($: Api) => {
  for (const [name, liveRun] of liveRuns) {
    if (liveRun.isStopped) continue
    await readRunFile($, name, liveRun).catch(() => undefined)
    await flushRun($, name, liveRun)
  }
}

// Runs one command of a gear run to its end: its exit code and what it wrote. The child lives as long as this loop
// reads it — a stop ends the stream, which ends the child, and the fixed launcher takes down what the child started;
// the module unloading (the session's end) ends it the same way. What the person typed is in `input` or is the
// value part of one word of `argv`, never anything else.
const runToEnd = async ($: Api, name: string, liveRun: LiveRun, argv: readonly string[], input: string, cwd: string | undefined, dir: string | null) => {
  liveRun.out = ''
  liveRun.all = ''
  liveRun.fileTail = ''
  liveRun.fileAt = 0
  liveRun.dir = dir
  liveRun.before = dir ? [] : (await $.fs.list(gearStateDir(cwd ?? '')).catch(() => [])).map(one => one.name)
  if (liveRun.isStopped) return { code: null, out: '', all: '' }
  try {
    const stream = $.process.spawn({ argv: gearLaunchArgv(argv), ...(cwd ? { cwd } : {}), input })
    liveRun.end = () => void Promise.resolve(stream.return({ code: null, signal: 'SIGTERM' })).catch(() => undefined)
    let step = await stream.next()
    while (!step.done && !liveRun.isStopped) {
      const piece = step.value
      if (piece.stream === 'stdout') liveRun.out = `${liveRun.out}${piece.text}`.slice(-KEEP_CHARS)
      liveRun.all = `${liveRun.all}${piece.text}`.slice(-KEEP_CHARS)
      await flushRun($, name, liveRun)
      step = await stream.next()
    }

    return { code: step.done ? step.value.code : null, out: liveRun.out, all: liveRun.all }
  } catch (error) {
    return { code: 1, out: liveRun.out, all: `${liveRun.all}\n시작하지 못했거나 끊김 — ${String(error)}` }
  } finally {
    liveRun.end = null
  }
}

// A run's end: its result stays on the gear's card. A long run is announced once; a short one started from the band
// above the prompt box (the pane may be out of sight) says so in a toast.
const endRun = async ($: Api, go: GearGo, how: { code: number; tail: string }) => {
  const at = await $.clock.now()
  await update($, gearRuns, all => ({ ...all, [go.name]: { startedAt: go.startedAt, endedAt: at, tail: tailOf(how.tail), exitCode: how.code, isStopped: false } }))
  const took = at - go.startedAt
  const gear = parseGears((await read($, snapshot)).gearsText).find(one => one.name === go.name)
  const said = buildAlertText([
    `기어 ${how.code === 0 ? '끝남' : `실패(종료 코드 ${how.code})`} — ${cutLine(gear?.does || go.name, 34)}`,
    took >= 1000 ? formatDuration(took) : null,
  ])
  if (took >= GEAR_RUN_MS) return alert($, said)
  if (go.from === 'band') await Promise.resolve($.ui.toast((await sayOf($))(`SCV: ${said}`))).catch(() => undefined)
}

// A run that stands before a step the person has not said yes to: the card asks, with that step's own lines.
const waitAt = async ($: Api, go: GearGo, stop: ConfirmStop) => {
  const at = await $.clock.now()
  await update($, gearRuns, all => ({ ...all, [go.name]: { startedAt: go.startedAt, endedAt: at, tail: '', exitCode: 11, isStopped: false } }))
  await openForm($, go.name, {
    kind: 'confirm',
    from: go.from,
    picked: {},
    input: '',
    lines: stopLines(stop),
    teeth: [stop.tooth],
    wait: { token: stop.token, step: stop.step },
    startedAt: go.startedAt,
  })
}

// Follows a gear run to its end. A run that stops before a step that reaches outside (exit code 11) goes on only
// with the person's go-ahead for that step: the press just made counts once, and only when the text it was made on
// named the step (teeth) — then SCV's own confirm command writes the answer down and resume runs the step. For any
// other stop the card asks again. No other way leads past such a step.
const driveGear = async ($: Api, go: GearGo, liveRun: LiveRun) => {
  const shot = await read($, snapshot)
  const core = shot.core
  if (!core) return
  const cwd = shot.cwd || undefined
  await update($, gearRuns, all => ({ ...all, [go.name]: { startedAt: go.startedAt, endedAt: null, tail: '', exitCode: null, isStopped: false } }))
  await closeForm($, go.name)
  let next = go.first
  let said = go.wait
  let teeth = go.teeth
  // a run that goes on from a stop keeps its state folder, named by its token
  let dir: string | null = null
  for (;;) {
    if (said) {
      const confirm = gearConfirmArgv(core, said.token, said.step, true)
      const wrote = confirm ? await $.process.run(confirm, { ...(cwd ? { cwd } : {}), timeoutMs: 15_000 }).catch(() => undefined) : undefined
      const resume = gearResumeArgv(core, said.token)
      if (!resume || !wrote?.stdout.includes(`GEAR_CONFIRMED: ${said.token}:${said.step}`)) {
        return endRun($, go, { code: 1, tail: '확인을 적지 못해 밖으로 나가는 단계를 돌리지 않음' })
      }
      next = { argv: resume, input: '' }
      dir = `${gearStateDir(cwd ?? '')}/${said.token}`
      said = null
    }
    if (!next) return
    const ended = await runToEnd($, go.name, liveRun, next.argv, next.input, cwd, dir)
    if (liveRun.isStopped) return
    const halted = ended.code === 11 ? confirmStop(ended.out) : null
    if (!halted) return endRun($, go, { code: ended.code ?? 1, tail: ended.code === 0 ? ended.out : ended.all })
    if (!teeth.includes(halted.tooth)) return waitAt($, go, halted)
    teeth = []
    said = { token: halted.token, step: halted.step }
  }
}

// Starts a run (or goes on with a stopped one) and leaves it running: the press that started it returns at once.
const beginRun = async ($: Api, go: Omit<GearGo, 'startedAt'> & { startedAt?: number }) => {
  const liveRun: LiveRun = { end: null, out: '', all: '', isStopped: false, flushedAt: 0, flushedLine: '', before: [], dir: null, fileAt: 0, fileTail: '' }
  liveRuns.set(go.name, liveRun)
  typedValues.delete(go.name)
  const startedAt = go.startedAt ?? (await $.clock.now())
  await noteGearUse($, go.name)
  await update($, gearOpen, () => go.name)
  void driveGear($, { ...go, startedAt }, liveRun)
    .catch(() => undefined)
    .finally(() => {
      if (liveRuns.get(go.name) === liveRun) liveRuns.delete(go.name)
    })
}

// The person's stop: the card says so at once, and the stream's end takes the child (and what it started) down.
const stopGear = async ($: Api, name: string) => {
  const liveRun = liveRuns.get(name)
  if (!liveRun || liveRun.isStopped) return
  liveRun.isStopped = true
  liveRun.end?.()
  liveRuns.delete(name)
  const at = await $.clock.now()
  await update($, gearRuns, all => {
    const run = all[name]

    return run ? { ...all, [name]: { ...run, endedAt: at, tail: liveRun.all.trim() ? tailOf(liveRun.all) : liveRun.fileTail, isStopped: true } } : all
  })
}

// The question before a gear that reaches outside is started: which of its steps go out, and with which values.
const openConfirm = async ($: Api, shot: Snapshot, name: string, from: GearFrom, picked: Record<string, string>, input: string) => {
  const steps = outwardSteps(await readText($, `${shot.cwd ? `${shot.cwd}/` : ''}scv/gears/${name}/GEAR.md`), shot.gearsText)
  const asked = await readGearAsk($, shot, name)
  const words = (shot.core ? gearRunArgv(shot.core, name, picked, asked?.args ?? []) : null)?.slice(4) ?? []
  const startedAt = await $.clock.now()
  await openForm($, name, { kind: 'confirm', from, picked, input, lines: confirmLines(steps, words), teeth: steps.map(step => step.name), wait: null, startedAt })
  await update($, gearOpen, () => name)
}

// A press on a gear's run button, or on 사용함 above the prompt box: what it leads to (runPlan), with the first step
// done — the gear started here, its values block opened, or its question opened. 'chat' is the caller's to hand on.
const pressGear = async ($: Api, name: string, from: GearFrom, canType: boolean): Promise<RunPlan> => {
  const shot = await read($, snapshot)
  const gear = parseGears(shot.gearsText).find(one => one.name === name)
  if (!gear || !shot.core || !isGearName(name) || (await read($, mirror))) return 'chat'
  if (liveRuns.has(name)) return 'run'
  // a gear with a judgment step is Claude's to run: nothing is read or started for it here
  if (gear.mark === 'judge') return 'chat'
  const asked = await readGearAsk($, shot, name)
  if (!asked) return 'chat'
  const plan = runPlan({ mark: gear.mark, args: asked.args, hasInput: asked.hasInput, chosen: null, canType })
  if (plan === 'chat') return plan
  await update($, paneNote, () => null)
  // used: it moves to the front of the list, so its line (and the block opened under it) is among those shown
  await noteGearUse($, name)
  if (plan === 'run') {
    const argv = gearRunArgv(shot.core, name)
    if (argv) await beginRun($, { name, from, first: { argv, input: '' }, wait: null, teeth: [] })
  } else if (plan === 'confirm') {
    await openConfirm($, shot, name, from, {}, '')
  } else {
    typedValues.delete(name)
    const picked = Object.fromEntries(asked.args.flatMap(arg => (arg.isOpen && argChoices(arg.desc, arg.value).kind === 'buttons' ? [[arg.name, arg.value]] : [])))
    await openForm($, name, { kind: 'values', from, picked })
    await update($, gearOpen, () => name)
  }

  return plan
}

// 이 값으로 실행: the values as set — a button's pick, what was typed, else the value as it stood — then the run, or
// first the question when the gear reaches outside.
const submitValues = async ($: Api, name: string, given?: { values: Record<string, string>; input: string }) => {
  const form = (await read($, gearForms))[name]
  const shot = await read($, snapshot)
  const gear = parseGears(shot.gearsText).find(one => one.name === name)
  const asked = await readGearAsk($, shot, name)
  if (!form || form.kind !== 'values' || !gear || !asked || !shot.core || liveRuns.has(name)) return
  // given: the values set in a viewer session's pane (picked and typed there), sent with its press
  const typed = given ? given.values : (typedValues.get(name) ?? {})
  const chosen = Object.fromEntries(asked.args.filter(arg => arg.isOpen).map(arg => [arg.name, typed[arg.name] ?? form.picked[arg.name] ?? arg.value]))
  const input = asked.hasInput ? (given ? given.input : (typed[DATA_FIELD] ?? '')) : ''
  const plan = runPlan({ mark: gear.mark, args: asked.args, hasInput: asked.hasInput, chosen, canType: true })
  if (plan === 'confirm') return openConfirm($, shot, name, form.from, chosen, input)
  const argv = plan === 'run' ? gearRunArgv(shot.core, name, chosen, asked.args) : null
  if (argv) await beginRun($, { name, from: form.from, first: { argv, input }, wait: null, teeth: [] })
}

// The answer to a gear's question. 실행: the run starts (or goes on from the step it waits at) — the go-ahead is
// then written down through SCV's own confirm command when the run reaches that step. 취소: nothing runs; a run
// that was waiting has the refusal written down the same way.
const answerConfirm = async ($: Api, name: string, isYes: boolean) => {
  const form = (await read($, gearForms))[name]
  const shot = await read($, snapshot)
  if (!form || form.kind !== 'confirm' || !shot.core || liveRuns.has(name)) return
  await closeForm($, name)
  if (!isYes) {
    const refuse = form.wait ? gearConfirmArgv(shot.core, form.wait.token, form.wait.step, false) : null
    if (refuse) await $.process.run(refuse, { ...(shot.cwd ? { cwd: shot.cwd } : {}), timeoutMs: 15_000 }).catch(() => undefined)

    return void (await update($, paneNote, () => (form.wait ? '실행하지 않음 — 밖으로 나가는 단계는 돌지 않았습니다' : '실행하지 않음 — 아무것도 돌지 않았습니다')))
  }
  if (form.wait) return beginRun($, { name, from: form.from, startedAt: form.startedAt, first: null, wait: form.wait, teeth: [] })
  const asked = await readGearAsk($, shot, name)
  const argv = gearRunArgv(shot.core, name, form.picked, asked?.args ?? [])
  if (argv) await beginRun($, { name, from: form.from, first: { argv, input: form.input }, wait: null, teeth: form.teeth })
}

// Hands a gear to the conversation. From the band, what the person typed goes now with the gear's line at its end
// (what a press on 사용함 did before 0.4.0); from the card, the gear's command goes into the prompt box, unsent —
// sent, Claude asks for the values the gear needs and runs it.
const handToChat = async ($: Api, name: string, from: GearFrom) => {
  await closeForm($, name)
  typedValues.delete(name)
  const gear = parseGears((await read($, snapshot)).gearsText).find(one => one.name === name)
  const box = from === 'band' ? await $.prompt.read().catch(() => ({ text: '', cursor: 0 })) : { text: '', cursor: 0 }
  if (gear && box.text.trim() !== '') {
    await noteGearUse($, name)
    await $.prompt.fill({ text: '', mode: 'replace' }).catch(() => undefined)
    await $.prompt.submit({ text: submitWithGear(box.text, gear, false), asUser: true }).catch(() => undefined)

    return
  }
  const command = gearCommand(name)
  if (!command) return
  await noteGearUse($, name)
  const filled = await fillPrompt($, command)
  await update($, paneNote, () => (filled ? `입력창에 넣음: ${command} — 보내면 필요한 값을 물어봄` : `입력창에 못 넣음 — ${command}`))
}

// Whether a run the state holds as under way really is: this copy of the module must hold its stream (a module
// loaded again ended the child, and the state it left still says 'running').
// (isHeld: whether the stream is held — this copy's own, or, in a viewer session, as the working session says.)
const isLiveRun = (name: string, run: GearRun | undefined, isHeld = liveRuns.has(name)) => run !== undefined && run.exitCode === null && !run.isStopped && isHeld

// The lines a gear's card shows for its run; for one under way the time runs to the pane's clock.
const runLines = (name: string, run: GearRun, at: number, isHeld = liveRuns.has(name)) =>
  run.exitCode === null && !run.isStopped && !isHeld
    ? ['끊김 — 창이 다시 불리면서 이 실행도 끝났습니다']
    : runView({ tail: run.tail, elapsedMs: Math.max(0, (run.endedAt ?? at) - run.startedAt), exitCode: run.exitCode, isStopped: run.isStopped })

// 실행, on the gear's own line: the pane runs the gear itself, with no model — at once, or after its values or
// its question, which open under the line. A gear already running, or with such a block open, is shown
// instead of started again; one that turns out to be Claude's to run goes into the prompt box.
const pressRun = async ($: Api, name: string, canType: boolean) => {
  if (liveRuns.has(name) || (await read($, gearForms))[name]) return void (await update($, gearOpen, () => name))
  if ((await pressGear($, name, 'card', canType)) === 'chat') await handToChat($, name, 'card')
}

// 결과를 대화에 붙이기: a run's result lines into the prompt box, after what the person typed. Never sent.
const pasteResult = async ($: Api, name: string) => {
  const run = (await read($, gearRuns))[name]
  if (!run) return
  const text = gearPaste(name, runLines(name, run, run.endedAt ?? run.startedAt))
  const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
  const filled = await $.prompt.fill(box.text.trim() === '' ? { text, mode: 'replace' } : { text: `\n\n${text}`, mode: 'append' }).catch(() => ({ isFilled: false }))
  await update($, paneNote, () => (filled.isFilled ? '결과를 입력창에 넣음 — 보내지는 않았습니다' : '결과를 입력창에 넣지 못했습니다'))
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
    await $.command.register({ name: 'scv-panel', description: 'Open the SCV dashboard pane' })
    await $.command.register({ name: TALK_COMMAND, description: 'Show the last exchanges from before the conversation was cleared' })
    await $.command.register({ name: 'scv-mirror', description: "Draw another session's SCV pane here: /scv-mirror <address>, or /scv-mirror stop", argumentHint: '<address> | stop' })
    await $.tool.register(STEP_TOOL_SPEC).catch(() => undefined)
    const more = await $.store.get(MORE_KEY).catch(() => undefined)
    await update($, expanded, value => ({ ...value, more: more === true }))
    const keptLight = await $.store.get(LIGHT_KEY).catch(() => undefined)
    await update($, light, () => parseLight(keptLight))
    const lately = await $.store.get(recentKey(project)).catch(() => undefined)
    if (Array.isArray(lately)) await update($, gearRecent, () => lately.filter((one): one is string => typeof one === 'string'))
    await refresh($)
    // A gear index written before core 0.102.0 has no mark on its gear lines ('-'): have SCV write it again, once.
    const first = await read($, snapshot)
    if (first.core && parseGears(first.gearsText).some(gear => gear.mark === '-')) {
      await $.process.run(['bash', `${first.core}/scripts/gear.sh`, 'index'], { ...(first.cwd ? { cwd: first.cwd } : {}), timeoutMs: 15_000 }).catch(() => undefined)
      await refresh($)
    }
    $.clock.every(REFRESH_MS, () => void refresh($).then(() => readJobTails($)).then(() => flushRuns($)).then(() => pushMirror($)).catch(() => undefined))
    void openPane($).catch(() => undefined)

    return started
  })

  // The session ends: a gear still running from the pane is stopped (the module's unloading ends it too). The clear
  // this mod asked for is no such end — the process goes on under another id, and the gear with it.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' && lightRun.isClearing) {
      lightRun.isCleared = true

      return next(e)
    }
    if (e.reason === 'clear') await update($, talks, () => [])
    for (const name of [...liveRuns.keys()]) await stopGear($, name).catch(() => undefined)

    return next(e)
  })

  // The conversation after a clear this mod asked for: the pane says it was cleared, and the work the turns left
  // running is handed to the model as context beside what SCV's own hook carries (the record's end) — as context, so
  // no turn starts by itself. A clear the person typed kept nothing in the store, and nothing is added to it.
  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    const brief = e.source === 'clear' ? await afterClear($).catch(() => null) : null

    return brief ? { ...started, additionalContext: [...(started.additionalContext ?? []), brief] } : started
  })

  on('prompt.submit', async ($, e, next) => {
    // A viewer session only draws the working session's pane; what the person types here would reach another Claude
    // that knows nothing of the work, so it is stopped. Slash commands (/scv-mirror stop) still run.
    const kind = (e as { origin?: { kind?: string } }).origin?.kind
    const mirrored = await read($, mirror)
    if (mirrored && !e.command && !e.isMeta && (kind === 'composer' || kind === 'bridge')) {
      return { drop: `이 세션은 ${mirrored.host} 의 SCV 칸만 보여 주는 거울입니다 — 대화는 작업 세션 창에서 하세요. 이 세션을 다시 쓰려면 /scv-mirror stop` }
    }
    // A gear that fits what the person typed, and whose line was drawn above the prompt box and not turned down:
    // the text goes on with one line at its end naming that gear. Anything else goes on as it is.
    let sending = e
    if (!mirrored && !e.command && !e.isMeta && kind === 'composer') {
      const fit = gearMatch(e.text, parseGears((await read($, snapshot)).gearsText))
      const refused = await read($, gearDismissed)
      if (fit && drawnHint.name === fit.gear.name && refused !== fit.gear.name) {
        sending = { ...e, text: submitWithGear(e.text, fit.gear, false) }
        await noteGearUse($, fit.gear.name)
      }
      drawnHint.name = null
      await update($, gearHint, () => null)
      await update($, gearDismissed, () => null)
    }
    const submitted = await next(sending)
    // A background task's notice delivered into a running turn starts no turn of its own, so its end is taken here;
    // one that wakes an idle session is taken where its turn starts.
    if (kind === 'task-notification' && (e as { turnId?: string }).turnId) await endJob($, jobEndOf({ text: e.text }))
    // The person's own message (not one a plugin sent) starts a new 'while you were away'.
    const origin = (e as { origin?: { kind?: string } }).origin
    if (origin?.kind !== 'plugin' && !e.isMeta) {
      const plan = await planInView($)
      const at = await $.clock.now()
      const doneSteps = plan ? deriveStages(plan).stages.flatMap((stage, i) => (stage.state === 'done' ? [i] : [])) : []
      await update($, since, () => ({ at, slug: plan?.slug ?? '', doneSteps }))
    }
    return submitted
  })

  on('command.run', { command: 'scv-dashboard' }, openByCommand)
  on('command.run', { command: 'scv-panel' }, openByCommand)

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
        await dropControls($, true)
      }
      await refresh($).catch(() => undefined)
      if (mirrored) {
        const lately = await $.store.get(recentKey((await read($, snapshot)).cwd)).catch(() => undefined)
        await update($, gearRecent, () => (Array.isArray(lately) ? lately.filter((one): one is string => typeof one === 'string') : []))
      }

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
    const { own, sent, previous } = await askMirror($, asked, true)
    await openPane($).catch(() => undefined)
    if (!sent.isDelivered) {
      await update($, mirror, () => previous)

      return { text: `거울 요청을 보내지 못했습니다: ${sent.reason}` }
    }
    const reach = own.isRemote
      ? ''
      : ' 이 세션의 Remote Control 주소를 아직 찾지 못해, 지금은 같은 컴퓨터의 작업 세션만 답할 수 있습니다. 주소가 생기면 저절로 다시 요청합니다.'

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
    const isPeer = e.origin.kind === 'peer' && !e.agentId
    const message = isPeer ? parseMirror(e.text) : null
    // An act this version does not take (a newer viewer's, a broken one) is taken off the conversation too, and
    // nothing is done; its sender, when it is a viewer, is sent the state so its pane does not wait for an answer.
    if (!message && isPeer && isActText(e.text)) {
      const from = /ACT (\S+) \{/.exec(e.text)?.[1] ?? ''
      if (from in (await read($, viewers))) await pushMirror($, from)

      return { consumed: 'scv mirror act (unknown)' }
    }
    if (!message) return next(e)
    if (message.kind === 'hello') {
      const isNew = !(message.address in (await read($, viewers)))
      await update($, viewers, value => ({ ...value, [message.address]: { sent: '', at: 0, misses: 0 } }))
      if (isNew) $.ui.toast((await sayOf($))(`SCV: 다른 세션이 이 세션의 칸을 봅니다 (${message.address})`))
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
    // A new turn is work again. The wake-up it may have set for itself is spent; the jobs it left stay on the board
    // until their own end is heard — the person speaking does not end them.
    await update($, live, value => ({ ...value, isWorking: true, turnStartedAt: at, background: false }))
    talkRun.typed = typedBy(e.text)
    await endJob($, jobEndOf({ text: e.text }))
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
    await update($, live, value => ({ ...value, isWorking: false, tool: null, hasEnded: true }))
    await update($, permit, () => null)
    const exchange = { user: talkRun.typed ?? '', answer: e.answer.trim() }
    talkRun.typed = null
    await update($, talks, list => keepTalk(list, exchange))
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
    await readTabs($).catch(() => undefined)
    // The turn is over: a conversation grown past the mark is made light now, apart from this hook's answer.
    void maybeLighten($).catch(() => {
      lightRun.pending = false
      lightRun.isClearing = false
    })

    return ended
  })

  // The engine's list of background work still in flight, given when the main conversation's turn stops: kept to
  // tell, before a clear, the jobs whose end nobody heard. Nothing about the stop itself is changed.
  on('classic.Stop', async ($, e, next) => {
    const at = await $.clock.now()
    flightRun.seen = flightOf(flightRun.seen, e.background_tasks, at)

    return next(e)
  })

  // The pass this mod asked for, on the main conversation: SCV's own record stands in for the older part — the
  // record's end, the plans in progress and the last turns as plain text. No model runs. Without a record, or for
  // a compaction this mod did not ask for (the person's /compact, the engine's own), the engine goes on as it would.
  on('session.compact', async ($, e, next) => {
    if (!lightRun.pending || e.trigger === 'auto' || e.trigger === 'precompute' || e.agentId) return next(e)
    const shot = await read($, snapshot)
    const record = await newestRecord($, shot.cwd).catch(() => null)
    const tail = recordTail(record?.text)
    if (!record || tail === '') return next(e)
    const plans = parsePlans(shot.plans)
      .filter(plan => !plan.isArchived)
      .map(plan => {
        const count = countStages(deriveStages(plan).stages)

        return { title: plan.title, status: plan.status, done: count.done, total: count.total }
      })
    lightRun.kind = 'records'

    return { messages: lightMessages(resumeBrief({ recordPath: record.path, tail, plans }), lastTurns(e.messages)) }
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

  // The mod's own look at the terminal's tabs when a turn ends (it runs nothing) asks no permission; the model's is judged as ever.
  on('tool.check', { tool: TABS_TOOL }, ($, e, next) => (isOwnCall(next.origin) ? { decision: 'allow' as const } : next(e)))

  // The mod's own mirror messages ask no permission (auto mode has no verdict for a send nobody typed); the model's are judged as ever.
  on('tool.check', { tool: 'SendMessage' }, ($, e, next) => (isOwnCall(next.origin) ? { decision: 'allow' as const } : next(e)))

  // Claude's instructions carry the step signal only while a plan is in progress.
  // While the person types (a burst of keys, a paste): the box the editor shows after the edit is what is matched.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await fitGear($, box.text).catch(() => undefined)

    return box
  })

  // A change no edit carried (a recalled entry, a clear, a plugin's fill).
  on('prompt.change', async ($, e, next) => {
    const changed = await next(e)
    await fitGear($, e.text).catch(() => undefined)

    return changed
  })

  // The rows of this mod's own command as the conversation stores them: the echo names the command, and the output
  // row after it holds the engine's words — replaced by the trimmed page of the last exchanges (one plain line when
  // none was shown), so another screen shows them too and the model reads no error that is none.
  // Another command's echo ends the wait for that output row.
  on('session.append', { door: 'command' }, async ($, e, next) => {
    const text = e.message.content.map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('')
    if (text.includes('<command-name>/')) {
      talkRow.isNext = isEchoOf(text, TALK_COMMAND)

      return next(e)
    }
    if (!isTalkOutput(text, talkRow.isNext)) return next(e)
    talkRow.isNext = false
    const words = (await read($, storedTalk)) || TALK_STORED
    const content = e.message.content.map(block => (block.type === 'text' && typeof block.text === 'string' ? { ...block, text: swapOutput(block.text, words) } : block))

    return next({ ...e, message: { ...e.message, content } })
  })

  // The output row of this mod's own command is drawn with the last exchanges in place of its words.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.props.command !== TALK_COMMAND) return next(e)

    return next({ ...e, props: { ...e.props, text: (await read($, shownTalk)) || NO_TALK } })
  })

  // The line above the prompt box: the fitting gear's role in plain words, and a way to turn it down.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const name = await read($, gearHint)
    const gear = name ? parseGears((await read($, snapshot)).gearsText).find(one => one.name === name) : undefined
    if (!gear || (await read($, gearDismissed)) === gear.name) {
      drawnHint.name = null

      return next(e)
    }
    drawnHint.name = gear.name
    const say = await sayOf($)
    const elements = sayElements($.ui.resolve(e), say)
    const { Box, Text, Button } = elements
    const hasCore = Boolean((await read($, snapshot)).core) && !(await read($, mirror))
    // 사용함: the pane runs the gear itself where it can — at once, or after its values are set or its question is
    // answered in the pane; nothing is sent and the prompt box stays as it is. A gear only Claude can run (a judgment
    // step, values this surface cannot take, no SCV found) goes as before: what is in the box is sent now with the
    // gear's line at its end. Sent without a press the text goes that way too; 사용안함 turns the gear down for this text.
    const useNow = async () => {
      const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
      if (box.text.trim() === '') return
      const did = await pressGear($, gear.name, 'band', 'Input' in elements)
      drawnHint.name = null
      await update($, gearHint, () => null)
      if (did === 'chat') return handToChat($, gear.name, 'band')
      // the pane has the gear now: this text is not given its line again, and the pane is where the rest happens
      await update($, gearDismissed, () => gear.name)
      await openPane($).catch(() => undefined)
      const said = did === 'run' ? '창에서 바로 돌림 — 결과는 SCV 칸의 기어 줄에' : did === 'values' ? 'SCV 칸에서 값을 정하면 바로 돌림' : '밖으로 나가는 일 — SCV 칸에서 [실행]을 눌러야 돌아감'
      await Promise.resolve($.ui.toast(say(`SCV: ${said}`))).catch(() => undefined)
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text>{hintLine(gear)}</Text>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text dimColor>{hintNote(gear, hasCore)}</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="gear-hint-use" label="사용함" onPress={() => void useNow().catch(() => undefined)} />
            <Button key="gear-hint-dismiss" label="사용안함" onPress={() => void update($, gearDismissed, () => gear.name)} />
          </Box>
        </Box>
      </Box>
    )
  })

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
    const paths = Array.isArray(input.evidence) ? input.evidence.filter((one): one is string => typeof one === 'string' && one.trim() !== '') : []
    const output = typeof input.output === 'string' ? input.output : undefined
    const source = {
      ...(typeof input.log === 'string' && input.log.trim() ? { log: input.log.trim() } : {}),
      ...(typeof input.url === 'string' && /^https?:\/\//.test(input.url.trim()) ? { url: input.url.trim() } : {}),
    }
    const shot = await read($, snapshot)
    const plans = parsePlans(shot.plans)
    // The store is the record: a signal sent right after another (or from another session) builds on it,
    // where the session value read here could still be the one from before the last write.
    const stored = await $.store.get(signalsKey(shot.cwd)).catch(() => undefined)
    const before = Array.isArray(stored) ? (stored as StepSignal[]) : await read($, signals)
    const checked = checkSignal(asked, plans, before)
    if (!checked.isOk) return { deny: checked.reason }
    const plan = plans.find(one => one.slug === asked.plan)
    let proof: Evidence | undefined
    if (asked.state === 'done') {
      const open = lastSignalOf(before, asked.plan, asked.step)
      const startedAt = open && open.state !== 'done' ? (open.startedAt ?? open.at) : undefined
      // The pure functions the step's plan line names: with them, the step may end with no file.
      const named = plan?.steps[asked.step - 1]?.refs ?? []
      const judged = judgeEvidence(paths, output, await fileFacts($, shot.cwd, paths), startedAt, named)
      if (!judged.isOk) return { deny: judged.reason }
      proof = judged.evidence
    }

    const kept = applySignal(
      before,
      { ...asked, ...(proof ? { evidence: proof } : {}), ...(asked.state === 'doing' ? { source, ...(input.background === true ? { background: true } : {}) } : {}) },
      await $.clock.now(),
    )
    await $.store.set(signalsKey(shot.cwd), kept).catch(() => undefined)
    await update($, signals, () => kept)
    await update($, startedSteps, started => nextStarted(started, asked))

    return { result: signalAnswer(asked, plan && deriveStages(mergeMarks(plan, kept)).stages, backgroundSteps(kept, asked.plan)) }
  }))

  on('tool.call', async ($, e, next) => {
    if (OWN_TOOLS.has(e.tool) || ((e.tool as string) === TABS_TOOL && isOwnCall(next.origin))) return next(e)
    const input = e as unknown as Record<string, unknown>
    const at = await $.clock.now()
    // The main conversation's tool is the 'now' line; a subagent's goes on that agent's own line.
    const isMain = isMainLoop(e)
    if (isMain) {
      // A wake-up the session sets for itself will start a turn by itself: the turn's end is then not the person's turn.
      // The jobs a call leaves running (a command in the background, a watch) go on the board once the call has answered.
      const leavesWork = e.tool === 'ScheduleWakeup' && isBackgroundStart(e.tool, input)
      await update($, live, value => ({ ...value, tool: { name: e.tool, target: describeTool(e.tool, input), startedAt: at }, ...(leavesWork ? { background: true } : {}) }))
      const before = await read($, tasks)
      const listed = applyTaskEvent(before, e.tool, input, at)
      await update($, tasks, () => listed)
      listRun.tool = listToolOf(e.tool) ?? listRun.tool
      for (const subject of newlyDone(before, listed)) await update($, doneLog, list => applyDone(list, { at, text: `${subject} 끝`, isOk: true }))
    } else {
      await update($, agents, list => applyAgentEvent(list, { kind: 'tool', id: e.agentId ?? '', tool: e.tool, target: describeTool(e.tool, input), at }))
    }
    // Only work after this session said it started a step is that step's; a plan's leftover mark takes nothing.
    const started = await read($, startedSteps)
    const working = started[started.length - 1]
    if (working) {
      const entry = { tool: e.tool, target: describeTool(e.tool, input), at }
      await update($, stepLog, log => logWork(log, `${working.plan}#${working.step - 1}`, entry))
      const code = writtenCode(e.tool, input)
      if (code !== null) await noteFunctions($, working.plan, working.step - 1, code)
    }
    if (e.tool === 'AskUserQuestion') {
      const question = describeTool(e.tool, input) || '질문'
      await update($, waiting, () => question)
      await alert($, `답을 기다리는 중 — ${question}`)
    }

    try {
      const ran = await next(e)
      if (isMain && !ran.deny && !ran.isError) {
        const started = jobStartOf(e.tool, input, { result: ran.result, text: ran.text }, at)
        if (started) await update($, jobs, board => applyJobEvent(board, { kind: 'start', job: started }))
        await endJob($, jobEndOf({ tool: e.tool, input }))
      }
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
    const say = await sayOf($)
    const elements = sayElements($.ui.resolve(e), say)
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
    const board = await read($, jobs)
    const finished = await read($, doneLog)
    const allRuns = await read($, runs)
    const message = await read($, note)
    const mirrored = await read($, mirror)
    // Asks the working session once more, when the person presses; what came of it is said in a toast.
    const askAgain = async () => {
      if (!mirrored) return
      const { sent } = await askMirror($, mirrored.host)
      $.ui.toast(say(sent.isDelivered ? 'SCV: 작업 세션에 다시 요청했습니다' : `SCV: 다시 요청을 보내지 못했습니다 — ${sent.reason}`))
    }
    // The controls of the cards (ask mode, the summary switch, gears, branch, words): this session's own — or,
    // mirroring, the working session's, pressed from here, when its state says it takes such presses.
    const canAct = Boolean(mirrored) && (await read($, hostActs)) >= MIRROR_ACTS_MIN
    const canActLang = Boolean(mirrored) && (await read($, hostActs)) >= MIRROR_ACTS_LANG
    const hasControls = !mirrored || canAct
    const liveThere = await read($, hostLive)
    const isHeld = (name: string) => (mirrored ? liveThere.includes(name) : liveRuns.has(name))
    const sentLine = await read($, actNote)
    const picksHere = await read($, viewPicks)
    const cameFrom = await read($, fromMirror)
    const mirrorLine = mirrored ? (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text color="#4f8cff">{mirrorLineText({ host: mirrored.host, name: mirrored.name, receivedAt: mirrored.at, at, formatDuration })}</Text>
          <Button key="mirror-ask" label="다시 요청" onPress={() => void askAgain().catch(() => undefined)} />
        </Box>
        {canAct && mirrored.at ? [<Text key="mirror-press-hint" dimColor>여기서 누르면 작업 세션에 메시지 한 줄이 남습니다.</Text>] : []}
      </Box>
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

    // Mirroring, a press on a card's control goes to the working session, which does it with its own functions and
    // answers with its state; until that comes, the card says the press was sent (or that it could not be). The act
    // is read back the way the working session will read it: one it would drop is not sent. Whether it was sent.
    const pressAct = async (where: ActNote['where'], act: MirrorAct) => {
      if (!mirrored) return false
      const checked = parseAct(JSON.stringify(act))
      if (!checked) {
        await update($, actNote, () => ({ where, text: '보내지 않음 — 값이 너무 길거나 보낼 수 없는 글자가 있습니다' }))

        return false
      }
      const own = await ownAddress($)
      const sent = await $.session
        .send({ to: { sessionId: mirrored.host }, text: mirrorText({ kind: 'act', address: own.address, act: checked }) })
        .catch((error: unknown) => ({ isDelivered: false as const, reason: String(error) }))
      await update($, actNote, () => ({ where, text: sent.isDelivered ? '작업 세션에 보냄 — 반영을 기다림' : `작업 세션에 못 보냄: ${sent.reason}` }))

      return sent.isDelivered
    }
    const sentNote = (where: ActNote['where']) => (sentLine?.where === where ? [<Text key={`act-note-${where}`} dimColor>{sentLine.text}</Text>] : [])

    // The next command into the prompt box, keeping what the person typed; where the box will not take it, copied.
    const fillNext = async (command: string) => {
      if (mirrored) return plan && sendAct({ do: 'fill', slug: plan.slug }, `입력창(작업 세션)에 넣으라고 보냄: ${command}`)
      if (await fillPrompt($, command)) return void (await update($, note, () => `입력창에 넣음: ${command}`))
      const copied = await $.ui.copy({ text: command, surface: e.surface }).catch(() => ({ isCopied: false }))
      await update($, note, () => (copied.isCopied ? `입력창에 못 넣어 복사함: ${command}` : `입력창에 못 넣음 — ${command}`))
    }

    const card = (children: RenderChildren, color = '#30363d') => (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} marginBottom={1}>
        {children}
      </Box>
    )

    // The jobs still running (with their progress) and what finished lately; a step's own live view is in its detail.
    const nowCard = (step: { number: number; name: string } | null) => {
      const view = nowBlock({
        now: nowLine({ tasks: todo, step, tool: state.tool, jobs: board.jobs, extra: board.extra, isWorking: state.isWorking, turnStartedAt: state.turnStartedAt }),
        board,
        done: finished,
        at,
        offsetMinutes: offsetAt(at),
        formatDuration,
      })
      // Only what is useful stays: the jobs left running (with their progress) and what finished lately.
      if (view.jobs.length === 0 && view.done.length === 0) return null

      return card(
        <Box flexDirection="column">
          {view.jobs.length > 0 ? <Text bold>{`뒤에서 도는 일 ${board.jobs.length + board.extra}`}</Text> : null}
          <Box flexDirection="column">
            {view.jobs.map((row, i) => (
              <Box key={`job-${i}`} flexDirection="column">
                {row.isStale ? <Text dimColor>{`· ${row.text}`}</Text> : <Text>{`· ${row.text}`}</Text>}
                {row.ratio !== null ? (
                  <Box width="100%" height={1} backgroundColor="#21262d">
                    <Box width={`${Math.round(row.ratio * 100)}%`} height={1} backgroundColor="#4f8cff" />
                  </Box>
                ) : null}
              </Box>
            ))}
          </Box>
          {view.done.length > 0 ? <Text dimColor>최근 끝난 일</Text> : null}
          <Box flexDirection="column">
            {view.done.map((line, i) => (
              <Text key={`done-${i}`} dimColor>
                {line}
              </Text>
            ))}
          </Box>
        </Box>,
        '#4f8cff',
      )
    }

    const usage = usageLine(await read($, limits), offsetAt(at))
    const context = contextLine(await read($, contextFill))
    const Input = 'Input' in elements ? elements.Input : undefined
    const askView = askModeView(parseAskMode(shot.settingsText))
    const openGear = await read($, gearOpen)
    const gearView = gearCatalog(parseGears(shot.gearsText), await read($, gearRecent), await read($, gearsAll))
    const gearList = gearRows(gearView.shown, Boolean(shot.core) && hasControls)
    const gearRan = await read($, gearRuns)
    const gearBlocks = await read($, gearForms)
    const asksKept = await read($, gearAsks)
    const askOf = (name: string) => (asksKept.index === (shot.gearsText ?? null) ? parseAsk(asksKept.byName[name]) : null)
    const paneMessage = await read($, paneNote)

    // 대화로 · Claude 에게 시키기: the gear's command into the prompt box — sent, Claude asks for the values the
    // gear needs and runs it.
    const useGear = (name: string) => handToChat($, name, 'card')
    // SCV was asked for this gear's values and did not print them (an older SCV): the gear goes to the conversation.
    const isUnread = (name: string) => asksKept.index === (shot.gearsText ?? null) && asksKept.byName[name] === ''

    // 실행, on the gear's own line. Mirroring, the press goes to the working session — unless the gear already runs
    // there or has its block open under its line: then the line is only opened here, and nothing is sent.
    const pressRunHere = async (name: string) => {
      if (!mirrored) return pressRun($, name, Boolean(Input))
      await update($, gearOpen, () => name)
      if (!isHeld(name) && !gearBlocks[name]) await pressAct('gears', { do: 'gearPress', name, canType: Boolean(Input) })
    }

    // 이 값으로 실행. Mirroring, what was picked and typed here travels with this one press, never per keystroke.
    const submitHere = async (name: string) => {
      if (!mirrored) return submitValues($, name)
      const { [DATA_FIELD]: data, ...typedArgs } = typedValues.get(name) ?? {}
      if (await pressAct('gears', { do: 'gearSubmit', name, values: { ...picksHere[name], ...typedArgs }, input: data ?? '' })) typedValues.delete(name)
    }

    const answerHere = async (name: string, isYes: boolean) => (mirrored ? void (await pressAct('gears', { do: 'gearConfirm', name, isYes })) : answerConfirm($, name, isYes))
    const stopHere = async (name: string) => (mirrored ? void (await pressAct('gears', { do: 'gearStop', name })) : stopGear($, name))

    // A choice button pressed: the block remembers it. Mirroring, the pick stays here until the block is submitted.
    const pickValue = (name: string, arg: string, value: string) =>
      mirrored
        ? update($, viewPicks, all => ({ ...all, [name]: { ...all[name], [arg]: value } }))
        : update($, gearForms, all => {
            const form = all[name]

            return form?.kind === 'values' ? { ...all, [name]: { ...form, picked: { ...form.picked, [arg]: value } } } : all
          })

    // The values of a gear, set here: a row of buttons where its description lists the choices (the value now is
    // the one picked), a field for a value to type and for the data it reads, then the run — or Claude.
    const valuesBlock = (name: string, form: Extract<GearForm, { kind: 'values' }>) => {
      const asked = askOf(name)
      if (!asked) return null
      const isTyped = asked.hasInput || asked.args.some(arg => arg.isOpen && argChoices(arg.desc, arg.value).kind === 'field')

      return (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>값 정하기</Text>
          {asked.args.map(arg => {
            const how = argChoices(arg.desc, arg.value)
            if (!arg.isOpen) return <Text key={`gear-fixed-${name}-${arg.name}`} dimColor>{`${arg.name} = ${arg.value} — 기어가 정해 둠`}</Text>
            if (how.kind === 'buttons') {
              return (
                <Box key={`gear-arg-row-${name}-${arg.name}`} flexDirection="column">
                  <Text dimColor>{`${arg.name} — ${arg.desc}`}</Text>
                  <Box flexDirection="row" gap={1}>
                    {how.choices.map((choice, i) => (
                      <Button
                        key={`gear-pick-${name}-${arg.name}-${i}`}
                        label={`${(picksHere[name]?.[arg.name] ?? form.picked[arg.name] ?? arg.value) === choice ? '●' : '○'} ${choice}`}
                        onPress={() => void pickValue(name, arg.name, choice)}
                      />
                    ))}
                  </Box>
                </Box>
              )
            }

            return Input ? (
              <Input
                key={`gear-arg-${name}-${arg.name}`}
                label={arg.name}
                placeholder={arg.desc || '값을 적기'}
                value={arg.value}
                submitLabel="값 넣기"
                onInput={(value: string) => noteTyped(name, arg.name, value)}
                onSubmit={(value: string) => noteTyped(name, arg.name, value)}
              />
            ) : (
              <Text key={`gear-arg-${name}-${arg.name}`} dimColor>{`${arg.name} = ${arg.value} — ${arg.desc}`}</Text>
            )
          })}
          {asked.hasInput && Input
            ? [
                <Input
                  key={`gear-input-${name}`}
                  label="넣을 자료"
                  rows={3}
                  placeholder={`이 기어가 읽을 자료(${asked.inputKind ?? ''})를 적기`}
                  submitLabel="이 값으로 실행"
                  onInput={(value: string) => noteTyped(name, DATA_FIELD, value)}
                  onSubmit={(value: string) => {
                    noteTyped(name, DATA_FIELD, value)
                    void submitHere(name).catch(() => undefined)
                  }}
                />,
              ]
            : []}
          {isTyped && !Input
            ? [<Text key="no-field" dimColor>{mirrored ? '이 화면에는 입력 칸이 없어 값을 적을 수 없습니다.' : '이 화면에는 입력 칸이 없어 값을 적을 수 없습니다 — Claude 에게 맡기면 물어봅니다.'}</Text>]
            : []}
          <Box flexDirection="row" gap={1}>
            {isTyped && !Input ? [] : [<Button key={`gear-go-${name}`} label="이 값으로 실행" variant="primary" onPress={() => void submitHere(name).catch(() => undefined)} />]}
            {mirrored ? [] : [<Button key={`gear-chat-${name}`} label="Claude 에게 맡기기" onPress={() => void handToChat($, name, form.from).catch(() => undefined)} />]}
          </Box>
        </Box>
      )
    }

    // The question before a gear that reaches outside runs: what goes out, then 실행 or 취소.
    const confirmBlock = (name: string, form: Extract<GearForm, { kind: 'confirm' }>) => (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="#e3b341">밖으로 나가는 일 — 확인</Text>
        {form.lines.map((line, i) => (
          <Text key={`gear-ask-${name}-${i}`}>{line}</Text>
        ))}
        <Box flexDirection="row" gap={1}>
          <Button key={`gear-confirm-yes-${name}`} label="실행" variant="primary" onPress={() => void answerHere(name, true).catch(() => undefined)} />
          <Button key={`gear-confirm-no-${name}`} label="취소" onPress={() => void answerHere(name, false).catch(() => undefined)} />
        </Box>
      </Box>
    )

    const toggleMore = async () => {
      const value = await update($, expanded, one => ({ ...one, more: !one.more }))
      await $.store.set(MORE_KEY, value.more === true).catch(() => undefined)
    }

    const lightState = await read($, light)
    const lightLine = await read($, lightSaid)
    const said = lightLine ? lightSaidParts(lightLine) : null
    const fillNow = await read($, contextFill)
    // Mirroring, each of these goes to the working session, with the value to end at; a press that would change
    // nothing there (the mark at the end of its bar, the branch already checked out) sends nothing.
    const switchLight = async () => (mirrored ? void (await pressAct('limits', { do: 'lightSwitch', isOn: !lightState.isOn })) : setLight($, one => ({ ...one, isOn: !one.isOn })))
    // ◀ · ▶: the mark one step down or up the bar.
    const stepLight = async (by: number) => {
      if (!mirrored) return setLight($, one => moveLight(one, one.percent + by))
      const next = moveLight(lightState, lightState.percent + by).percent
      if (next !== lightState.percent) await pressAct('limits', { do: 'lightMark', percent: next })
    }
    const where = await read($, place)
    const picking = await read($, branchPick)
    const pressBranches = async () => (mirrored ? void (await pressAct('limits', { do: 'branchList', isOpen: !picking })) : openBranches($))
    const pickBranch = async (to: string) => {
      if (!mirrored) return switchBranch($, to)
      if (to !== where.branch?.name) await pressAct('limits', { do: 'branchPick', to })
    }
    const whereNote = await read($, placeNote)
    const folder = shot.root ? shortPath(shot.root, where.home) : null
    const branchLabel = where.branch ? (where.branch.isBranch ? where.branch.name : `${where.branch.name} (브랜치 없음)`) : null
    // The language row (after 0.6.2), last in the card: the project's SCV language, picked from the languages the
    // pane carries or typed by name. Only where the project has a settings file; a viewer's press goes to the working
    // session, and only to one that takes it.
    const langNow = langFromSettings(shot.settingsText)
    const langView = langNow ? langChoice(langNow) : null
    const langOpen = await read($, langPick)
    const langLine = await read($, langNote)
    const canPickLang = hasControls && (mirrored ? canActLang : Boolean(shot.core))
    const isPackMissing = !mirrored && langView?.pick === 'other' && !parsePack((await read($, langPack)).text)
    const pickLang = async (to: string) => {
      if (to === 'other') return void (await update($, langPick, () => 'other' as const))
      if (!mirrored) return setLang($, to)
      await update($, langPick, () => null)
      const lang = cleanLang(to)
      if (!lang) return void (await update($, langNote, () => '언어 이름으로 쓸 수 없는 글 — 글자와 숫자, 띄어쓰기만'))
      if (lang !== langNow) await pressAct('limits', { do: 'lang', to: lang })
    }
    const langRows = () =>
      langView
        ? [
            <Box key="lang-row" flexDirection="row" gap={1} alignItems="center">
              <Text bold>언어</Text>
              {canPickLang ? (
                <Button
                  key="lang-open"
                  label={`${langView.name} ${langOpen ? '▴' : '▾'}`}
                  onPress={() => void Promise.all([update($, langPick, value => (value ? null : ('list' as const))), update($, langNote, () => null)]).catch(() => undefined)}
                />
              ) : (
                <Text dimColor>{langView.name}</Text>
              )}
            </Box>,
            ...(langOpen && canPickLang
              ? [
                  <Box key="lang-list" flexDirection="column">
                    {Select ? (
                      <Select key="lang-pick" label="언어 고르기" options={[...LANG_OPTIONS]} value={langOpen === 'other' ? 'other' : langView.pick} onSelect={(value: string) => void pickLang(value).catch(() => undefined)} />
                    ) : (
                      LANG_OPTIONS.map(one => <Button key={`lang-to-${one.value}`} label={one.label} onPress={() => void pickLang(one.value).catch(() => undefined)} />)
                    )}
                    {langOpen !== 'other' ? null : Input ? (
                      <Input
                        key="lang-name"
                        label="다른 언어"
                        placeholder="언어 이름 — 예: français"
                        value={langView.pick === 'other' ? langView.name : ''}
                        submitLabel="이 언어로"
                        onInput={(value: string) => void (langTyped.name = value)}
                        onSubmit={(value: string) => {
                          langTyped.name = value
                          void pickLang(cleanLang(value) ?? '').catch(() => undefined)
                        }}
                      />
                    ) : (
                      <Text dimColor>이 화면에는 입력 칸이 없어 값을 적을 수 없습니다.</Text>
                    )}
                  </Box>,
                ]
              : []),
            ...(langLine ? [<Text key="lang-note" dimColor>{langLine}</Text>] : []),
            ...(isPackMissing && !langLine
              ? [
                  <Box key="lang-missing" flexDirection="row" gap={1} alignItems="center">
                    <Text dimColor>{`${langView.name} 번역이 아직 없음 — 영어로 보임`}</Text>
                    {canPickLang ? <Button key="lang-ask" label="번역 요청" onPress={() => void askPack($, langView.name).catch(() => undefined)} /> : null}
                  </Box>,
                ]
              : []),
          ]
        : []

    // The folder and branch the session works in, then context · usage; a row only for a value this session has.
    const limitsCard = () =>
      usage || context || folder || langView
        ? card(
            <Box flexDirection="column">
              {folder ? (
                <Box flexDirection="row" gap={1}>
                  <Text bold>폴더</Text>
                  <Text dimColor>{folder}</Text>
                </Box>
              ) : null}
              {branchLabel ? (
                <Box flexDirection="row" gap={1} alignItems="center">
                  <Text bold>브랜치</Text>
                  {hasControls ? <Button key="branch-open" label={`${branchLabel} ${picking ? '▴' : '▾'}`} onPress={() => void pressBranches().catch(() => undefined)} /> : <Text dimColor>{branchLabel}</Text>}
                </Box>
              ) : null}
              {picking && hasControls ? (
                <Box flexDirection="column">
                  {Select ? (
                    <Select
                      key="branch-pick"
                      label="바꿀 브랜치"
                      options={picking.map(value => ({ value }))}
                      {...(where.branch?.isBranch && picking.includes(where.branch.name) ? { value: where.branch.name } : {})}
                      onSelect={(value: string) => void pickBranch(value).catch(() => undefined)}
                    />
                  ) : (
                    picking.slice(0, 12).map((name, i) => <Button key={`branch-to-${i}`} label={name} onPress={() => void pickBranch(name).catch(() => undefined)} />)
                  )}
                </Box>
              ) : null}
              {whereNote ? <Text dimColor>{whereNote}</Text> : null}
              {context ? (
                <Box flexDirection="row" gap={1}>
                  <Text bold>컨텍스트</Text>
                  <Text dimColor>{context}</Text>
                </Box>
              ) : null}
              {usage ? (
                <Box flexDirection="row" gap={1}>
                  <Text bold>사용 한도</Text>
                  <Text dimColor>{usage}</Text>
                </Box>
              ) : null}
              {context ? (
                <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                  <Box flexDirection="row" gap={1}>
                    <Text bold>자동 비우기</Text>
                    <Text dimColor>{lightLabel(lightState)}</Text>
                  </Box>
                  <Box flexDirection="row">
                    {hasControls ? [<Button key="light-toggle" label={lightState.isOn ? '끄기' : '켜기'} onPress={() => void switchLight().catch(() => undefined)} />] : []}
                  </Box>
                </Box>
              ) : null}
              {context && lightState.isOn && hasControls ? (
                <Box flexDirection="row" gap={1} alignItems="center">
                  <Button key="light-down" label="◀" onPress={() => void stepLight(-LIGHT_STEP).catch(() => undefined)} />
                  {Svg ? <Svg source={lightBarSvg(lightState.percent, fillNow)} alt={`비우기 기준 ${lightState.percent}% · 지금 ${context}`} /> : null}
                  <Button key="light-up" label="▶" onPress={() => void stepLight(LIGHT_STEP).catch(() => undefined)} />
                </Box>
              ) : null}
              {said?.name ? (
                <Box flexDirection="row" gap={1}>
                  <Text bold>{said.name}</Text>
                  <Text dimColor>{said.value}</Text>
                </Box>
              ) : said ? (
                <Text dimColor>{said.value}</Text>
              ) : null}
              {langRows()}
              {sentNote('limits')}
            </Box>,
            '#4f8cff',
          )
        : null

    const pressAskMode = async () => (mirrored ? void (await pressAct('askMode', { do: 'askMode', to: askView.next })) : switchAskMode($, askView.next))
    const askCard = () =>
      card(
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" gap={1}>
              <Text bold>묻기 방식</Text>
              <Text>{askView.name}</Text>
            </Box>
            <Box flexDirection="row">
              {hasControls ? [<Button key="ask-mode-switch" label={askView.nextLabel} onPress={() => void pressAskMode().catch(() => undefined)} />] : []}
            </Box>
          </Box>
          <Text dimColor>{askView.meaning}</Text>
          {sentNote('askMode')}
        </Box>,
      )

    // One line per gear — what it does, in plain words — and a press opens that gear alone: its name, the values to
    // set, the words a request for it would use. More than five: the lately-used ones first, the rest on a press.
    const gearsCard = () =>
      card(
        <Box flexDirection="column">
          <Text bold>{`저장해 둔 일(기어) ${gearView.total}`}</Text>
          {gearView.total === 0 ? (
            <Text dimColor>이 프로젝트에 기어가 없습니다 — 되풀이하는 일을 기어로 만들어 달라고 하면 여기에 보입니다.</Text>
          ) : (
            <Text dimColor>하려는 일을 그냥 말해도 맞는 것을 씁니다</Text>
          )}
          {(shot.gearWaits ?? 0) > 0 ? <Text color="#e3b341">{`확인 기다림 ${shot.gearWaits} — 밖으로 나가는 단계 앞에서 멈춘 기어 실행이 있습니다`}</Text> : null}
          {gearList.map(row => {
            const isOpen = openGear === row.name
            const run = gearRan[row.name]
            const form = gearBlocks[row.name]
            const isRunning = isLiveRun(row.name, run, isHeld(row.name))
            const canRun = row.direct === 'run' && !isUnread(row.name)

            return (
              <Box key={`gear-${row.name}`} flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                  <Box flexDirection="row" flexShrink={1}>
                    <Button key={`gear-open-${row.name}`} plain onPress={() => void update($, gearOpen, value => (value === row.name ? null : row.name))}>
                      {`${isOpen ? '▾' : '▸'} ${row.title}${isRunning ? ' · 돌리는 중' : ''}`}
                    </Button>
                  </Box>
                  <Box flexDirection="row">
                    {!hasControls
                      ? []
                      : !canRun
                        ? // a gear that goes to the conversation: that is the working session's own to start
                          mirrored
                          ? []
                          : [<Button key={`gear-use-${row.name}`} label="대화로" onPress={() => void useGear(row.name).catch(() => undefined)} />]
                        : isRunning || (form && isOpen)
                          ? // running: 멈춤 is under the line; a block open under the line has its own buttons
                            []
                          : [<Button key={`gear-run-${row.name}`} label="실행" onPress={() => void pressRunHere(row.name).catch(() => undefined)} />]}
                  </Box>
                </Box>
                {isOpen ? (
                  <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
                    {row.does && row.does !== row.title ? [<Text key="does">{row.does}</Text>] : []}
                    <Text dimColor>{`이름 ${row.name} · 받는 값 → 돌려주는 값: ${row.flow}`}</Text>
                    <Text dimColor>{row.argsLine ? row.argsLine.replace(/^인자 /, '정할 값 ') : '정할 값 없음'}</Text>
                    {row.words ? [<Text key="words" dimColor>{`이럴 때: ${row.words}`}</Text>] : []}
                    {row.markLine ? [<Text key="mark" dimColor>{row.markLine}</Text>] : []}
                    {canRun && !mirrored && !isRunning && !form
                      ? [<Button key={`gear-use-${row.name}`} label="Claude 에게 시키기" dimColor onPress={() => void useGear(row.name).catch(() => undefined)} />]
                      : []}
                    {form?.kind === 'values' ? valuesBlock(row.name, form) : null}
                    {form?.kind === 'confirm' ? confirmBlock(row.name, form) : null}
                    {(run ? runLines(row.name, run, at, isHeld(row.name)) : []).map((line, i) => (
                      <Text key={`gear-out-${row.name}-${i}`} dimColor>{`│ ${line}`}</Text>
                    ))}
                    {isRunning && hasControls ? [<Button key={`gear-stop-${row.name}`} label="멈춤" onPress={() => void stopHere(row.name).catch(() => undefined)} />] : []}
                    {run && !isRunning && run.exitCode !== 11 && !mirrored
                      ? [<Button key={`gear-paste-${row.name}`} label="결과를 대화에 붙이기" onPress={() => void pasteResult($, row.name).catch(() => undefined)} />]
                      : []}
                  </Box>
                ) : null}
              </Box>
            )
          })}
          {gearView.hidden > 0 ? [<Button key="gears-all" label={`${gearView.total}개 모두 보기`} onPress={() => void update($, gearsAll, () => true)} />] : []}
          {paneMessage ? <Text dimColor>{paneMessage}</Text> : null}
          {sentNote('gears')}
        </Box>,
      )

    // The word dictionary: folded to one line until it is pressed (each session folds its own — a mirror sends
    // nothing for it). Unfolded: an entry a line — the word to avoid, the word to use, its forms dim under them —
    // then the form that adds one. Shown where the project is read, also when the dictionary is empty.
    const wordsOpen = await read($, wordsView)
    const wordsLine = await read($, wordsNote)
    const wordList = parseWords(shot.wordsText)
    const wordFold = wordsFold(wordList, wordsOpen.isAll)
    const editing = wordsOpen.edit ? wordList.find(one => one.avoid === wordsOpen.edit) : undefined
    // an emptied form: nothing typed is kept, and its fields are drawn anew
    const resetForm = () => {
      clearWordsTyped()

      return update($, wordsView, one => ({ ...one, edit: null, gen: one.gen + 1 }))
    }
    const editWord = (avoid: string) => {
      clearWordsTyped()

      return update($, wordsView, one => ({ ...one, edit: avoid, asking: null, gen: one.gen + 1 }))
    }
    // 저장: what the fields hold (for an entry being edited, its own words where nothing was typed). An edit that
    // changes nothing runs and sends nothing. Mirroring, the typed words travel with this one press.
    const saveHere = async () => {
      const draft = { avoid: wordsTyped.avoid ?? editing?.avoid ?? '', use: wordsTyped.use ?? editing?.use ?? '', forms: wordsTyped.forms ?? editing?.forms.join(', ') ?? '' }
      const was = editing?.avoid ?? null
      const checked = checkWord(draft)
      if (checked.isOk && editing && checked.word.avoid === editing.avoid && checked.word.use === editing.use && checked.word.forms === editing.forms.join(', ')) {
        if (mirrored) await update($, actNote, () => ({ where: 'words' as const, text: '바뀐 것이 없어 보내지 않음' }))
        else await update($, wordsNote, () => '바뀐 것이 없어 그대로 둠')

        return void (await resetForm())
      }
      if (!mirrored) return void ((await saveWord($, draft, was)) && (await resetForm()))
      if (!checked.isOk) return void (await update($, actNote, () => ({ where: 'words' as const, text: checked.reason })))
      if (await pressAct('words', { do: 'wordsSave', ...checked.word, was })) await resetForm()
    }
    const askRemove = (avoid: string | null) => update($, wordsView, one => ({ ...one, asking: avoid }))
    const removeHere = async (avoid: string) => {
      await askRemove(null)
      if (mirrored) return void (await pressAct('words', { do: 'wordsRemove', avoid }))
      await removeWord($, avoid)
    }
    // A command of the dictionary into this session's prompt box, unsent; the card says what sending it does.
    const fillWords = async (command: string, then: string) => {
      const filled = await fillPrompt($, command)
      await update($, wordsNote, () => (filled ? `입력창에 넣음: ${command.trim()} — ${then}` : `입력창에 못 넣음 — ${command.trim()}`))
    }
    const formKind = wordsFormKind({ controls: hasControls, input: Boolean(Input), isMirror: Boolean(mirrored) })
    const wordsForm = () =>
      formKind === 'hidden' ? null : formKind === 'form' && Input ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{editing ? `고치기 — ${wordLine(editing)}` : '낱말 추가'}</Text>
          <Input
            key={`words-avoid-${wordsOpen.gen}`}
            label="피할 말"
            placeholder="예: 재다"
            value={editing?.avoid ?? ''}
            submitLabel="값 넣기"
            onInput={(value: string) => void (wordsTyped.avoid = value)}
            onSubmit={(value: string) => void (wordsTyped.avoid = value)}
          />
          <Input
            key={`words-use-${wordsOpen.gen}`}
            label="바꿀 말"
            placeholder="예: 측정하다"
            value={editing?.use ?? ''}
            submitLabel="값 넣기"
            onInput={(value: string) => void (wordsTyped.use = value)}
            onSubmit={(value: string) => void (wordsTyped.use = value)}
          />
          <Input
            key={`words-forms-${wordsOpen.gen}`}
            label="변형(쉼표로)"
            placeholder="비워 두면 Claude 가 채움 — 예: 잰, 재서, 재 본"
            value={editing ? editing.forms.join(', ') : ''}
            submitLabel="저장"
            onInput={(value: string) => void (wordsTyped.forms = value)}
            onSubmit={(value: string) => {
              wordsTyped.forms = value
              void saveHere().catch(() => undefined)
            }}
          />
          <Box flexDirection="row" gap={1}>
            <Button key="words-save" label="저장" variant="primary" onPress={() => void saveHere().catch(() => undefined)} />
            {editing ? [<Button key="words-edit-cancel" label="취소" onPress={() => void resetForm()} />] : []}
          </Box>
        </Box>
      ) : formKind === 'none' ? (
        <Text dimColor>이 화면에는 입력 칸이 없어 낱말을 추가할 수 없습니다 — 지우기는 됩니다.</Text>
      ) : (
        <Box flexDirection="row">
          <Button key="words-add" label="낱말 추가 — 입력창에 /scv:words add" onPress={() => void fillWords('/scv:words add ', "뒤에 '피할 말 → 바꿀 말' 을 적어 보내 주세요").catch(() => undefined)} />
        </Box>
      )
    const wordsCard = () =>
      card(
        <Box flexDirection="column">
          <Box flexDirection="row">
            <Button key="words-toggle" plain onPress={() => void update($, wordsView, one => ({ ...one, isOpen: !one.isOpen }))}>
              {`${wordsOpen.isOpen ? '▾' : '▸'} 낱말 사전 ${wordList.length}`}
            </Button>
          </Box>
          {wordsOpen.isOpen ? (
            <Box flexDirection="column">
              {wordList.length === 0 ? (
                <Text dimColor>피할 말과 바꿀 말을 적어 두면, Claude 가 그 말이나 그 변형을 쓰려 할 때 바꿀 말로 씁니다 — 예: 재다 → 측정하다 (잰 · 재 봤을 때 → 측정)</Text>
              ) : (
                <Text dimColor>Claude 가 왼쪽 말이나 그 변형을 쓰려 할 때 오른쪽 말로 바꿔 씁니다</Text>
              )}
              {wordFold.shown.map((entry, i) => {
                const forms = formsLine(entry)
                const isAsked = wordsOpen.asking === entry.avoid

                return (
                  <Box key={`word-${i}`} flexDirection="column">
                    <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                      <Box flexDirection="row" flexShrink={1}>
                        <Text>{wordLine(entry)}</Text>
                      </Box>
                      <Box flexDirection="row" gap={1}>
                        {hasControls && !isAsked
                          ? [
                              ...(Input ? [<Button key={`words-edit-${i}`} label="고치기" onPress={() => void editWord(entry.avoid)} />] : []),
                              <Button key={`words-remove-${i}`} label="지우기" onPress={() => void askRemove(entry.avoid)} />,
                            ]
                          : []}
                      </Box>
                    </Box>
                    {forms ? (
                      <Box paddingLeft={2}>
                        <Text dimColor>{forms}</Text>
                      </Box>
                    ) : (
                      <Box flexDirection="row" paddingLeft={2} gap={1} alignItems="center">
                        <Text dimColor>변형 없음 — Claude 가 채움</Text>
                        {mirrored ? [] : [<Button key={`words-fill-${i}`} label="채우기" onPress={() => void fillWords('/scv:words fill', '보내면 Claude 가 빈 변형을 채웁니다').catch(() => undefined)} />]}
                      </Box>
                    )}
                    {isAsked && hasControls ? (
                      <Box flexDirection="row" paddingLeft={2} gap={1} alignItems="center">
                        <Text color="#e3b341">지울까요?</Text>
                        <Button key="words-remove-yes" label="지우기" onPress={() => void removeHere(entry.avoid).catch(() => undefined)} />
                        <Button key="words-remove-no" label="취소" onPress={() => void askRemove(null)} />
                      </Box>
                    ) : null}
                  </Box>
                )
              })}
              {wordFold.hidden > 0 ? [<Button key="words-all" label={`${wordFold.hidden}개 더 보기`} onPress={() => void update($, wordsView, one => ({ ...one, isAll: true }))} />] : []}
              {wordsForm()}
            </Box>
          ) : null}
          {wordsLine ? <Text dimColor>{wordsLine}</Text> : null}
          {sentNote('words')}
        </Box>,
      )

    // Always on top: context · usage, then ask mode and gears where this session's project is read. The word
    // dictionary is not among them: it sits right under the plan (under the two lines that say there is none).
    const hasProject = shot.settingsText !== undefined
    const sectionsOf = (hasPlan: boolean, hasBlocks: boolean) => paneSections({ plan: hasPlan, blocks: hasBlocks, project: hasProject, words: shot.wordsText !== undefined })
    const topCards = (sections: readonly PaneSection[]) => (
      <Box flexDirection="column">
        {!mirrored && cameFrom ? <Text dimColor>{cameFrom}</Text> : null}
        {sections.includes('limits') ? limitsCard() : null}
        {sections.includes('askMode') ? askCard() : null}
        {sections.includes('gears') ? gearsCard() : null}
      </Box>
    )

    // Until the host's first state comes, what this session holds is its own folder or an older state: not shown.
    if (mirrored && !mirrored.at) {
      return (
        <Box flexDirection="column">
          {mirrorLine}
          <Text bold>SCV 대시보드</Text>
          <Text dimColor>작업 세션의 상태가 오면 여기에 그립니다.</Text>
        </Box>
      )
    }

    if (!plan) {
      const sections = sectionsOf(false, false)

      return (
        <Box flexDirection="column">
          {mirrorLine}
          <Text bold>SCV 대시보드</Text>
          {topCards(sections)}
          <Text dimColor>이 폴더에 진행 중인 SCV 계획이 없습니다. /scv:promote 로 계획을 만들면 여기에 보입니다.</Text>
          <Text dimColor>{`확인한 곳: ${shot.cwd || '(작업 폴더 모름)'}/scv/promote`}</Text>
          {sections.includes('words') ? wordsCard() : null}
          {nowCard(null)}
        </Box>
      )
    }

    const derived = deriveStages(plan)
    const isEstimated = derived.isEstimated
    const run = runFor(plan, allRuns)
    const rows = mergeTests(plan, run)
    const blocks = findBlocks(derived.stages, run, asked, asking, halted)
    const turn = turnStateOf({ isWorking: state.isWorking, hasEnded: state.hasEnded === true, blocks, agents: team.length, background: state.background === true, jobs: board.jobs.length + board.extra })
    // The steps running behind the conversation: such a step stays in progress when the turn ends, and says so.
    const behind = backgroundSteps(reported, plan.slug)
    const stages = applyTurn(applyBlocks(derived.stages, blocks), turn, behind)
    const wordOf = (state: StageState, i: number) => (state === 'doing' ? doingWord(behind.includes(i + 1)) : STATE_LABEL[state])
    // Steps worked on at the same time are all 'here'; the one opened by default is the step this session's work
    // goes to (the last it said it started), else the first of them.
    const isHere = (state: StageState | undefined) => state === 'doing' || state === 'blocked' || state === 'yourTurn'
    const lastStarted = [...(await read($, startedSteps))].reverse().find(one => one.plan === plan.slug && isHere(stages[one.step - 1]?.state))
    const here = lastStarted ? lastStarted.step - 1 : stages.findIndex(stage => isHere(stage.state))
    const focused = (await read($, focusStep)) ?? (here >= 0 ? here : null)
    const focusedStage = focused === null ? undefined : stages[focused]
    const work = focused === null ? [] : ((await read($, stepLog))[`${plan.slug}#${focused}`] ?? [])
    const catalog = shot.catalog ?? {}
    const functionLog = await read($, stepFunctions)
    // Each step's functions: what it builds, what it made and used. Only the step in focus shows them, in its
    // detail under the flow — finished or not. A line of the flow is the step's sentence and its state, nothing more.
    const viewOf = (i: number) => stepFunctionView(i, stages, plan.slug, plan.pipeline, catalog, functionLog)
    const focusedView = focused === null ? null : viewOf(focused)
    const did = focusedView?.did
    const builds = focusedView?.builds ?? []
    const callsOpen = await read($, showCalls)
    const focusedSignal = focused === null ? undefined : lastSignalOf(await read($, signals), plan.slug, focused + 1)
    const fullOf = (path: string) => (path.startsWith('/') ? path : `${shot.cwd}/${path}`)
    // A finished step's proof: only what a person can look at. A picture is drawn; a video or a page gets a button.
    const proof = focusedStage?.state === 'done' ? proofView(focusedSignal?.evidence, focusedStage.refs) : null
    const pictures = proof ? await Promise.all(proof.files.map(file => (file.kind === 'image' ? evidencePicture($, fullOf(file.path), file.size) : Promise.resolve(null)))) : []
    // The picture a person pressed to see large, drawn in place of the whole pane until they close it.
    const bigAt = proof ? bigIndexOf(await read($, bigProof), plan.slug, focused, proof.files) : null
    const bigFile = proof && bigAt !== null ? proof.files[bigAt] : undefined
    const bigPicture = bigFile ? await evidencePicture($, fullOf(bigFile.path), bigFile.size, BIG_WIDTH, BIG_HEIGHT) : null
    const liveSource = focusedStage && isHere(focusedStage.state) && focusedSignal?.state !== 'done' ? focusedSignal?.source : undefined
    const liveView = liveSource?.log ? liveOf((await logTail($, fullOf(liveSource.log))) ?? '') : null
    const done = focusedView?.done ?? { made: [], used: [] }
    // 하는 일: one bullet per function, with what it does. 이 단계에서 한 일: the two lists, each with its count.
    // Drawn the same in a step's detail and on a finished step's line.
    const buildsPart = (lines: StepFunctionView['builds']) =>
      lines.map(line => (
        <Box flexDirection="column">
          <Text>{functionBullet(line.name, line.kind)}</Text>
          {line.role ? (
            <Box paddingLeft={4}>
              <Text dimColor>{firstClause(line.role)}</Text>
            </Box>
          ) : null}
        </Box>
      ))
    const didPart = (lists: StepFunctionView['done']) =>
      (
        [
          ['새로 만듦', lists.made],
          ['가져다 씀', lists.used],
        ] as const
      ).map(([title, list]) => (
        <Box flexDirection="column">
          <Text>{`${title} ${list.length}`}</Text>
          {list.map(one => (
            <Box flexDirection="column">
              <Text>{functionBullet(one.name)}</Text>
              {one.detail ? (
                <Box paddingLeft={4}>
                  <Text dimColor>{one.detail}</Text>
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      ))
    const count = countStages(stages)
    // Step times from Claude's signals survive a new session; the times seen in this session are the fallback.
    const durations = stepDurationsFromSignals(reported, plan.slug)
    const eta =
      durations.length > 0
        ? estimateFromDurations(durations, count.total - count.done)
        : estimateEta(await read($, history), plan.slug, count.total - count.done)
    const action = nextAction(plan.slug, plan.status, stages, blocks, turn)
    const percent = count.total ? Math.round((count.done / count.total) * 100) : 0
    const current = here >= 0 ? stages[here] : undefined
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

    if (Svg && proof && bigFile && bigPicture && bigAt !== null && focusedStage && focused !== null) {
      const shown = proof.files.filter(isDrawable)
      const closeBig = () => void update($, bigProof, () => null)
      const turn = (delta: 1 | -1) => () => void update($, bigProof, () => ({ plan: plan.slug, step: focused, index: turnPicture(bigAt, proof.files, delta) }))

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>{`증거 크게 보기 — ${focused + 1}. ${focusedStage.name}`}</Text>
            <Button key="big-close" label="✕ 닫기" onPress={closeBig} />
          </Box>
          <Svg source={bigPicture} alt={`증거 그림 크게 ${bigFile.path}`} />
          <Text dimColor>{shown.length > 1 ? `${bigFile.path} (${shown.indexOf(bigFile) + 1}/${shown.length})` : bigFile.path}</Text>
          <Box flexDirection="row" gap={1}>
            {shown.length > 1 ? <Button key="big-prev" label="◀ 이전" onPress={turn(-1)} /> : null}
            {shown.length > 1 ? <Button key="big-next" label="다음 ▶" onPress={turn(1)} /> : null}
            <Button key="big-open" label="새 창으로 열기" onPress={() => void openThing($, fullOf(bigFile.path))} />
            <Button key="big-back" label="돌아가기" onPress={closeBig} />
          </Box>
        </Box>
      )
    }

    const sections = sectionsOf(true, blocks.length > 0)

    return (
      <Box flexDirection="column">
        {mirrorLine}
        {topCards(sections)}
        {plans.length > 1 && Select ? (
          <Select
            key="plan"
            label="계획"
            value={plan.slug}
            options={pickerPlans(plans, plan.slug).map(one => ({ value: one.slug, label: `${one.title} (${one.status})` }))}
            onSelect={(value: string) => void update($, chosen, () => value)}
          />
        ) : null}
        {plan.isArchived ? <Text dimColor>진행 중인 계획이 없어 최근 끝난 계획을 보여 줍니다.</Text> : null}
        {plans.length > 1 && Select ? null : <Text bold>{plan.title}</Text>}
        <Text dimColor>{`상태: ${statusWords(plan.status, stages, plan.pausedBy ? titleOf(plans, plan.pausedBy) : '')}`}</Text>
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
                      alt={`${i + 1}단계 ${wordOf(stage.state, i)}`}
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
                      {isHere(stage.state) ? `${wordOf(stage.state, i)}  ◀ 지금 여기` : wordOf(stage.state, i)}
                    </Text>
                  </Box>
                </Box>
              ))}
            </Box>
            <Text dimColor>{`완료 ${count.done} · 진행 ${count.doing} · 막힘 ${count.blocked} · 대기 ${count.waiting} — 단계를 누르면 자세히`}</Text>
            {focusedStage && focused !== null ? (
              <Box flexDirection="column" borderStyle="round" borderColor={STATE_COLOR[focusedStage.state]} paddingX={1} marginTop={1}>
                <Text bold color={STATE_COLOR[focusedStage.state]}>{`${focused + 1}. ${focusedStage.name} — ${wordOf(focusedStage.state, focused)}`}</Text>
                <Text bold>하는 일</Text>
                {builds.length > 0 ? (
                  buildsPart(builds)
                ) : (
                  <Box flexDirection="column">
                    <Text>순수함수 없음</Text>
                    <Box paddingLeft={4}>
                      <Text dimColor>{focusedStage.role ?? focusedStage.name}</Text>
                    </Box>
                  </Box>
                )}
                {proof ? (
                  <Box flexDirection="column" marginTop={1}>
                    <Text bold>증거</Text>
                    {proof.files.map((file, i) => (
                      <Box flexDirection="column">
                        {Svg && pictures[i] ? <Svg source={pictures[i] as string} alt={`증거 그림 ${file.path}`} width={320} height={200} /> : null}
                        {Svg && pictures[i] && focused !== null ? (
                          <Button key={`evidence-big-${i}`} label="⤢ 크게 보기" onPress={() => void update($, bigProof, () => ({ plan: plan.slug, step: focused, index: i }))} />
                        ) : null}
                        <Button key={`evidence-${i}`} plain onPress={() => void openThing($, fullOf(file.path))}>
                          {`▸ ${file.path} 열기`}
                        </Button>
                      </Box>
                    ))}
                    {proof.note ? <Text color={proof.isMissing ? '#f85149' : undefined}>{proof.note}</Text> : null}
                    {proof.output ? <Text dimColor>{proof.output}</Text> : null}
                  </Box>
                ) : null}
                {focusedStage && isHere(focusedStage.state) ? (
                  <Box flexDirection="column" marginTop={1}>
                    <Text bold>지금 진행</Text>
                    {liveView && liveView.lines.length > 0 ? (
                      <Box flexDirection="column">
                        {liveView.ratio !== null ? (
                          <Box width="100%" height={1} backgroundColor="#21262d">
                            <Box width={`${Math.round(liveView.ratio * 100)}%`} height={1} backgroundColor="#4f8cff" />
                          </Box>
                        ) : null}
                        {liveView.lines.map(line => (
                          <Text dimColor>{line}</Text>
                        ))}
                      </Box>
                    ) : (
                      <Text dimColor>{liveSource?.log ? `로그가 아직 비어 있음 — ${liveSource.log}` : '진행 출처 없음 — 단계 시작 때 로그 파일이나 주소를 알리지 않았습니다'}</Text>
                    )}
                    {liveSource?.url ? (
                      <Button key="live-url" plain onPress={() => void openThing($, liveSource.url as string)}>
                        {`▸ 진행 화면 열기 — ${liveSource.url}`}
                      </Button>
                    ) : null}
                  </Box>
                ) : null}
                <Box marginTop={1}>
                  <Text bold>이 단계에서 한 일</Text>
                </Box>
                {did || work.length > 0 ? (
                  didPart(done)
                ) : (
                  <Text dimColor>기록 없음 — Claude가 이 세션에서 단계 시작을 알린 뒤의 작업만 셉니다</Text>
                )}
                {work.length > 0 ? (
                  <Button key="calls-toggle" plain onPress={() => void update($, showCalls, value => !value)}>
                    {`${callsOpen ? '▾' : '▸'} 도구 호출 ${work.length}건`}
                  </Button>
                ) : null}
                {callsOpen ? work.map(entry => <Text dimColor>{`${entry.tool}${entry.target ? `: ${entry.target}` : ''}`}</Text>) : null}
              </Box>
            ) : null}
            {message && !isActionNote(message) ? <Text color="#f85149">{message}</Text> : null}
          </>,
        )}

        {sections.includes('words') ? wordsCard() : null}
        <Button key="more-toggle" label={open.more ? '접기 — 진행률 · 시험 결과 · 변경 이력' : '더 보기 — 진행률 · 시험 결과 · 변경 이력'} onPress={() => void toggleMore().catch(() => undefined)} />
        {open.more ? (
          <Box flexDirection="column" marginTop={1}>
        {returnLine(plan, plans) ? <Text dimColor>{returnLine(plan, plans)}</Text> : null}
        {plan.history.length > 0 ? (
          <Box flexDirection="column">
            <Text dimColor>{`변경 이력 (최근 ${Math.min(3, plan.history.length)} / ${plan.history.length})`}</Text>
            {plan.history.slice(0, 3).map((entry, i) => (
              <Text key={`hist-${i}`} dimColor>{`· ${entry}`}</Text>
            ))}
          </Box>
        ) : null}
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
                    : turn === 'background'
                      ? '뒤의 일을 기다리는 중'
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
          </>,
          '#4f8cff',
        )}

        {nowCard(current && current.state === 'doing' ? { number: stages.indexOf(current) + 1, name: current.name } : null)}
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
          </Box>
        ) : null}
      </Box>
    )
  })
}

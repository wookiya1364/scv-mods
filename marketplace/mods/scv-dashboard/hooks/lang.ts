// The pane's language (after 0.6.2): which language the project's SCV settings name, the command that writes a
// new one, and the one step that turns a drawn Korean text into that language. Every function here is pure:
// the settings text and a saved table's text come in as arguments, and nothing is read or written.
//
// The Korean text is the key. A table maps a key to its text in another language; a key with slots is a shape:
//   {0} … {9}    any text (may be empty) — put through the table again, so a word inside it is changed too
//   {=0} … {=9}  a name: any text with no joint in it (' · ', ' — ', a line end) — said like {0}
//   {#0} … {#9}  a number or a clock time (digits with . , ~ · : / and spaces between runs), kept as it is
// A text the table does not hold is given back unchanged: what a person wrote stays as written.

import { WORDS } from './words'

export type Pack = Readonly<Record<string, string>>

export const LANG_KEY = 'SCV_LANG'
export const DEFAULT_LANG = 'korean'
export const LANG_NAME_MAX = 40

// The languages the pane carries a table for, with the name each one is picked by.
export const LANG_BUILT_IN = [
  { value: 'korean', label: '한국어' },
  { value: 'english', label: 'English' },
  { value: 'japanese', label: '日本語' },
] as const

export type LangPick = (typeof LANG_BUILT_IN)[number]['value'] | 'other'

const LANG_ALIAS: Record<string, string> = {
  ko: 'korean',
  kr: 'korean',
  한국어: 'korean',
  en: 'english',
  영어: 'english',
  ja: 'japanese',
  jp: 'japanese',
  日本語: 'japanese',
  일본어: 'japanese',
}

// A language name as the settings file keeps it: trimmed, lower case, one of the three known names for its
// aliases. null: not a name the file can keep (empty, too long, or with a character a file name cannot take).
export const cleanLang = (typed: unknown): string | null => {
  if (typeof typed !== 'string') return null
  const name = typed.trim().toLowerCase().replace(/\s+/g, ' ')
  if (name === '' || name.length > LANG_NAME_MAX) return null
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\p{N} ()_-]*$/u.test(name)) return null

  return LANG_ALIAS[name] ?? name
}

// The language the settings text names. A key that is missing, empty or of another shape is Korean, as the pane
// was before it could be picked. null: there is no settings text to read (not an SCV project).
export const langFromSettings = (settingsText: string | null | undefined): string | null => {
  if (!settingsText) return null
  try {
    const one = JSON.parse(settingsText) as Record<string, unknown> | null
    if (!one || typeof one !== 'object' || Array.isArray(one)) return null

    return cleanLang(one[LANG_KEY]) ?? DEFAULT_LANG
  } catch {
    return null
  }
}

// The picks of the language row, in the order drawn: the languages the pane carries, then any other by its name.
export const LANG_OPTIONS: readonly { value: LangPick; label: string }[] = [...LANG_BUILT_IN, { value: 'other', label: '기타' }]

// What the language row shows for a language: which of the picks it is, and the name to draw.
export const langChoice = (lang: string): { pick: LangPick; name: string } => {
  const known = LANG_BUILT_IN.find(one => one.value === lang)

  return known ? { pick: known.value, name: known.label } : { pick: 'other', name: lang }
}

// SCV's own settings command for the language: the one key, nothing else.
export const langSaveArgv = (core: string, lang: string): string[] => ['bash', `${core}/scripts/settings-set.sh`, `${LANG_KEY}=${lang}`]

// Where a project keeps the table of a language the pane carries none for.
export const packFile = (lang: string) => `scv/dashboard-lang/${lang.replace(/ /g, '-')}.json`

// A saved table as its file holds it: an object of text to text. A value that is not a non-empty text is left
// out. null: the text is not such an object.
export const parsePack = (text: string | null | undefined): Pack | null => {
  if (!text) return null
  try {
    const one = JSON.parse(text) as unknown
    if (!one || typeof one !== 'object' || Array.isArray(one)) return null

    return Object.fromEntries(Object.entries(one as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''))
  } catch {
    return null
  }
}

const column = (at: 0 | 1): Pack => Object.fromEntries(Object.entries(WORDS).map(([key, texts]) => [key, texts[at]]))

export const PACKS: Readonly<Record<string, Pack>> = { english: column(0), japanese: column(1) }

// The table a language is drawn with. Korean has none (the text is drawn as written). A language the pane carries
// no table for is drawn with its saved table over the English one, so a text the saved table lacks is English.
export const packFor = (lang: string | null, saved: Pack | null): Pack | null => {
  if (!lang || lang === DEFAULT_LANG) return null
  const own = PACKS[lang]
  if (own) return own

  return saved ? { ...PACKS.english, ...saved } : (PACKS.english ?? null)
}

const HANGUL = /[가-힣]/
const SLOT = /\{([#=]?)(\d)\}/g
const SEPARATORS = ['\n', ' · ', ' — '] as const
const MEMO_MAX = 4000
const MARKED = /^((?:[▸▾▴·│└•] )?)([\s\S]*?)((?: [▾▴])?)$/
const CLOCK_LEAD = /^((?:[0-9]{1,2}\/[0-9]{1,2} )?[0-9]{1,2}:[0-9]{2} )([\s\S]+)$/

// Step numbers are written with the same joint the pane joins its parts with ('1 · 3~5단계 막힘'): a part that is
// only numbers belongs to the part after it.
const joinNumbers = (parts: readonly string[]): string[] =>
  parts.reduce<string[]>((joined, part, i) => {
    const before = i > 0 ? parts[i - 1] : undefined
    const last = joined[joined.length - 1]

    return before !== undefined && last !== undefined && /^[0-9~]+$/.test(before) && /^[0-9~]+(?: · [0-9~]+)*단계/.test(`${before} · ${part}`) ? [...joined.slice(0, -1), `${last} · ${part}`] : [...joined, part]
  }, [])

type Shape = { test: RegExp; slots: { at: string; isNumber: boolean }[]; out: string; lead: string; weight: number }

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const shapeOf = (key: string, out: string): Shape => {
  const slots: Shape['slots'] = []
  const literals = key.split(SLOT).filter((_, i) => i % 3 === 0)
  let source = ''
  let last = 0
  for (const found of key.matchAll(SLOT)) {
    source += escapeRegExp(key.slice(last, found.index))
    source += found[1] === '#' ? '(-?[0-9][0-9.,~·:/ ]*?)' : found[1] === '=' ? '((?:(?! — | · |\\n)[\\s\\S])*?)' : '([\\s\\S]*?)'
    slots.push({ at: found[2] ?? '0', isNumber: found[1] === '#' })
    last = (found.index ?? 0) + found[0].length
  }
  source += escapeRegExp(key.slice(last))

  return { test: new RegExp(`^${source}$`), slots, out, lead: literals.reduce((best, one) => (one.length > best.length ? one : best), ''), weight: literals.join('').length }
}

// The step that turns one drawn text into the table's language. Whole text first, then the text inside the pane's
// own marks, then the shapes (the one with the most fixed text first), then the text without its outer spaces, then
// the text after a clock time in front,
// then its parts between line ends and the ' · ' and ' — ' joints. With no table (Korean) it gives every text back as it is.
export const toLang = (pack: Pack | null): ((text: string) => string) => {
  if (!pack) return text => text
  const exact = new Map<string, string>()
  const shapes: Shape[] = []
  for (const [key, out] of Object.entries(pack)) {
    if (/\{[#=]?\d\}/.test(key)) shapes.push(shapeOf(key, out))
    else exact.set(key, out)
  }
  shapes.sort((a, b) => b.weight - a.weight)
  const memo = new Map<string, string>()

  const byShape = (text: string): string | undefined => {
    for (const shape of shapes) {
      if (shape.lead && !text.includes(shape.lead)) continue
      const found = shape.test.exec(text)
      if (!found) continue
      const values = new Map(shape.slots.map((slot, i) => [slot.at, slot.isNumber ? (found[i + 1] ?? '') : say(found[i + 1] ?? '')]))

      return shape.out.replace(/\{(\d)\}/g, (_, at: string) => values.get(at) ?? '')
    }

    return undefined
  }

  const byTrim = (text: string): string | undefined => {
    const inner = text.trim()
    if (inner === text || inner === '') return undefined
    const said = exact.get(inner) ?? byShape(inner)

    return said === undefined ? undefined : text.replace(inner, () => said)
  }

  // A mark the pane draws around a text — an arrow or a bullet in front, an arrow behind — is kept and the text
  // inside it said.
  const byMark = (text: string): string | undefined => {
    const found = MARKED.exec(text)
    if (!found || (!found[1] && !found[3])) return undefined
    const inner = found[2] ?? ''
    const said = say(inner)

    return said === inner ? undefined : `${found[1] ?? ''}${said}${found[3] ?? ''}`
  }

  // A clock time in front ('14:02 …') is kept and the rest said.
  const byClock = (text: string): string | undefined => {
    const found = CLOCK_LEAD.exec(text)
    if (!found) return undefined
    const rest = found[2] ?? ''
    const said = say(rest)

    return said === rest ? undefined : `${found[1]}${said}`
  }

  const byParts = (text: string): string | undefined => {
    for (const joint of SEPARATORS) {
      if (!text.includes(joint)) continue
      const parts = joint === ' · ' ? joinNumbers(text.split(joint)) : text.split(joint)
      if (parts.length < 2) continue
      const said = parts.map(say)
      if (said.some((one, i) => one !== parts[i])) return said.join(joint)
    }

    return undefined
  }

  const say = (text: string): string => {
    if (!HANGUL.test(text)) return text
    const kept = memo.get(text)
    if (kept !== undefined) return kept
    const said = exact.get(text) ?? byMark(text) ?? byShape(text) ?? byTrim(text) ?? byClock(text) ?? byParts(text) ?? text
    if (memo.size >= MEMO_MAX) memo.clear()
    memo.set(text, said)

    return said
  }

  return say
}

// A drawn child, said: a text is changed, a list is changed item by item, anything else (an element already made,
// a number, nothing) is given back as it is.
export const sayChildren = <T,>(children: T, say: (text: string) => string): T =>
  (typeof children === 'string' ? say(children) : Array.isArray(children) ? children.map(one => sayChildren(one as unknown, say)) : children) as T

const SAID_PROPS = ['label', 'placeholder', 'submitLabel', 'alt', 'title'] as const

// An element's props with the texts a person reads said: its children, its label, placeholder, alt and title, and
// the labels of its options (its submit label too). Values a person typed or picks by (value, key, source) are never touched.
export const sayProps = <P extends Record<string, unknown>>(props: P, say: (text: string) => string): P => {
  if (!props || typeof props !== 'object') return props
  const said: Record<string, unknown> = { ...props }
  for (const name of SAID_PROPS) if (typeof said[name] === 'string') said[name] = say(said[name])
  if ('children' in said) said.children = sayChildren(said.children, say)
  if (Array.isArray(said.options))
    said.options = (said.options as unknown[]).map(one =>
      one && typeof one === 'object' && typeof (one as { label?: unknown }).label === 'string' ? { ...one, label: say((one as { label: string }).label) } : one,
    )

  return said as P
}

// The elements a surface hands out, each drawing its texts in the table's language. Box only places its
// children, so it is left as it is — the texts inside were already said by the element that holds them.
export const sayElements = <E extends object>(elements: E, say: (text: string) => string): E =>
  Object.fromEntries(
    Object.entries(elements).map(([name, make]) => [
      name,
      typeof make === 'function' && name !== 'Box' ? (props: Record<string, unknown>) => (make as (props: unknown) => unknown)(sayProps(props, say)) : make,
    ]),
  ) as E

// What the session is asked once when a language the pane carries no table for is picked: translate the English
// column of the pane's own table and write it where the pane reads it.
export const packRequest = (input: { lang: string; file: string; source: string }) =>
  [
    `[SCV dashboard] Translate the SCV pane's words into ${input.lang}.`,
    `1. Read ${input.source} — WORDS maps each Korean key to [English, Japanese].`,
    `2. Write ${input.file} as one JSON object: every Korean key, unchanged, mapped to its ${input.lang} text (translate the English text; keep it as short as the English).`,
    '3. Keep every {0} … {9} slot of the English text in the translation, with the same numbers. Keep symbols (▾ ▸ ◀ ▶ ✕ ⤢ → · —), slash commands, file names and SCV as they are.',
    '4. Write nothing else and change no other file. Then say in one line that the pane will draw in this language after its next refresh.',
  ].join('\n')

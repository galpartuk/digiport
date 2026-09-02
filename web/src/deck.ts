import type { Card, CardIndex } from './cards'

export type Deck = {
  id: string
  name: string
  /** card id -> copies. Digi-Eggs live in `eggs`, everything else in `main`. */
  main: Record<string, number>
  eggs: Record<string, number>
  updatedAt: number
}

export const MAIN_SIZE = 50
export const EGG_SIZE = 5
export const MAX_COPIES = 4

export function newDeck(name = 'Untitled deck'): Deck {
  return { id: crypto.randomUUID(), name, main: {}, eggs: {}, updatedAt: Date.now() }
}

export function slotFor(card: Card): 'main' | 'eggs' {
  return card.cardType === 'Digi-Egg' ? 'eggs' : 'main'
}

export function count(deck: Deck, id: string): number {
  return (deck.main[id] ?? 0) + (deck.eggs[id] ?? 0)
}

export function total(pile: Record<string, number>): number {
  let n = 0
  for (const k in pile) n += pile[k]
  return n
}

/** Copies allowed by the ban list. Regular cards cap at 4. */
export function copyLimit(card: Card): number {
  if (card.restriction === 'Banned') return 0
  if (card.restriction === 'Restricted to 1') return 1
  return MAX_COPIES
}

export function addCard(deck: Deck, card: Card, delta = 1): Deck {
  const slot = slotFor(card)
  const pile = { ...deck[slot] }
  const next = (pile[card.id] ?? 0) + delta
  if (next <= 0) delete pile[card.id]
  else pile[card.id] = Math.min(next, copyLimit(card))
  return { ...deck, [slot]: pile, updatedAt: Date.now() }
}

export type Problem = { level: 'error' | 'warn'; text: string }

export function validate(deck: Deck, index: CardIndex): Problem[] {
  const problems: Problem[] = []
  const mainTotal = total(deck.main)
  const eggTotal = total(deck.eggs)

  if (mainTotal !== MAIN_SIZE) {
    problems.push({
      level: 'error',
      text: `Main deck has ${mainTotal} cards — needs exactly ${MAIN_SIZE}.`,
    })
  }
  if (eggTotal > EGG_SIZE) {
    problems.push({ level: 'error', text: `Egg deck has ${eggTotal} cards — max ${EGG_SIZE}.` })
  }

  const choiceRestricted: string[] = []
  for (const [id, n] of [...Object.entries(deck.main), ...Object.entries(deck.eggs)]) {
    const card = index.byId.get(id)
    if (!card) {
      problems.push({ level: 'error', text: `Unknown card id ${id}.` })
      continue
    }
    const limit = copyLimit(card)
    if (limit === 0) {
      problems.push({ level: 'error', text: `${card.name} (${id}) is banned.` })
    } else if (n > limit) {
      problems.push({
        level: 'error',
        text: `${n}x ${card.name} (${id}) — limit is ${limit}.`,
      })
    }
    if (card.restriction === 'Choice Restriction') choiceRestricted.push(`${card.name} (${id})`)
    if (!card.released) {
      problems.push({ level: 'warn', text: `${card.name} (${id}) is not released in English yet.` })
    }
  }

  // The data carries no grouping for choice-restricted sets, so this is a
  // nudge rather than a verdict: only one card per official group is legal.
  if (choiceRestricted.length > 1) {
    problems.push({
      level: 'warn',
      text: `Choice-restricted cards present (${choiceRestricted.join(', ')}) — ` +
        'check they are not from the same restriction group.',
    })
  }
  return problems
}

// ---------------------------------------------------------------- statistics

export type Stats = {
  byType: Record<string, number>
  byColor: Record<string, number>
  /** play cost -> copies, for the curve. Cards without a cost are skipped. */
  curve: Record<number, number>
  byLevel: Record<number, number>
}

export function stats(deck: Deck, index: CardIndex): Stats {
  const s: Stats = { byType: {}, byColor: {}, curve: {}, byLevel: {} }
  for (const [id, n] of Object.entries(deck.main)) {
    const card = index.byId.get(id)
    if (!card) continue
    s.byType[card.cardType] = (s.byType[card.cardType] ?? 0) + n
    for (const col of card.colors) s.byColor[col] = (s.byColor[col] ?? 0) + n
    if (card.playCost !== undefined) {
      const bucket = Math.min(card.playCost, 10)
      s.curve[bucket] = (s.curve[bucket] ?? 0) + n
    }
    if (card.level !== undefined) s.byLevel[card.level] = (s.byLevel[card.level] ?? 0) + n
  }
  return s
}

// ------------------------------------------------------------ import/export

export function exportText(deck: Deck, index: CardIndex): string {
  const line = (id: string, n: number) => {
    const card = index.byId.get(id)
    return `${n} ${id}${card ? ` ${card.name}` : ''}`
  }
  const order = (pile: Record<string, number>) =>
    Object.entries(pile).sort(([a], [b]) => {
      const ca = index.byId.get(a)
      const cb = index.byId.get(b)
      return (ca?.level ?? 99) - (cb?.level ?? 99) ||
        (ca?.playCost ?? 99) - (cb?.playCost ?? 99) || a.localeCompare(b)
    })

  const out = [`// ${deck.name}`, '']
  if (total(deck.eggs)) {
    out.push('// Egg deck')
    for (const [id, n] of order(deck.eggs)) out.push(line(id, n))
    out.push('')
  }
  out.push('// Main deck')
  for (const [id, n] of order(deck.main)) out.push(line(id, n))
  return out.join('\n')
}

/**
 * The id shape. The digits after the set letters are optional because promos
 * and Limited cards do not have any — P-224, LM-001 — and requiring them
 * silently dropped every one of those 311 cards on import.
 */
const ID = String.raw`[A-Z]{1,4}\d{0,2}-\d{1,3}[A-Za-z0-9_-]*`

/** `4 BT1-010 Agumon`, `BT1-010 x4`, `4x BT1-010` and bare ids all parse. */
const TEXT_LINE = new RegExp(String.raw`^\s*(?:(\d+)\s*x?\s+)?(${ID})\s*(?:x\s*(\d+))?`, 'i')

/** The same id anywhere in the line, for lists that lead with the card name. */
const LOOSE_ID = new RegExp(String.raw`\b(${ID})\b`, 'i')
const LEADING_COUNT = /^\s*(\d+)\s*x?\b/

/**
 * One line of a deck list. A line that names a card is never dropped in
 * silence: whatever id it carries goes through to `resolve`, which either
 * finds the card or reports it in `missing`.
 */
function parseLine(line: string): [string, number] | null {
  const exact = TEXT_LINE.exec(line)
  if (exact) return [exact[2].toUpperCase(), Number(exact[1] ?? exact[3] ?? 1)]

  const loose = LOOSE_ID.exec(line)
  if (!loose) return null
  const count = LEADING_COUNT.exec(line)
  return [loose[1].toUpperCase(), count ? Number(count[1]) : 1]
}

export type ImportResult = { deck: Deck; missing: string[] }

/**
 * Accepts our own text format, the one-line-per-card format every other
 * Digimon site exports, and the JSON shape used by digimoncard.dev / Drasil
 * (`{ cards: [{ cardNumber, count }] }`, with assorted key spellings).
 */
export function importDeck(raw: string, index: CardIndex, name?: string): ImportResult {
  const entries: Array<[string, number]> = []

  const json = tryJson(raw)
  if (json) {
    const list: any[] = Array.isArray(json)
      ? json
      : json.cards ?? json.mainDeck ?? json.deck ?? json.list ?? []
    for (const row of list) {
      if (typeof row === 'string') {
        entries.push([row, 1])
        continue
      }
      const id = row.cardNumber ?? row.cardnumber ?? row.id ?? row.number ?? row.card
      const n = row.count ?? row.quantity ?? row.qty ?? row.amount ?? 1
      if (id) entries.push([String(id), Number(n) || 1])
    }
    // Some exports keep the egg deck in its own array.
    for (const key of ['eggDeck', 'digiEggs', 'eggs', 'sideDeck']) {
      for (const row of (json as any)[key] ?? []) {
        const id = row?.cardNumber ?? row?.id ?? row?.number ?? row
        const n = row?.count ?? row?.quantity ?? row?.qty ?? 1
        if (id) entries.push([String(id), Number(n) || 1])
      }
    }
    if (!name && typeof json.name === 'string') name = json.name
  } else {
    for (const line of raw.split(/\r?\n/)) {
      if (/^\s*(?:\/\/|#)/.test(line)) continue
      const entry = parseLine(line)
      if (entry) entries.push(entry)
    }
  }

  let deck = newDeck(name || 'Imported deck')
  const missing: string[] = []
  for (const [rawId, n] of entries) {
    const card = resolve(rawId, index)
    if (!card) {
      missing.push(rawId)
      continue
    }
    deck = addCard(deck, card, n)
  }
  return { deck, missing }
}

function tryJson(raw: string): any | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

/** Ids differ across sites in zero padding and alt-art suffix: BT1-10 == BT1-010 == BT1-010_P1. */
function resolve(rawId: string, index: CardIndex): Card | undefined {
  const id = rawId.trim().toUpperCase()
  const direct = index.byId.get(id)
  if (direct) return direct
  const base = id.split('_')[0]
  return index.byId.get(base) ??
    index.all.find((c) => normalise(c.id) === normalise(base))
}

function normalise(id: string): string {
  const m = /^([A-Z]+\d*)-0*(\d+)$/.exec(id)
  return m ? `${m[1]}-${m[2]}` : id
}

// ------------------------------------------------------------------ storage

const KEY = 'digiport.decks.v1'

export function loadDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const decks = JSON.parse(raw) as Deck[]
    return Array.isArray(decks) ? decks : []
  } catch {
    return []
  }
}

export function saveDecks(decks: Deck[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(decks))
  } catch {
    // Private windows and full quotas both land here; the session still works.
  }
}

// The card record as build_cards.py emits it. Falsy fields are dropped at build
// time, so almost everything here is optional.
export type CardType = 'Digimon' | 'Option' | 'Tamer' | 'Digi-Egg'

export type DigivolveCondition = { color: string; cost: string; level: string }

export type Card = {
  id: string
  name: string
  cardType: CardType
  colors: string[]
  level?: number
  playCost?: number
  dp?: number
  form?: string
  attribute?: string
  types?: string[]
  rarity?: string
  setCode: string
  setPrefix: string
  setCategory?: string
  effect?: string
  inheritedEffect?: string
  securityEffect?: string
  digivolveCondition?: DigivolveCondition[]
  digiXros?: string
  dnaDigivolve?: string
  aceEffect?: string
  linkRequirement?: string
  linkDP?: number
  rule?: string
  restriction?: 'Unrestricted' | 'Restricted to 1' | 'Choice Restriction' | 'Banned' | 'Not released'
  released: boolean
  altArtCount?: number
  tcgplayerId?: number
  setReleased?: string
  jp?: string
  /** index into meta.hosts — the art host digimondle resolved for this card */
  h: number
}

export type Meta = {
  count: number
  hosts: string[]
  sets: string[]
  types: string[]
  banned: string[]
  restricted: string[]
}

export type CardIndex = {
  all: Card[]
  byId: Map<string, Card>
  meta: Meta
  /** lowercased haystack per card id, built once for text search */
  search: Map<string, string>
}

export const COLORS = ['Red', 'Blue', 'Yellow', 'Green', 'Black', 'Purple', 'White'] as const
export const CARD_TYPES: CardType[] = ['Digimon', 'Digi-Egg', 'Tamer', 'Option']
export const FORMS = [
  'In-Training', 'Rookie', 'Champion', 'Ultimate', 'Mega', 'Armor Form', 'Hybrid',
]

export async function loadCards(base = import.meta.env.BASE_URL): Promise<CardIndex> {
  const [all, meta] = await Promise.all([
    fetch(`${base}data/cards.json`).then((r) => r.json() as Promise<Card[]>),
    fetch(`${base}data/meta.json`).then((r) => r.json() as Promise<Meta>),
  ])
  const byId = new Map(all.map((c) => [c.id, c]))
  const search = new Map(all.map((c) => [c.id, haystack(c)]))
  return { all, byId, meta, search }
}

function haystack(c: Card): string {
  return [
    c.id, c.name, c.jp, c.form, c.attribute, c.rarity,
    c.types?.join(' '), c.effect, c.inheritedEffect, c.securityEffect,
    c.aceEffect, c.digiXros, c.dnaDigivolve, c.rule,
  ].filter(Boolean).join(' ').toLowerCase()
}

/** Art URL. `attempt` walks the host list so onError can retry a second host. */
export function imageUrl(card: Card, meta: Meta, attempt = 0): string {
  const host = meta.hosts[(card.h + attempt) % meta.hosts.length]
  return host.replace('{id}', card.id)
}

export type Filters = {
  text: string
  colors: string[]
  /** true = a card must have every picked colour, false = any of them */
  colorsExact: boolean
  types: CardType[]
  levels: number[]
  costs: number[]
  forms: string[]
  sets: string[]
  includeUnreleased: boolean
}

export const EMPTY_FILTERS: Filters = {
  text: '', colors: [], colorsExact: false, types: [], levels: [], costs: [],
  forms: [], sets: [], includeUnreleased: false,
}

export function filterCards(index: CardIndex, f: Filters): Card[] {
  const text = f.text.trim().toLowerCase()
  // Every space-separated term must appear somewhere in the card.
  const terms = text ? text.split(/\s+/) : []

  return index.all.filter((c) => {
    if (!f.includeUnreleased && !c.released) return false
    if (f.types.length && !f.types.includes(c.cardType)) return false
    if (f.forms.length && (!c.form || !f.forms.includes(c.form))) return false
    if (f.sets.length && !f.sets.includes(c.setCode)) return false
    if (f.levels.length && (c.level === undefined || !f.levels.includes(c.level))) return false
    if (f.costs.length) {
      const cost = c.playCost
      // 10 is the "10+" bucket.
      const hit = cost !== undefined && f.costs.some((v) => (v === 10 ? cost >= 10 : cost === v))
      if (!hit) return false
    }
    if (f.colors.length) {
      const has = f.colorsExact
        ? f.colors.every((col) => c.colors.includes(col))
        : f.colors.some((col) => c.colors.includes(col))
      if (!has) return false
    }
    if (terms.length) {
      const hay = index.search.get(c.id)!
      if (!terms.every((t) => hay.includes(t))) return false
    }
    return true
  })
}

/** Deckbuilding sort: type, then level, then cost, then id. */
export function sortCards(cards: Card[]): Card[] {
  const typeRank: Record<string, number> = { 'Digi-Egg': 0, Digimon: 1, Tamer: 2, Option: 3 }
  return [...cards].sort((a, b) =>
    (typeRank[a.cardType] ?? 9) - (typeRank[b.cardType] ?? 9) ||
    (a.level ?? 99) - (b.level ?? 99) ||
    (a.playCost ?? 99) - (b.playCost ?? 99) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id))
}

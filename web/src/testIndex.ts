import { readFileSync } from 'node:fs'
import { buildIndex, type Card, type CardIndex, type Meta } from './cards'

/**
 * The real card payload, read straight off disk. Fixtures made up by hand
 * would not catch the things that actually break — zero-padded ids, alt-art
 * suffixes, banned cards, cards with no play cost.
 */
let cached: CardIndex | null = null

export function realIndex(): CardIndex {
  if (cached) return cached
  const read = <T>(name: string): T =>
    JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8')) as T
  cached = buildIndex(read<Card[]>('cards.json'), read<Meta>('meta.json'))
  return cached
}

/** First card matching a predicate, with a useful failure when the pool moves. */
export function pick(index: CardIndex, why: string, match: (c: Card) => boolean): Card {
  const card = index.all.find(match)
  if (!card) throw new Error(`no card in the pool for: ${why}`)
  return card
}

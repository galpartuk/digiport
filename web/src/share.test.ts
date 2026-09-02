import { describe, expect, it } from 'vitest'
import { addCard, copyLimit, newDeck, total } from './deck'
import {
  decodeDeck, encodeDeck, hashPayload, hashWithoutPayload,
  HASH_PREFIX, ROUTE_HASH_PREFIX, shareHash,
} from './share'
import { realIndex } from './testIndex'

const index = realIndex()

function sampleDeck() {
  const pool = index.all.filter((c) => c.cardType !== 'Digi-Egg' && c.released && copyLimit(c) === 4)
  const eggs = index.all.filter((c) => c.cardType === 'Digi-Egg' && c.released)
  let deck = newDeck('Sample — 50 & 5')
  for (let i = 0; i < 12; i++) deck = addCard(deck, pool[i], 4)
  deck = addCard(deck, pool[12], 2)
  deck = addCard(deck, eggs[0], 4)
  deck = addCard(deck, eggs[1], 1)
  return deck
}

describe('share links', () => {
  it('round-trips a full deck through the hash', async () => {
    const deck = sampleDeck()
    const back = await decodeDeck(await encodeDeck(deck))
    expect(back).not.toBeNull()
    expect(back!.name).toBe(deck.name)
    expect(back!.main).toEqual(deck.main)
    expect(back!.eggs).toEqual(deck.eggs)
    expect(total(back!.main)).toBe(50)
    expect(total(back!.eggs)).toBe(5)
  })

  it('gives the decoded deck its own id so a shared link never collides', async () => {
    const deck = sampleDeck()
    const back = await decodeDeck(await encodeDeck(deck))
    expect(back!.id).not.toBe(deck.id)
  })

  it('stays URL-safe and short enough to paste', async () => {
    const code = await encodeDeck(sampleDeck())
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(code.length).toBeLessThan(400)
  })

  it('round-trips an empty deck', async () => {
    const back = await decodeDeck(await encodeDeck(newDeck('Empty')))
    expect(back!.main).toEqual({})
    expect(back!.eggs).toEqual({})
  })

  it('wraps and unwraps the hash it emits', async () => {
    const hash = await shareHash(sampleDeck())
    expect(hash.startsWith(ROUTE_HASH_PREFIX)).toBe(true)
    expect(hashPayload(hash)).toBe(hash.slice(ROUTE_HASH_PREFIX.length))
    expect(await decodeDeck(hashPayload(hash)!)).not.toBeNull()
  })

  it('emits a hash the router can also read as the builder route', async () => {
    const hash = await shareHash(sampleDeck())
    expect(hash.slice(1).split('?')[0]).toBe('/')
  })

  it('still reads the original #d= links, which are already out in the world', async () => {
    const code = await encodeDeck(sampleDeck())
    const legacy = HASH_PREFIX + code
    expect(hashPayload(legacy)).toBe(code)
    expect(await decodeDeck(hashPayload(legacy)!)).not.toBeNull()
  })

  it('reads the payload out of a route hash whatever else the query holds', async () => {
    const code = await encodeDeck(sampleDeck())
    expect(hashPayload(`#/?d=${code}`)).toBe(code)
    expect(hashPayload(`#/?from=chat&d=${code}`)).toBe(code)
    expect(hashPayload(`#/play?mode=goldfish&d=${code}`)).toBe(code)
  })

  it('ignores a hash that is not a shared deck', () => {
    expect(hashPayload('')).toBeNull()
    expect(hashPayload('#play')).toBeNull()
    expect(hashPayload('#/')).toBeNull()
    expect(hashPayload('#/play?mode=hotseat&a=one&b=two')).toBeNull()
    expect(hashPayload('#d=')).toBeNull()
  })

  it('strips the payload and leaves the route alone', async () => {
    const code = await encodeDeck(sampleDeck())
    expect(hashWithoutPayload(`#/?d=${code}`)).toBe('#/')
    expect(hashWithoutPayload(`#/?d=${code}&from=chat`)).toBe('#/?from=chat')
    expect(hashWithoutPayload(`#/play?mode=goldfish&d=${code}`)).toBe('#/play?mode=goldfish')
    // The original form carried nothing but the deck, so it collapses to the
    // builder route rather than to an empty hash the router cannot read.
    expect(hashWithoutPayload(HASH_PREFIX + code)).toBe('#/')
  })

  // The builder moved to /decks and `/` became the home page, but both share
  // forms still name `/` — the emitted hash is deliberately unchanged. What
  // the root does with the payload it adopts is routing's problem, not this
  // module's; all that matters here is that a payload reads and strips the
  // same way on whichever route it turns up.
  it('reads and strips a payload on the builder route as well', async () => {
    const code = await encodeDeck(sampleDeck())
    expect(hashPayload(`#/decks?d=${code}`)).toBe(code)
    expect(hashWithoutPayload(`#/decks?d=${code}`)).toBe('#/decks')
    expect(hashPayload('#/decks?deck=abc')).toBeNull()
    expect(hashWithoutPayload('#/decks?deck=abc')).toBe('#/decks?deck=abc')
  })

  it('leaves a hash with no payload untouched', () => {
    expect(hashWithoutPayload('#/play?mode=hotseat&a=one&b=two'))
      .toBe('#/play?mode=hotseat&a=one&b=two')
    expect(hashWithoutPayload('#/')).toBe('#/')
  })

  it('returns null for a corrupted payload instead of throwing', async () => {
    expect(await decodeDeck('not-a-deck')).toBeNull()
    expect(await decodeDeck('')).toBeNull()
    const code = await encodeDeck(sampleDeck())
    expect(await decodeDeck(code.slice(0, code.length - 8))).toBeNull()
  })

  it('drops junk counts from a hand-edited link', async () => {
    const hostile = { n: 'Hostile', m: { 'BT1-010': 4, 'BT1-011': -3, 'BT1-012': 'x' }, e: null }
    const bytes = new TextEncoder().encode(JSON.stringify(hostile))
    const compressed = new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')),
    )
    const raw = new Uint8Array(await compressed.arrayBuffer())
    let binary = ''
    for (const b of raw) binary += String.fromCharCode(b)
    const code = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const back = await decodeDeck(code)
    expect(back!.main).toEqual({ 'BT1-010': 4 })
    expect(back!.eggs).toEqual({})
  })
})

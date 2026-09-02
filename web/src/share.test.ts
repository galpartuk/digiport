import { describe, expect, it } from 'vitest'
import { addCard, copyLimit, newDeck, total } from './deck'
import { decodeDeck, encodeDeck, hashPayload, HASH_PREFIX, shareHash } from './share'
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

  it('wraps and unwraps the #d= hash', async () => {
    const hash = await shareHash(sampleDeck())
    expect(hash.startsWith(HASH_PREFIX)).toBe(true)
    expect(hashPayload(hash)).toBe(hash.slice(HASH_PREFIX.length))
    expect(await decodeDeck(hashPayload(hash)!)).not.toBeNull()
  })

  it('ignores a hash that is not a shared deck', () => {
    expect(hashPayload('')).toBeNull()
    expect(hashPayload('#play')).toBeNull()
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

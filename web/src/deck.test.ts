import { describe, expect, it } from 'vitest'
import {
  addCard, copyLimit, count, exportText, importDeck, newDeck, sharedLimit, stats, total,
  validate, EGG_SIZE, MAIN_SIZE, MAX_COPIES, type Deck,
} from './deck'
import type { Card } from './cards'
import { pick, realIndex } from './testIndex'

const index = realIndex()

const unrestricted = pick(index, 'an unrestricted Digimon', (c) =>
  c.cardType === 'Digimon' && c.released && copyLimit(c) === 4)
const egg = pick(index, 'a Digi-Egg', (c) => c.cardType === 'Digi-Egg' && c.released)
const limitedToOne = pick(index, 'a restricted-to-1 card', (c) => c.restriction === 'Restricted to 1')
const banned = pick(index, 'a banned card', (c) => c.restriction === 'Banned')

/** A legal 50 + 5 deck built from whatever the current pool offers. */
function legalDeck(): Deck {
  const mainPool = index.all.filter((c) =>
    c.cardType !== 'Digi-Egg' && c.released && copyLimit(c) === 4)
  const eggPool = index.all.filter((c) => c.cardType === 'Digi-Egg' && c.released)
  const full = Math.floor(MAIN_SIZE / 4)
  let deck = newDeck('Legal deck')
  for (let i = 0; i < full; i++) deck = addCard(deck, mainPool[i], 4)
  if (MAIN_SIZE % 4) deck = addCard(deck, mainPool[full], MAIN_SIZE % 4)
  deck = addCard(deck, eggPool[0], 4)
  deck = addCard(deck, eggPool[1], EGG_SIZE - 4)
  return deck
}

describe('addCard', () => {
  it('caps an ordinary card at four copies', () => {
    let deck = newDeck()
    for (let i = 0; i < 9; i++) deck = addCard(deck, unrestricted, 1)
    expect(deck.main[unrestricted.id]).toBe(4)
    expect(addCard(deck, unrestricted, 7).main[unrestricted.id]).toBe(4)
  })

  it('caps a restricted card at one', () => {
    const deck = addCard(newDeck(), limitedToOne, 4)
    expect(deck.main[limitedToOne.id]).toBe(1)
    expect(copyLimit(limitedToOne)).toBe(1)
  })

  it('refuses to hold a banned card, without leaving an entry at zero', () => {
    const deck = addCard(newDeck(), banned, 3)
    expect(copyLimit(banned)).toBe(0)
    expect(count(deck, banned.id)).toBe(0)
    // A 0-count entry would still draw a row in the deck panel.
    expect(banned.id in deck.main).toBe(false)
    expect(banned.id in deck.eggs).toBe(false)
    expect(Object.keys(deck.main)).toEqual([])
  })

  it('lets a card raise its own ceiling from its rule text', () => {
    const fifty = pick(index, 'a card that allows 50 copies', (c) =>
      /include up to 50 copies/i.test(c.rule ?? ''))
    expect(copyLimit(fifty)).toBe(50)
    const deck = addCard(newDeck(), fifty, 60)
    expect(deck.main[fifty.id]).toBe(50)
    expect(validate(deck, index).some((p) => p.text.includes('limit is'))).toBe(false)
  })

  it('still caps an ordinary card at four even next to an unlimited one', () => {
    expect(copyLimit(unrestricted)).toBe(MAX_COPIES)
  })

  it('puts Digi-Eggs in the egg deck and everything else in main', () => {
    let deck = addCard(newDeck(), egg, 2)
    deck = addCard(deck, unrestricted, 2)
    expect(deck.eggs[egg.id]).toBe(2)
    expect(deck.main[egg.id]).toBeUndefined()
    expect(deck.main[unrestricted.id]).toBe(2)
  })

  it('removes the entry entirely at zero, and never goes negative', () => {
    let deck = addCard(newDeck(), unrestricted, 2)
    deck = addCard(deck, unrestricted, -2)
    expect(unrestricted.id in deck.main).toBe(false)
    deck = addCard(deck, unrestricted, -1)
    expect(count(deck, unrestricted.id)).toBe(0)
  })

  it('does not mutate the deck it was given', () => {
    const before = addCard(newDeck(), unrestricted, 1)
    const snapshot = JSON.stringify(before.main)
    addCard(before, unrestricted, 1)
    expect(JSON.stringify(before.main)).toBe(snapshot)
  })
})

describe('validate', () => {
  it('passes a legal 50 + 5 deck', () => {
    expect(validate(legalDeck(), index).filter((p) => p.level === 'error')).toEqual([])
  })

  it('reports a main deck that is not exactly 50', () => {
    const deck = addCard(newDeck(), unrestricted, 4)
    const errors = validate(deck, index).filter((p) => p.level === 'error')
    expect(errors.some((p) => p.text.includes('needs exactly 50'))).toBe(true)
  })

  it('reports an oversized egg deck', () => {
    let deck = legalDeck()
    const extraEggs = index.all.filter((c) => c.cardType === 'Digi-Egg' && c.released)
    deck = addCard(deck, extraEggs[2], 4)
    expect(total(deck.eggs)).toBeGreaterThan(EGG_SIZE)
    expect(validate(deck, index).some((p) => p.text.includes('max 5'))).toBe(true)
  })

  it('reports an unknown id', () => {
    const deck: Deck = { ...newDeck(), main: { 'NOPE-999': 1 } }
    expect(validate(deck, index).some((p) => p.text.includes('Unknown card id'))).toBe(true)
  })

  it('reports a banned card and an over-the-limit count that got in another way', () => {
    const deck: Deck = { ...newDeck(), main: { [banned.id]: 1, [limitedToOne.id]: 3 } }
    const texts = validate(deck, index).map((p) => p.text)
    expect(texts.some((t) => t.includes('is banned'))).toBe(true)
    expect(texts.some((t) => t.includes('limit is 1'))).toBe(true)
  })

  it('catches a reprint pair that shares one four-copy allowance', () => {
    const reprint = pick(index, 'a reprint sharing a limit', (c) => sharedLimit(c) !== null)
    const { partner, limit } = sharedLimit(reprint)!
    expect(index.byId.get(partner)).toBeDefined()

    const legal: Deck = { ...newDeck(), main: { [reprint.id]: 2, [partner]: 2 } }
    expect(validate(legal, index).some((p) => p.text.includes('together'))).toBe(false)

    const over: Deck = { ...newDeck(), main: { [reprint.id]: 3, [partner]: 2 } }
    const problem = validate(over, index).find((p) => p.text.includes('together'))
    expect(problem?.level).toBe('error')
    expect(problem?.text).toContain(`limit is ${limit} across both`)
  })

  it('warns about a card that is not released in English', () => {
    const unreleased = pick(index, 'an unreleased card', (c) => !c.released)
    const deck: Deck = { ...newDeck(), main: { [unreleased.id]: 1 } }
    const warns = validate(deck, index).filter((p) => p.level === 'warn')
    expect(warns.some((p) => p.text.includes('not released'))).toBe(true)
  })
})

describe('stats', () => {
  it('counts type, colour, curve and level over the main deck', () => {
    const deck = addCard(newDeck(), unrestricted, 4)
    const s = stats(deck, index)
    expect(s.byType[unrestricted.cardType]).toBe(4)
    for (const color of unrestricted.colors) expect(s.byColor[color]).toBe(4)
    if (unrestricted.playCost !== undefined) {
      expect(s.curve[Math.min(unrestricted.playCost, 10)]).toBe(4)
    }
    if (unrestricted.level !== undefined) expect(s.byLevel[unrestricted.level]).toBe(4)
  })

  it('buckets every cost of 10 or more together', () => {
    const big = index.all.filter((c) => (c.playCost ?? 0) >= 10 && c.cardType !== 'Digi-Egg')
    let deck = newDeck()
    for (const card of big.slice(0, 3)) deck = addCard(deck, card, 1)
    expect(stats(deck, index).curve[10]).toBe(Math.min(3, big.length))
    expect(stats(deck, index).curve[11]).toBeUndefined()
  })
})

describe('exportText / importDeck', () => {
  it('round-trips a full deck exactly', () => {
    const deck = legalDeck()
    const { deck: back, missing } = importDeck(exportText(deck, index), index)
    expect(missing).toEqual([])
    expect(back.main).toEqual(deck.main)
    expect(back.eggs).toEqual(deck.eggs)
  })

  it('takes the deck name from the export comment when none is given', () => {
    const text = exportText(legalDeck(), index)
    expect(text.startsWith('// Legal deck')).toBe(true)
    // Comment lines are skipped, so the name comes from the caller instead.
    expect(importDeck(text, index, 'Renamed').deck.name).toBe('Renamed')
  })

  it.each([
    ['4 BT1-010 Agumon', 4],
    ['BT1-010 x4', 4],
    ['4x BT1-010', 4],
    ['BT1-010', 1],
  ])('parses %s', (line, expected) => {
    const { deck, missing } = importDeck(line, index)
    expect(missing).toEqual([])
    expect(deck.main['BT1-010']).toBe(expected)
  })

  it('accepts an id that is missing its zero padding', () => {
    expect(importDeck('3 BT1-10', index).deck.main['BT1-010']).toBe(3)
  })

  it('imports promo and Limited ids, whose set prefix has no digits', () => {
    const { deck, missing } = importDeck('3 P-224 Kotone Amano\n2 LM-001', index)
    expect(missing).toEqual([])
    expect(deck.main['P-224']).toBe(3)
    expect(count(deck, 'LM-001')).toBe(2)
  })

  it('round-trips a deck containing a promo', () => {
    const promo = pick(index, 'a promo card', (c) =>
      c.id.startsWith('P-') && c.cardType !== 'Digi-Egg' && copyLimit(c) === 4)
    const deck = addCard(addCard(newDeck('Promos'), promo, 3), unrestricted, 4)
    const { deck: back, missing } = importDeck(exportText(deck, index), index)
    expect(missing).toEqual([])
    expect(back.main).toEqual(deck.main)
  })

  it('reads a list that puts the name before the id', () => {
    const { deck, missing } = importDeck('3x Kotone Amano (P-224)', index)
    expect(missing).toEqual([])
    expect(deck.main['P-224']).toBe(3)
  })

  it('imports the whole of a real red-hybrid list, promo included', () => {
    const list = [
      '// Egg deck', '4 BT10-003 Pickmons', '', '// Main deck',
      '3 BT10-029 Starmons', '4 BT19-008 Shoutmon', '2 BT19-057 Sparrowmon',
      '3 BT19-035 ShootingStarmon', '3 BT19-061 RaptorSparrowmon',
      '1 BT19-012 OmniShoutmon', '3 BT19-038 JaegerDorulumon',
      '3 BT19-051 AtlurBallistamon', '4 BT21-021 OmniShoutmon',
      '3 AD1-013 ZeigGreymon', '2 BT19-014 Shoutmon EX6', '4 AD1-006 Shoutmon X7',
      '2 BT8-095 Fire Rocket', '4 BT10-087 Taiki Kudo', '3 P-224 Kotone Amano',
      '3 BT11-095 Taiki, Kiriha, & Nene', '3 BT21-083 Taiki Kudo',
    ].join('\n')
    const { deck, missing } = importDeck(list, index)
    expect(missing).toEqual([])
    expect(deck.main['P-224']).toBe(3)
    expect(total(deck.main)).toBe(50)
    expect(total(deck.eggs)).toBe(4)
  })

  it('folds an alt-art suffix onto the base card', () => {
    const { deck, missing } = importDeck('2 BT1-010_P1', index)
    expect(missing).toEqual([])
    expect(deck.main['BT1-010']).toBe(2)
  })

  it('reports an id it does not know instead of throwing', () => {
    const { deck, missing } = importDeck('4 BT1-010\n4 BT99-999', index)
    expect(missing).toEqual(['BT99-999'])
    expect(deck.main['BT1-010']).toBe(4)
  })

  it('skips a line that is not a card id at all', () => {
    const { deck, missing } = importDeck('Deck by someone\n4 BT1-010\nthanks!', index)
    expect(missing).toEqual([])
    expect(Object.keys(deck.main)).toEqual(['BT1-010'])
  })

  it('reads the JSON shape digimoncard.dev and Drasil export', () => {
    const json = JSON.stringify({
      name: 'JSON deck',
      cards: [{ cardNumber: 'BT1-010', count: 4 }, { cardNumber: 'BT1-20', count: 3 }],
      eggDeck: [{ cardNumber: 'BT1-001', count: 4 }],
    })
    const { deck, missing } = importDeck(json, index)
    expect(missing).toEqual([])
    expect(deck.name).toBe('JSON deck')
    expect(deck.main['BT1-010']).toBe(4)
    expect(deck.main['BT1-020']).toBe(3)
    expect(deck.eggs['BT1-001']).toBe(4)
  })

  it('reads the alternative JSON key spellings', () => {
    const json = JSON.stringify({ mainDeck: [{ id: 'BT1-010', quantity: 2 }] })
    expect(importDeck(json, index).deck.main['BT1-010']).toBe(2)
  })

  it('still respects the copy limit on import', () => {
    const { deck } = importDeck(`40 ${unrestricted.id}\n9 ${limitedToOne.id}`, index)
    expect(deck.main[unrestricted.id]).toBe(4)
    expect(deck.main[limitedToOne.id]).toBe(1)
  })

  it('ignores comment lines and blank lines', () => {
    const { deck } = importDeck('// Egg deck\n\n# a note\n4 BT1-010', index)
    expect(Object.keys(deck.main)).toEqual(['BT1-010'])
  })
})

describe('cards used by the deck panel', () => {
  it('gives every card in a real deck a card record', () => {
    const deck = legalDeck()
    const ids = [...Object.keys(deck.main), ...Object.keys(deck.eggs)]
    const cards = ids.map((id) => index.byId.get(id)) as Card[]
    expect(cards.every(Boolean)).toBe(true)
    expect(total(deck.main)).toBe(MAIN_SIZE)
  })
})

import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, filterCards, imageUrl, sortCards, type Filters } from './cards'
import { pick, realIndex } from './testIndex'

const index = realIndex()
const find = (f: Partial<Filters>) => filterCards(index, { ...EMPTY_FILTERS, ...f })

describe('filterCards', () => {
  it('hides unreleased cards unless asked for them', () => {
    expect(find({}).every((c) => c.released)).toBe(true)
    expect(find({ includeUnreleased: true }).length).toBeGreaterThan(find({}).length)
  })

  it('filters by card type', () => {
    const eggs = find({ types: ['Digi-Egg'] })
    expect(eggs.length).toBeGreaterThan(0)
    expect(eggs.every((c) => c.cardType === 'Digi-Egg')).toBe(true)
  })

  it('filters by form', () => {
    const rookies = find({ forms: ['Rookie'] })
    expect(rookies.length).toBeGreaterThan(0)
    expect(rookies.every((c) => c.form === 'Rookie')).toBe(true)
  })

  it('filters by set', () => {
    const st1 = find({ sets: ['ST1'] })
    expect(st1.length).toBeGreaterThan(0)
    expect(st1.every((c) => c.setCode === 'ST1')).toBe(true)
  })

  it('filters by level', () => {
    const megas = find({ levels: [6, 7] })
    expect(megas.length).toBeGreaterThan(0)
    expect(megas.every((c) => c.level === 6 || c.level === 7)).toBe(true)
  })

  it('treats cost 10 as the 10-and-over bucket', () => {
    const cheap = find({ costs: [3] })
    expect(cheap.every((c) => c.playCost === 3)).toBe(true)
    const big = find({ costs: [10] })
    expect(big.length).toBeGreaterThan(0)
    expect(big.every((c) => (c.playCost ?? 0) >= 10)).toBe(true)
    expect(big.some((c) => (c.playCost ?? 0) > 10)).toBe(true)
  })

  it('drops cards with no play cost when a cost filter is on', () => {
    expect(find({ costs: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })
      .every((c) => c.playCost !== undefined)).toBe(true)
  })

  it('matches any picked colour by default', () => {
    const redOrBlue = find({ colors: ['Red', 'Blue'] })
    expect(redOrBlue.every((c) => c.colors.includes('Red') || c.colors.includes('Blue'))).toBe(true)
    expect(redOrBlue.some((c) => c.colors.includes('Red') && !c.colors.includes('Blue'))).toBe(true)
  })

  it('requires every picked colour when colorsExact is on', () => {
    const both = find({ colors: ['Red', 'Blue'], colorsExact: true })
    expect(both.length).toBeGreaterThan(0)
    expect(both.every((c) => c.colors.includes('Red') && c.colors.includes('Blue'))).toBe(true)
    expect(both.length).toBeLessThan(find({ colors: ['Red', 'Blue'] }).length)
  })

  it('searches id, name and effect text, and requires every term', () => {
    expect(find({ text: 'BT1-010' }).map((c) => c.id)).toContain('BT1-010')
    const agumon = find({ text: 'agumon' })
    expect(agumon.length).toBeGreaterThan(1)
    const narrowed = find({ text: 'agumon blocker' })
    expect(narrowed.length).toBeLessThan(agumon.length)
    expect(narrowed.every((c) => agumon.includes(c))).toBe(true)
  })

  it('combines filters as an AND', () => {
    const combined = find({ types: ['Digimon'], colors: ['Red'], levels: [4] })
    expect(combined.every((c) =>
      c.cardType === 'Digimon' && c.colors.includes('Red') && c.level === 4)).toBe(true)
  })

  it('returns nothing for an impossible combination rather than throwing', () => {
    expect(find({ types: ['Digi-Egg'], levels: [7] })).toEqual([])
  })
})

describe('sortCards', () => {
  it('orders Digi-Eggs, Digimon, Tamers, Options, then by level and cost', () => {
    const sorted = sortCards(find({ sets: ['ST1'] }))
    const rank = { 'Digi-Egg': 0, Digimon: 1, Tamer: 2, Option: 3 } as Record<string, number>
    for (let i = 1; i < sorted.length; i++) {
      const [a, b] = [sorted[i - 1], sorted[i]]
      expect(rank[a.cardType]).toBeLessThanOrEqual(rank[b.cardType])
      if (a.cardType === b.cardType && a.level !== undefined && b.level !== undefined) {
        expect(a.level).toBeLessThanOrEqual(b.level)
      }
    }
  })

  it('leaves the input array alone', () => {
    const input = find({ sets: ['ST1'] })
    const before = input.map((c) => c.id)
    sortCards(input)
    expect(input.map((c) => c.id)).toEqual(before)
  })
})

describe('imageUrl', () => {
  it('walks the host list on each retry and wraps around', () => {
    const card = pick(index, 'any card', () => true)
    const hosts = index.meta.hosts
    const seen = hosts.map((_, i) => imageUrl(card, index.meta, i))
    expect(new Set(seen).size).toBe(hosts.length)
    expect(seen.every((url) => url.includes(card.id))).toBe(true)
    expect(imageUrl(card, index.meta, hosts.length)).toBe(imageUrl(card, index.meta, 0))
  })
})

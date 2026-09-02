import { describe, expect, it } from 'vitest'
import { PRESETS, deckFromPreset, presetMisses } from './presets'
import { total, validate, EGG_SIZE, MAIN_SIZE } from './deck'
import { realIndex } from './testIndex'

const index = realIndex()

describe('preset decks', () => {
  it('has at least one', () => {
    expect(PRESETS.length).toBeGreaterThan(0)
  })

  it.each(PRESETS.map((p) => [p.name, p] as const))(
    '%s resolves every card against the live pool',
    (_name, preset) => {
      expect(presetMisses(preset, index)).toEqual([])
    },
  )

  it.each(PRESETS.map((p) => [p.name, p] as const))('%s is a legal deck', (_name, preset) => {
    const deck = deckFromPreset(preset, index)
    expect(total(deck.main)).toBe(MAIN_SIZE)
    expect(total(deck.eggs)).toBeLessThanOrEqual(EGG_SIZE)
    expect(validate(deck, index).filter((p) => p.level === 'error')).toEqual([])
  })

  it.each(PRESETS.map((p) => [p.name, p] as const))('%s is named and described', (_name, preset) => {
    const deck = deckFromPreset(preset, index)
    expect(deck.name).toBe(preset.name)
    expect(preset.blurb.length).toBeGreaterThan(10)
  })

  it('gives every copy its own id', () => {
    const a = deckFromPreset(PRESETS[0], index)
    const b = deckFromPreset(PRESETS[0], index)
    expect(a.id).not.toBe(b.id)
    expect(a.main).toEqual(b.main)
  })

  it('has unique preset ids', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length)
  })
})

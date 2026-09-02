import { beforeEach, describe, expect, it } from 'vitest'
import { act } from './actions'
import { allInstances, apply, countCards, emptyState } from './reducer'
import { replay, undo, withoutLastAction } from './replay'
import { viewFor } from './view'
import {
  IllegalAction, MEMORY_MAX, OPENING_HAND, SECURITY_SIZE, TURN_START_MEMORY, other,
  type Action, type CardInstance, type DeckList, type GameState, type PlayerId, type Zone,
} from './types'

// Two small, distinguishable decks. The reducer never looks a card up, so the
// ids only have to be unique — no card database is involved anywhere in game/.
function deckList(prefix: string): DeckList {
  const main: Record<string, number> = {}
  for (let i = 1; i <= 13; i++) main[`${prefix}-${String(i).padStart(3, '0')}`] = 4
  main[`${prefix}-014`] = 2                       // 13*4 + 2 = 54, comfortably over 10
  return { main, eggs: { [`${prefix}-E01`]: 4, [`${prefix}-E02`]: 1 } }
}

const DECKS: [DeckList, DeckList] = [deckList('AA'), deckList('BB')]
const NAMES: [string, string] = ['Gal', 'Daniel']

const SETUP = act.setup(0, DECKS, NAMES, 0, 12345)

function fresh(seed = 12345, firstPlayer: PlayerId = 0): GameState {
  return apply(emptyState(), act.setup(0, DECKS, NAMES, firstPlayer, seed))
}

const ZONES: Zone[] =
  ['deck', 'hand', 'security', 'eggDeck', 'breeding', 'battle', 'trash', 'reveal']

/** Every instance sits in exactly one place, and no iid is used twice. */
function assertIntegrity(state: GameState) {
  const seen = new Map<string, string>()
  const walk = (card: CardInstance, where: string) => {
    expect(seen.has(card.iid), `${card.iid} appears twice: ${seen.get(card.iid)} and ${where}`)
      .toBe(false)
    seen.set(card.iid, where)
    card.attached.forEach((a) => walk(a, `${where}>attached`))
  }
  for (const player of [0, 1] as PlayerId[]) {
    for (const zone of ZONES) {
      for (const card of state.players[player][zone]) walk(card, `p${player}.${zone}`)
    }
  }
  expect(seen.size).toBe(allInstances(state).length)
}

let game: GameState
beforeEach(() => { game = fresh() })

describe('setup', () => {
  it('deals five to hand and five to security for both players', () => {
    for (const player of [0, 1] as PlayerId[]) {
      const me = game.players[player]
      expect(me.hand).toHaveLength(OPENING_HAND)
      expect(me.security).toHaveLength(SECURITY_SIZE)
      expect(me.hand.every((c) => !c.faceDown)).toBe(true)
      expect(me.security.every((c) => c.faceDown)).toBe(true)
      expect(me.eggDeck).toHaveLength(5)
      expect(me.deck).toHaveLength(54 - OPENING_HAND - SECURITY_SIZE)
    }
    expect(game.turn).toBe(1)
    expect(game.phase).toBe('main')
    expect(game.memory).toBe(0)
    assertIntegrity(game)
  })

  it('is deterministic for a fixed seed, and different for another', () => {
    const a = fresh(999)
    const b = fresh(999)
    expect(a.players[0].hand.map((c) => c.cardId)).toEqual(b.players[0].hand.map((c) => c.cardId))
    const c = fresh(1000)
    expect(c.players[0].deck.map((x) => x.cardId))
      .not.toEqual(a.players[0].deck.map((x) => x.cardId))
  })

  it('actually shuffles rather than dealing the build order', () => {
    const ordered = [...game.players[0].deck].map((c) => c.cardId)
    expect(ordered).not.toEqual([...ordered].sort())
  })

  it('refuses to set up twice', () => {
    expect(() => apply(game, SETUP)).toThrow(IllegalAction)
  })

  it('rejects every other action before setup', () => {
    expect(() => apply(emptyState(), act.draw(0, 1))).toThrow(/has not been set up/)
  })
})

describe('memory', () => {
  it('spends down without passing the turn', () => {
    const next = apply(apply(game, act.setMemory(0, 5)), act.payMemory(0, 3))
    expect(next.memory).toBe(2)
    expect(next.turnPlayer).toBe(0)
    expect(next.turn).toBe(1)
  })

  it('passes the turn when a payment crosses zero, carrying the overshoot', () => {
    const next = apply(apply(game, act.setMemory(0, 2)), act.payMemory(0, 5))
    expect(next.turnPlayer).toBe(1)
    expect(next.memory).toBe(3)                 // overshoot of 3, on the new side
    expect(next.turn).toBe(2)
    expect(next.phase).toBe('unsuspend')
  })

  it('passes the turn on a payment that lands exactly at zero only when it goes below', () => {
    const exact = apply(apply(game, act.setMemory(0, 3)), act.payMemory(0, 3))
    expect(exact.memory).toBe(0)
    expect(exact.turnPlayer).toBe(0)            // 0 is still your side

    const over = apply(apply(game, act.setMemory(0, 3)), act.payMemory(0, 4))
    expect(over.turnPlayer).toBe(1)
    expect(over.memory).toBe(1)
  })

  it('clamps a huge overshoot to the end of the gauge', () => {
    const next = apply(game, act.payMemory(0, 40))
    expect(next.turnPlayer).toBe(1)
    expect(next.memory).toBe(MEMORY_MAX)
  })

  it('setMemory to a negative value crosses the gauge the same way', () => {
    const next = apply(game, act.setMemory(0, -4))
    expect(next.turnPlayer).toBe(1)
    expect(next.memory).toBe(4)
    expect(next.turn).toBe(2)
  })

  it('setMemory to a positive value just sets it', () => {
    expect(apply(game, act.setMemory(0, 7)).memory).toBe(7)
    expect(apply(game, act.setMemory(0, 7)).turnPlayer).toBe(0)
  })

  it('refuses a value off the gauge', () => {
    expect(() => apply(game, act.setMemory(0, 11))).toThrow(IllegalAction)
    expect(() => apply(game, act.setMemory(0, -11))).toThrow(IllegalAction)
  })

  it('gives the new turn player 3 when the turn is simply passed', () => {
    const next = apply(apply(game, act.setMemory(0, 6)), act.endTurn(0))
    expect(next.turnPlayer).toBe(1)
    expect(next.memory).toBe(TURN_START_MEMORY)
    expect(next.turn).toBe(2)
  })

  it('is only the turn player who may pay', () => {
    expect(() => apply(game, act.payMemory(1, 1))).toThrow(/only the turn player/)
  })
})

describe('phases', () => {
  // Comprehensive rules 6-1-2: four phases, and no end phase.
  it('walks unsuspend -> draw -> breeding -> main, then passes the turn', () => {
    let s = apply(game, act.endTurn(0))          // get to a normal turn 2
    expect(s.phase).toBe('unsuspend')
    const seen = [s.phase]
    for (let i = 0; i < 3; i++) {
      s = apply(s, act.nextPhase(1))
      seen.push(s.phase)
    }
    expect(seen).toEqual(['unsuspend', 'draw', 'breeding', 'main'])
    s = apply(s, act.nextPhase(1))
    expect(s.turnPlayer).toBe(0)
    expect(s.phase).toBe('unsuspend')
    expect(s.turn).toBe(3)
  })

  it('draws one on entering the draw phase', () => {
    const s = apply(game, act.endTurn(0))
    const before = s.players[1].hand.length
    const drawn = apply(s, act.nextPhase(1))
    expect(drawn.phase).toBe('draw')
    expect(drawn.players[1].hand).toHaveLength(before + 1)
  })

  it('skips the draw for the player who went first, on turn 1 only', () => {
    // Turn 1 starts in main, so reach the draw phase by hand to prove the guard.
    const contrived: GameState = { ...game, phase: 'unsuspend' }
    const first = apply(contrived, act.nextPhase(0))
    expect(first.phase).toBe('draw')
    expect(first.players[0].hand).toHaveLength(OPENING_HAND)

    // The same player on a later turn does draw.
    const later: GameState = { ...game, phase: 'unsuspend', turn: 3 }
    expect(apply(later, act.nextPhase(0)).players[0].hand).toHaveLength(OPENING_HAND + 1)
  })

  it('unsuspends the turn player everything on leaving the unsuspend phase', () => {
    let s = playToBattle(game, 0)
    const iid = s.players[0].battle[0].iid
    s = apply(s, act.suspend(0, iid))
    expect(s.players[0].battle[0].suspended).toBe(true)
    s = apply({ ...s, phase: 'unsuspend' }, act.nextPhase(0))
    expect(s.players[0].battle[0].suspended).toBe(false)
  })

  it('is only the turn player who may advance the phase', () => {
    expect(() => apply(game, act.nextPhase(1))).toThrow(/only the turn player/)
  })
})

describe('draw', () => {
  it('moves cards from the top of the deck to hand, face up', () => {
    const top = game.players[0].deck.slice(0, 2).map((c) => c.iid)
    const s = apply(game, act.draw(0, 2))
    expect(s.players[0].hand).toHaveLength(OPENING_HAND + 2)
    expect(s.players[0].hand.slice(-2).map((c) => c.iid)).toEqual(top)
    expect(s.players[0].hand.every((c) => !c.faceDown)).toBe(true)
  })

  it('loses the game when the deck runs out', () => {
    const empty: GameState = {
      ...game,
      players: [{ ...game.players[0], deck: [] }, game.players[1]],
    }
    const s = apply(empty, act.draw(0, 1))
    expect(s.winner).toBe(1)
    expect(s.log.at(-1)!.text).toMatch(/cannot draw/)
  })

  it('locks the board once someone has won', () => {
    const done: GameState = { ...game, winner: 1 }
    expect(() => apply(done, act.draw(0, 1))).toThrow(/game is over/)
    expect(() => apply(done, act.chat(0, 'gg'))).not.toThrow()
  })
})

describe('mulligan', () => {
  it('redraws a fresh five and is only available once', () => {
    const before = game.players[0].hand.map((c) => c.iid)
    const s = apply(game, act.mulligan(0))
    expect(s.players[0].hand).toHaveLength(OPENING_HAND)
    expect(s.players[0].hand.map((c) => c.iid)).not.toEqual(before)
    expect(s.players[0].deck.length + s.players[0].hand.length)
      .toBe(54 - SECURITY_SIZE)
    expect(() => apply(s, act.mulligan(0))).toThrow(IllegalAction)
    assertIntegrity(s)
  })

  it('is forfeited by taking any other action first', () => {
    const s = apply(game, act.draw(0, 1))
    expect(() => apply(s, act.mulligan(0))).toThrow(/already played/)
  })

  it('is not forfeited by the other player acting', () => {
    const s = apply(game, act.draw(0, 1))
    expect(() => apply(s, act.mulligan(1))).not.toThrow()
  })

  it('is gone after turn 1', () => {
    const s = apply(game, act.endTurn(0))
    expect(() => apply(s, act.mulligan(1))).toThrow(/turn 1/)
  })
})

// --------------------------------------------------------------- board moves

/** Puts the player's first hand card into the battle area and returns the state. */
function playToBattle(state: GameState, player: PlayerId): GameState {
  const iid = state.players[player].hand[0].iid
  return apply(state, act.move(player, iid, 'battle'))
}

describe('move', () => {
  it('plays a card from hand to the battle area, face up', () => {
    const iid = game.players[0].hand[0].iid
    const s = playToBattle(game, 0)
    expect(s.players[0].battle.map((c) => c.iid)).toEqual([iid])
    expect(s.players[0].hand).toHaveLength(OPENING_HAND - 1)
    expect(s.players[0].battle[0].faceDown).toBe(false)
    assertIntegrity(s)
  })

  it('sends a card to the bottom of the deck when asked', () => {
    const iid = game.players[0].hand[0].iid
    const s = apply(game, act.move(0, iid, 'deck', { position: 'bottom' }))
    expect(s.players[0].deck.at(-1)!.iid).toBe(iid)
    expect(s.players[0].deck[0].iid).not.toBe(iid)
    expect(s.players[0].deck.at(-1)!.faceDown).toBe(true)
  })

  it('hatches from the egg deck into the breeding area', () => {
    const iid = game.players[0].eggDeck[0].iid
    const s = apply(game, act.move(0, iid, 'breeding'))
    expect(s.players[0].breeding.map((c) => c.iid)).toEqual([iid])
    expect(s.players[0].breeding[0].faceDown).toBe(false)
  })

  it('recovers a card from hand to the top of security, face down', () => {
    const iid = game.players[0].hand[0].iid
    const s = apply(game, act.move(0, iid, 'security', { position: 'top' }))
    expect(s.players[0].security[0].iid).toBe(iid)
    expect(s.players[0].security[0].faceDown).toBe(true)
  })

  it("lets a player bounce an opponent's Digimon to its owner's hand", () => {
    const s = playToBattle(game, 1)
    const iid = s.players[1].battle[0].iid
    const bounced = apply(s, act.move(0, iid, 'hand'))
    expect(bounced.players[1].hand.map((c) => c.iid)).toContain(iid)
    expect(bounced.players[0].hand.map((c) => c.iid)).not.toContain(iid)
  })

  it("refuses to move an opponent's card somewhere it has no business going", () => {
    const s = playToBattle(game, 1)
    const iid = s.players[1].battle[0].iid
    expect(() => apply(s, act.move(0, iid, 'battle'))).toThrow(/opponent's card/)
    expect(() => apply(s, act.move(0, iid, 'breeding'))).toThrow(IllegalAction)
  })

  it('complains about an instance id it has never seen', () => {
    expect(() => apply(game, act.move(0, 'nope', 'trash'))).toThrow(/no card with instance id/)
  })

  it('never names a card that travels between two hidden zones', () => {
    const iid = game.players[0].deck[0].iid
    const cardId = game.players[0].deck[0].cardId
    const s = apply(game, act.move(0, iid, 'security'))
    expect(s.log.at(-1)!.text).not.toContain(cardId)
    expect(s.log.at(-1)!.text).toContain('a card')
  })
})

describe('digivolve and de-digivolve', () => {
  function stacked() {
    let s = playToBattle(game, 0)
    const target = s.players[0].battle[0]
    const bottomId = target.cardId
    s = apply(s, act.suspend(0, target.iid))
    s = apply(s, act.setDp(0, target.iid, 1000))
    const fromHand = s.players[0].hand[0]
    const topId = fromHand.cardId
    s = apply(s, act.digivolve(0, target.iid, fromHand.iid))
    return { s, iid: target.iid, bottomId, topId }
  }

  it('keeps the instance, its suspension, DP and attachments, and grows the stack', () => {
    const { s, iid, bottomId, topId } = stacked()
    const card = s.players[0].battle.find((c) => c.iid === iid)!
    expect(card.cardId).toBe(topId)
    expect(card.stack).toEqual([bottomId])
    expect(card.suspended).toBe(true)
    expect(card.dpMod).toBe(1000)
    expect(s.players[0].battle).toHaveLength(1)
    assertIntegrity(s)
  })

  it('conserves cards: the hand card becomes a source, it is not destroyed', () => {
    const before = countCards(game)
    const { s } = stacked()
    expect(countCards(s)).toBe(before)
    expect(allInstances(s).length).toBe(allInstances(game).length - 1)
  })

  it('reverses exactly, putting the old top in the trash', () => {
    const { s, iid, bottomId, topId } = stacked()
    const back = apply(s, act.deDigivolve(0, iid, 1))
    const card = back.players[0].battle.find((c) => c.iid === iid)!
    expect(card.cardId).toBe(bottomId)
    expect(card.stack).toEqual([])
    expect(back.players[0].trash[0].cardId).toBe(topId)
    expect(countCards(back)).toBe(countCards(s))
    assertIntegrity(back)
  })

  // 16-12-4: <De-Digivolve> can't trash cards from level 3 cards or lower, so a
  // Digimon that was never digivolved must survive it.
  it('refuses on a card with nothing underneath, rather than deleting it', () => {
    const s = playToBattle(game, 0)
    const iid = s.players[0].battle[0].iid
    expect(() => apply(s, act.deDigivolve(0, iid, 1))).toThrow(/no digivolution sources/)
    expect(s.players[0].battle).toHaveLength(1)
  })

  it('stops when the sources run out instead of eating the Digimon', () => {
    let s = playToBattle(game, 0)
    const iid = s.players[0].battle[0].iid
    s = apply(s, act.digivolve(0, iid, s.players[0].hand[0].iid))
    const back = apply(s, act.deDigivolve(0, iid, 5))
    expect(back.players[0].battle).toHaveLength(1)
    expect(back.players[0].battle[0].stack).toEqual([])
    expect(back.players[0].trash).toHaveLength(1)
    expect(countCards(back)).toBe(countCards(s))
  })

  it('merges the sources of an absorbed Digimon underneath', () => {
    const { s, iid } = stacked()
    let t = playToBattle(s, 0)
    const second = t.players[0].battle.find((c) => c.iid !== iid)!
    const secondId = second.cardId
    t = apply(t, act.digivolve(0, iid, second.iid))
    const card = t.players[0].battle.find((c) => c.iid === iid)!
    expect(card.cardId).toBe(secondId)
    expect(card.stack).toHaveLength(2)
    expect(t.players[0].battle).toHaveLength(1)
    expect(countCards(t)).toBe(countCards(s))
  })

  it('refuses to digivolve onto something that is not in play', () => {
    const inHand = game.players[0].hand[0].iid
    const other2 = game.players[0].hand[1].iid
    expect(() => apply(game, act.digivolve(0, inHand, other2))).toThrow(/in play/)
  })

  it('refuses to digivolve a card into itself', () => {
    const s = playToBattle(game, 0)
    const iid = s.players[0].battle[0].iid
    expect(() => apply(s, act.digivolve(0, iid, iid))).toThrow(/into itself/)
  })

  it("refuses to touch the opponent's Digimon", () => {
    const s = playToBattle(game, 1)
    const theirs = s.players[1].battle[0].iid
    expect(() => apply(s, act.deDigivolve(0, theirs, 1))).toThrow(/other player/)
  })
})

describe('leaving the field', () => {
  it('sends digivolution sources and attached cards to the trash too', () => {
    let s = playToBattle(game, 0)
    const iid = s.players[0].battle[0].iid
    s = apply(s, act.digivolve(0, iid, s.players[0].hand[0].iid))
    s = apply(s, act.attach(0, s.players[0].hand[0].iid, iid))
    expect(s.players[0].battle[0].stack).toHaveLength(1)
    expect(s.players[0].battle[0].attached).toHaveLength(1)

    const before = countCards(s)
    const dead = apply(s, act.move(0, iid, 'trash'))
    expect(dead.players[0].battle).toHaveLength(0)
    // The Digimon, its one source and its one plug-in: three cards in the trash.
    expect(dead.players[0].trash).toHaveLength(3)
    expect(countCards(dead)).toBe(before)
    assertIntegrity(dead)
  })

  it('keeps the stack when moving between battle and breeding', () => {
    let s = playToBattle(game, 0)
    const iid = s.players[0].battle[0].iid
    s = apply(s, act.digivolve(0, iid, s.players[0].hand[0].iid))
    const promoted = apply(apply(s, act.move(0, iid, 'breeding')), act.move(0, iid, 'battle'))
    expect(promoted.players[0].battle[0].stack).toHaveLength(1)
    expect(promoted.players[0].trash).toHaveLength(0)
  })
})

describe('hatch', () => {
  it('moves the top egg into the breeding area, face up', () => {
    const top = game.players[0].eggDeck[0]
    const s = apply(game, act.hatch(0))
    expect(s.players[0].breeding.map((c) => c.iid)).toEqual([top.iid])
    expect(s.players[0].breeding[0].faceDown).toBe(false)
    expect(s.players[0].eggDeck).toHaveLength(4)
    expect(countCards(s)).toBe(countCards(game))
    assertIntegrity(s)
  })

  it('refuses when the breeding area is already occupied', () => {
    const s = apply(game, act.hatch(0))
    expect(() => apply(s, act.hatch(0))).toThrow(/occupied/)
  })

  it('refuses when the egg deck is empty', () => {
    const empty: GameState = {
      ...game,
      players: [{ ...game.players[0], eggDeck: [] }, game.players[1]],
    }
    expect(() => apply(empty, act.hatch(0))).toThrow(/empty/)
  })

  it('needs no instance id, because the egg deck is hidden even from its owner', () => {
    // viewFor masks the egg deck for everyone, so a `move` could never name it.
    expect(viewFor(game, 0).players[0].eggDeck.every((c) => c.cardId === null)).toBe(true)
  })
})

describe('attach', () => {
  it('puts a hand card on top of a card in play', () => {
    const s = playToBattle(game, 0)
    const host = s.players[0].battle[0].iid
    const plug = s.players[0].hand[0]
    const done = apply(s, act.attach(0, plug.iid, host))
    expect(done.players[0].battle[0].attached.map((c) => c.iid)).toEqual([plug.iid])
    expect(done.players[0].hand.map((c) => c.iid)).not.toContain(plug.iid)
    expect(countCards(done)).toBe(countCards(s))
    assertIntegrity(done)
  })

  it('lets an attached card be found and detached again', () => {
    const s = playToBattle(game, 0)
    const host = s.players[0].battle[0].iid
    const plug = s.players[0].hand[0].iid
    const on = apply(s, act.attach(0, plug, host))
    expect(on.players[0].battle[0].attached.map((c) => c.iid)).toEqual([plug])

    // Before locate() searched attached cards this threw "no card with instance id".
    const off = apply(on, act.move(0, plug, 'trash'))
    expect(off.players[0].battle[0].attached).toHaveLength(0)
    expect(off.players[0].battle).toHaveLength(1)
    expect(off.players[0].trash.map((c) => c.iid)).toEqual([plug])
    expect(countCards(off)).toBe(countCards(s))
    assertIntegrity(off)
  })

  it('does not treat unplugging a card as its host leaving the field', () => {
    let s = playToBattle(game, 0)
    const host = s.players[0].battle[0].iid
    s = apply(s, act.digivolve(0, host, s.players[0].hand[0].iid))
    const plug = s.players[0].hand[0].iid
    s = apply(s, act.attach(0, plug, host))
    const off = apply(s, act.move(0, plug, 'hand'))
    // The host keeps its digivolution source; only the plug-in moved.
    expect(off.players[0].battle[0].stack).toHaveLength(1)
    expect(off.players[0].trash).toHaveLength(0)
    expect(off.players[0].hand.map((c) => c.iid)).toContain(plug)
  })

  it('can suspend and flip an attached card now that it is reachable', () => {
    const s = playToBattle(game, 0)
    const host = s.players[0].battle[0].iid
    const plug = s.players[0].hand[0].iid
    const on = apply(s, act.attach(0, plug, host))
    expect(() => apply(on, act.suspend(0, plug))).not.toThrow()
    expect(apply(on, act.suspend(0, plug)).players[0].battle[0].attached[0].suspended).toBe(true)
  })

  it('refuses to attach to something that is not in play', () => {
    const [a, b] = game.players[0].hand
    expect(() => apply(game, act.attach(0, a.iid, b.iid))).toThrow(/not in play|in play/)
  })
})

describe('suspending and counters', () => {
  it('suspends, unsuspends, and unsuspends everything at once', () => {
    let s = playToBattle(game, 0)
    s = playToBattle(s, 0)
    for (const card of s.players[0].battle) s = apply(s, act.suspend(0, card.iid))
    expect(s.players[0].battle.every((c) => c.suspended)).toBe(true)
    s = apply(s, act.unsuspend(0, s.players[0].battle[0].iid))
    expect(s.players[0].battle[0].suspended).toBe(false)
    s = apply(s, act.suspend(0, s.players[0].battle[0].iid))
    s = apply(s, act.unsuspendAll(0))
    expect(s.players[0].battle.every((c) => !c.suspended)).toBe(true)
  })

  it('accumulates DP modifiers and never lets counters go below zero', () => {
    let s = playToBattle(game, 0)
    const iid = s.players[0].battle[0].iid
    s = apply(apply(s, act.setDp(0, iid, 1000)), act.setDp(0, iid, -3000))
    expect(s.players[0].battle[0].dpMod).toBe(-2000)
    s = apply(apply(s, act.setCounters(0, iid, 2)), act.setCounters(0, iid, -5))
    expect(s.players[0].battle[0].counters).toBe(0)
  })
})

describe('security and reveal', () => {
  it("flips the top of the opponent's security into their reveal area", () => {
    const top = game.players[1].security[0]
    const s = apply(game, act.securityCheck(0))
    expect(s.players[1].security).toHaveLength(SECURITY_SIZE - 1)
    expect(s.players[1].reveal.map((c) => c.iid)).toEqual([top.iid])
    expect(s.players[1].reveal[0].faceDown).toBe(false)
    expect(s.log.at(-1)!.text).toContain(top.cardId)
    assertIntegrity(s)
  })

  it('refuses when there is nothing left to check', () => {
    const empty: GameState = {
      ...game,
      players: [game.players[0], { ...game.players[1], security: [] }],
    }
    expect(() => apply(empty, act.securityCheck(0))).toThrow(/empty/)
  })

  it('reveals the top of the deck and the whole hand', () => {
    const s = apply(game, act.revealTop(0, 3))
    expect(s.players[0].reveal).toHaveLength(3)
    expect(s.players[0].reveal.every((c) => !c.faceDown)).toBe(true)

    const hand = apply(s, act.revealHand(0))
    expect(hand.players[0].hand).toHaveLength(0)
    expect(hand.players[0].reveal).toHaveLength(3 + OPENING_HAND)
    assertIntegrity(hand)
  })

  it('flips a card face up and back', () => {
    const iid = game.players[0].security[0].iid
    const up = apply(game, act.flip(0, iid))
    expect(up.players[0].security[0].faceDown).toBe(false)
    expect(apply(up, act.flip(0, iid)).players[0].security[0].faceDown).toBe(true)
  })
})

describe('shuffles and conceding', () => {
  it('reorders the deck and advances the rng state', () => {
    const before = game.players[0].deck.map((c) => c.iid)
    const s = apply(game, act.shuffleDeck(0))
    expect(s.players[0].deck.map((c) => c.iid)).not.toEqual(before)
    expect([...s.players[0].deck.map((c) => c.iid)].sort()).toEqual([...before].sort())
    expect(s.rngState).not.toBe(game.rngState)
  })

  it('reorders security without losing any of it', () => {
    const before = game.players[0].security.map((c) => c.iid).sort()
    const s = apply(game, act.shuffleSecurity(0))
    expect(s.players[0].security.map((c) => c.iid).sort()).toEqual(before)
  })

  it('hands the win to the other player on a concede', () => {
    expect(apply(game, act.concede(0)).winner).toBe(1)
    expect(apply(game, act.concede(1)).winner).toBe(0)
  })
})

describe('purity', () => {
  it('never mutates the state it was given', () => {
    const snapshot = JSON.stringify(game)
    apply(game, act.draw(0, 3))
    apply(game, act.move(0, game.players[0].hand[0].iid, 'battle'))
    apply(game, act.payMemory(0, 20))
    expect(JSON.stringify(game)).toBe(snapshot)
  })

  it('logs every action it accepts', () => {
    const before = game.log.length
    expect(apply(game, act.chat(0, 'hello')).log).toHaveLength(before + 1)
    expect(apply(game, act.draw(0, 1)).log).toHaveLength(before + 1)
  })
})

describe('replay and undo', () => {
  const script: Action[] = [
    SETUP,
    act.draw(0, 2),
    act.chat(0, 'here we go'),
    act.setMemory(0, 4),
    act.payMemory(0, 2),
  ]

  it('folds an action log back into the same state', () => {
    const stepped = script.reduce(apply, emptyState())
    expect(replay(script)).toEqual(stepped)
  })

  it('is stable: replaying twice gives the same state', () => {
    expect(replay(script)).toEqual(replay(script))
  })

  it('undoes the last board action and skips over chatter', () => {
    const withChat = [...script, act.chat(1, 'nice')]
    const { actions, state } = undo(withChat)
    expect(actions.map((a) => a.t))
      .toEqual(['setup', 'draw', 'chat', 'setMemory', 'chat'])
    expect(state.memory).toBe(4)                // the payMemory is gone
  })

  it('never undoes past the setup', () => {
    expect(withoutLastAction([SETUP])).toEqual([SETUP])
    expect(replay(withoutLastAction([SETUP])).turn).toBe(1)
  })
})

describe('viewFor', () => {
  it('hides both decks, both egg decks and both security stacks from everyone', () => {
    for (const viewer of [0, 1, 'spectator'] as const) {
      const view = viewFor(game, viewer)
      for (const player of [0, 1] as PlayerId[]) {
        for (const zone of ['deck', 'eggDeck', 'security'] as const) {
          expect(view.players[player][zone].every((c) => c.cardId === null)).toBe(true)
          expect(view.players[player][zone].length).toBe(game.players[player][zone].length)
        }
      }
    }
  })

  it('shows a player their own hand and not the other one', () => {
    const view = viewFor(game, 0)
    expect(view.players[0].hand.every((c) => c.cardId !== null)).toBe(true)
    expect(view.players[1].hand.every((c) => c.cardId === null)).toBe(true)
  })

  it('hides both hands from a spectator but keeps the counts honest', () => {
    const view = viewFor(game, 'spectator')
    expect(view.players[0].hand.every((c) => c.cardId === null)).toBe(true)
    expect(view.players[1].hand.every((c) => c.cardId === null)).toBe(true)
    expect(view.players[0].hand).toHaveLength(OPENING_HAND)
  })

  it('shows the reveal area to everyone', () => {
    const s = apply(game, act.securityCheck(0))
    const shown = s.players[1].reveal[0].cardId
    for (const viewer of [0, 1, 'spectator'] as const) {
      expect(viewFor(s, viewer).players[1].reveal[0].cardId).toBe(shown)
    }
  })

  it('never ships the seed, the rng state or the opponent deck list', () => {
    const view = viewFor(game, 0) as unknown as Record<string, unknown>
    expect(view.seed).toBeUndefined()
    expect(view.rngState).toBeUndefined()
    expect(view.nextIid).toBeUndefined()
    expect(viewFor(game, 0).players[1].deckList).toEqual({ main: {}, eggs: {} })
    expect(viewFor(game, 0).players[0].deckList).toEqual(DECKS[0])
  })

  it('strips the action payload off the log', () => {
    const s = apply(game, act.draw(0, 1))
    expect(s.log.at(-1)!.action).toBeDefined()
    const entry = viewFor(s, 1).log.at(-1)! as Record<string, unknown>
    expect(entry.action).toBeUndefined()
    expect(entry.text).toBeTruthy()
  })

  it('leaves nothing of a hidden card behind — not its sources, not its plug-ins', () => {
    let s = playToBattle(game, 0)
    const iid = s.players[0].battle[0].iid
    s = apply(s, act.digivolve(0, iid, s.players[0].hand[0].iid))
    s = apply(s, act.move(0, iid, 'deck'))
    const buried = viewFor(s, 1).players[0].deck.find((c) => c.iid === iid)
    expect(buried).toBeUndefined()               // it is in there, just unidentifiable
    expect(viewFor(s, 1).players[0].deck.every((c) => c.cardId === null)).toBe(true)
  })
})

describe('a two hundred action random walk', () => {
  /** A tiny deterministic generator so a failure is reproducible from the seed. */
  function walker(seed: number) {
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it.each([1, 7, 42, 1234, 90210])('survives seed %i', (seed) => {
    const rand = walker(seed)
    const pick = <T>(list: T[]): T | undefined =>
      list.length ? list[Math.floor(rand() * list.length)] : undefined

    let state = fresh(seed)
    const cards = countCards(state)
    let applied = 0

    for (let step = 0; step < 200 && state.winner === null; step++) {
      const me = state.turnPlayer
      const mine = state.players[me]
      const candidates: Action[] = [
        act.nextPhase(me),
        act.payMemory(me, Math.floor(rand() * 4)),
        act.shuffleDeck(me),
        act.unsuspendAll(me),
        act.revealTop(me, 1),
        act.chat(me, 'thinking'),
      ]

      const inHand = pick(mine.hand)
      if (inHand) {
        candidates.push(act.move(me, inHand.iid, pick(['battle', 'trash', 'security'] as const)!))
      }
      const inPlay = pick(mine.battle)
      if (inPlay) {
        candidates.push(act.suspend(me, inPlay.iid), act.setDp(me, inPlay.iid, 1000))
        if (inPlay.stack.length) candidates.push(act.deDigivolve(me, inPlay.iid, 1))
        const partner = pick(mine.hand)
        if (partner) candidates.push(act.digivolve(me, inPlay.iid, partner.iid))
      }
      if (mine.eggDeck.length && !mine.breeding.length) candidates.push(act.hatch(me))
      const inBreeding = pick(mine.breeding)
      if (inBreeding) candidates.push(act.move(me, inBreeding.iid, 'battle'))
      if (state.players[other(me)].security.length) candidates.push(act.securityCheck(me))
      const revealed = pick(mine.reveal)
      if (revealed) candidates.push(act.move(me, revealed.iid, 'hand'))

      const action = pick(candidates)!
      state = apply(state, action)
      applied++

      assertIntegrity(state)
      expect(countCards(state)).toBe(cards)
      expect(state.memory).toBeGreaterThanOrEqual(0)
      expect(state.memory).toBeLessThanOrEqual(MEMORY_MAX)
    }

    expect(applied).toBeGreaterThan(20)
    // Whatever happened, the log still rebuilds it exactly.
    const actions = state.log.map((e) => e.action).filter(Boolean) as Action[]
    expect(replay(actions)).toEqual(state)
  })
})

describe('every action type is exercised', () => {
  it('covers the whole union', () => {
    const seen = new Set<string>()
    let s = fresh()
    const run = (action: Action) => { s = apply(s, action); seen.add(action.t) }

    seen.add('setup')
    run(act.chat(0, 'hi'))
    run(act.mulligan(0))
    run(act.draw(0, 1))
    run(act.shuffleDeck(0))
    run(act.shuffleSecurity(0))
    run(act.hatch(0))
    const played = s.players[0].hand[0].iid
    run(act.move(0, played, 'battle'))
    run(act.digivolve(0, played, s.players[0].hand[0].iid))
    run(act.attach(0, s.players[0].hand[0].iid, played))
    run(act.deDigivolve(0, played, 1))
    run(act.suspend(0, played))
    run(act.unsuspend(0, played))
    run(act.unsuspendAll(0))
    run(act.setDp(0, played, 1000))
    run(act.setCounters(0, played, 1))
    run(act.setMemory(0, 5))
    run(act.payMemory(0, 1))
    run(act.securityCheck(0))
    run(act.revealTop(0, 1))
    run(act.revealHand(0))
    run(act.flip(0, s.players[0].security[0].iid))
    run(act.nextPhase(0))          // main is the last phase, so this passes the turn
    run(act.endTurn(1))
    run(act.undoRequest(1))
    run(act.undoAccept(1))
    run(act.undoDecline(1))
    run(act.concede(1))

    const every: Action['t'][] = [
      'setup', 'mulligan', 'draw', 'shuffleDeck', 'shuffleSecurity', 'hatch', 'move', 'digivolve',
      'deDigivolve', 'attach', 'suspend', 'unsuspend', 'unsuspendAll', 'setDp', 'setCounters',
      'setMemory', 'payMemory', 'nextPhase', 'endTurn', 'securityCheck', 'revealTop',
      'revealHand', 'flip', 'concede', 'chat', 'undoRequest', 'undoAccept', 'undoDecline',
    ]
    expect([...every].filter((t) => !seen.has(t))).toEqual([])
    expect(s.winner).toBe(0)
  })
})

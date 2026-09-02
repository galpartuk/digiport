/**
 * The game state model.
 *
 * Nothing in `game/` may import React, touch the DOM, or read `window`: this
 * same code runs unchanged inside a Cloudflare Durable Object in Phase 2. It
 * is also a *manual* tabletop model, not a rules engine — the reducer moves
 * cards and enforces whose turn it is, and never reads a card's effect text.
 */

export type PlayerId = 0 | 1

export type Zone =
  | 'deck' | 'hand' | 'security' | 'eggDeck' | 'breeding'
  | 'battle' | 'trash' | 'reveal'            // reveal = temporary face-up area

/** Instance id, unique for the life of one game. */
export type Iid = string

export type CardInstance = {
  iid: Iid
  cardId: string                             // e.g. "BT1-010"
  owner: PlayerId
  faceDown: boolean                          // true in deck / security / eggDeck
  suspended: boolean
  dpMod: number                              // ±1000 modifiers
  counters: number                           // generic counters
  /**
   * Digivolution sources beneath this card, bottom first. Card ids only;
   * sources are not instances.
   */
  stack: string[]
  /** Plug-ins / link cards attached to this card, top first. */
  attached: CardInstance[]
}

export type DeckList = {
  main: Record<string, number>
  eggs: Record<string, number>
}

export type PlayerState = {
  name: string
  deck: CardInstance[]        // index 0 = top
  eggDeck: CardInstance[]
  hand: CardInstance[]
  security: CardInstance[]    // index 0 = top
  breeding: CardInstance[]    // 0 or 1 in practice; keep it a list
  battle: CardInstance[]      // Digimon, Tamers, delayed Options, display order
  trash: CardInstance[]       // index 0 = most recent
  reveal: CardInstance[]
  deckList: DeckList
}

/**
 * Comprehensive rules 6-1-2: "A turn proceeds using phases in the following
 * order. Unsuspend phase, draw phase, breeding phase, and main phase."
 * There is no end phase — a turn ends when the memory condition is met
 * (6-1-4-1) or the turn player passes (6-5-1-7-1), not by reaching a last step.
 */
export type Phase = 'unsuspend' | 'draw' | 'breeding' | 'main'

export const PHASES: Phase[] = ['unsuspend', 'draw', 'breeding', 'main']

export type LogEntry = {
  n: number
  by: PlayerId | 'system'
  text: string
  action?: Action
}

export type GameState = {
  seed: number                 // for deterministic shuffles
  rngState: number             // advanced by every shuffle; part of the state
  players: [PlayerState, PlayerState]
  turnPlayer: PlayerId
  turn: number                 // 1-based
  phase: Phase
  /**
   * The gauge is physically −10…+10, but it is stored from the turn player's
   * point of view: 0…10 on their own side. Crossing below zero is what passes
   * the turn, which is why the sign never has to be tracked separately.
   */
  memory: number
  firstPlayer: PlayerId
  winner: PlayerId | null
  log: LogEntry[]
  nextIid: number
  /** Players who have already used (or forfeited) their mulligan. */
  mulliganed: PlayerId[]
}

export const MEMORY_MAX = 10

/** The memory a player starts a normal turn with, per the comprehensive rules. */
export const TURN_START_MEMORY = 3

export const OPENING_HAND = 5
export const SECURITY_SIZE = 5

// --------------------------------------------------------------- the actions

export type Position = 'top' | 'bottom' | number

export type Action =
  | { t: 'setup'; by: PlayerId; decks: [DeckList, DeckList]; names: [string, string]
      firstPlayer: PlayerId; seed?: number }
  | { t: 'mulligan'; by: PlayerId }
  | { t: 'draw'; by: PlayerId; n: number }
  | { t: 'shuffleDeck'; by: PlayerId }
  | { t: 'shuffleSecurity'; by: PlayerId }
  /**
   * Top of your own egg deck into your breeding area. It needs its own action
   * because the egg deck is hidden from everyone including its owner, so its
   * cards have no instance id a client could name in a `move`.
   */
  | { t: 'hatch'; by: PlayerId }
  | { t: 'move'; by: PlayerId; iid: Iid; to: Zone; position?: Position; faceDown?: boolean }
  | { t: 'digivolve'; by: PlayerId; sourceIid: Iid; cardIid: Iid }
  | { t: 'deDigivolve'; by: PlayerId; iid: Iid; n: number }
  | { t: 'attach'; by: PlayerId; iid: Iid; targetIid: Iid }
  | { t: 'suspend'; by: PlayerId; iid: Iid }
  | { t: 'unsuspend'; by: PlayerId; iid: Iid }
  | { t: 'unsuspendAll'; by: PlayerId }
  | { t: 'setDp'; by: PlayerId; iid: Iid; delta: number }
  | { t: 'setCounters'; by: PlayerId; iid: Iid; delta: number }
  | { t: 'setMemory'; by: PlayerId; value: number }
  | { t: 'payMemory'; by: PlayerId; cost: number }
  | { t: 'nextPhase'; by: PlayerId }
  | { t: 'endTurn'; by: PlayerId }
  | { t: 'securityCheck'; by: PlayerId }
  | { t: 'revealTop'; by: PlayerId; n: number }
  | { t: 'revealHand'; by: PlayerId }
  | { t: 'flip'; by: PlayerId; iid: Iid }
  | { t: 'concede'; by: PlayerId }
  | { t: 'chat'; by: PlayerId; text: string }
  | { t: 'undoRequest'; by: PlayerId }
  | { t: 'undoAccept'; by: PlayerId }
  | { t: 'undoDecline'; by: PlayerId }

export type ActionType = Action['t']

/**
 * Actions that only talk — they never change the board, so undo skips them and
 * a replay can drop them without changing the outcome.
 */
export const CHATTER: ReadonlySet<ActionType> = new Set<ActionType>([
  'chat', 'undoRequest', 'undoAccept', 'undoDecline',
])

/** Thrown by `apply` when an action is not legal. Never a bare Error. */
export class IllegalAction extends Error {
  readonly action: Action

  constructor(action: Action, reason: string) {
    super(`${action.t}: ${reason}`)
    this.name = 'IllegalAction'
    this.action = action
  }
}

// ------------------------------------------------------------------ helpers

export const ZONES: Zone[] = [
  'deck', 'hand', 'security', 'eggDeck', 'breeding', 'battle', 'trash', 'reveal',
]

/** Zones whose cards are face-down for everyone but, at most, their owner. */
export const HIDDEN_ZONES: ReadonlySet<Zone> = new Set<Zone>(['deck', 'eggDeck', 'security'])

export function other(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0
}

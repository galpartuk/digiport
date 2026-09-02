import { HIDDEN_ZONES, type Attack, type CardInstance, type DeckList, type GameState,
  type LogEntry, type Phase, type PlayerId, type Zone } from './types'

/**
 * What one seat is allowed to see. The board UI renders only a PlayerView and
 * never a GameState, so moving from the local reducer to a server socket in
 * Phase 2 changes nothing above this line.
 */
export type ViewCard = Omit<CardInstance, 'cardId' | 'attached'> & {
  /** null when this viewer may not know what the card is. */
  cardId: string | null
  attached: ViewCard[]
}

export type ViewPlayer = {
  name: string
  deck: ViewCard[]
  eggDeck: ViewCard[]
  hand: ViewCard[]
  security: ViewCard[]
  breeding: ViewCard[]
  battle: ViewCard[]
  trash: ViewCard[]
  reveal: ViewCard[]
  deckList: DeckList
}

export type ViewLogEntry = Omit<LogEntry, 'action'>

export type Viewer = PlayerId | 'spectator'

export type PlayerView = {
  viewer: Viewer
  players: [ViewPlayer, ViewPlayer]
  turnPlayer: PlayerId
  turn: number
  phase: Phase
  memory: number
  firstPlayer: PlayerId
  winner: PlayerId | null
  /** Both battle areas are public, so a declared attack is visible to everyone. */
  attack: Attack | null
  log: ViewLogEntry[]
}

const EMPTY_LIST: DeckList = { main: {}, eggs: {} }

/**
 * A hidden card gives up everything, not just its face. The instance id goes
 * too: a Digimon the opponent watched get shuffled into the deck would
 * otherwise stay trackable by its iid through the whole game. What is left is
 * a positional handle, good enough for a React key and useless for cheating.
 */
function mask(card: CardInstance, zone: Zone, index: number): ViewCard {
  return {
    ...card,
    iid: `?${card.owner}${zone}${index}`,
    cardId: null,
    stack: [],
    attached: [],
  }
}

function show(card: CardInstance): ViewCard {
  return { ...card, attached: card.attached.map(show) }
}

/**
 * Can this viewer read this card's face?
 *
 * Deck, egg deck and security are secret from everyone including their owner —
 * knowing your own deck order would be cheating at solitaire. Everywhere else,
 * a face-down card is readable only by the player who owns it.
 */
function visible(zone: Zone, card: CardInstance, viewer: Viewer): boolean {
  if (HIDDEN_ZONES.has(zone)) return false
  if (zone === 'hand') return viewer === card.owner
  return !card.faceDown || viewer === card.owner
}

function projectPlayer(state: GameState, player: PlayerId, viewer: Viewer): ViewPlayer {
  const src = state.players[player]
  const zone = (name: Zone): ViewCard[] =>
    src[name].map((card, i) => (visible(name, card, viewer) ? show(card) : mask(card, name, i)))

  return {
    name: src.name,
    deck: zone('deck'),
    eggDeck: zone('eggDeck'),
    hand: zone('hand'),
    security: zone('security'),
    breeding: zone('breeding'),
    battle: zone('battle'),
    trash: zone('trash'),
    reveal: zone('reveal'),
    // A deck list is the whole 50 cards; only your own comes down the wire.
    deckList: viewer === player ? src.deckList : EMPTY_LIST,
  }
}

/**
 * Note what is absent: `seed`, `rngState` and `nextIid` never leave the server.
 * The seed alone would let a client replay the shuffle and read both decks in
 * order, which is exactly the hole the projection exists to close.
 */
export function viewFor(state: GameState, viewer: Viewer): PlayerView {
  return {
    viewer,
    players: [
      projectPlayer(state, 0, viewer),
      projectPlayer(state, 1, viewer),
    ],
    turnPlayer: state.turnPlayer,
    turn: state.turn,
    phase: state.phase,
    memory: state.memory,
    firstPlayer: state.firstPlayer,
    winner: state.winner,
    attack: state.attack,
    // The action payload would carry instance ids and card ids straight past
    // every check above, so the log travels as text only.
    log: state.log.map(({ n, by, text }) => ({ n, by, text })),
  }
}

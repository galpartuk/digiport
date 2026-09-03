import {
  CHATTER, HIDDEN_ZONES, IllegalAction, MEMORY_MAX, OPENING_HAND, PHASES,
  SECURITY_SIZE, TURN_START_MEMORY, other,
  type Action, type CardInstance, type DeckList, type GameState, type Iid,
  type LogEntry, type PlayerId, type PlayerState, type Position, type Zone,
} from './types'

// ---------------------------------------------------------------------- rng

/** mulberry32. Small, fast, and its whole state is one 32-bit number. */
function rng(seed: number) {
  let a = seed >>> 0
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
    state: () => a,
  }
}

/** Fisher-Yates. Returns the shuffled copy and the advanced rng state. */
function shuffled<T>(items: T[], seed: number): [T[], number] {
  const r = rng(seed)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1))
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return [out, r.state()]
}

// -------------------------------------------------------------------- state

function emptyPlayer(name = ''): PlayerState {
  return {
    name,
    deck: [], eggDeck: [], hand: [], security: [], breeding: [],
    battle: [], trash: [], reveal: [],
    deckList: { main: {}, eggs: {} },
  }
}

export function emptyState(): GameState {
  return {
    seed: 0,
    rngState: 0,
    players: [emptyPlayer(), emptyPlayer()],
    turnPlayer: 0,
    turn: 0,
    phase: 'main',
    memory: 0,
    firstPlayer: 0,
    winner: null,
    attack: null,
    log: [],
    nextIid: 1,
    mulliganed: [],
  }
}

function cloneInstance(c: CardInstance): CardInstance {
  return { ...c, stack: [...c.stack], attached: c.attached.map(cloneInstance) }
}

function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    deck: p.deck.map(cloneInstance),
    eggDeck: p.eggDeck.map(cloneInstance),
    hand: p.hand.map(cloneInstance),
    security: p.security.map(cloneInstance),
    breeding: p.breeding.map(cloneInstance),
    battle: p.battle.map(cloneInstance),
    trash: p.trash.map(cloneInstance),
    reveal: p.reveal.map(cloneInstance),
  }
}

/**
 * A working copy. The reducer mutates this freely and returns it, which keeps
 * every case readable without an immutability library; the caller's state is
 * never touched. The log array is copied but its entries are shared — they are
 * frozen facts, never edited after the fact.
 */
function clone(state: GameState): GameState {
  return {
    ...state,
    players: [clonePlayer(state.players[0]), clonePlayer(state.players[1])],
    log: [...state.log],
    mulliganed: [...state.mulliganed],
  }
}

// ------------------------------------------------------------------ locating

/**
 * Where an instance sits. `host` is set when the card is plugged into another
 * card rather than sitting in a zone of its own — the zone is then the host's.
 */
type Spot = {
  player: PlayerId
  zone: Zone
  index: number
  instance: CardInstance
  host?: CardInstance
}

const SEARCH_ORDER: Zone[] =
  ['battle', 'breeding', 'hand', 'reveal', 'trash', 'security', 'deck', 'eggDeck']

/**
 * Where an instance currently sits, including cards plugged into other cards.
 * Attached cards used to be invisible here, which made them a black hole: once
 * attached, an instance could never be detached, trashed or flipped again, and
 * every action naming it failed with "no card with instance id".
 */
function locate(state: GameState, iid: Iid): Spot | null {
  for (const player of [0, 1] as PlayerId[]) {
    for (const zone of SEARCH_ORDER) {
      const list = state.players[player][zone]
      const index = list.findIndex((c) => c.iid === iid)
      if (index >= 0) return { player, zone, index, instance: list[index] }

      for (const candidate of list) {
        const found = locateAttached(candidate, iid)
        if (found) return { player, zone, index: list.indexOf(candidate), ...found }
      }
    }
  }
  return null
}

function locateAttached(
  host: CardInstance,
  iid: Iid,
): { instance: CardInstance; host: CardInstance } | null {
  for (const attached of host.attached) {
    if (attached.iid === iid) return { instance: attached, host }
    const deeper = locateAttached(attached, iid)
    if (deeper) return deeper
  }
  return null
}

/** Takes the instance out of wherever it is, zone list or host. */
function lift(state: GameState, spot: Spot) {
  if (spot.host) {
    spot.host.attached = spot.host.attached.filter((c) => c.iid !== spot.instance.iid)
    return
  }
  state.players[spot.player][spot.zone].splice(spot.index, 1)
}

function need(state: GameState, action: Action, iid: Iid): Spot {
  const spot = locate(state, iid)
  if (!spot) throw new IllegalAction(action, `no card with instance id ${iid}`)
  return spot
}

/** Every instance on the board, including cards attached to other cards. */
export function allInstances(state: GameState): CardInstance[] {
  const out: CardInstance[] = []
  const walk = (c: CardInstance) => {
    out.push(c)
    c.attached.forEach(walk)
  }
  for (const player of state.players) {
    for (const zone of SEARCH_ORDER) player[zone].forEach(walk)
  }
  return out
}

/**
 * Physical cards in play: instances plus the digivolution sources under them,
 * which are card ids rather than instances. Digivolving turns an instance into
 * a stack entry and de-digivolving turns it back, so only the sum is constant.
 */
export function countCards(state: GameState): number {
  return allInstances(state).reduce((n, c) => n + 1 + c.stack.length, 0)
}

// -------------------------------------------------------------------- pieces

function place(list: CardInstance[], card: CardInstance, position: Position | undefined) {
  if (position === 'top' || position === undefined) list.unshift(card)
  else if (position === 'bottom') list.push(card)
  else list.splice(Math.max(0, Math.min(position, list.length)), 0, card)
}

/** Zone-appropriate default: piles take from the top, open areas append. */
function defaultPosition(zone: Zone): Position {
  return zone === 'deck' || zone === 'security' || zone === 'trash' ? 'top' : 'bottom'
}

/**
 * The `action` field is what replay folds over, so it has to appear exactly
 * once per applied action — `apply` attaches it below. One action can write
 * several lines (entering the draw phase also draws), and only the first
 * carries the payload.
 */
function log(state: GameState, by: PlayerId | 'system', text: string) {
  const entry: LogEntry = { n: state.log.length + 1, by, text }
  state.log.push(entry)
}

function nameOf(state: GameState, player: PlayerId): string {
  return state.players[player].name || `Player ${player + 1}`
}

/**
 * Moves an instance into a zone, applying the rule that a Digimon leaving the
 * field leaves its digivolution sources and attached cards behind in the trash.
 */
function relocate(
  state: GameState,
  spot: Spot,
  to: Zone,
  position?: Position,
  faceDown?: boolean,
): CardInstance {
  const card = spot.instance
  lift(state, spot)

  // A card being unplugged from a host is not itself leaving the field, so it
  // keeps nothing to shed.
  const leavingField =
    !spot.host &&
    (spot.zone === 'battle' || spot.zone === 'breeding') &&
    to !== 'battle' && to !== 'breeding'

  if (leavingField) {
    const trash = state.players[card.owner].trash
    // Sources are card ids, so they become instances again on the way out.
    for (const cardId of [...card.stack].reverse()) {
      trash.unshift(newInstance(state, cardId, card.owner, false))
    }
    for (const attached of card.attached) {
      attached.faceDown = false
      attached.suspended = false
      trash.unshift(attached)
    }
    card.stack = []
    card.attached = []
    card.dpMod = 0
    card.counters = 0
    card.suspended = false
  }

  card.faceDown = faceDown ?? HIDDEN_ZONES.has(to)
  if (to === 'battle' || to === 'breeding' || to === 'reveal') card.faceDown = faceDown ?? false
  place(state.players[card.owner][to], card, position ?? defaultPosition(to))
  return card
}

function newInstance(
  state: GameState,
  cardId: string,
  owner: PlayerId,
  faceDown: boolean,
): CardInstance {
  return {
    iid: `i${state.nextIid++}`,
    cardId,
    owner,
    faceDown,
    suspended: false,
    dpMod: 0,
    counters: 0,
    stack: [],
    attached: [],
  }
}

/** Deterministic instance order: ids sorted, then one instance per copy. */
function build(state: GameState, list: DeckList, owner: PlayerId): [CardInstance[], CardInstance[]] {
  const make = (pile: Record<string, number>) => {
    const out: CardInstance[] = []
    for (const cardId of Object.keys(pile).sort()) {
      for (let i = 0; i < pile[cardId]; i++) out.push(newInstance(state, cardId, owner, true))
    }
    return out
  }
  return [make(list.main), make(list.eggs)]
}

// ------------------------------------------------------------------- memory

/**
 * Hands the turn over. `memory` is always read from the turn player's side, so
 * a crossing carries the overshoot across as the new player's starting memory;
 * an ordinary pass gives them 3, per the comprehensive rules.
 */
function passTurn(state: GameState, memory: number, why: string) {
  state.attack = null
  const from = state.turnPlayer
  state.turnPlayer = other(state.turnPlayer)
  state.memory = Math.max(0, Math.min(memory, MEMORY_MAX))
  state.phase = 'unsuspend'
  state.turn += 1
  log(state, from, `${why} — turn passes to ${nameOf(state, state.turnPlayer)} ` +
    `with ${state.memory} memory`)
}

/** Applies a new memory value expressed from the current turn player's side. */
function applyMemory(state: GameState, action: Action, value: number, why: string) {
  if (value >= 0) {
    state.memory = Math.min(value, MEMORY_MAX)
    log(state, action.by, `${why} — memory ${state.memory}`)
    return
  }
  passTurn(state, -value, why)
}

// ------------------------------------------------------------------- guards

function assertTurn(state: GameState, action: Action) {
  if (action.by !== state.turnPlayer) {
    throw new IllegalAction(action, 'only the turn player may do this')
  }
}

function assertOwn(action: Action, spot: Spot) {
  if (spot.instance.owner !== action.by) {
    throw new IllegalAction(action, 'that card belongs to the other player')
  }
}

/** Zones an opponent's card may legally be pushed into by the acting player. */
const OPPONENT_DESTINATIONS: ReadonlySet<Zone> =
  new Set<Zone>(['reveal', 'trash', 'hand', 'deck', 'security'])

// ------------------------------------------------------------------ reducer

export function apply(state: GameState, action: Action): GameState {
  if (action.t === 'setup') return setup(state, action)

  if (state.turn === 0) throw new IllegalAction(action, 'the game has not been set up')
  if (state.winner !== null && action.t !== 'chat') {
    throw new IllegalAction(action, 'the game is over')
  }

  const next = clone(state)
  const mark = next.log.length

  // Anything that touches the board forfeits that player's mulligan.
  if (!CHATTER.has(action.t) && !next.mulliganed.includes(action.by) && action.t !== 'mulligan') {
    next.mulliganed.push(action.by)
  }

  switch (action.t) {
    case 'mulligan': {
      if (next.turn !== 1) throw new IllegalAction(action, 'mulligans only happen on turn 1')
      if (next.mulliganed.includes(action.by)) {
        throw new IllegalAction(action, 'you have already played a card this game')
      }
      const me = next.players[action.by]
      me.deck.push(...me.hand.splice(0, me.hand.length).map((c) => ({ ...c, faceDown: true })))
      const [deck, rngState] = shuffled(me.deck, next.rngState)
      me.deck = deck
      next.rngState = rngState
      me.hand = me.deck.splice(0, OPENING_HAND).map((c) => ({ ...c, faceDown: false }))
      next.mulliganed.push(action.by)
      log(next, action.by, `${nameOf(next, action.by)} mulligans`)
      break
    }

    case 'draw': {
      assertTurn(next, action)
      drawCards(next, action.by, action.n)
      break
    }

    case 'shuffleDeck': {
      const me = next.players[action.by]
      const [deck, rngState] = shuffled(me.deck, next.rngState)
      me.deck = deck
      next.rngState = rngState
      log(next, action.by, `${nameOf(next, action.by)} shuffles their deck`)
      break
    }

    case 'shuffleSecurity': {
      const me = next.players[action.by]
      const [security, rngState] = shuffled(me.security, next.rngState)
      me.security = security
      next.rngState = rngState
      log(next, action.by, `${nameOf(next, action.by)} shuffles their security stack`)
      break
    }

    case 'move': {
      const spot = need(next, action, action.iid)
      if (spot.instance.owner !== action.by && !OPPONENT_DESTINATIONS.has(action.to)) {
        throw new IllegalAction(action, `you may only send an opponent's card to ` +
          [...OPPONENT_DESTINATIONS].join(', '))
      }
      const from = spot.zone
      const card = relocate(next, spot, action.to, action.position, action.faceDown)
      log(next, action.by, `${nameOf(next, action.by)} moves ` +
        `${describe(card, from, action.to)} from ${from} to ${action.to}`)
      break
    }

    case 'digivolve': {
      const target = need(next, action, action.sourceIid)
      assertOwn(action, target)
      if (target.zone !== 'battle' && target.zone !== 'breeding') {
        throw new IllegalAction(action, 'you can only digivolve a Digimon in play')
      }
      const source = need(next, action, action.cardIid)
      assertOwn(action, source)
      if (source.instance.iid === target.instance.iid) {
        throw new IllegalAction(action, 'a card cannot digivolve into itself')
      }
      if (!['hand', 'reveal', 'battle'].includes(source.zone)) {
        throw new IllegalAction(action, 'digivolve from hand, the reveal area, or the field')
      }

      const under = target.instance
      const top = source.instance
      lift(next, source)
      // Bottom first: the absorbed Digimon's own sources go furthest down.
      under.stack = [...top.stack, ...under.stack, under.cardId]
      under.cardId = top.cardId
      under.attached = [...under.attached, ...top.attached]
      under.faceDown = false
      log(next, action.by, `${nameOf(next, action.by)} digivolves into ${top.cardId} ` +
        `(${under.stack.length} source${under.stack.length === 1 ? '' : 's'})`)
      break
    }

    case 'deDigivolve': {
      const spot = need(next, action, action.iid)
      assertOwn(action, spot)
      // Comprehensive rules 16-12-4: <De-Digivolve> can't trash cards from
      // level 3 cards or lower. The reducer has no card database, so "nothing
      // underneath" stands in for that -- either way, de-digivolving a Digimon
      // that was never digivolved must not delete it.
      if (!spot.instance.stack.length) {
        throw new IllegalAction(action, 'that card has no digivolution sources to trash')
      }
      let popped = 0
      for (let i = 0; i < action.n && spot.instance.stack.length; i++) {
        const card = spot.instance
        next.players[card.owner].trash.unshift(newInstance(next, card.cardId, card.owner, false))
        card.cardId = card.stack.pop()!
        popped++
      }
      log(next, action.by, `${nameOf(next, action.by)} de-digivolves ${popped}`)
      break
    }

    case 'attach': {
      const spot = need(next, action, action.iid)
      assertOwn(action, spot)
      if (spot.zone !== 'hand' && spot.zone !== 'battle') {
        throw new IllegalAction(action, 'only a card in hand or in play can be attached')
      }
      const target = need(next, action, action.targetIid)
      assertOwn(action, target)
      if (target.zone !== 'battle' && target.zone !== 'breeding') {
        throw new IllegalAction(action, 'you can only attach to a card in play')
      }
      if (spot.instance.iid === target.instance.iid) {
        throw new IllegalAction(action, 'a card cannot attach to itself')
      }
      lift(next, spot)
      spot.instance.faceDown = false
      target.instance.attached.unshift(spot.instance)
      log(next, action.by, `${nameOf(next, action.by)} attaches ${spot.instance.cardId} ` +
        `to ${target.instance.cardId}`)
      break
    }

    case 'placeUnder': {
      const target = need(next, action, action.targetIid)
      if (target.zone !== 'battle' && target.zone !== 'breeding') {
        throw new IllegalAction(action, 'you can only place a card under a card in play')
      }
      if (!action.iids.length) throw new IllegalAction(action, 'no cards to place')

      const under = target.instance
      const names: string[] = []
      for (const iid of action.iids) {
        if (iid === under.iid) throw new IllegalAction(action, 'a card cannot go under itself')
        const source = need(next, action, iid)
        if (source.zone === 'deck' || source.zone === 'eggDeck' || source.zone === 'security') {
          throw new IllegalAction(action, 'that card is in a hidden pile')
        }

        const moved = source.instance
        lift(next, source)

        // 4-9-6: a card that becomes a new card loses its link cards, and 4-7-7
        // puts stacked cards off the field entirely, so anything plugged into
        // the moved card is trashed rather than riding along.
        for (const plug of moved.attached) {
          plug.faceDown = false
          plug.suspended = false
          next.players[plug.owner].trash.unshift(plug)
        }
        // Its own sources travel with it, keeping their order (4-7-3).
        const buried = [...moved.stack, moved.cardId]
        under.stack = action.position === 'bottom'
          ? [...buried, ...under.stack]
          : [...under.stack, ...buried]
        names.push(moved.cardId)
      }

      log(next, action.by, `${nameOf(next, action.by)} places ${names.join(', ')} under ` +
        `${under.cardId} (${under.stack.length} source${under.stack.length === 1 ? '' : 's'})`)
      break
    }

    case 'suspend':
    case 'unsuspend': {
      const spot = need(next, action, action.iid)
      assertOwn(action, spot)
      spot.instance.suspended = action.t === 'suspend'
      log(next, action.by, `${nameOf(next, action.by)} ${action.t}s ${spot.instance.cardId}`)
      break
    }

    case 'unsuspendAll': {
      for (const zone of ['battle', 'breeding'] as Zone[]) {
        for (const card of next.players[action.by][zone]) card.suspended = false
      }
      log(next, action.by, `${nameOf(next, action.by)} unsuspends everything`)
      break
    }

    case 'setDp': {
      const spot = need(next, action, action.iid)
      assertOwn(action, spot)
      spot.instance.dpMod += action.delta
      log(next, action.by, `${spot.instance.cardId} DP ` +
        `${spot.instance.dpMod >= 0 ? '+' : ''}${spot.instance.dpMod}`)
      break
    }

    case 'setCounters': {
      const spot = need(next, action, action.iid)
      assertOwn(action, spot)
      spot.instance.counters = Math.max(0, spot.instance.counters + action.delta)
      log(next, action.by, `${spot.instance.cardId} counters ${spot.instance.counters}`)
      break
    }

    case 'setMemory': {
      if (action.value < -MEMORY_MAX || action.value > MEMORY_MAX) {
        throw new IllegalAction(action, `memory runs from -${MEMORY_MAX} to ${MEMORY_MAX}`)
      }
      applyMemory(next, action, action.value, `${nameOf(next, action.by)} sets memory`)
      break
    }

    case 'payMemory': {
      assertTurn(next, action)
      applyMemory(next, action, next.memory - action.cost,
        `${nameOf(next, action.by)} pays ${action.cost}`)
      break
    }

    case 'nextPhase': {
      assertTurn(next, action)
      const at = PHASES.indexOf(next.phase)
      if (next.phase === 'unsuspend') {
        for (const zone of ['battle', 'breeding'] as Zone[]) {
          for (const card of next.players[action.by][zone]) card.suspended = false
        }
      }
      if (at === PHASES.length - 1) {
        passTurn(next, TURN_START_MEMORY, `${nameOf(next, action.by)} ends their turn`)
        break
      }
      next.phase = PHASES[at + 1]
      log(next, action.by, `${nameOf(next, action.by)} enters the ${next.phase} phase`)
      // The player who goes first does not draw on the very first turn.
      if (next.phase === 'draw' && !(next.turn === 1 && action.by === next.firstPlayer)) {
        drawCards(next, action.by, 1)
      }
      break
    }

    case 'endTurn': {
      assertTurn(next, action)
      passTurn(next, TURN_START_MEMORY, `${nameOf(next, action.by)} ends their turn`)
      break
    }

    case 'hatch': {
      const me = next.players[action.by]
      if (!me.eggDeck.length) throw new IllegalAction(action, 'your egg deck is empty')
      if (me.breeding.length) throw new IllegalAction(action, 'your breeding area is occupied')
      const egg = me.eggDeck.shift()!
      egg.faceDown = false
      me.breeding.push(egg)
      log(next, action.by, `${nameOf(next, action.by)} hatches ${egg.cardId}`)
      break
    }

    case 'attack': {
      assertTurn(next, action)
      const attacker = need(next, action, action.iid)
      assertOwn(action, attacker)
      if (attacker.zone !== 'battle') {
        throw new IllegalAction(action, 'only a Digimon in the battle area can attack')
      }

      let what = nameOf(next, other(action.by))
      if (action.target !== 'player') {
        const target = need(next, action, action.target)
        if (target.instance.owner === action.by) {
          throw new IllegalAction(action, 'you cannot attack your own Digimon')
        }
        if (target.zone !== 'battle') {
          throw new IllegalAction(action, 'that card is not in the battle area')
        }
        what = target.instance.cardId
      }

      // Declaring an attack suspends the attacker (11-2-1). That is mechanical
      // and always true, so the simulator does it rather than making the player
      // remember. Everything conditional -- summoning sickness, whether the
      // target may legally be attacked, counter and block timings -- is left to
      // the players, because it depends on card text this reducer never reads.
      attacker.instance.suspended = true
      next.attack = { attacker: action.iid, target: action.target }
      log(next, action.by, `${attacker.instance.cardId} attacks ${what}`)
      break
    }

    case 'endAttack': {
      next.attack = null
      log(next, action.by, 'attack ends')
      break
    }

    case 'securityCheck': {
      const victim = other(action.by)
      const stack = next.players[victim].security
      if (!stack.length) throw new IllegalAction(action, 'that security stack is empty')
      const card = stack.shift()!
      card.faceDown = false
      next.players[victim].reveal.push(card)
      log(next, action.by, `${nameOf(next, action.by)} checks security — ${card.cardId}`)
      break
    }

    case 'revealTop': {
      const me = next.players[action.by]
      const taken = me.deck.splice(0, Math.max(0, action.n))
      for (const card of taken) {
        card.faceDown = false
        me.reveal.push(card)
      }
      log(next, action.by, `${nameOf(next, action.by)} reveals ${taken.length} from the top ` +
        `of their deck — ${taken.map((c) => c.cardId).join(', ') || 'nothing'}`)
      break
    }

    case 'revealHand': {
      const me = next.players[action.by]
      const taken = me.hand.splice(0, me.hand.length)
      for (const card of taken) {
        card.faceDown = false
        me.reveal.push(card)
      }
      log(next, action.by, `${nameOf(next, action.by)} reveals their hand — ` +
        `${taken.map((c) => c.cardId).join(', ') || 'nothing'}`)
      break
    }

    case 'flip': {
      const spot = need(next, action, action.iid)
      assertOwn(action, spot)
      spot.instance.faceDown = !spot.instance.faceDown
      log(next, action.by, `${nameOf(next, action.by)} turns a card ` +
        `${spot.instance.faceDown ? 'face down' : 'face up'}`)
      break
    }

    case 'concede': {
      next.winner = other(action.by)
      log(next, action.by, `${nameOf(next, action.by)} concedes — ` +
        `${nameOf(next, next.winner)} wins`)
      break
    }

    case 'chat':
      log(next, action.by, `${nameOf(next, action.by)}: ${action.text}`)
      break

    case 'undoRequest':
      log(next, action.by, `${nameOf(next, action.by)} asks to undo`)
      break

    case 'undoAccept':
      log(next, action.by, `${nameOf(next, action.by)} agrees to undo`)
      break

    case 'undoDecline':
      log(next, action.by, `${nameOf(next, action.by)} declines the undo`)
      break
  }

  // Exactly one entry per action carries it, so `replay` sees each action once.
  if (next.log.length > mark) next.log[mark] = { ...next.log[mark], action }
  return next
}

/** Naming a card that was face down would leak it; the zone decides. */
function describe(card: CardInstance, from: Zone, to: Zone): string {
  const secret = HIDDEN_ZONES.has(from) && HIDDEN_ZONES.has(to)
  return secret ? 'a card' : card.cardId
}

function drawCards(state: GameState, player: PlayerId, n: number) {
  const me = state.players[player]
  let drawn = 0
  for (let i = 0; i < n; i++) {
    if (!me.deck.length) {
      state.winner = other(player)
      log(state, 'system', `${nameOf(state, player)} cannot draw — ` +
        `${nameOf(state, state.winner)} wins`)
      return
    }
    const card = me.deck.shift()!
    card.faceDown = false
    me.hand.push(card)
    drawn++
  }
  // The card itself is secret, so the log only ever says how many.
  log(state, player, `${nameOf(state, player)} draws ${drawn}`)
}

function setup(state: GameState, action: Extract<Action, { t: 'setup' }>): GameState {
  if (state.turn !== 0) throw new IllegalAction(action, 'this game is already set up')

  const seed = action.seed ?? 1
  const next: GameState = {
    ...emptyState(),
    seed,
    rngState: seed,
    firstPlayer: action.firstPlayer,
    turnPlayer: action.firstPlayer,
    turn: 1,
    phase: 'main',
    memory: 0,
  }

  for (const player of [0, 1] as PlayerId[]) {
    const me = next.players[player]
    me.name = action.names[player]
    me.deckList = action.decks[player]
    const [main, eggs] = build(next, action.decks[player], player)
    const [deck, rngState] = shuffled(main, next.rngState)
    me.deck = deck
    me.eggDeck = eggs
    next.rngState = rngState

    me.hand = me.deck.splice(0, OPENING_HAND).map((c) => ({ ...c, faceDown: false }))
    // 5-2-1-6: dealt one at a time, so the top card of the deck ends up at the
    // BOTTOM of the security stack.
    me.security = me.deck.splice(0, SECURITY_SIZE)
      .map((c) => ({ ...c, faceDown: true }))
      .reverse()
  }

  log(next, 'system', `${nameOf(next, 0)} vs ${nameOf(next, 1)} — ` +
    `${nameOf(next, action.firstPlayer)} goes first`)
  next.log[0] = { ...next.log[0], action }
  return next
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { loadCards, type CardIndex } from '../cards'
import { loadDecks, validate, type Deck } from '../deck'
import { act } from '../game/actions'
import { viewFor } from '../game/view'
import type { Action, DeckList, PlayerId } from '../game/types'
import { useGame } from './useGame'
import { Board } from './Board'

/**
 * The local play routes.
 *
 *   /play?mode=goldfish&deck=<id>        one deck against a seat that only passes
 *   /play?mode=hotseat&a=<id>&b=<id>     two players sharing one screen
 *
 * Everything the board renders comes from `viewFor`, never from `GameState`,
 * so the seat whose turn it is not cannot read anything it should not — the
 * same projection the server will do in Phase 2.
 */
type Mode = 'goldfish' | 'hotseat'

/** How long the empty seat "thinks" between phases. Long enough to follow. */
const AUTO_PASS_MS = 420

type Choice = { label: string; hint: string; to: string }

/** What the URL resolved to: a game to run, a deck to pick, or a dead end. */
type Plan =
  | { kind: 'loading' }
  | { kind: 'ready'; mode: Mode; setup: Action }
  | { kind: 'gate'; title: string; lines: string[]; choices: Choice[] }

function errorsIn(deck: Deck, index: CardIndex): string[] {
  return validate(deck, index).filter((p) => p.level === 'error').map((p) => p.text)
}

function listOf(deck: Deck): DeckList {
  return { main: deck.main, eggs: deck.eggs }
}

/** The same URL with one parameter set — used by the deck pickers below. */
function withParam(params: URLSearchParams, mode: Mode, key: string, value: string): string {
  const next = new URLSearchParams(params)
  next.set('mode', mode)
  next.set(key, value)
  return `/play?${next.toString()}`
}

/** Every legal saved deck, as a link that fills in one seat of this URL. */
function legalChoices(
  params: URLSearchParams,
  mode: Mode,
  key: string,
  decks: Deck[],
  index: CardIndex,
): Choice[] {
  const size = (pile: Record<string, number>) =>
    Object.values(pile).reduce((a, b) => a + b, 0)
  return decks
    .filter((deck) => errorsIn(deck, index).length === 0)
    .map((deck) => ({
      label: deck.name || 'Untitled deck',
      hint: `${size(deck.main)} + ${size(deck.eggs)}`,
      to: withParam(params, mode, key, deck.id),
    }))
}

const NOTHING_LEGAL =
  'None of the decks on this device are legal yet — a deck needs exactly 50 main-deck ' +
  'cards and at most 5 Digi-Eggs.'

function pickDeck(
  params: URLSearchParams,
  mode: Mode,
  key: string,
  decks: Deck[],
  index: CardIndex,
  title: string,
  lines: string[],
): Plan {
  const choices = legalChoices(params, mode, key, decks, index)
  return {
    kind: 'gate',
    title,
    lines: choices.length ? lines : [...lines, NOTHING_LEGAL],
    choices,
  }
}

/**
 * Resolves the query string into a game, without ever throwing: a missing or
 * unknown deck id is a normal thing for a pasted link to contain.
 */
function makePlan(
  params: URLSearchParams,
  decks: Deck[],
  index: CardIndex | null,
  seed: number,
): Plan {
  if (!index) return { kind: 'loading' }

  const raw = params.get('mode')
  if (raw !== null && raw !== 'goldfish' && raw !== 'hotseat') {
    return {
      kind: 'gate',
      title: 'Unknown play mode',
      lines: [`“${raw}” is not a play mode. Pick a deck to test on your own, or go back.`],
      choices: legalChoices(params, 'goldfish', 'deck', decks, index),
    }
  }
  const mode: Mode = raw === 'hotseat' ? 'hotseat' : 'goldfish'
  const find = (id: string) => decks.find((d) => d.id === id)

  const seats: string[] = mode === 'goldfish' ? ['deck'] : ['a', 'b']
  const chosen: Deck[] = []
  for (const key of seats) {
    const id = params.get(key)
    const label = mode === 'goldfish' ? 'a deck to test' : `a deck for player ${key.toUpperCase()}`
    if (!id) {
      return pickDeck(params, mode, key, decks, index,
        `Choose ${label}`,
        mode === 'goldfish'
          ? ['Goldfish mode deals you a hand against an empty seat that only passes.']
          : ['Hotseat mode puts both players on this screen, one turn at a time.'])
    }
    const deck = find(id)
    if (!deck) {
      return pickDeck(params, mode, key, decks, index,
        `That deck is not on this device`,
        [`No saved deck has the id “${id}”. Decks live in this browser only, so a link ` +
          `made on another device or in another browser will not find one. Choose ${label}:`])
    }
    const problems = errorsIn(deck, index)
    if (problems.length) {
      return {
        kind: 'gate',
        title: `“${deck.name}” is not legal yet`,
        lines: ['A deck has to be legal before it can be played:', ...problems],
        choices: legalChoices(params, mode, key, decks, index),
      }
    }
    chosen.push(deck)
  }

  if (mode === 'goldfish') {
    const [deck] = chosen
    // The empty seat gets a copy of the same list. It never plays a card, but
    // it does draw during its own draw phase, and a seat with no deck would
    // deck out on its first turn and hand you the win two turns in.
    return {
      kind: 'ready',
      mode,
      setup: act.setup(0, [listOf(deck), listOf(deck)], ['You', 'Goldfish'], 0, seed),
    }
  }

  const [a, b] = chosen
  // The seed picks who starts, so a reload of the same URL replays the same
  // game rather than quietly dealing a different one.
  const first = (seed & 1) as PlayerId
  return {
    kind: 'ready',
    mode,
    setup: act.setup(0, [listOf(a), listOf(b)], ['Player A', 'Player B'], first, seed),
  }
}

/** The readable dead end: never a blank page, always a way back. */
function Gate(props: { title: string; lines: string[]; choices: Choice[] }) {
  return (
    <div className="loading">
      <div className="play-gate">
        <h2>{props.title}</h2>
        {props.lines.map((line, i) => <p className="hint" key={i}>{line}</p>)}
        {props.choices.length > 0 && (
          <div className="play-gate-choices">
            {props.choices.map((c) => (
              <Link className="btn" key={c.to} to={c.to}>
                {c.label} <span>{c.hint}</span>
              </Link>
            ))}
          </div>
        )}
        <Link className="btn btn-primary" to="/">Back to the deck builder</Link>
      </div>
    </div>
  )
}

export function Play() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [index, setIndex] = useState<CardIndex | null>(null)

  // One seed for the life of this screen: the game is a fold over the action
  // log, and the log starts with a `setup` that has to stay put.
  const [seed] = useState(() => Math.floor(Math.random() * 0x7fffffff))
  const query = params.toString()

  // Decks are read once, on the way in. Editing them mid-game must not
  // reshuffle the game underneath the players.
  const [decks] = useState<Deck[]>(() => loadDecks())

  useEffect(() => {
    let live = true
    loadCards().then((loaded) => { if (live) setIndex(loaded) })
    return () => { live = false }
  }, [])

  const plan = useMemo(
    () => makePlan(new URLSearchParams(query), decks, index, seed),
    [query, decks, index, seed],
  )
  const ready = plan.kind === 'ready' ? plan : null

  // The card index arrives a tick after mount, and legality is judged with it,
  // so the game is dealt through `restart` rather than in `useGame`'s
  // initialiser. `plan` only changes identity when the URL does, which is
  // exactly when a new game is wanted.
  const { state, dispatch, undo, restart, refused } = useGame(null)
  useEffect(() => {
    if (ready) restart(ready.setup)
  }, [ready, restart])

  const hotseat = ready?.mode === 'hotseat'
  const goldfish = ready?.mode === 'goldfish'

  // Hotseat hides the board between turns. It starts covered so the first
  // player picks the device up before anything is on screen.
  const [covered, setCovered] = useState(false)
  const shown = useRef<PlayerId | null>(null)
  useEffect(() => {
    if (!hotseat || state.turn === 0) return
    if (shown.current === state.turnPlayer) return
    shown.current = state.turnPlayer
    setCovered(true)
  }, [hotseat, state.turn, state.turnPlayer])

  /**
   * The empty seat, passing.
   *
   * The loop cannot run away: it is one timer, cleared by the effect's own
   * cleanup on unmount and before every reschedule, and it re-arms only when
   * one of the values it watches has changed. A `nextPhase` always moves the
   * phase or the turn, so it re-arms until the turn comes back — and if the
   * reducer ever refuses one, nothing in the dependency list changes and the
   * loop stops instead of retrying forever. A finished game stops it outright.
   */
  useEffect(() => {
    if (!goldfish) return
    if (state.winner !== null || state.turn === 0) return
    if (state.turnPlayer !== 1) return
    const timer = setTimeout(() => dispatch(act.nextPhase(1)), AUTO_PASS_MS)
    return () => clearTimeout(timer)
  }, [goldfish, state.turn, state.turnPlayer, state.phase, state.winner, dispatch])

  if (plan.kind === 'gate') return <Gate {...plan} />
  if (!ready || state.turn === 0) return <div className="loading">Dealing…</div>

  // Hotseat renders whoever is holding the device; goldfish is always seat 0.
  const seat: PlayerId = hotseat ? state.turnPlayer : 0
  const view = viewFor(state, seat)
  const holder = view.players[seat].name

  return (
    <>
      <Board
        view={view}
        seat={seat}
        index={index!}
        dispatch={dispatch}
        onUndo={undo}
        onExit={() => navigate('/')}
        refused={refused}
      />
      {hotseat && covered && (
        <div
          className="pass-scrim"
          role="button"
          tabIndex={0}
          onClick={() => setCovered(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setCovered(false)
          }}
        >
          <div>
            <h2>Pass the device to {holder}</h2>
            <p>Turn {state.turn}. Tap anywhere once {holder} is holding it.</p>
            <button className="btn btn-primary">I am {holder}</button>
          </div>
        </div>
      )}
    </>
  )
}

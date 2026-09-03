import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { COLORS, loadCards, type CardIndex } from '../cards'
import { loadDecks, stats, validate, type Deck } from '../deck'
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

/**
 * One deck, offered as a seat to fill. The deck itself travels with the choice
 * rather than just its name: what a player needs in order to pick between two
 * of their own decks is the *shape* of each — see `DeckShape`.
 */
type Choice = { label: string; hint: string; to: string; deck: Deck }

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
      deck,
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

// ------------------------------------------------- the shape of a deck, small

const colorVar = (color: string) => `var(--c-${color.toLowerCase()})`

/**
 * A labelled bar chart, exactly the one the deck builder draws.
 *
 * It is written out again rather than imported because `DeckPanel` keeps it
 * private, and the classes are what actually carry the treatment: `.bar-row`,
 * `.bar` and `.color-bar` are the builder's own rules, so a curve here and a
 * curve there are the same picture and not two dialects of one.
 */
function Bars({ title, entries }: { title: string; entries: Array<[string, number]> }) {
  if (!entries.length) return null
  const max = Math.max(...entries.map(([, n]) => n))
  return (
    <div className="group">
      <h3>{title}</h3>
      {entries.map(([label, n]) => (
        <div className="bar-row" key={label}>
          <span>{label}</span>
          <span className="bar"><i style={{ width: `${(n / max) * 100}%` }} /></span>
          <span>{n}</span>
        </div>
      ))}
    </div>
  )
}

/** Digimon first, then the two supporting types, then anything else. */
const TYPE_ORDER = ['Digimon', 'Tamer', 'Option']

/**
 * What a deck is made of, at the moment you are choosing which one to play.
 *
 * The list used to be a name and a card count, which is enough to tell two
 * decks apart only if you remember what you called them. `stats()` already
 * computes all of this for the builder — this draws the same three readings
 * with the same classes, small enough to sit under a name.
 */
function DeckShape({ deck, index }: { deck: Deck; index: CardIndex }) {
  const s = stats(deck, index)

  const curve: Array<[string, number]> = Object.entries(s.curve)
    .map(([k, n]) => [Number(k), n] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .map(([k, n]) => [k === 10 ? '10+' : String(k), n])

  const types: Array<[string, number]> = Object.entries(s.byType)
    .sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a[0])
      const ib = TYPE_ORDER.indexOf(b[0])
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0])
    })

  const colorTotal = COLORS.reduce((sum, c) => sum + (s.byColor[c] ?? 0), 0)

  return (
    <div className="deck-shape">
      <div className="stats-cols">
        <Bars title="Play cost" entries={curve} />
        <Bars title="Card type" entries={types} />
      </div>
      {colorTotal > 0 && (
        <div className="color-bar" title={COLORS.filter((c) => s.byColor[c])
          .map((c) => `${c} ${s.byColor[c]}`).join(' · ')}>
          {COLORS.filter((c) => s.byColor[c]).map((c) => (
            <i
              key={c}
              style={{ background: colorVar(c), width: `${(s.byColor[c] / colorTotal) * 100}%` }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** The readable dead end: never a blank page, always a way back. */
function Gate(
  props: { title: string; lines: string[]; choices: Choice[]; index: CardIndex },
) {
  const picking = props.choices.length > 0
  return (
    <div className="loading">
      <div className={picking ? 'play-gate picking' : 'play-gate'}>
        <h2>{props.title}</h2>
        {props.lines.map((line, i) => <p className="hint" key={i}>{line}</p>)}
        {picking && (
          <div className="play-gate-choices">
            {props.choices.map((c) => (
              <Link className="btn deck-choice" key={c.to} to={c.to}>
                {/*
                  A `<b>` and not a `<span>`: `.play-gate-choices .btn span` is
                  the existing rule that greys the card count down to 11px, and
                  a span here would hand the deck's own name the same treatment.
                */}
                <b className="deck-choice-head">
                  {c.label} <span>{c.hint}</span>
                </b>
                <DeckShape deck={c.deck} index={props.index} />
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

  /*
    One seed per deal. The game is a fold over the action log and the log starts
    with a `setup` that has to stay put, so this cannot change while a game is
    running — but drawing a new one is exactly what starting over *is*: the
    shuffle, the opening hands and the five security cards all come out of it.
    `plan` is memoised on the seed, and the effect below re-deals when `plan`
    changes identity, so `restartGame` is the whole of Restart.
  */
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 0x7fffffff))
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

  /** Is the Restart button waiting for a yes? Inline, never `window.confirm`. */
  const [confirmRestart, setConfirmRestart] = useState(false)

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

  /*
    Start over with the same decks and a fresh shuffle.

    It is one line because the deal is already a pure function of the seed: a
    new seed makes a new `plan`, the effect above sees a new `ready` and calls
    `useGame`'s `restart`, and the action log is replaced by a single new
    `setup`. Nothing here reaches into the game — `Play` owns the session, which
    is the only reason this can live outside the board at all.

    The hotseat cover is reset with it. It only raises itself when the turn
    player *changes*, and a redeal that happens to start with the same seat
    would otherwise hand the device straight over with the new hand showing.
  */
  const restartGame = () => {
    setConfirmRestart(false)
    shown.current = null
    setCovered(false)
    setSeed(Math.floor(Math.random() * 0x7fffffff))
  }

  if (plan.kind === 'gate') return <Gate {...plan} index={index!} />
  if (!ready || state.turn === 0) return <div className="loading">Dealing…</div>

  // Hotseat renders whoever is holding the device; goldfish is always seat 0.
  const seat: PlayerId = hotseat ? state.turnPlayer : 0
  const view = viewFor(state, seat)
  const holder = view.players[seat].name

  return (
    <>
      <Board
        /*
          A new deal is a new board, not the old one holding new cards.

          `Board` keeps a little screen state of its own — the cost offer it is
          waiting to be told about, a half-picked attack target, whose trash is
          open, the card in the reader — and none of it survives a restart
          meaningfully: an offer to pay for a Sparrowmon that is back in a
          shuffled deck is worse than no offer. Keying the component on the deal
          throws all of it away in one place, which is both shorter and more
          honest than teaching each piece of it to notice. The two preferences
          that *should* outlive a game (the row split, the reader's fold) live
          in storage and come back on their own.
        */
        key={`${query}:${seed}`}
        view={view}
        seat={seat}
        index={index!}
        dispatch={dispatch}
        onUndo={undo}
        onExit={() => navigate('/')}
        refused={refused}
      />

      {/*
        Restart. It sits out here, over the mat, rather than in the rail beside
        Exit, because the rail belongs to `Board` — and `Board` is
        presentational: it renders a view and emits actions, and it has no
        session to restart. `Play` holds the log, so `Play` holds the button.

        The confirm is inline and follows the board's own Concede: a native
        `confirm()` steals focus from the page and cannot be dismissed by
        clicking away from it, which is the wrong shape for a control that sits
        two pixels from the board you are still playing on. A finished game has
        nothing left to discard, so it skips straight through.
      */}
      <div className="play-restart">
        {confirmRestart ? (
          <>
            <span className="zone-label">Restart?</span>
            <button type="button" className="btn btn-sm" onClick={restartGame}>Yes</button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setConfirmRestart(false)}
            >
              No
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            title={state.winner === null
              ? 'Deal this game again — the same decks, a fresh shuffle'
              : 'Deal again — the same decks, a fresh shuffle'}
            onClick={() => {
              if (state.winner === null) setConfirmRestart(true)
              else restartGame()
            }}
          >
            {state.winner === null ? 'Restart' : 'Play again'}
          </button>
        )}
      </div>

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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import type { Card, CardIndex } from '../cards'
import { CardDetail } from '../components/CardDetail'
import { act } from '../game/actions'
import {
  MEMORY_MAX, PHASES, other,
  type Action, type PlayerId, type Position, type Zone,
} from '../game/types'
import type { PlayerView, ViewCard, ViewPlayer } from '../game/view'
import { Art, BoardCard } from './BoardCard'
import { OPPONENT_DESTINATIONS, UiCtx, useUi, type BoardUi, type DragData, type MenuTarget } from './boardCtx'
import { ContextMenu, type MenuItem } from './ContextMenu'

export type BoardProps = {
  /** Already projected for `seat` — the board never sees a GameState. */
  view: PlayerView
  /** The seat this screen is controlling. */
  seat: PlayerId
  index: CardIndex
  dispatch: (action: Action) => void
  onUndo: () => void
  /** Leave the game, back to the deck builder. */
  onExit: () => void
  /** Reason the last action was rejected, or null. */
  refused: string | null
}

const PHASE_LABEL: Record<string, string> = {
  unsuspend: 'Unsusp', draw: 'Draw', breeding: 'Breed', main: 'Main', end: 'End',
}

/**
 * Drop-target ids are strings because dnd-kit compares them by identity. The
 * shape is `kind:zone[:position]`:
 *   card:<iid>       a card in play — digivolve, or attach with Shift
 *   zone:<zone>      one of my own areas
 *   dz:<zone>:<pos>  a labelled chip from the floating strip
 *   off:<zone>       an opponent area; always disabled, present only so the
 *                    two seats can share one component
 */
const MY = (zone: string) => `zone:${zone}`
const THEIRS = (zone: string) => `off:${zone}`

// --------------------------------------------------------------- small parts

function DropField(
  { id, disabled, className, children }:
  { id: string; disabled?: boolean; className: string; children: ReactNode },
) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled })
  return (
    <div ref={setNodeRef} className={!disabled && isOver ? `${className} over` : className}>
      {children}
    </div>
  )
}

function DropChip({ id, label }: { id: string; label: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={isOver ? 'dropzone over' : 'dropzone'}>{label}</div>
  )
}

function Pile(
  { dropId, disabled, label, labelFirst, count, faceCardId, onClick, title }:
  {
    dropId: string; disabled?: boolean; label: string; labelFirst: boolean
    count: number; faceCardId?: string | null; onClick?: () => void; title?: string
  },
) {
  const ui = useUi()
  const { setNodeRef, isOver } = useDroppable({ id: dropId, disabled })
  const tag = <div className="zone-label">{label}</div>

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={!disabled && isOver ? 'pile over' : 'pile'}
      title={title}
      onClick={onClick}
      onMouseEnter={(e) => { if (faceCardId) ui.hoverCard(faceCardId, e) }}
      onMouseLeave={() => ui.hoverCard(null)}
    >
      {labelFirst && tag}
      <div className={count === 0 ? 'pile-face empty' : 'pile-face'}>
        {faceCardId ? <Art cardId={faceCardId} index={ui.index} /> : null}
      </div>
      {!labelFirst && tag}
      <div className="pile-count">{count}</div>
    </button>
  )
}

/**
 * Security is drawn as a fan rather than a pile so its size reads without
 * counting. Every card in it is masked for everyone — including its owner —
 * so the fan is a shape, never a set of handles.
 */
function SecurityFan(
  { dropId, disabled, cards, labelFirst, onClick, title }:
  {
    dropId: string; disabled?: boolean; cards: ViewCard[]; labelFirst: boolean
    onClick?: () => void; title?: string
  },
) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId, disabled })
  const tag = <div className="zone-label">Security {cards.length}</div>

  return (
    <div>
      {labelFirst && tag}
      <button
        type="button"
        ref={setNodeRef}
        className={!disabled && isOver ? 'security-fan over' : 'security-fan'}
        onClick={onClick}
        title={title}
      >
        {cards.length === 0
          ? <div className="pile-face empty" />
          : cards.map((c) => <span className="sec-card" key={c.iid} />)}
      </button>
      {!labelFirst && tag}
    </div>
  )
}

// ---------------------------------------------------------------------- seat

type SeatProps = {
  player: ViewPlayer
  who: PlayerId
  /** Drawn at the top of the screen, mirrored, and never a drop target. */
  opponent: boolean
  onCard: (card: ViewCard, zone: Zone) => void
  onHatch: () => void
  onDeck: () => void
  onSecurity?: () => void
  securityTitle: string
}

function Seat(p: SeatProps) {
  const mine = !p.opponent
  const zoneId = mine ? MY : THEIRS
  const labelFirst = mine

  /** Nearest the memory gauge first, so the two halves read as a mirror. */
  const order = (a: ReactNode, b: ReactNode): ReactNode =>
    mine ? <>{a}{b}</> : <>{b}{a}</>

  const labelled = (label: string, node: ReactNode): ReactNode =>
    labelFirst
      ? <><div className="zone-label">{label}</div>{node}</>
      : <>{node}<div className="zone-label">{label}</div></>

  const cards = (list: ViewCard[], zone: Zone) =>
    list.map((c) => (
      <BoardCard
        key={c.iid}
        card={c}
        zone={zone}
        owner={p.who}
        draggable={c.cardId !== null}
        droppable={mine}
        onClick={() => p.onCard(c, zone)}
      />
    ))

  const breeding = labelled('Breeding', (
    <DropField id={zoneId('breeding')} disabled={!mine} className="field">
      {cards(p.player.breeding, 'breeding')}
    </DropField>
  ))

  // The egg deck is a hidden zone, so `viewFor` masks every card in it and its
  // top card has a positional placeholder iid, not a real one. Hatching
  // therefore cannot be a `move` naming a card; `hatch` reaches the top egg by
  // position instead, and a click is the whole gesture.
  //
  // It rides with the other piles rather than over the breeding area: the first
  // seat column is exactly one card wide and one card tall's worth of row, and
  // two stacked piles there overflow into the memory gauge.
  const canHatch = mine && p.player.eggDeck.length > 0 && p.player.breeding.length === 0
  const eggs = (
    <Pile
      dropId={zoneId('eggDeck')}
      disabled={!mine}
      label="Eggs"
      labelFirst={labelFirst}
      count={p.player.eggDeck.length}
      onClick={canHatch ? p.onHatch : undefined}
      title={
        !mine ? 'Egg deck (face down)'
          : p.player.breeding.length ? 'Breeding area is occupied'
            : p.player.eggDeck.length ? 'Click to hatch the top egg'
              : 'Egg deck is empty'
      }
    />
  )

  const battle = labelled('Battle area', (
    <DropField id={zoneId('battle')} disabled={!mine} className="field">
      {cards(p.player.battle, 'battle')}
    </DropField>
  ))

  const reveal = p.player.reveal.length > 0
    ? labelled('Revealed', (
      <DropField id={zoneId('reveal')} disabled={!mine} className="field">
        {cards(p.player.reveal, 'reveal')}
      </DropField>
    ))
    : null

  const security = (
    <SecurityFan
      dropId={zoneId('security')}
      disabled={!mine}
      cards={p.player.security}
      labelFirst={labelFirst}
      onClick={p.onSecurity}
      title={p.securityTitle}
    />
  )

  const deck = (
    <Pile
      dropId={zoneId('deck')}
      disabled={!mine}
      label="Deck"
      labelFirst={labelFirst}
      count={p.player.deck.length}
      onClick={p.onDeck}
      title={mine ? 'Draw a card' : 'Opponent deck'}
    />
  )

  const trash = (
    <Pile
      dropId={zoneId('trash')}
      disabled={!mine}
      label="Trash"
      labelFirst={labelFirst}
      count={p.player.trash.length}
      faceCardId={p.player.trash[0]?.cardId ?? null}
      title="Trash"
    />
  )

  return (
    <div className={p.opponent ? 'seat opponent' : 'seat'}>
      <div>{breeding}</div>
      <div>{order(battle, reveal)}</div>
      <div className="piles">
        {mine ? <>{security}{deck}{trash}{eggs}</> : <>{eggs}{trash}{deck}{security}</>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- context menus

const MOVE_TARGETS: Array<{ label: string; to: Zone; position?: Position }> = [
  { label: 'Hand', to: 'hand' },
  { label: 'Battle area', to: 'battle' },
  { label: 'Breeding', to: 'breeding' },
  { label: 'Trash', to: 'trash' },
  { label: 'Deck — top', to: 'deck', position: 'top' },
  { label: 'Deck — bottom', to: 'deck', position: 'bottom' },
  { label: 'Security — top', to: 'security', position: 'top' },
  { label: 'Security — bottom', to: 'security', position: 'bottom' },
  { label: 'Egg deck', to: 'eggDeck', position: 'top' },
]

/**
 * The right-click menu for one card. An opponent's card gets only the moves the
 * reducer will accept from me, so nothing on the menu can produce a refusal.
 */
function menuFor(
  target: MenuTarget,
  seat: PlayerId,
  dispatch: (a: Action) => void,
  name: string,
): MenuItem[] {
  const { card, owner, zone } = target
  const iid = card.iid
  const inPlay = zone === 'battle' || zone === 'breeding'
  const item = (label: string, run: () => void): MenuItem => ({ kind: 'item', label, run })

  const moves = MOVE_TARGETS
    .filter((m) => owner === seat || OPPONENT_DESTINATIONS.has(m.to))
    .filter((m) => m.to !== zone || m.position !== undefined)
    .map((m) => item(m.label, () =>
      dispatch(act.move(seat, iid, m.to, m.position ? { position: m.position } : {}))))

  if (owner !== seat) {
    return [
      { kind: 'title', label: `${name} — opponent's` },
      item('Reveal', () => dispatch(act.move(seat, iid, 'reveal'))),
      { kind: 'sep' },
      { kind: 'title', label: 'Move to' },
      ...moves,
    ]
  }

  return [
    { kind: 'title', label: name },
    ...(inPlay
      ? [
        item(card.suspended ? 'Unsuspend' : 'Suspend', () =>
          dispatch(card.suspended ? act.unsuspend(seat, iid) : act.suspend(seat, iid))),
        item('De-digivolve 1', () => dispatch(act.deDigivolve(seat, iid, 1))),
      ]
      : []),
    item('DP +1000', () => dispatch(act.setDp(seat, iid, 1000))),
    item('DP −1000', () => dispatch(act.setDp(seat, iid, -1000))),
    item('Counter +', () => dispatch(act.setCounters(seat, iid, 1))),
    item('Counter −', () => dispatch(act.setCounters(seat, iid, -1))),
    { kind: 'sep' },
    item('Reveal', () => dispatch(act.move(seat, iid, 'reveal'))),
    item(card.faceDown ? 'Turn face up' : 'Turn face down', () => dispatch(act.flip(seat, iid))),
    item('Trash', () => dispatch(act.move(seat, iid, 'trash'))),
    { kind: 'sep' },
    { kind: 'title', label: 'Move to' },
    ...moves,
  ]
}

// --------------------------------------------------------------------- board

/**
 * The whole game board. It owns no game state: everything it draws comes from
 * `view`, and every interaction leaves as exactly one action through
 * `dispatch`. That is what lets the identical component sit on top of a
 * websocket in Phase 2 without a line changing.
 */
export function Board({ view, seat, index, dispatch, onUndo, onExit, refused }: BoardProps) {
  const foeId = other(seat)
  const me = view.players[seat]
  const foe = view.players[foeId]

  const [hover, setHover] = useState<{ card: Card; x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<{ target: MenuTarget; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState<DragData | null>(null)
  const [chat, setChat] = useState('')
  const [confirmConcede, setConfirmConcede] = useState(false)
  const [checking, setChecking] = useState(false)

  // dnd-kit's drag events carry the pointerdown that started the drag, not the
  // modifier state at the moment of the drop, so Shift is tracked separately.
  const shift = useRef(false)
  const logRef = useRef<HTMLDivElement | null>(null)

  const hoverCard = useCallback(
    (cardId: string | null, at?: { clientX: number; clientY: number }) => {
      if (!cardId || !at) return setHover(null)
      const card = index.byId.get(cardId)
      setHover(card ? { card, x: at.clientX, y: at.clientY } : null)
    },
    [index],
  )

  const openMenu = useCallback((target: MenuTarget, x: number, y: number) => {
    setHover(null)
    setMenu({ target, x, y })
  }, [])

  const ui = useMemo<BoardUi>(
    () => ({ seat, index, dispatch, hoverCard, openMenu }),
    [seat, index, dispatch, hoverCard, openMenu],
  )

  // A click has to survive the drag sensor, so a press only becomes a drag
  // after the pointer has actually travelled.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  useEffect(() => {
    const track = (e: KeyboardEvent | PointerEvent) => { shift.current = e.shiftKey }
    window.addEventListener('keydown', track)
    window.addEventListener('keyup', track)
    window.addEventListener('pointermove', track)
    return () => {
      window.removeEventListener('keydown', track)
      window.removeEventListener('keyup', track)
      window.removeEventListener('pointermove', track)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        onUndo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === ' ') {
        e.preventDefault()
        dispatch(act.nextPhase(seat))
        return
      }
      if (e.key.length !== 1) return
      if (e.key >= '0' && e.key <= '9') {
        dispatch(act.payMemory(seat, Number(e.key)))
        return
      }
      switch (e.key.toLowerCase()) {
        case 'd': dispatch(act.draw(seat, 1)); break
        case 's': dispatch(act.shuffleDeck(seat)); break
        case 'e': dispatch(act.endTurn(seat)); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, onUndo, seat])

  // Newest at the bottom, always in view.
  const logCount = view.log.length
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logCount])

  // The prompt is over once the revealed card has been sent somewhere.
  const revealCount = me.reveal.length + foe.reveal.length
  useEffect(() => {
    if (revealCount === 0) setChecking(false)
  }, [revealCount])

  // ------------------------------------------------------------ interactions

  const onDragStart = (e: DragStartEvent) => {
    setHover(null)
    setMenu(null)
    setDragging((e.active.data.current as DragData | undefined) ?? null)
  }

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const data = e.active.data.current as DragData | undefined
    if (!data || !e.over) return

    const id = String(e.over.id)
    const ownCard = data.owner === seat

    if (id.startsWith('card:')) {
      const targetIid = id.slice('card:'.length)
      // Digivolving and attaching are both "my card onto my card" only.
      if (!ownCard || targetIid === data.iid) return
      dispatch(shift.current
        ? act.attach(seat, data.iid, targetIid)
        : act.digivolve(seat, targetIid, data.iid))
      return
    }

    const [, zoneName, position] = id.split(':')
    const to = zoneName as Zone
    if (!ownCard && !OPPONENT_DESTINATIONS.has(to)) return
    // Dropping a card back where it already is would only re-log it.
    if (data.zone === to && !position) return
    dispatch(act.move(seat, data.iid, to, position ? { position: position as Position } : {}))
  }

  /** Clicking a card in play is the suspend toggle; elsewhere it does nothing. */
  const onCard = (card: ViewCard, zone: Zone, owner: PlayerId) => {
    if (owner !== seat || card.cardId === null) return
    if (zone !== 'battle' && zone !== 'breeding') return
    dispatch(card.suspended ? act.unsuspend(seat, card.iid) : act.suspend(seat, card.iid))
  }

  const checkSecurity = () => {
    if (view.phase !== 'main') return
    setChecking(true)
    dispatch(act.securityCheck(seat))
  }

  const myMemory = view.turnPlayer === seat ? view.memory : -view.memory
  /** The gauge is drawn from my seat's point of view; the action is not. */
  const asAction = (mine: number) => (view.turnPlayer === seat ? mine : -mine)

  // The prompt follows a security check specifically, not every reveal.
  const revealed = foe.reveal[foe.reveal.length - 1] ?? me.reveal[me.reveal.length - 1] ?? null
  const revealedOwner: PlayerId = foe.reveal.length > 0 ? foeId : seat
  const revealedName = revealed?.cardId
    ? index.byId.get(revealed.cardId)?.name ?? revealed.cardId
    : null

  const seatLine = (who: PlayerId) => {
    const pl = view.players[who]
    return (
      <div className={view.turnPlayer === who ? 'seat-line active' : 'seat-line'}>
        <span className="turn-dot" />
        <b>{pl.name || `Player ${who + 1}`}</b>
        {who === seat && <span>(you)</span>}
        <span>Hand {pl.hand.length}</span>
        <span>Deck {pl.deck.length}</span>
        <span>Security {pl.security.length}</span>
        <span>Trash {pl.trash.length}</span>
      </div>
    )
  }

  const gaugeStops: number[] = []
  for (let v = -MEMORY_MAX; v <= MEMORY_MAX; v++) gaugeStops.push(v)

  return (
    <UiCtx.Provider value={ui}>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="board">
          <div className="board-main">
            <div>
              {seatLine(foeId)}
              <DropField id={THEIRS('hand')} disabled className="hand-strip">
                {foe.hand.map((c) => (
                  <BoardCard key={c.iid} card={c} zone="hand" owner={foeId} />
                ))}
              </DropField>
            </div>

            <Seat
              player={foe}
              who={foeId}
              opponent
              onCard={(card, zone) => onCard(card, zone, foeId)}
              onHatch={() => undefined}
              onDeck={() => undefined}
              onSecurity={checkSecurity}
              securityTitle={view.phase === 'main'
                ? 'Check security'
                : 'Security checks happen in the main phase'}
            />

            <div className="gauge-row">
              <div className="gauge">
                {gaugeStops.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={[
                      'gauge-stop',
                      v === 0 ? 'zero' : v > 0 ? 'mine' : 'theirs',
                      v === myMemory ? 'on' : '',
                    ].filter(Boolean).join(' ')}
                    title={v === 0 ? 'Memory 0' : `${Math.abs(v)} on ${v > 0 ? 'your' : "your opponent's"} side`}
                    onClick={() => dispatch(act.setMemory(seat, asAction(v)))}
                  >
                    {Math.abs(v)}
                  </button>
                ))}
              </div>
              <div className="cost-strip">
                <span className="zone-label">Pay</span>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((cost) => (
                  <button
                    key={cost}
                    type="button"
                    className="btn"
                    title={`Pay ${cost} memory`}
                    onClick={() => dispatch(act.payMemory(seat, cost))}
                  >
                    {cost}
                  </button>
                ))}
              </div>
            </div>

            <Seat
              player={me}
              who={seat}
              opponent={false}
              onCard={(card, zone) => onCard(card, zone, seat)}
              onHatch={() => dispatch(act.hatch(seat))}
              onDeck={() => dispatch(act.draw(seat, 1))}
              securityTitle="Your security stack"
            />

            <div>
              <DropField id={MY('hand')} className="hand-strip">
                {me.hand.map((c) => (
                  <BoardCard key={c.iid} card={c} zone="hand" owner={seat} draggable />
                ))}
              </DropField>
              {seatLine(seat)}
            </div>
          </div>

          <div className="rail">
            <div className="phase-bar">
              {PHASES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={p === view.phase ? 'step-phase on' : 'step-phase'}
                  title="Advance one phase"
                  onClick={() => dispatch(act.nextPhase(seat))}
                >
                  {PHASE_LABEL[p]}
                </button>
              ))}
            </div>

            <div className="readout">
              <div><b>{view.turn}</b><span>Turn</span></div>
              <div>
                <b>{view.turnPlayer === seat ? 'You' : 'Them'}</b>
                <span>{PHASE_LABEL[view.phase]} phase</span>
              </div>
              <div>
                <b>{myMemory > 0 ? `+${myMemory}` : myMemory}</b>
                <span>Memory</span>
              </div>
            </div>

            {view.winner !== null && (
              <div className="security-prompt">
                <span>{view.winner === seat ? 'You win' : 'You lose'}</span>
                <span className="spacer" />
                <button type="button" className="btn btn-sm btn-primary" onClick={onExit}>Leave</button>
              </div>
            )}

            {revealed && revealedName && (
              <div className="security-prompt">
                <span>{checking ? 'Security' : 'Revealed'}: <b>{revealedName}</b></span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => dispatch(act.move(seat, revealed.iid, 'trash'))}
                >
                  Trash
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => dispatch(act.move(seat, revealed.iid, 'hand'))}
                >
                  To hand
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={revealedOwner !== seat}
                  title={revealedOwner === seat
                    ? 'Put it into play'
                    : "Only its owner can put their own security card into play"}
                  onClick={() => dispatch(act.move(seat, revealed.iid, 'battle'))}
                >
                  Play
                </button>
              </div>
            )}

            {refused && <div className="refused">{refused}</div>}

            <div className="rail-actions">
              {confirmConcede ? (
                <>
                  <span className="zone-label">Concede?</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => { setConfirmConcede(false); dispatch(act.concede(seat)) }}
                  >
                    Yes
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setConfirmConcede(false)}>
                    No
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn" onClick={() => dispatch(act.endTurn(seat))}>
                    End turn
                  </button>
                  <button type="button" className="btn" onClick={onUndo}>Undo</button>
                  <button type="button" className="btn" onClick={() => setConfirmConcede(true)}>
                    Concede
                  </button>
                </>
              )}
            </div>

            <div className="rail-actions">
              <button type="button" className="btn" onClick={() => dispatch(act.draw(seat, 1))}>Draw</button>
              <button type="button" className="btn" onClick={() => dispatch(act.shuffleDeck(seat))}>
                Shuffle
              </button>
              <button type="button" className="btn" onClick={onExit}>Exit</button>
            </div>

            <div className="logpanel">
              <div className="log-scroll" ref={logRef}>
                {view.log.map((e) => (
                  <div key={e.n} className={`log-line ${e.by === 'system' ? 'system' : `p${e.by}`}`}>
                    {e.text}
                  </div>
                ))}
              </div>
              <form
                className="log-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  const text = chat.trim()
                  if (!text) return
                  dispatch(act.chat(seat, text))
                  setChat('')
                }}
              >
                {/*
                  Not `.field`: inside .board that class is the battle-area
                  rule, which would give the input a 120px min-height.
                */}
                <input
                  className="log-input"
                  value={chat}
                  placeholder="Say something…"
                  onChange={(e) => setChat(e.target.value)}
                />
                <button type="submit" className="btn btn-sm">Send</button>
              </form>
            </div>

            <div className="keys">
              <kbd>D</kbd> draw · <kbd>S</kbd> shuffle · <kbd>Space</kbd> next phase ·{' '}
              <kbd>E</kbd> end turn · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>0</kbd>–<kbd>9</kbd> pay
              <br />
              Drag onto a Digimon to digivolve, <kbd>Shift</kbd>+drag to attach. Right-click for more.
            </div>
          </div>

          {/* Inside .board so the overlay card inherits the --bcard sizing. */}
          <DragOverlay dropAnimation={null}>
            {dragging
              ? <div className="bcard"><Art cardId={dragging.cardId} index={index} /></div>
              : null}
          </DragOverlay>
        </div>

        {dragging && (
          <div className="dropzones">
            <DropChip id="dz:hand:bottom" label="Hand" />
            <DropChip id="dz:trash:top" label="Trash" />
            <DropChip id="dz:deck:top" label="Deck top" />
            <DropChip id="dz:deck:bottom" label="Deck bottom" />
            <DropChip id="dz:security:top" label="Security top" />
            <DropChip id="dz:security:bottom" label="Security bottom" />
          </div>
        )}
      </DndContext>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuFor(
            menu.target,
            seat,
            dispatch,
            menu.target.card.cardId
              ? index.byId.get(menu.target.card.cardId)?.name ?? menu.target.card.cardId
              : 'Card',
          )}
          onClose={() => setMenu(null)}
        />
      )}

      {hover && <CardDetail card={hover.card} meta={index.meta} x={hover.x} y={hover.y} />}
    </UiCtx.Provider>
  )
}

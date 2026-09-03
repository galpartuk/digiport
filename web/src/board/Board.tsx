import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import {
  DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import type { Card, CardIndex } from '../cards'
import { act } from '../game/actions'
import {
  MEMORY_MAX, PHASES, other,
  type Action, type Attack, type Iid, type PlayerId, type Position, type Zone,
} from '../game/types'
import type { PlayerView, ViewCard, ViewPlayer } from '../game/view'
import { Art, BoardCard, type CardMark } from './BoardCard'
import { OPPONENT_DESTINATIONS, UiCtx, useUi, type BoardUi, type DragData, type MenuTarget } from './boardCtx'
import { CardPeek } from './CardPeek'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { useBattleFit } from './fit'
import { RulePicker } from './RulePicker'
import { RULE_BADGE, offeredIn, ruleHint, ruleOn, rulesOn, type RuleKind, type RuleSpec } from './rules'

/** Where the front-row / back-row preference is remembered. */
const ROWS_KEY = 'digiport.board.rows'

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

/**
 * Comprehensive rules 6-1-2 lists four phases and no end phase, so the rail has
 * four stops. The turn ends on the memory condition (6-1-4-1) or on a pass
 * (6-5-1-7-1) — which is why "End turn" caps the rail instead of being a fifth
 * phase you step into.
 */
const PHASE_LABEL: Record<string, string> = {
  unsuspend: 'Unsusp', draw: 'Draw', breeding: 'Breed', main: 'Main',
}

const PHASE_HINT: Record<string, string> = {
  unsuspend: 'Unsuspend phase — everything you control unsuspends at once (6-2-1)',
  draw: 'Draw phase — draw 1; the first player skips it on turn 1 (6-3-1-1)',
  breeding: 'Breeding phase — hatch, or move your Digimon out. Exactly one (6-4-1)',
  main: 'Main phase — play, digivolve, attack, or pass (6-5-1)',
}

/**
 * Drop-target ids are strings because dnd-kit compares them by identity. The
 * shape is `kind:zone[:position]`:
 *   card:<iid>       a card in play — digivolve, place under, or link
 *   zone:<zone>      one of my own areas
 *   dz:<zone>:<pos>  a labelled chip from the floating strip
 *   off:<zone>       an opponent area; always disabled, present only so the
 *                    two seats can share one component
 */
const MY = (zone: string) => `zone:${zone}`
const THEIRS = (zone: string) => `off:${zone}`

// --------------------------------------------------------------- small parts

function DropField(
  { id, disabled, className, children, innerRef }:
  {
    id: string; disabled?: boolean; className: string; children: ReactNode
    /** A second ref onto the same node — the battle area is measured as well as dropped on. */
    innerRef?: (node: HTMLElement | null) => void
  },
) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled })
  return (
    <div
      ref={(node) => { setNodeRef(node); innerRef?.(node) }}
      className={!disabled && isOver ? `${className} over` : className}
    >
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

/**
 * A face-down or face-up pile drawn as a physical stack: the plate underneath
 * gives it thickness, the tag under it names the zone and carries the count.
 */
function Pile(
  { dropId, disabled, label, count, faceCardId, onClick, title, tone }:
  {
    dropId: string; disabled?: boolean; label: string; count: number
    faceCardId?: string | null; onClick?: () => void; title?: string
    tone?: 'deck' | 'trash' | 'egg'
  },
) {
  const ui = useUi()
  const { setNodeRef, isOver } = useDroppable({ id: dropId, disabled })
  const cls = [
    'pile', tone ? `pile-${tone}` : '', count === 0 ? 'is-empty' : '',
    !disabled && isOver ? 'over' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      ref={setNodeRef}
      className={cls}
      title={title}
      onClick={() => {
        // A pile with a readable face reads into the panel like any other card.
        if (faceCardId) ui.peekCard(faceCardId)
        onClick?.()
      }}
    >
      <span className="pile-face">
        {faceCardId ? <Art cardId={faceCardId} index={ui.index} /> : null}
      </span>
      <span className="zone-tag">{label}<b>{count}</b></span>
    </button>
  )
}

/**
 * Security is drawn as a fan rather than a pile because 3-7-2 requires the
 * count to be readable at a glance while the faces stay hidden. Every card in
 * it is masked for everyone — including its owner — so the fan is a shape,
 * never a set of handles.
 */
function SecurityFan(
  { dropId, disabled, cards, onClick, title, anchor, aimed }:
  {
    dropId: string; disabled?: boolean; cards: ViewCard[]
    onClick?: () => void; title?: string
    /** Where the attack arrow lands when the target is the player. */
    anchor?: string
    aimed?: boolean
  },
) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId, disabled })

  return (
    <button
      type="button"
      ref={setNodeRef}
      data-anchor={anchor}
      className={[
        'sec-zone', !disabled && isOver ? 'over' : '', aimed ? 'aimed' : '',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      title={title}
    >
      {/*
        Drawn bottom-of-stack first so the card the next check will reveal — the
        top of the stack — is the one lying fully visible on top of the fan.
      */}
      <span className="sec-fan">
        {cards.length === 0
          ? <span className="sec-empty" />
          : [...cards].reverse().map((c, i) => (
            <span className={i === cards.length - 1 ? 'sec-card top' : 'sec-card'} key={c.iid} />
          ))}
      </span>
      <span className="zone-tag">Security<b>{cards.length}</b></span>
    </button>
  )
}

// -------------------------------------------------------------- reveal tray

/**
 * The staging area a search effect actually needs. `revealTop` and `revealHand`
 * put cards here; getting them out again is the whole point, so every legal
 * destination is one click for the whole set, and any single card can still be
 * dragged or right-clicked somewhere else.
 */
function RevealTray(
  { cards, owner, mine }: { cards: ViewCard[]; owner: PlayerId; mine: boolean },
) {
  const ui = useUi()
  if (cards.length === 0) return null

  /**
   * Sending the whole tray somewhere is n moves, not one action. Going to the
   * top of a pile is done in reverse so the order the player is looking at
   * survives the trip.
   */
  const sweep = (to: Zone, position?: Position) => () => {
    const order = position === 'top' ? [...cards].reverse() : cards
    for (const c of order) {
      if (c.cardId === null) continue
      ui.dispatch(act.move(ui.seat, c.iid, to, position ? { position } : {}))
    }
  }

  const btn = (label: string, to: Zone, position?: Position, title?: string) => (
    <button type="button" className="btn btn-sm" title={title} onClick={sweep(to, position)}>
      {label}
    </button>
  )

  return (
    <div className="reveal-tray">
      <span className="zone-tag">{mine ? 'Revealed' : 'They revealed'}<b>{cards.length}</b></span>
      <div className="reveal-body">
        <DropField id={mine ? MY('reveal') : THEIRS('reveal')} disabled={!mine} className="reveal-cards">
          {cards.map((c) => (
            <BoardCard key={c.iid} card={c} zone="reveal" owner={owner} draggable={c.cardId !== null} />
          ))}
        </DropField>
        <div className="reveal-actions">
          <span className="zone-label">All to</span>
          {btn('Hand', 'hand')}
          {btn('Trash', 'trash')}
          {btn('Top', 'deck', 'top', 'Back on top of the deck, in this order')}
          {btn('Bottom', 'deck', 'bottom', 'To the bottom of the deck')}
          {mine && btn('Play', 'battle', undefined, 'Into your battle area')}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ trash browser

/**
 * 3-6-3 / 3-1-2-1-1: the trash is a public area and either player may look
 * through either trash at any time. A count is not enough, so both piles open.
 */
function TrashBrowser(
  { cards, owner, name, onClose }:
  { cards: ViewCard[]; owner: PlayerId; name: string; onClose: () => void },
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="browser-scrim" onClick={onClose} role="presentation">
      <div className="browser" onClick={(e) => e.stopPropagation()} role="presentation">
        <header className="browser-head">
          <b>{name}</b>
          <span>{cards.length} card{cards.length === 1 ? '' : 's'} · public area</span>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </header>
        {cards.length === 0
          ? <p className="browser-empty">Nothing in this trash yet.</p>
          : (
            <div className="browser-grid">
              {cards.map((c) => (
                <BoardCard key={c.iid} card={c} zone="trash" owner={owner} />
              ))}
            </div>
          )}
        <footer className="browser-foot">
          Most recent first. Click a card to read it in the panel, right-click to move it.
        </footer>
      </div>
    </div>
  )
}

// ------------------------------------------------------------- attack arrow

type Line = { x1: number; y1: number; x2: number; y2: number }

/**
 * The declaration, drawn. `view.attack` is public to both seats and to
 * spectators, so this arrow is the same picture on every screen watching the
 * game — which is the whole reason the declaration lives in the state at all.
 *
 * The endpoints are found in the DOM rather than threaded through props: a card
 * moves around three different containers depending on the zone it is in, and
 * measuring the rendered node is both shorter and always right.
 */
function AttackArrow(
  { attack, foeId, label, onEnd }:
  { attack: Attack; foeId: PlayerId; label: string; onEnd: () => void },
) {
  const [line, setLine] = useState<Line | null>(null)
  const { attacker, target } = attack

  useLayoutEffect(() => {
    const find = (sel: string) => document.querySelector<HTMLElement>(sel)
    const measure = () => {
      const a = find(`[data-iid="${CSS.escape(attacker)}"]`)
      const t = target === 'player'
        ? find(`[data-anchor="player-${foeId}"]`)
        : find(`[data-iid="${CSS.escape(target)}"]`)
      if (!a || !t) return setLine(null)
      const ra = a.getBoundingClientRect()
      const rt = t.getBoundingClientRect()
      setLine({
        x1: ra.left + ra.width / 2,
        y1: ra.top + ra.height / 2,
        x2: rt.left + rt.width / 2,
        y2: rt.top + rt.height / 2,
      })
    }
    measure()
    // One more pass after paint: card art loads late and reflows the row.
    const frame = requestAnimationFrame(measure)
    const timer = window.setTimeout(measure, 260)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [attacker, target, foeId])

  if (!line) return null

  // Bowed to one side so the arrow never disappears under the cards it joins.
  const mx = (line.x1 + line.x2) / 2
  const my = (line.y1 + line.y2) / 2
  const bow = Math.min(90, Math.abs(line.y2 - line.y1) * 0.22 + 30)
  const cx = mx + (line.y2 > line.y1 ? bow : -bow)

  return (
    <div className="atk-layer">
      <svg className="atk-svg" aria-hidden="true">
        <defs>
          <marker id="atk-head" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
            <path d="M0,0 L9,4.5 L0,9 Z" fill="var(--err)" />
          </marker>
        </defs>
        <path
          className="atk-path glow"
          d={`M${line.x1},${line.y1} Q${cx},${my} ${line.x2},${line.y2}`}
        />
        <path
          className="atk-path"
          markerEnd="url(#atk-head)"
          d={`M${line.x1},${line.y1} Q${cx},${my} ${line.x2},${line.y2}`}
        />
      </svg>
      <button
        type="button"
        className="atk-chip"
        style={{ left: (mx + cx) / 2, top: my }}
        title="Clear the declaration"
        onClick={onEnd}
      >
        {label} <span>✕</span>
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------- seat

type SeatProps = {
  player: ViewPlayer
  who: PlayerId
  /** Drawn at the top of the screen, mirrored, and never a drop target. */
  opponent: boolean
  /** Is this the turn player? Their half of the mat is lit. */
  active: boolean
  /** How a declared (or half-declared) attack paints one card. */
  markOf: (card: ViewCard, zone: Zone) => CardMark | undefined
  /** True while this player is the one being attacked directly. */
  aimed: boolean
  /** Split the battle area into a front and a back row. Presentation only. */
  rows: boolean
  /** Single click: the only board action it can take is picking an attack target. */
  onPick: (card: ViewCard, zone: Zone) => void
  /** Double click: the suspend toggle, in play. */
  onToggle: (card: ViewCard, zone: Zone) => void
  onHatch: () => void
  onDeck: () => void
  onSecurity?: () => void
  onTrash: () => void
  securityTitle: string
}

/**
 * One player's half of the mat. The two halves are the same component with the
 * geometry mirrored in CSS, so the rail (deck / security / trash) always sits
 * on the outside edge and the raising area always sits by its owner's hand.
 */
function Seat(p: SeatProps) {
  const ui = useUi()
  const mine = !p.opponent
  const zoneId = mine ? MY : THEIRS

  const cards = (list: ViewCard[], zone: Zone) =>
    list.map((c) => (
      <BoardCard
        key={c.iid}
        card={c}
        zone={zone}
        owner={p.who}
        draggable={c.cardId !== null}
        droppable={mine}
        mark={p.markOf(c, zone)}
        onClick={() => p.onPick(c, zone)}
        onDoubleClick={() => p.onToggle(c, zone)}
      />
    ))

  // The egg deck is a hidden zone, so `viewFor` masks every card in it and its
  // top card has a positional placeholder iid, not a real one. Hatching
  // therefore cannot be a `move` naming a card; `hatch` reaches the top egg by
  // position instead, and a click is the whole gesture.
  const canHatch = mine && p.player.eggDeck.length > 0 && p.player.breeding.length === 0

  /*
    Front row and back row are a way of laying cards out, not a rule: §3-4-8-2
    is simply "any number of cards can be placed in the battle area" and `game/`
    has one `battle` zone. Both rows drop to the same zone and no action knows
    the difference. A card whose type the index cannot resolve goes to the front,
    where a Digimon would be — never nowhere.
  */
  const back = p.rows
    ? p.player.battle.filter((c) => {
      const type = c.cardId ? ui.index.byId.get(c.cardId)?.cardType : undefined
      return type === 'Tamer' || type === 'Option'
    })
    : []
  const front = p.rows ? p.player.battle.filter((c) => !back.includes(c)) : p.player.battle

  /*
    The field never scrolls (see `fit.ts`). The zone's box is fixed by the mat,
    so what gives instead is the layout inside it: the gap closes, then the
    cards overlap, and only then do they shrink. A stack is taller than a flat
    card because its sources spread downwards (§4-7-4), so the depths go into
    the measurement, not just the count.
  */
  const fitRef = useBattleFit({
    rows: p.rows,
    front: front.map((c) => c.stack.length),
    back: back.map((c) => c.stack.length),
  })

  return (
    <section className={['half', mine ? 'me' : 'foe', p.active ? 'active' : ''].filter(Boolean).join(' ')}>
      <div className="mat-rail">
        <Pile
          dropId={zoneId('deck')}
          disabled={!mine}
          tone="deck"
          label="Deck"
          count={p.player.deck.length}
          onClick={p.onDeck}
          title={mine ? 'Click to draw a card' : "Opponent's deck"}
        />
        <SecurityFan
          dropId={zoneId('security')}
          disabled={!mine}
          cards={p.player.security}
          anchor={`player-${p.who}`}
          aimed={p.aimed}
          onClick={p.onSecurity}
          title={p.securityTitle}
        />
        <Pile
          dropId={zoneId('trash')}
          disabled={!mine}
          tone="trash"
          label="Trash"
          count={p.player.trash.length}
          faceCardId={p.player.trash[0]?.cardId ?? null}
          onClick={p.onTrash}
          title="Click to look through this trash — it is a public area"
        />
      </div>

      <div className="mat-main">
        <div className="stage">
          <RevealTray cards={p.player.reveal} owner={p.who} mine={mine} />
        </div>

        {/*
          3-4-7-3 to 3-4-7-8 wall the raising area off from effects entirely:
          nothing there can be chosen, referenced or triggered. That is a real
          rule, so the box is drawn as a walled enclosure rather than as one
          more slot on the mat.
        */}
        <div
          className="raising"
          title="Raising area — cards here cannot be chosen, referenced or triggered by effects (§3-4-7-3…8)"
        >
          <span className="raising-head">
            <b>Raising</b>
            <em>sealed from effects</em>
          </span>
          <div className="raising-slots">
            <Pile
              dropId={zoneId('eggDeck')}
              disabled={!mine}
              tone="egg"
              label="Digi-Eggs"
              count={p.player.eggDeck.length}
              onClick={canHatch ? p.onHatch : undefined}
              title={
                !mine ? 'Digi-Egg deck (face down)'
                  : p.player.breeding.length ? 'The breeding area already holds a card'
                    : p.player.eggDeck.length ? 'Click to hatch the top Digi-Egg'
                      : 'Digi-Egg deck is empty'
              }
            />
            <DropField id={zoneId('breeding')} disabled={!mine} className="zone breed">
              <span className="zone-tag">Breeding</span>
              <div className="zone-cards">{cards(p.player.breeding, 'breeding')}</div>
            </DropField>
          </div>
        </div>

        <DropField
          id={zoneId('battle')}
          disabled={!mine}
          innerRef={fitRef}
          className={p.rows ? 'zone battle rows' : 'zone battle'}
        >
          {/*
            One `var(--bcard-base)` wide and nothing else. An unregistered
            custom property keeps its token stream in the computed style, so
            `--bcard-base` reads back as the whole `clamp(...)` string rather
            than a length; a probe is how the fit learns the base card width in
            pixels without the formula being written down twice.
          */}
          <i className="fit-probe" aria-hidden="true" />
          <span className="zone-tag">Battle area</span>
          {p.rows ? (
            <div className="battle-rows">
              <div className="brow front">
                <div className="zone-cards">{cards(front, 'battle')}</div>
              </div>
              <div className="brow back">
                <span className="brow-tag">Tamers &amp; Options</span>
                <div className="zone-cards">{cards(back, 'battle')}</div>
              </div>
            </div>
          ) : (
            <div className="zone-cards">{cards(p.player.battle, 'battle')}</div>
          )}
        </DropField>
      </div>
    </section>
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
  onAttack: (iid: Iid) => void,
  /** Told where the card went, so playing one from the menu still offers its cost. */
  onMoved: (to: Zone) => void,
): MenuItem[] {
  const { card, owner, zone } = target
  const iid = card.iid
  const inPlay = zone === 'battle' || zone === 'breeding'
  const item = (label: string, run: () => void): MenuItem => ({ kind: 'item', label, run })

  const moves = MOVE_TARGETS
    .filter((m) => owner === seat || OPPONENT_DESTINATIONS.has(m.to))
    .filter((m) => m.to !== zone || m.position !== undefined)
    .map((m) => item(m.label, () => {
      dispatch(act.move(seat, iid, m.to, m.position ? { position: m.position } : {}))
      onMoved(m.to)
    }))

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
    ...(zone === 'battle' ? [item('Attack…', () => onAttack(iid)), { kind: 'sep' } as MenuItem] : []),
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

// ------------------------------------------------------------- cost assists

/**
 * A cost the board read off the card and is offering to pay for you.
 *
 * Deliberately an offer and never an automatic deduction: play and digivolve
 * costs are modified by card text constantly — reductions, alternate costs,
 * "play this without paying its cost" — and this board does not read card text.
 * Doing the arithmetic and the click for the common case is a real saving;
 * doing it silently would be wrong about a third of the time.
 */
type CostOffer = {
  name: string
  kind: 'play' | 'digivolve' | 'rule'
  /** What the offer is for, when a special rule worked it out. */
  label?: string
  costs: Array<{ cost: number; note?: string }>
}

function playOffer(card: Card | undefined): CostOffer | null {
  if (!card || card.playCost === undefined) return null
  return { name: card.name, kind: 'play', costs: [{ cost: card.playCost }] }
}

/**
 * A card usually has several digivolution conditions at different costs, so
 * every distinct one is offered and the player picks the line they took.
 */
function digivolveOffer(card: Card | undefined): CostOffer | null {
  const seen = new Map<number, string>()
  for (const c of card?.digivolveCondition ?? []) {
    const cost = Number(c.cost)
    if (!Number.isFinite(cost)) continue
    const note = `${c.color} Lv.${c.level}`
    seen.set(cost, seen.has(cost) ? `${seen.get(cost)} / ${note}` : note)
  }
  if (!card || seen.size === 0) return null
  return {
    name: card.name,
    kind: 'digivolve',
    costs: [...seen].sort((a, b) => a[0] - b[0]).map(([cost, note]) => ({ cost, note })),
  }
}

// ---------------------------------------------------------- the drop choice

/**
 * A card dropped onto another card, waiting for the player to say which of the
 * three rules they meant by it.
 *
 * They are genuinely three different things, and only one of them used to be
 * reachable without a modifier key:
 *
 *   · **Digivolve** (§8) puts the new card **on top**; the Digimon is
 *     considered to change into it (§3-4-5), which is why it keeps its
 *     suspended state and can still attack.
 *   · **Place under** slides a card **beneath** another as a digivolution card
 *     and the top card does not change — DigiXros (§7-2), Assembly (§7-3), and
 *     effects like "place 1 of your opponent's level 3 or lower Digimon under
 *     another Digimon as its bottom digivolution card" (§4-7-7). It takes a
 *     position because those effects name one.
 *   · **Link** (§4-9) plugs a card in sideways. It is not a stacked card at
 *     all, and one card holds at most one (§4-9-5).
 *
 * A hidden modifier cannot express three things, and a player cannot discover
 * one. So the drop asks.
 */
type DropChoice = { from: DragData; targetIid: Iid; x: number; y: number }

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

  /** The docked reader's subject. Sticky: leaving a card does not clear it. */
  const [peek, setPeek] = useState<Card | null>(null)
  /**
   * Where the reader's card was picked up from, when it was picked up off the
   * board at all. A card id is enough to *read* a card and not nearly enough to
   * *do* anything with it, and the rule buttons do things.
   */
  const [peekFrom, setPeekFrom] = useState<MenuTarget | null>(null)
  /** The special-rule picker: which card, and which of its rules. */
  const [rulePick, setRulePick] = useState<{ target: MenuTarget; spec: RuleSpec } | null>(null)
  const [menu, setMenu] = useState<{ target: MenuTarget; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState<DragData | null>(null)
  const [chat, setChat] = useState('')
  const [confirmConcede, setConfirmConcede] = useState(false)
  const [checking, setChecking] = useState(false)
  /** Whose trash is open, or null. Either trash may be browsed (3-6-3). */
  const [browsing, setBrowsing] = useState<PlayerId | null>(null)
  /** The attacker whose target the player is picking, or null. */
  const [targeting, setTargeting] = useState<Iid | null>(null)
  /** A cost the board noticed but will not pay on its own. See `CostOffer`. */
  const [offer, setOffer] = useState<CostOffer | null>(null)
  /** A card dropped onto another card, waiting for its verb. See `DropChoice`. */
  const [dropChoice, setDropChoice] = useState<DropChoice | null>(null)
  /**
   * Front row / back row. A layout preference, not game state — which is why it
   * is the one thing on this board that touches storage: it belongs to the
   * screen, not to the match, and a player should not have to set it again on
   * every reload. Storage failing (private mode, a blocked origin) just means
   * the default.
   */
  const [rows, setRows] = useState<boolean>(() => {
    try { return window.localStorage.getItem(ROWS_KEY) !== 'off' } catch { return true }
  })

  useEffect(() => {
    try { window.localStorage.setItem(ROWS_KEY, rows ? 'on' : 'off') } catch { /* not fatal */ }
  }, [rows])

  // dnd-kit's drag events carry the pointerdown that started the drag, not the
  // modifier state at the moment of the drop, so Shift is tracked separately.
  const shift = useRef(false)
  const logRef = useRef<HTMLDivElement | null>(null)

  /**
   * Fills the docked reader, and nothing else. The panel holds whatever was
   * last clicked until something else is clicked, which is what makes it usable
   * while you think — a panel driven by the pointer flickers away exactly when
   * you look down at your hand.
   */
  const peekCard = useCallback(
    (cardId: string, from?: MenuTarget) => {
      const card = index.byId.get(cardId)
      if (card) {
        setPeek(card)
        setPeekFrom(from ?? null)
      }
    },
    [index],
  )

  const openMenu = useCallback((target: MenuTarget, x: number, y: number) => {
    setMenu({ target, x, y })
  }, [])

  const openRule = useCallback((target: MenuTarget, kind: RuleKind) => {
    const card = target.card.cardId ? index.byId.get(target.card.cardId) : undefined
    const spec = ruleOn(card, kind)
    if (spec) setRulePick({ target, spec })
  }, [index])

  const ui = useMemo<BoardUi>(
    () => ({ seat, index, dispatch, peekCard, openMenu, openRule }),
    [seat, index, dispatch, peekCard, openMenu, openRule],
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
        case 'r': dispatch(act.revealTop(seat, 1)); break
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

  // A half-made declaration does not survive the attack landing, the turn
  // passing, or the game ending; neither does an unpaid cost offer.
  const declared = view.attack
  useEffect(() => { setTargeting(null) }, [declared, view.turn, view.winner])
  useEffect(() => { setOffer(null) }, [view.turn])

  // ------------------------------------------------------------ interactions

  const onDragStart = (e: DragStartEvent) => {
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
      if (targetIid === data.iid) return
      // Shift survives as a shortcut for the commonest of the three, but it is
      // no longer the only way to reach anything.
      if (shift.current && ownCard && (data.zone === 'hand' || data.zone === 'battle')) {
        dispatch(act.attach(seat, data.iid, targetIid))
        return
      }
      // Otherwise the drop asks which rule it meant, beside the card it landed
      // on: `over.rect` is the target's box in viewport coordinates, which is
      // where the player is already looking. It opens on the right of the card
      // unless the rail is there, and then on the left — ContextMenu only knows
      // how to clamp a menu of its own default width.
      const r = e.over.rect
      const wide = 262
      const right = r.left + r.width + 10
      setDropChoice({
        from: data,
        targetIid,
        x: right + wide <= window.innerWidth ? right : Math.max(6, r.left - wide),
        y: r.top,
      })
      return
    }

    const [, zoneName, position] = id.split(':')
    const to = zoneName as Zone
    if (!ownCard && !OPPONENT_DESTINATIONS.has(to)) return
    // Dropping a card back where it already is would only re-log it.
    if (data.zone === to && !position) return
    dispatch(act.move(seat, data.iid, to, position ? { position: position as Position } : {}))
    // Playing a card is the one gesture with a price on the card itself.
    if (data.zone === 'hand' && (to === 'battle' || to === 'breeding')) {
      setOffer(playOffer(index.byId.get(data.cardId)))
    }
  }

  /**
   * A single click reads the card (BoardCard does that itself) and otherwise
   * changes nothing — the one exception being that while a target is being
   * picked, the opponent's battle area is a row of buttons.
   */
  const pickCard = (card: ViewCard, zone: Zone, owner: PlayerId) => {
    if (card.cardId === null) return
    if (targeting && owner === foeId && zone === 'battle') {
      dispatch(act.attack(seat, targeting, card.iid))
      setTargeting(null)
    }
  }

  /** A double click on a card in play is the suspend toggle. */
  const toggleCard = (card: ViewCard, zone: Zone, owner: PlayerId) => {
    if (owner !== seat || card.cardId === null) return
    if (zone !== 'battle' && zone !== 'breeding') return
    dispatch(card.suspended ? act.unsuspend(seat, card.iid) : act.suspend(seat, card.iid))
  }

  const checkSecurity = () => {
    if (view.phase !== 'main') return
    setChecking(true)
    dispatch(act.securityCheck(seat))
  }

  // ------------------------------------------------------------ attack assists

  /** Every card in play, by instance id — the arrow and the DP compare need it. */
  const inPlay = useMemo(() => {
    const found = new Map<Iid, { card: ViewCard; owner: PlayerId }>()
    for (const owner of [0, 1] as PlayerId[]) {
      for (const card of view.players[owner].battle) found.set(card.iid, { card, owner })
      for (const card of view.players[owner].breeding) found.set(card.iid, { card, owner })
    }
    return found
  }, [view])

  const nameFor = (card: ViewCard | undefined) =>
    card?.cardId ? index.byId.get(card.cardId)?.name ?? card.cardId : 'a card'

  /**
   * The three things a drop onto a card can mean, offered as three lines.
   *
   * Only the ones the reducer will actually accept are listed, so nothing on
   * this menu can produce a refusal: digivolving and linking are "my card onto
   * my card" and read the card off a public zone, while placing under is the
   * one of the three that may take the opponent's Digimon (§4-7-7) and so is
   * offered for their cards too.
   */
  const dropItems = (choice: DropChoice): MenuItem[] => {
    const { from, targetIid } = choice
    const mine = from.owner === seat
    const target = inPlay.get(targetIid)?.card
    const moving = index.byId.get(from.cardId)?.name ?? from.cardId
    const item = (label: string, run: () => void): MenuItem => ({ kind: 'item', label, run })
    const items: MenuItem[] = [
      { kind: 'title', label: `${moving} → ${nameFor(target)}` },
    ]

    // §8, §3-4-5: on top, and the Digimon changes into it.
    if (mine && (from.zone === 'hand' || from.zone === 'reveal' || from.zone === 'battle')) {
      items.push(item('Digivolve — the new card on top', () => {
        dispatch(act.digivolve(seat, targetIid, from.iid))
        setOffer(digivolveOffer(index.byId.get(from.cardId)))
      }))
    }

    // §7-2 DigiXros, §7-3 Assembly, §4-7-7: underneath, and the top card stays.
    items.push(
      { kind: 'sep' },
      item('Place under — top of the sources', () =>
        dispatch(act.placeUnder(seat, from.iid, targetIid, 'top'))),
      item('Place under — bottom of the sources', () =>
        dispatch(act.placeUnder(seat, from.iid, targetIid, 'bottom'))),
    )

    // §4-9: sideways, not stacked, and at most one to a card (§4-9-5).
    if (mine && (from.zone === 'hand' || from.zone === 'battle')) {
      const linked = (target?.attached.length ?? 0) > 0
      items.push(
        { kind: 'sep' },
        item(
          linked ? 'Link — sideways (one is already linked)' : 'Link — plugged in sideways',
          () => dispatch(act.attach(seat, from.iid, targetIid)),
        ),
      )
    }

    // Nothing has moved yet: the drop is only committed by picking a line.
    items.push({ kind: 'sep' }, item('Cancel', () => undefined))
    return items
  }

  // -------------------------------------------------- the special-rule buttons

  /**
   * Which of my own zones a card is in right now, or null if it has left them.
   *
   * The reader is sticky — it holds the last card you clicked while you think —
   * so by the time you press one of its buttons the card may well have moved.
   * Reading the zone back off the view rather than off what the reader was told
   * is what keeps a DigiXros button from still being there after the DigiXros.
   */
  const myZoneOf = (iid: Iid): Zone | null => {
    for (const zone of ['hand', 'battle', 'breeding', 'trash', 'reveal'] as Zone[]) {
      if (me[zone].some((c) => c.iid === iid)) return zone
    }
    return null
  }

  /**
   * Runs a rule the picker put together. Several actions, because the reducer
   * has no single "DigiXros" verb and should not: a DigiXros is a play and a
   * placement, and both are things a player can already do by hand. What the
   * picker buys is that the placement is *one* `placeUnder` — one log line and
   * one undo for a five-card Xros.
   */
  const runRule = (
    actions: Action[],
    cost: { name: string; costs: number[]; note: string },
  ) => {
    for (const action of actions) dispatch(action)
    setRulePick(null)
    setOffer(cost.costs.length === 0 ? null : {
      name: cost.name,
      kind: 'rule',
      label: cost.note,
      costs: cost.costs.map((c) => ({ cost: c })),
    })
  }

  /** The rule buttons the docked reader grows for the card it is holding. */
  const peekActions = (): ReactNode => {
    if (!peek || !peekFrom || peekFrom.owner !== seat) return null
    const zone = myZoneOf(peekFrom.card.iid)
    if (!zone) return null
    const specs = rulesOn(peek).filter((s) => offeredIn(s, zone))
    if (specs.length === 0) return null
    return specs.map((spec) => (
      <button
        key={spec.kind}
        type="button"
        className="btn btn-sm rule-btn"
        title={ruleHint(spec)}
        onClick={() => setRulePick({ target: { ...peekFrom, zone }, spec })}
      >
        {RULE_BADGE[spec.kind]}
      </button>
    ))
  }

  /** Printed DP plus every modifier on the instance, or null for a card with none. */
  const effectiveDp = (card: ViewCard | undefined): number | null => {
    const printed = card?.cardId ? index.byId.get(card.cardId) : undefined
    return printed?.dp === undefined ? null : printed.dp + (card?.dpMod ?? 0)
  }

  const markOf = (who: PlayerId) => (card: ViewCard, zone: Zone): CardMark | undefined => {
    if (targeting) {
      if (card.iid === targeting) return 'attacker'
      if (who === foeId && zone === 'battle' && card.cardId !== null) return 'pick'
      return undefined
    }
    if (!view.attack) return undefined
    if (card.iid === view.attack.attacker) return 'attacker'
    if (card.iid === view.attack.target) return 'target'
    return undefined
  }

  const attackerCard = view.attack ? inPlay.get(view.attack.attacker)?.card : undefined
  const defenderCard = view.attack && view.attack.target !== 'player'
    ? inPlay.get(view.attack.target)?.card
    : undefined
  const attackIsMine = view.attack
    ? inPlay.get(view.attack.attacker)?.owner === seat
    : false
  /** Their security stack is what an unblocked attack on the player hits. */
  const aimedAt: PlayerId | null = view.attack?.target === 'player'
    ? (attackIsMine ? foeId : seat)
    : null

  /**
   * Who is ahead on DP. Deliberately phrased as a comparison and not a verdict:
   * the actual outcome is decided by card text this board never reads, so
   * "the defender is deleted" would be confidently wrong the moment a blocker,
   * an ACE, or any [When Attacking] effect is involved. The board never deletes
   * anything either — the player reads the numbers and decides.
   */
  const battleCall = (): string | null => {
    const a = effectiveDp(attackerCard)
    const d = effectiveDp(defenderCard)
    if (a === null || d === null) return null
    if (a > d) return 'attacker ahead on DP'
    if (a < d) return 'defender ahead on DP'
    return 'level on DP'
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

  const nameOf = (who: PlayerId) => view.players[who].name || `Player ${who + 1}`

  const seatLine = (who: PlayerId) => {
    const pl = view.players[who]
    return (
      <div className={view.turnPlayer === who ? 'seat-line active' : 'seat-line'}>
        <span className="turn-dot" />
        <b>{nameOf(who)}</b>
        {who === seat && <span className="you-tag">you</span>}
        <span>Hand {pl.hand.length}</span>
        <span>Deck {pl.deck.length}</span>
        <span>Security {pl.security.length}</span>
        <button
          type="button"
          className="linky"
          title="Look through this trash — it is a public area"
          onClick={() => setBrowsing(who)}
        >
          Trash {pl.trash.length}
        </button>
      </div>
    )
  }

  /*
    Comprehensive rules 1-4-2-3: "0 on the memory gauge is the center, the
    numbers on the left represent your memory, and the numbers on the right
    represent your opponent's memory." So the track runs from your 10 on the
    left, down through 0, out to their 10 on the right -- not the other way.
  */
  const gaugeStops: number[] = []
  for (let v = MEMORY_MAX; v >= -MEMORY_MAX; v--) gaugeStops.push(v)

  return (
    <UiCtx.Provider value={ui}>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div className="board">
          <CardPeek card={peek} meta={index.meta} actions={peekActions()} />

          <div className="board-main">
            <div className="edge">
              {seatLine(foeId)}
              {/*
                Their hand is face down (§3-5-3): there is nothing on it to
                read and the nameplate already carries the count, so it is a
                strip of backs rather than a full row of cards. That row was
                costing the mat a whole card-height to say a number.
              */}
              <DropField id={THEIRS('hand')} disabled className="hand-strip foe-hand">
                {foe.hand.map((c) => (
                  <BoardCard key={c.iid} card={c} zone="hand" owner={foeId} />
                ))}
              </DropField>
            </div>

            <Seat
              player={foe}
              who={foeId}
              opponent
              active={view.turnPlayer === foeId}
              markOf={markOf(foeId)}
              aimed={aimedAt === foeId}
              rows={rows}
              onPick={(card, zone) => pickCard(card, zone, foeId)}
              onToggle={(card, zone) => toggleCard(card, zone, foeId)}
              onHatch={() => undefined}
              onDeck={() => undefined}
              onSecurity={checkSecurity}
              onTrash={() => setBrowsing(foeId)}
              securityTitle={view.phase === 'main'
                ? 'Check security — reveals their top card'
                : 'Security checks happen in the main phase'}
            />

            {/*
              The gauge is one physical track shared by both players, which is
              why it lives between the halves and not in either of them: memory
              is a single marker sliding across a scale, and whose side it is on
              is the whole game state it carries.
            */}
            <div className="gauge-row">
              <div className="gauge-track">
                <span className="gauge-end mine">You</span>
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
                <span className="gauge-end theirs">{nameOf(foeId)}</span>
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
              active={view.turnPlayer === seat}
              markOf={markOf(seat)}
              aimed={aimedAt === seat}
              rows={rows}
              onPick={(card, zone) => pickCard(card, zone, seat)}
              onToggle={(card, zone) => toggleCard(card, zone, seat)}
              onHatch={() => dispatch(act.hatch(seat))}
              onDeck={() => dispatch(act.draw(seat, 1))}
              onTrash={() => setBrowsing(seat)}
              securityTitle="Your security stack — face down, spread so the count reads"
            />

            <div className="edge">
              <DropField id={MY('hand')} className="hand-strip">
                {me.hand.map((c) => (
                  <BoardCard key={c.iid} card={c} zone="hand" owner={seat} draggable />
                ))}
              </DropField>
              {seatLine(seat)}
            </div>
          </div>

          <div className="rail">
            {/*
              Four phases, per 6-1-2 — there is no end phase. "End turn" caps
              the rail rather than sitting in it, because passing is an action
              that moves memory (6-5-1-7-1), not a step you walk into.
            */}
            <div className="phase-bar">
              {PHASES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={p === view.phase ? 'step-phase on' : 'step-phase'}
                  title={`${PHASE_HINT[p]} — click to advance`}
                  onClick={() => dispatch(act.nextPhase(seat))}
                >
                  {PHASE_LABEL[p]}
                </button>
              ))}
              <button
                type="button"
                className="step-phase cap"
                title="Pass — memory moves to 3 on your opponent's side (6-5-1-7-1)"
                onClick={() => dispatch(act.endTurn(seat))}
              >
                Pass
              </button>
            </div>

            <div className="readout">
              <div><b>{view.turn}</b><span>Turn</span></div>
              <div>
                <b>{view.turnPlayer === seat ? 'You' : 'Them'}</b>
                <span>{PHASE_LABEL[view.phase]} phase</span>
              </div>
              <div className={myMemory > 0 ? 'mem mine' : myMemory < 0 ? 'mem theirs' : 'mem'}>
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

            {/* Picking a target. The opponent's battle area is live while this is up. */}
            {targeting && (
              <div className="security-prompt attack-prompt">
                <span>
                  <b>{nameFor(inPlay.get(targeting)?.card)}</b> attacks — pick a target
                </span>
                <span className="spacer" />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  title="Attack the player: an unblocked hit checks their security (§13)"
                  onClick={() => {
                    dispatch(act.attack(seat, targeting, 'player'))
                    setTargeting(null)
                  }}
                >
                  The player
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setTargeting(null)}>
                  Cancel
                </button>
              </div>
            )}

            {/*
              A live declaration. Attacking the player leads somewhere specific —
              §13-1-8-1-1 says an unblocked hit checks security — so the check is
              offered right here rather than left as a click on the far stack.
            */}
            {view.attack && (
              <div className="security-prompt attack-live">
                <span className="atk-line">
                  <b>{nameFor(attackerCard)}</b>
                  <em>→</em>
                  <b>{view.attack.target === 'player'
                    ? nameOf(attackIsMine ? foeId : seat)
                    : nameFor(defenderCard)}</b>
                </span>
                {defenderCard && (
                  <span className="atk-dp">
                    {effectiveDp(attackerCard)?.toLocaleString('en-US') ?? '—'}
                    {' vs '}
                    {effectiveDp(defenderCard)?.toLocaleString('en-US') ?? '—'}
                    {battleCall() && <em> · {battleCall()}</em>}
                  </span>
                )}
                <span className="spacer" />
                {view.attack.target === 'player' && attackIsMine && (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={view.phase !== 'main'}
                    title={view.phase === 'main'
                      ? 'Reveal the top card of their security stack'
                      : 'Security checks happen in the main phase'}
                    onClick={checkSecurity}
                  >
                    Check security
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => dispatch(act.endAttack(seat))}
                >
                  End attack
                </button>
              </div>
            )}

            {revealed && revealedName && (
              <div className="security-prompt">
                <span>
                  {checking ? 'Security' : 'Revealed'}:{' '}
                  <button
                    type="button"
                    className="linky"
                    title="Read it in the panel"
                    onClick={() => revealed.cardId && peekCard(revealed.cardId)}
                  >
                    {revealedName}
                  </button>
                </span>
                <span className="spacer" />
                {/* §13-1-8-4: the checked card goes to the trash unless something moves it. */}
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  title="Where a checked security card goes unless an effect says otherwise (§13-1-8-4)"
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

            {/* Read off the card, offered, never deducted. See `CostOffer`. */}
            {offer && (
              <div className="security-prompt cost-offer">
                <span>
                  <b>{offer.name}</b> —{' '}
                  {offer.kind === 'play' ? 'play cost'
                    : offer.kind === 'digivolve' ? 'digivolve cost'
                      : offer.label}
                </span>
                <span className="spacer" />
                {offer.costs.map((c) => (
                  <button
                    key={c.cost}
                    type="button"
                    className="btn btn-sm btn-primary"
                    title={c.note ? `Pay ${c.cost} memory — ${c.note}` : `Pay ${c.cost} memory`}
                    onClick={() => { dispatch(act.payMemory(seat, c.cost)); setOffer(null) }}
                  >
                    Pay {c.cost}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-sm"
                  title="Dismiss — the cost was modified, or already paid"
                  onClick={() => setOffer(null)}
                >
                  ✕
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

            {/*
              "Reveal the top 4 cards of your deck…" is unplayable without this:
              `revealTop` and `revealHand` existed in the reducer with nothing to
              fire them. The count is a row of stops rather than a text box so a
              reveal is always one click.
            */}
            <div className="reveal-bar">
              <span className="zone-label">Reveal top</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="btn btn-sm"
                  title={`Reveal the top ${n} card${n === 1 ? '' : 's'} of your deck`}
                  onClick={() => dispatch(act.revealTop(seat, n))}
                >
                  {n}
                </button>
              ))}
              <span className="spacer" />
              <button
                type="button"
                className="btn btn-sm"
                title="Reveal your whole hand"
                onClick={() => dispatch(act.revealHand(seat))}
              >
                Hand
              </button>
            </div>

            {/*
              The rows are a way of laying the mat out, not a rule, so turning
              them off is a view preference and nothing else changes.
            */}
            <div className="reveal-bar opt-bar">
              <span className="zone-label">Battle rows</span>
              <span className="spacer" />
              <button
                type="button"
                className={rows ? 'toggle on' : 'toggle'}
                role="switch"
                aria-checked={rows}
                title={rows
                  ? 'Digimon in front, Tamers and Options behind — click for one row'
                  : 'One row, everything together — click to split off a back row'}
                onClick={() => setRows((r) => !r)}
              >
                <span className="toggle-knob" />
                {rows ? 'Two rows' : 'One row'}
              </button>
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
              <b>Click</b> a card to read it here on the left · <b>double-click</b> a card in
              play to suspend or unsuspend it · <b>right-click</b> for attack, move and
              everything else.
              <br />
              Drag a card <b>onto</b> another and pick what you meant — digivolve on top,
              place under as a source, or link it in sideways. <kbd>Shift</kbd>+drag
              links straight away. Click a source under a Digimon to read it.
              <br />
              <kbd>D</kbd> draw · <kbd>S</kbd> shuffle · <kbd>R</kbd> reveal 1 ·{' '}
              <kbd>Space</kbd> next phase · <kbd>E</kbd> end turn · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo ·{' '}
              <kbd>0</kbd>–<kbd>9</kbd> pay
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

      {view.attack && (
        <AttackArrow
          attack={view.attack}
          foeId={attackIsMine ? foeId : seat}
          label={view.attack.target === 'player' ? 'Attacking the player' : 'Attack'}
          onEnd={() => dispatch(act.endAttack(seat))}
        />
      )}

      {browsing !== null && (
        <TrashBrowser
          cards={view.players[browsing].trash}
          owner={browsing}
          name={browsing === seat ? 'Your trash' : `${nameOf(browsing)}'s trash`}
          onClose={() => setBrowsing(null)}
        />
      )}

      {/*
        DigiXros, Assembly, Jogress, Burst and Link, each as one screen showing
        the cards you could use. Not a rules engine: it offers, it never refuses
        — see `RulePicker` and `rules.ts` for why that is the only honest way to
        read printed prose.
      */}
      {rulePick && rulePick.target.card.cardId && (
        <RulePicker
          subject={{
            iid: rulePick.target.card.iid,
            cardId: rulePick.target.card.cardId,
            zone: rulePick.target.zone,
            owner: rulePick.target.owner,
          }}
          spec={rulePick.spec}
          me={me}
          index={index}
          seat={seat}
          onCommit={runRule}
          onPeek={peekCard}
          onClose={() => setRulePick(null)}
        />
      )}

      {/*
        The drop asks rather than guessing. It is a menu and not a modal on
        purpose: it opens beside the card the drop landed on, and pressing
        Escape or clicking anywhere else leaves the board exactly as it was.
      */}
      {dropChoice && (
        <ContextMenu
          x={dropChoice.x}
          y={dropChoice.y}
          items={dropItems(dropChoice)}
          onClose={() => setDropChoice(null)}
        />
      )}

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
            (iid) => setTargeting(iid),
            (to) => {
              const played = (to === 'battle' || to === 'breeding')
                && menu.target.zone === 'hand'
                && menu.target.owner === seat
              setOffer(played && menu.target.card.cardId
                ? playOffer(index.byId.get(menu.target.card.cardId))
                : null)
            },
          )}
          onClose={() => setMenu(null)}
        />
      )}
    </UiCtx.Provider>
  )
}

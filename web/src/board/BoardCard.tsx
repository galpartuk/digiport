import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { imageUrl, type CardIndex } from '../cards'
import type { PlayerId, Zone } from '../game/types'
import type { ViewCard } from '../game/view'
import { useUi, type DragData } from './boardCtx'
import { RULE_BADGE, offeredIn, ruleHint, rulesOn } from './rules'

/**
 * Card art with the host walk `imageUrl` exists for: every failure steps to the
 * next host until the list runs out. A card id that is not in the index at all
 * (a set the payload has not been rebuilt for) shows as its number.
 */
export function Art({ cardId, index, alt }: { cardId: string; index: CardIndex; alt?: boolean }) {
  const [attempt, setAttempt] = useState(0)
  useEffect(() => setAttempt(0), [cardId])

  const card = index.byId.get(cardId)
  if (!card) return <span className="bcard-id">{cardId}</span>

  return (
    <img
      src={imageUrl(card, index.meta, attempt)}
      alt={alt === false ? '' : card.name}
      draggable={false}
      onError={() => setAttempt((a) => (a + 1 < index.meta.hosts.length ? a + 1 : a))}
    />
  )
}

/**
 * A token's face, drawn rather than fetched.
 *
 * §4-21: a token is a non-game card with no card number, so there is nothing
 * in the card pool to look one up by and no art belonging to it. Borrowing a
 * real card's image would put the picture of a game card on the one thing that
 * is deliberately not one — and a player glancing at the field would count it
 * as a card. So it gets a face of its own: the name, and the word "token".
 */
export function TokenFace({ name }: { name: string }) {
  return (
    <span className="token-face">
      <span className="token-kind">Token</span>
      <span className="token-name">{name}</span>
      <span className="token-rule">§4-21</span>
    </span>
  )
}

/**
 * How a declared attack paints this card: the attacker, its target, or one of
 * the legal targets while the player is still choosing.
 */
export type CardMark = 'attacker' | 'target' | 'pick'

type Props = {
  card: ViewCard
  zone: Zone
  owner: PlayerId
  /** Can this card be picked up? */
  draggable?: boolean
  /** Can another card be dropped onto it (digivolve / attach)? */
  droppable?: boolean
  mark?: CardMark
  /** Single click, after the card has been sent to the docked reader. */
  onClick?: () => void
  /** Double click — in play, the suspend toggle. */
  onDoubleClick?: () => void
}

/**
 * One card on the board. It is both a drag source and, in play, a drop target,
 * so the same node carries two dnd-kit refs.
 *
 * A card the viewer may not identify (`cardId === null`) is inert on purpose:
 * its iid is a positional placeholder from the projection, not a real instance
 * id, so it can be shown as a back but can never be the subject of an action.
 */
export function BoardCard(
  { card, zone, owner, draggable = false, droppable = false, mark, onClick, onDoubleClick }: Props,
) {
  const ui = useUi()
  /** Where to draw the hover fan, in viewport coordinates — see below. */
  const [fanned, setFanned] = useState<FanBox | null>(null)

  const known = card.cardId !== null
  const cardId = card.cardId ?? ''
  const hidden = card.faceDown || !known

  const token = card.token === true

  const data: DragData = { iid: card.iid, cardId, owner, zone }
  const drag = useDraggable({ id: `drag:${card.iid}`, data, disabled: !draggable || !known })
  /*
    §4-21-3 and §4-21-4: a token cannot be stacked with and cannot be linked to,
    so nothing may be dropped onto one. The reducer refuses all three verbs
    already; switching the drop target off means the board never lights a token
    up as though it would accept the card, which is the part a refusal cannot
    take back.
  */
  const drop = useDroppable({ id: `card:${card.iid}`, disabled: !droppable || !known || token })

  const setRef = (node: HTMLElement | null) => {
    drag.setNodeRef(node)
    drop.setNodeRef(node)
  }

  const cls = [
    'bcard',
    hidden ? 'down' : '',
    token ? 'token' : '',
    card.stack.length > 0 ? 'stacked' : '',
    card.suspended ? 'suspended' : '',
    drag.isDragging ? 'dragging' : '',
    droppable && drop.isOver ? 'droptarget' : '',
    mark ? `mark-${mark}` : '',
  ].filter(Boolean).join(' ')

  /*
    §4-7-4: the bottom cards of a stack are spread out so that inherited effects
    are visible. `--n` is the depth the spread has to fit into, and the CSS
    tightens the step when a stack gets deep; `--o` is how many bands down one
    source sits. Both are numbers, not lengths, because the mirrored half puts
    the same offset on `bottom` instead of `top`.
  */
  const depth = { '--n': card.stack.length } as CSSProperties
  const nameOf = (id: string) => ui.index.byId.get(id)?.name ?? id

  /** A source or a link card: readable, clickable, and never actionable. */
  const buried = (cardId: string, key: string, className: string, style: CSSProperties, label: string) => (
    <span
      key={key}
      role="button"
      tabIndex={-1}
      className={className}
      style={style}
      title={label}
      onClick={(e) => { e.stopPropagation(); ui.peekCard(cardId) }}
      onKeyDown={(e) => { if (e.key === 'Enter') ui.peekCard(cardId) }}
    >
      <Art cardId={cardId} index={ui.index} alt={false} />
    </span>
  )

  /*
    Effective DP, which is printed DP plus every ±1000 the players have piled on.
    `game/` has no card database on purpose, so this is the board's job: it is
    the one number a player recomputes in their head on every single battle, and
    reading it off the card costs nothing and decides nothing.
  */
  const printed = known ? ui.index.byId.get(cardId) : undefined
  const inPlay = zone === 'battle' || zone === 'breeding'
  const dp = printed?.dp
  const showDp = !hidden && inPlay && dp !== undefined

  /*
    DigiXros (§7-2), Assembly (§7-3), Jogress (§8-2), Burst (§8-3) and Link
    (§4-9) are all "this card, plus some other cards you already own" — and
    until now every one of them was a drag per source and a guess at the cost.
    A card that carries one wears a badge, and the badge is the whole gesture.

    Only on my own cards, and only where the rule can actually reach: a card in
    the hand for four of them, and in the trash as well for Assembly, whose
    sources are lying right beside it (§7-3-2-1).
  */
  const specs = !hidden && owner === ui.seat
    ? rulesOn(printed).filter((s) => offeredIn(s, zone))
    : []

  return (
    <button
      type="button"
      ref={setRef}
      className={cls}
      style={depth}
      /* The attack arrow finds its two endpoints by this attribute. */
      data-iid={card.iid}
      {...drag.listeners}
      {...drag.attributes}
      title={known ? (token ? `${cardId} — token (§4-21)` : cardId) : undefined}
      /*
        Three gestures and no hidden fourth: a single click reads the card into
        the docked panel and never changes the board, a double click is the
        suspend toggle in play, and a right click opens everything else. Reading
        a card has to be free — it is the thing a player does most.
      */
      onClick={() => {
        if (!known) return
        // The reader is told where the card came from, so the rule buttons it
        // grows have an instance to act on and not just a card number.
        ui.peekCard(cardId, { card, owner, zone })
        onClick?.()
      }}
      onDoubleClick={() => { if (known) onDoubleClick?.() }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (known) {
          ui.peekCard(cardId, { card, owner, zone })
          ui.openMenu({ card, owner, zone }, e.clientX, e.clientY)
        }
      }}
      onMouseEnter={(e) => {
        setFanned(fanBox(e.currentTarget, card.stack.length + card.attached.length))
      }}
      onMouseLeave={() => setFanned(null)}
    >
      {/*
        The sources come first and deepest first, so paint order is the physical
        stacking order and every source's bottom band stays visible under the
        card lying on it. `card.stack` is bottom first, so the last one is the
        source directly under the top card and sits one band down.
      */}
      {card.stack.map((sourceId, i) => buried(
        sourceId,
        `s${i}-${sourceId}`,
        'src-card',
        { '--o': card.stack.length - i } as CSSProperties,
        `${nameOf(sourceId)} — digivolution source ${i + 1} of ${card.stack.length}, bottom first`,
      ))}

      {/*
        A token's `cardId` is the name the effect gave it, not a card number, so
        `Art` would have nothing to fetch and would fall back to printing the
        raw id. It gets its own face instead — see `TokenFace`.
      */}
      {!hidden && (token ? <TokenFace name={cardId} /> : <Art cardId={cardId} index={ui.index} />)}

      {card.stack.length > 0 && (
        <div
          className="stack-count"
          title={`${card.stack.length} digivolution source${card.stack.length === 1 ? '' : 's'} — click one to read it`}
        >
          {card.stack.length}
        </div>
      )}

      {/* §4-9: a link card is plugged in sideways, and is not a stacked card. */}
      {card.attached.map((a, i) => (a.cardId
        ? buried(
          a.cardId,
          `a-${a.iid}`,
          'link-card',
          { '--o': i } as CSSProperties,
          `${nameOf(a.cardId)} — link card (§4-9)`,
        )
        : null))}

      {showDp && (
        <span
          className={`dp-plate${card.dpMod > 0 ? ' up' : card.dpMod < 0 ? ' down' : ''}`}
          title={card.dpMod === 0
            ? `${dp} DP`
            : `${dp} printed ${card.dpMod > 0 ? '+' : '−'} ${Math.abs(card.dpMod)}`}
        >
          {(dp + card.dpMod).toLocaleString('en-US')}
        </span>
      )}

      {/*
        The special-rule buttons. A span and not a button: this card is itself a
        <button>, and nesting one inside another is invalid markup that browsers
        untangle in their own ways. Bottom-left because a hand is an overlapping
        fan and the left edge of every card is the part that stays visible.
      */}
      {specs.length > 0 && (
        <span className="rule-row">
          {specs.map((spec) => (
            <span
              key={spec.kind}
              role="button"
              tabIndex={-1}
              className={`rule-chip rule-${spec.kind}`}
              title={ruleHint(spec)}
              onClick={(e) => { e.stopPropagation(); ui.openRule({ card, owner, zone }, spec.kind) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') ui.openRule({ card, owner, zone }, spec.kind)
              }}
            >
              {RULE_BADGE[spec.kind]}
            </span>
          ))}
        </span>
      )}

      {/* A Tamer or Option carrying a modifier has no printed DP to fold it into. */}
      {((card.dpMod !== 0 && !showDp) || card.counters > 0) && (
        <div className="badge-row">
          {card.dpMod !== 0 && !showDp && (
            <span className={`badge dp${card.dpMod < 0 ? ' minus' : ''}`}>
              {card.dpMod > 0 ? '+' : '−'}{Math.abs(card.dpMod) / 1000}k
            </span>
          )}
          {card.counters > 0 && <span className="badge ct">{card.counters}</span>}
        </div>
      )}

      {/*
        Hovering a stack fans its sources and plug-ins out. The fan is drawn
        through a portal rather than inside this button, because a suspended
        card carries a 90° rotation that every descendant would inherit — and
        because a fan on a card at the edge of a zone would be clipped.

        Sources are card ids, not instances, so they are readable and never
        actionable. Attached cards are read-only too, for one more reason: the
        reducer's `locate` searches top-level zones only, so an attached
        instance has no reachable iid that any action could name. They come
        back when their host leaves the field.
      */}
      {fanned && (
        <StackFan
          box={fanned}
          sources={[...card.stack].reverse()}
          attached={card.attached.map((a) => a.cardId).filter((id): id is string => !!id)}
          index={ui.index}
          onPeek={ui.peekCard}
        />
      )}
    </button>
  )
}

// --------------------------------------------------------------- the hover fan

type FanBox = { left: number; top: number; w: number; h: number }

/** CardDetail's own width, and the gap it leaves at the cursor. */
const DETAIL_WIDTH = 316
const DETAIL_GAP = 24

/**
 * Places the fan beside the card in viewport coordinates.
 *
 * It goes on the side CardDetail will *not* take: that panel opens to the right
 * of the cursor unless it would overflow, and it is tall enough to cover a fan
 * drawn on the same side — which would hide the very thumbnails you have to
 * point at to read an inherited effect.
 *
 * `Math.min` of the card's two sides is its unrotated width, which a suspended
 * card's swapped bounding box would otherwise hide.
 */
function fanBox(el: HTMLElement, count: number): FanBox | null {
  if (count < 1) return null
  const r = el.getBoundingClientRect()
  const side = Math.min(r.width, r.height)
  const w = Math.round(side * 0.72)
  const h = Math.round(w * 601 / 430)
  const total = count * w + (count - 1) * 3

  const detailGoesRight = r.left + DETAIL_WIDTH + DETAIL_GAP <= window.innerWidth
  const left = detailGoesRight
    ? Math.max(4, r.left - 8 - total)
    : Math.min(r.right + 8, window.innerWidth - total - 4)

  return { left, top: Math.max(4, Math.min(r.top, window.innerHeight - h - 4)), w, h }
}

function StackFan(
  { box, sources, attached, index, onPeek }:
  {
    box: FanBox
    sources: string[]
    attached: string[]
    index: CardIndex
    onPeek: (cardId: string) => void
  },
) {
  /* Click, like everywhere else on the board, is what fills the docked reader. */
  const thumb = (cardId: string, key: string, plugin: boolean) => (
    <span
      key={key}
      role="button"
      tabIndex={-1}
      className={plugin ? 'fan-thumb plugin' : 'fan-thumb'}
      style={{ width: box.w, height: box.h }}
      onClick={(e) => { e.stopPropagation(); onPeek(cardId) }}
      onKeyDown={(e) => { if (e.key === 'Enter') onPeek(cardId) }}
    >
      <Art cardId={cardId} index={index} alt={false} />
    </span>
  )

  return createPortal(
    <div className="stack-fan" style={{ left: box.left, top: box.top }}>
      {sources.map((id, i) => thumb(id, `s${i}-${id}`, false))}
      {attached.map((id, i) => thumb(id, `a${i}-${id}`, true))}
    </div>,
    document.body,
  )
}

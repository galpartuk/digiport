import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { imageUrl, type CardIndex } from '../cards'
import type { PlayerId, Zone } from '../game/types'
import type { ViewCard } from '../game/view'
import { useUi, type DragData } from './boardCtx'

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

type Props = {
  card: ViewCard
  zone: Zone
  owner: PlayerId
  /** Can this card be picked up? */
  draggable?: boolean
  /** Can another card be dropped onto it (digivolve / attach)? */
  droppable?: boolean
  onClick?: () => void
}

/**
 * One card on the board. It is both a drag source and, in play, a drop target,
 * so the same node carries two dnd-kit refs.
 *
 * A card the viewer may not identify (`cardId === null`) is inert on purpose:
 * its iid is a positional placeholder from the projection, not a real instance
 * id, so it can be shown as a back but can never be the subject of an action.
 */
export function BoardCard({ card, zone, owner, draggable = false, droppable = false, onClick }: Props) {
  const ui = useUi()
  /** Where to draw the hover fan, in viewport coordinates — see below. */
  const [fanned, setFanned] = useState<FanBox | null>(null)

  const known = card.cardId !== null
  const cardId = card.cardId ?? ''
  const hidden = card.faceDown || !known

  const data: DragData = { iid: card.iid, cardId, owner, zone }
  const drag = useDraggable({ id: `drag:${card.iid}`, data, disabled: !draggable || !known })
  const drop = useDroppable({ id: `card:${card.iid}`, disabled: !droppable || !known })

  const setRef = (node: HTMLElement | null) => {
    drag.setNodeRef(node)
    drop.setNodeRef(node)
  }

  const cls = [
    'bcard',
    hidden ? 'down' : '',
    card.suspended ? 'suspended' : '',
    drag.isDragging ? 'dragging' : '',
    droppable && drop.isOver ? 'droptarget' : '',
  ].filter(Boolean).join(' ')

  const showDetail = (id: string, e: { clientX: number; clientY: number }) => ui.hoverCard(id, e)

  return (
    <button
      type="button"
      ref={setRef}
      className={cls}
      {...drag.listeners}
      {...drag.attributes}
      title={known ? cardId : undefined}
      onClick={() => { if (known) onClick?.() }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (known) ui.openMenu({ card, owner, zone }, e.clientX, e.clientY)
      }}
      onMouseEnter={(e) => {
        setFanned(fanBox(e.currentTarget, card.stack.length + card.attached.length))
        if (!hidden) showDetail(cardId, e)
      }}
      onMouseLeave={() => {
        setFanned(null)
        ui.hoverCard(null)
      }}
    >
      {!hidden && <Art cardId={cardId} index={ui.index} />}

      {card.stack.length > 0 && (
        <>
          <div className="stack-edges">
            {card.stack.map((_, i) => <i key={i} />)}
          </div>
          <div className="stack-count">{card.stack.length}</div>
        </>
      )}

      {card.attached.length > 0 && (
        <div className="attached-tabs">
          {card.attached.map((a) => <i key={a.iid} />)}
        </div>
      )}

      {(card.dpMod !== 0 || card.counters > 0) && (
        <div className="badge-row">
          {card.dpMod !== 0 && (
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
          onPeek={showDetail}
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
    onPeek: (cardId: string, at: { clientX: number; clientY: number }) => void
  },
) {
  const thumb = (cardId: string, key: string, plugin: boolean) => (
    <span
      key={key}
      className={plugin ? 'fan-thumb plugin' : 'fan-thumb'}
      style={{ width: box.w, height: box.h }}
      onMouseEnter={(e) => onPeek(cardId, e)}
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

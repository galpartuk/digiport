import { useEffect, useRef, useState } from 'react'
import { imageUrl, type Card, type Meta } from '../cards'
import { copyLimit, MAX_COPIES } from '../deck'

const PAGE = 60

type TileProps = {
  card: Card
  meta: Meta
  count: number
  onAdd: () => void
  onRemove: () => void
  onHover: (card: Card | null, e?: React.MouseEvent) => void
}

function Tile({ card, meta, count, onAdd, onRemove, onHover }: TileProps) {
  const [attempt, setAttempt] = useState(0)
  const limit = copyLimit(card)

  return (
    <button
      className={`tile${count ? ' in-deck' : ''}${count >= limit ? ' maxed' : ''}`}
      title={`${card.name} (${card.id}) — click to add, right-click to remove`}
      onClick={onAdd}
      onContextMenu={(e) => { e.preventDefault(); onRemove() }}
      onMouseEnter={(e) => onHover(card, e)}
      onMouseMove={(e) => onHover(card, e)}
      onMouseLeave={() => onHover(null)}
    >
      <img
        src={imageUrl(card, meta, attempt)}
        alt={card.name}
        loading="lazy"
        decoding="async"
        onError={() => setAttempt((a) => (a + 1 < meta.hosts.length ? a + 1 : a))}
      />
      {count > 0 && <span className="tile-count">{count}</span>}
      {limit === 0 && <span className="tile-flag banned">BANNED</span>}
      {limit > 0 && limit !== MAX_COPIES && <span className="tile-flag">{limit}</span>}
    </button>
  )
}

type Props = {
  cards: Card[]
  meta: Meta
  countOf: (id: string) => number
  onAdd: (card: Card) => void
  onRemove: (card: Card) => void
  onHover: (card: Card | null, e?: React.MouseEvent) => void
}

export function CardGrid({ cards, meta, countOf, onAdd, onRemove, onHover }: Props) {
  const [visible, setVisible] = useState(PAGE)
  const sentinel = useRef<HTMLDivElement>(null)

  // A changed result set starts again from the top.
  useEffect(() => setVisible(PAGE), [cards])

  useEffect(() => {
    const node = sentinel.current
    if (!node) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible((v) => Math.min(v + PAGE, cards.length))
      },
      { rootMargin: '600px' },
    )
    io.observe(node)
    return () => io.disconnect()
  }, [cards.length])

  if (!cards.length) {
    return <div className="empty">No cards match these filters.</div>
  }

  return (
    <>
      <div className="card-grid">
        {cards.slice(0, visible).map((card) => (
          <Tile
            key={card.id}
            card={card}
            meta={meta}
            count={countOf(card.id)}
            onAdd={() => onAdd(card)}
            onRemove={() => onRemove(card)}
            onHover={onHover}
          />
        ))}
      </div>
      <div ref={sentinel} style={{ height: 1 }} />
    </>
  )
}

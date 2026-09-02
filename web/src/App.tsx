import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EMPTY_FILTERS, filterCards, loadCards, sortCards,
  type Card, type CardIndex, type Filters, type Meta,
} from './cards'
import {
  addCard, count, loadDecks, newDeck, saveDecks, total,
  EGG_SIZE, MAIN_SIZE, type Deck,
} from './deck'
import { FilterPanel } from './components/Filters'
import { CardGrid } from './components/CardGrid'
import { CardDetail } from './components/CardDetail'

export type Hover = { card: Card; x: number; y: number }
export type HoverHandler = (card: Card | null, e?: React.MouseEvent) => void

/**
 * The grid re-renders on every mouse move otherwise: hovering a tile updates
 * App state so the detail panel can follow the cursor. Splitting it out behind
 * a memo means only the detail panel repaints while the pointer travels.
 */
const GridSection = memo(function GridSection(props: {
  cards: Card[]
  meta: Meta
  deck: Deck
  onAdd: (card: Card) => void
  onRemove: (card: Card) => void
  onHover: HoverHandler
}) {
  const { cards, meta, deck, onAdd, onRemove, onHover } = props
  const countOf = useCallback((id: string) => count(deck, id), [deck])
  return (
    <CardGrid
      cards={cards}
      meta={meta}
      countOf={countOf}
      onAdd={onAdd}
      onRemove={onRemove}
      onHover={onHover}
    />
  )
})

export function App() {
  const [index, setIndex] = useState<CardIndex | null>(null)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [decks, setDecks] = useState<Deck[]>(() => {
    const stored = loadDecks()
    // The deck panel must never have nothing to show.
    return stored.length ? stored : [newDeck('New deck')]
  })
  const [currentId, setCurrentId] = useState<string>(() => decks[0].id)
  const [hover, setHover] = useState<Hover | null>(null)

  useEffect(() => {
    loadCards().then(setIndex)
  }, [])

  // A missing id (deck deleted elsewhere, stale hash) falls back to the first.
  const deck = decks.find((d) => d.id === currentId) ?? decks[0]

  // Callbacks handed to the memoised grid must stay identity-stable, so they
  // read the live deck id from a ref rather than closing over it.
  const currentRef = useRef(deck.id)
  currentRef.current = deck.id

  useEffect(() => {
    const t = setTimeout(() => saveDecks(decks), 300)
    return () => clearTimeout(t)
  }, [decks])

  const bump = useCallback((card: Card, delta: number) => {
    setDecks((ds) => ds.map((d) => (d.id === currentRef.current ? addCard(d, card, delta) : d)))
  }, [])

  const onAdd = useCallback((card: Card) => bump(card, 1), [bump])
  const onRemove = useCallback((card: Card) => bump(card, -1), [bump])

  const onHover = useCallback<HoverHandler>((card, e) => {
    if (!card || !e) setHover(null)
    else setHover({ card, x: e.clientX, y: e.clientY })
  }, [])

  const results = useMemo(
    () => (index ? sortCards(filterCards(index, filters)) : []),
    [index, filters],
  )

  if (!index) return <div className="loading">Loading cards…</div>

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          Digi<em>port</em> <span>deck builder</span>
        </div>
        <div className="spacer" />
        <span className="result-count">{index.meta.count.toLocaleString()} cards</span>
      </div>

      <div className="workspace">
        <div className="col col-filters">
          <FilterPanel filters={filters} meta={index.meta} onChange={setFilters} />
        </div>

        <div className="col">
          <div className="grid-head">
            <input
              className="field"
              placeholder="Search name, id, effect text…"
              value={filters.text}
              onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
            />
            <span className="result-count">{results.length.toLocaleString()}</span>
          </div>
          <GridSection
            cards={results}
            meta={index.meta}
            deck={deck}
            onAdd={onAdd}
            onRemove={onRemove}
            onHover={onHover}
          />
        </div>

        <div className="col col-deck">
          <div className="deck-head">
            <div className="deck-name">{deck.name}</div>
            <div className="deck-switch">
              <select
                className="field"
                value={deck.id}
                onChange={(e) => setCurrentId(e.target.value)}
              >
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="counters">
              <div className={`counter ${total(deck.main) === MAIN_SIZE ? 'good' : 'bad'}`}>
                <b>{total(deck.main)}/{MAIN_SIZE}</b>
                <span>Main</span>
              </div>
              <div className={`counter ${total(deck.eggs) <= EGG_SIZE ? 'good' : 'bad'}`}>
                <b>{total(deck.eggs)}/{EGG_SIZE}</b>
                <span>Eggs</span>
              </div>
            </div>
          </div>
          <div className="deck-scroll">
            <div className="hint" style={{ padding: '0 6px' }}>
              Click a card to add it, right-click to remove.
            </div>
          </div>
        </div>
      </div>

      {hover && <CardDetail card={hover.card} meta={index.meta} x={hover.x} y={hover.y} />}
    </div>
  )
}

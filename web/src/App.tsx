import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EMPTY_FILTERS, filterCards, loadCards, sortCards, SORTS,
  type Card, type CardIndex, type Filters, type Meta, type SortKey,
} from './cards'
import { Link, useSearchParams } from 'react-router-dom'
import { addCard, count, loadDecks, newDeck, saveDecks, validate, type Deck } from './deck'
import { FilterPanel } from './components/Filters'
import { CardGrid } from './components/CardGrid'
import { CardDetail } from './components/CardDetail'
import { DeckPanel } from './components/DeckPanel'
import { DeckIO, type IoTab } from './components/DeckIO'
import { Nav } from './Nav'
import { decodeDeck } from './share'
import { clearSharedCode, pendingSharedCode, subscribeSharedCode } from './sharedDeck'

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
  // `/decks?deck=<id>` opens on that deck — how the home page hands one over.
  // An id this device has never heard of is simply ignored.
  const [params] = useSearchParams()
  const [currentId, setCurrentId] = useState<string>(() => {
    const wanted = params.get('deck')
    return wanted && decks.some((d) => d.id === wanted) ? wanted : decks[0].id
  })
  const [hover, setHover] = useState<Hover | null>(null)
  // /decks?io=presets opens straight on a tab, so the home page can point at one.
  const [io, setIo] = useState<IoTab | null>(() => {
    const wanted = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('io')
    return (['presets', 'import', 'export', 'share'] as const)
      .find((t) => t === wanted) ?? null
  })
  const [sort, setSort] = useState<SortKey>('deck')
  const [sortDesc, setSortDesc] = useState(false)

  useEffect(() => {
    loadCards().then(setIndex)
  }, [])

  // A missing id (deck deleted elsewhere, stale hash) falls back to the first.
  const deck = decks.find((d) => d.id === currentId) ?? decks[0]

  // Callbacks handed to the memoised grid must stay identity-stable, so they
  // read the live deck id from a ref rather than closing over it.
  const currentRef = useRef(deck.id)
  currentRef.current = deck.id
  const decksRef = useRef(decks)
  decksRef.current = decks

  useEffect(() => {
    const t = setTimeout(() => saveDecks(decks), 300)
    return () => clearTimeout(t)
  }, [decks])

  const bump = useCallback((card: Card, delta: number) => {
    setDecks((ds) => ds.map((d) => (d.id === currentRef.current ? addCard(d, card, delta) : d)))
  }, [])

  const onAdd = useCallback((card: Card) => bump(card, 1), [bump])
  const onRemove = useCallback((card: Card) => bump(card, -1), [bump])

  const patchDeck = useCallback((name: string) => {
    setDecks((ds) => ds.map((d) =>
      (d.id === currentRef.current ? { ...d, name, updatedAt: Date.now() } : d)))
  }, [])

  const onNew = useCallback(() => {
    const fresh = newDeck('New deck')
    setDecks([...decksRef.current, fresh])
    setCurrentId(fresh.id)
  }, [])

  const onDuplicate = useCallback(() => {
    const source = decksRef.current.find((d) => d.id === currentRef.current)
    if (!source) return
    const copy = { ...newDeck(`${source.name} copy`), main: { ...source.main }, eggs: { ...source.eggs } }
    setDecks([...decksRef.current, copy])
    setCurrentId(copy.id)
  }, [])

  const onDelete = useCallback(() => {
    const rest = decksRef.current.filter((d) => d.id !== currentRef.current)
    // The panel is never empty: deleting the last deck leaves a fresh one.
    const next = rest.length ? rest : [newDeck('New deck')]
    setDecks(next)
    setCurrentId(next[0].id)
  }, [])

  const onClear = useCallback(() => {
    setDecks((ds) => ds.map((d) =>
      (d.id === currentRef.current ? { ...d, main: {}, eggs: {}, updatedAt: Date.now() } : d)))
  }, [])

  const adoptDeck = useCallback((incoming: Deck, mode: 'new' | 'replace') => {
    if (mode === 'new') {
      setDecks([...decksRef.current, incoming])
      setCurrentId(incoming.id)
      return
    }
    setDecks(decksRef.current.map((d) => (d.id === currentRef.current
      ? { ...d, main: incoming.main, eggs: incoming.eggs, updatedAt: Date.now() }
      : d)))
  }, [])

  // A shared link lands as a new deck, selected, with the hash already cleared —
  // on a cold load, and equally when one is pasted into an already-open tab.
  // The payload itself is taken out of the URL in sharedDeck.ts, because `/`
  // is the home page now and a share link names `/`.
  useEffect(() => {
    let live = true
    /**
     * The pending code is cleared only once a deck has actually been adopted.
     * StrictMode throws the first effect pass away, and the builder unmounts
     * whenever another route is open, so "read it out of the URL" and "used
     * it" have to be two separate moments.
     */
    const pull = () => {
      const code = pendingSharedCode()
      if (!code) return
      decodeDeck(code).then((shared) => {
        // Unreadable is final: leaving it pending would bounce the visitor
        // from the home page back to here on every visit.
        if (!shared) return clearSharedCode(code)
        if (!live) return
        clearSharedCode(code)
        adoptDeck(shared, 'new')
      })
    }
    pull()
    const off = subscribeSharedCode(pull)
    return () => {
      live = false
      off()
    }
  }, [adoptDeck])

  const onHover = useCallback<HoverHandler>((card, e) => {
    if (!card || !e) setHover(null)
    else setHover({ card, x: e.clientX, y: e.clientY })
  }, [])

  const results = useMemo(
    () => (index ? sortCards(filterCards(index, filters), sort, sortDesc) : []),
    [index, filters, sort, sortDesc],
  )

  // Playable means legal: the errors are the same ones the deck panel lists,
  // so the button and the problem list can never disagree.
  const playable = useMemo(
    () => (index ? !validate(deck, index).some((p) => p.level === 'error') : false),
    [index, deck],
  )

  if (!index) return <div className="loading">Loading cards…</div>

  return (
    <div className="app">
      <Nav label="deck builder">
        {playable ? (
          <Link
            className="btn btn-primary btn-sm"
            to={`/play?mode=goldfish&deck=${encodeURIComponent(deck.id)}`}
            title={`Goldfish “${deck.name}” — play it against an empty seat`}
          >
            Play
          </Link>
        ) : (
          <button
            className="btn btn-sm"
            disabled
            title="Playable once the deck is legal: 50 main-deck cards, at most 5 Digi-Eggs."
          >
            Play
          </button>
        )}
        <span className="result-count">{index.meta.count.toLocaleString()} cards</span>
      </Nav>

      <div className="workspace">
        <div className="col col-filters">
          <FilterPanel filters={filters} index={index} onChange={setFilters} />
        </div>

        <div className="col">
          <div className="grid-head">
            <input
              className="field"
              placeholder="Search name, id, effect text…"
              value={filters.text}
              onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
            />
            <select
              className="field sort"
              aria-label="Sort cards by"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button
              className="btn btn-sm"
              aria-pressed={sortDesc}
              title={sortDesc ? 'Descending — click for ascending' : 'Ascending — click for descending'}
              onClick={() => setSortDesc((d) => !d)}
            >
              {sortDesc ? '↓' : '↑'}
            </button>
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
          <DeckPanel
            deck={deck}
            decks={decks}
            index={index}
            onSelect={setCurrentId}
            onRename={patchDeck}
            onNew={onNew}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onClear={onClear}
            onBump={bump}
            onHover={onHover}
            onOpenIO={setIo}
          />
        </div>
      </div>

      {io && (
        <DeckIO
          deck={deck}
          index={index}
          tab={io}
          onTab={setIo}
          onClose={() => setIo(null)}
          onImport={adoptDeck}
        />
      )}

      {hover && <CardDetail card={hover.card} meta={index.meta} x={hover.x} y={hover.y} />}
    </div>
  )
}

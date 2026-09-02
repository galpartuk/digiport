import { useEffect, useState } from 'react'
import { COLORS, imageUrl, type Card, type CardIndex } from '../cards'
import {
  EGG_SIZE, MAIN_SIZE, stats, total, validate, type Deck, type Problem,
} from '../deck'

type HoverHandler = (card: Card | null, e?: React.MouseEvent) => void

type Row = { card: Card; n: number }
type Group = { key: string; label: string; rows: Row[] }

/** Digi-Eggs, then Digimon by level, then Tamers, then Options. */
function groupRows(deck: Deck, index: CardIndex): Group[] {
  const rowsOf = (pile: Record<string, number>): Row[] => {
    const out: Row[] = []
    for (const [id, n] of Object.entries(pile)) {
      const card = index.byId.get(id)
      if (card) out.push({ card, n })
    }
    return out
  }

  const byCost = (a: Row, b: Row) =>
    (a.card.playCost ?? 99) - (b.card.playCost ?? 99) ||
    a.card.name.localeCompare(b.card.name) ||
    a.card.id.localeCompare(b.card.id)

  const groups: Group[] = []
  const push = (key: string, label: string, rows: Row[]) => {
    if (rows.length) groups.push({ key, label, rows: rows.sort(byCost) })
  }

  const main = rowsOf(deck.main)
  push('eggs', 'Digi-Eggs', rowsOf(deck.eggs))

  const digimon = main.filter((r) => r.card.cardType === 'Digimon')
  const levels = [...new Set(digimon.map((r) => r.card.level ?? 0))].sort((a, b) => a - b)
  for (const lv of levels) {
    push(`lv${lv}`, lv ? `Lv.${lv}` : 'Digimon',
      digimon.filter((r) => (r.card.level ?? 0) === lv))
  }

  push('tamers', 'Tamers', main.filter((r) => r.card.cardType === 'Tamer'))
  push('options', 'Options', main.filter((r) => r.card.cardType === 'Option'))
  // Anything the type list does not cover still has to be visible.
  push('other', 'Other',
    main.filter((r) => !['Digimon', 'Tamer', 'Option'].includes(r.card.cardType)))
  return groups
}

function colorVar(color: string): string {
  return `var(--c-${color.toLowerCase()})`
}

function DeckRow({ card, n, index, onBump, onHover }: {
  card: Card
  n: number
  index: CardIndex
  onBump: (card: Card, delta: number) => void
  onHover: HoverHandler
}) {
  const [attempt, setAttempt] = useState(0)
  useEffect(() => setAttempt(0), [card.id])

  return (
    <div
      className="deck-row tinted"
      style={{ ['--row-tint' as string]: colorVar(card.colors[0] ?? 'black') }}
      onMouseEnter={(e) => onHover(card, e)}
      onMouseMove={(e) => onHover(card, e)}
      onMouseLeave={() => onHover(null)}
    >
      <img
        className="thumb"
        src={imageUrl(card, index.meta, attempt)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setAttempt((a) => (a + 1 < index.meta.hosts.length ? a + 1 : a))}
      />
      <div>
        <div className="nm">{card.name}</div>
        <div className="sub">
          <span>{card.id}</span>
          <span className="dots">
            {card.colors.map((c) => <i key={c} style={{ background: colorVar(c) }} />)}
          </span>
          {card.playCost !== undefined && <span>{card.playCost}c</span>}
        </div>
      </div>
      <div className="steps">
        <button className="step" title="Remove one" onClick={() => onBump(card, -1)}>&minus;</button>
        <b className="n">{n}</b>
        <button className="step" title="Add one" onClick={() => onBump(card, 1)}>+</button>
      </div>
    </div>
  )
}

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

type Props = {
  deck: Deck
  decks: Deck[]
  index: CardIndex
  onSelect: (id: string) => void
  onRename: (name: string) => void
  onNew: () => void
  onDuplicate: () => void
  onDelete: () => void
  onClear: () => void
  onBump: (card: Card, delta: number) => void
  onHover: HoverHandler
}

export function DeckPanel(props: Props) {
  const { deck, decks, index, onSelect, onRename, onBump, onHover } = props
  const [name, setName] = useState(deck.name)
  const [confirm, setConfirm] = useState<'delete' | 'clear' | null>(null)

  // Switching decks (or a rename from elsewhere) reloads the editable name.
  useEffect(() => setName(deck.name), [deck.id, deck.name])
  useEffect(() => setConfirm(null), [deck.id])

  const commitName = () => {
    const next = name.trim()
    if (next && next !== deck.name) onRename(next)
    else setName(deck.name)
  }

  const groups = groupRows(deck, index)
  const s = stats(deck, index)
  const mainTotal = total(deck.main)
  const eggTotal = total(deck.eggs)

  const curve: Array<[string, number]> = Object.entries(s.curve)
    .map(([k, n]) => [Number(k), n] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .map(([k, n]) => [k === 10 ? '10+' : String(k), n])

  const levels: Array<[string, number]> = Object.entries(s.byLevel)
    .map(([k, n]) => [Number(k), n] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .map(([k, n]) => [`Lv.${k}`, n])

  const colorTotal = COLORS.reduce((sum, c) => sum + (s.byColor[c] ?? 0), 0)

  const problems: Problem[] = validate(deck, index)
    .slice()
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))

  return (
    <>
      <div className="deck-head">
        <input
          className="deck-name"
          value={name}
          aria-label="Deck name"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { setName(deck.name); e.currentTarget.blur() }
          }}
        />

        <div className="deck-switch">
          {confirm === 'delete' ? (
            <div className="confirm">
              Delete this deck?
              <span className="spacer" />
              <button className="btn btn-sm" onClick={() => { setConfirm(null); props.onDelete() }}>
                Yes
              </button>
              <button className="btn btn-sm" onClick={() => setConfirm(null)}>No</button>
            </div>
          ) : (
            <>
              <select
                className="field"
                aria-label="Switch deck"
                value={deck.id}
                onChange={(e) => onSelect(e.target.value)}
              >
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <button className="btn btn-sm" title="New deck" onClick={props.onNew}>New</button>
              <button className="btn btn-sm" title="Duplicate deck" onClick={props.onDuplicate}>
                Copy
              </button>
              <button className="btn btn-sm" title="Delete deck" onClick={() => setConfirm('delete')}>
                Del
              </button>
            </>
          )}
        </div>

        <div className="counters" style={{ marginTop: 8 }}>
          <div className={`counter ${mainTotal === MAIN_SIZE ? 'good' : 'bad'}`}>
            <b>{mainTotal}/{MAIN_SIZE}</b>
            <span>Main</span>
          </div>
          <div className={`counter ${eggTotal <= EGG_SIZE ? 'good' : 'bad'}`}>
            <b>{eggTotal}/{EGG_SIZE}</b>
            <span>Eggs</span>
          </div>
        </div>
      </div>

      <div className="deck-scroll">
        {groups.length === 0 && (
          <p className="hint" style={{ padding: '6px 8px' }}>
            Empty deck. Click a card in the grid to add it, right-click to remove.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.key}>
            <div className="deck-group">
              <span>{g.label}</span>
              <span>{g.rows.reduce((n, r) => n + r.n, 0)}</span>
            </div>
            {g.rows.map((r) => (
              <DeckRow
                key={r.card.id}
                card={r.card}
                n={r.n}
                index={index}
                onBump={onBump}
                onHover={onHover}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="stats">
        <div className="stats-cols">
          <Bars title="Play cost" entries={curve} />
          <Bars title="Level" entries={levels} />
        </div>
        {colorTotal > 0 && (
          <div className="group" style={{ marginBottom: 0 }}>
            <h3>Colours</h3>
            <div className="color-bar">
              {COLORS.filter((c) => s.byColor[c]).map((c) => (
                <i
                  key={c}
                  title={`${c} ${s.byColor[c]}`}
                  style={{ background: colorVar(c), width: `${(s.byColor[c] / colorTotal) * 100}%` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="problems">
        {problems.length === 0
          ? <div className="problem ok">Deck is legal.</div>
          : problems.map((p, i) => <div className={`problem ${p.level}`} key={i}>{p.text}</div>)}
      </div>

      <div className="deck-actions">
        {confirm === 'clear' ? (
          <div className="confirm">
            Remove every card?
            <span className="spacer" />
            <button className="btn btn-sm" onClick={() => { setConfirm(null); props.onClear() }}>
              Yes
            </button>
            <button className="btn btn-sm" onClick={() => setConfirm(null)}>No</button>
          </div>
        ) : (
          <button className="btn" onClick={() => setConfirm('clear')}>Clear</button>
        )}
      </div>
    </>
  )
}

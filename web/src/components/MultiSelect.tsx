import { useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  /** Shown on the trigger when nothing is picked, e.g. "Any trait". */
  emptyLabel: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Cards per option, shown beside each row so dead ends are obvious. */
  counts?: Map<string, number>
  searchPlaceholder?: string
}

/**
 * A folded multi-select for lists too long to lay out as chips — 288 traits and
 * 65 sets between them. The panel opens *in flow* rather than floating: the
 * filter column scrolls, and an absolutely positioned panel would be clipped by
 * its overflow.
 */
export function MultiSelect({
  emptyLabel, options, selected, onChange, counts, searchPlaceholder,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Reopening should not inherit the last search.
  useEffect(() => { if (!open) setQuery('') }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, query])

  const toggle = (value: string) => {
    onChange(selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value])
  }

  return (
    <div className="ms" ref={root}>
      <button
        className="ms-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{selected.length ? `${selected.length} selected` : emptyLabel}</span>
        <span className="ms-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {selected.length > 0 && (
        <div className="chips ms-selected">
          {selected.map((value) => (
            <button
              key={value}
              className="chip"
              aria-pressed="true"
              title={`Remove ${value}`}
              onClick={() => toggle(value)}
            >
              {value} ✕
            </button>
          ))}
          <button className="chip ms-clear" onClick={() => onChange([])}>Clear</button>
        </div>
      )}

      {open && (
        <div className="ms-panel">
          <input
            className="field ms-search"
            autoFocus
            placeholder={searchPlaceholder ?? 'Search…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="ms-list">
            {matches.map((value) => (
              <button
                key={value}
                className="ms-option"
                aria-pressed={selected.includes(value)}
                onClick={() => toggle(value)}
              >
                <span className="ms-name">{value}</span>
                {counts && <em>{counts.get(value) ?? 0}</em>}
              </button>
            ))}
            {matches.length === 0 && <div className="ms-empty">Nothing matches “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

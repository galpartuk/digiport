import { CARD_TYPES, COLORS, FORMS, type CardType, type Filters, type Meta } from '../cards'

type Props = {
  filters: Filters
  meta: Meta
  onChange: (next: Filters) => void
}

const LEVELS = [2, 3, 4, 5, 6, 7]
const COSTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** Adds or removes one value from a multi-select filter array. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export function FilterPanel({ filters, meta, onChange }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  // Newest sets first — that is what people are usually building for.
  const sets = [...meta.sets].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))

  return (
    <div>
      <div className="group">
        <h3>Colour</h3>
        <div className="chips">
          {COLORS.map((c) => (
            <button
              key={c}
              className="chip chip-color"
              style={{ ['--chip-color' as string]: `var(--c-${c.toLowerCase()})` }}
              aria-pressed={filters.colors.includes(c)}
              onClick={() => set({ colors: toggle(filters.colors, c as string) })}
            >
              {c}
            </button>
          ))}
        </div>
        {filters.colors.length > 1 && (
          <label className="toggle-row" style={{ marginTop: 7 }}>
            <input
              type="checkbox"
              checked={filters.colorsExact}
              onChange={(e) => set({ colorsExact: e.target.checked })}
            />
            Must have all picked colours
          </label>
        )}
      </div>

      <div className="group">
        <h3>Card type</h3>
        <div className="chips">
          {CARD_TYPES.map((t) => (
            <button
              key={t}
              className="chip"
              aria-pressed={filters.types.includes(t)}
              onClick={() => set({ types: toggle(filters.types, t as CardType) })}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <h3>Level</h3>
        <div className="chips">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="chip chip-num"
              aria-pressed={filters.levels.includes(l)}
              onClick={() => set({ levels: toggle(filters.levels, l) })}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <h3>Play cost</h3>
        <div className="chips">
          {COSTS.map((c) => (
            <button
              key={c}
              className="chip chip-num"
              aria-pressed={filters.costs.includes(c)}
              onClick={() => set({ costs: toggle(filters.costs, c) })}
            >
              {c === 10 ? '10+' : c}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <h3>Form</h3>
        <div className="chips">
          {FORMS.map((f) => (
            <button
              key={f}
              className="chip"
              aria-pressed={filters.forms.includes(f)}
              onClick={() => set({ forms: toggle(filters.forms, f) })}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <h3>Set</h3>
        <div className="chips" style={{ maxHeight: 168, overflowY: 'auto' }}>
          {sets.map((s) => (
            <button
              key={s}
              className="chip"
              aria-pressed={filters.sets.includes(s)}
              onClick={() => set({ sets: toggle(filters.sets, s) })}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="group">
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={filters.includeUnreleased}
            onChange={(e) => set({ includeUnreleased: e.target.checked })}
          />
          Include unreleased (JP-only)
        </label>
      </div>
    </div>
  )
}

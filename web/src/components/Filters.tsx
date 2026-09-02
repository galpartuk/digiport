import { useMemo } from 'react'
import {
  CARD_TYPES, COLORS, FORMS, setCounts, traitCounts,
  type CardIndex, type CardType, type Filters,
} from '../cards'
import { MultiSelect } from './MultiSelect'

type Props = {
  filters: Filters
  index: CardIndex
  onChange: (next: Filters) => void
}

const LEVELS = [2, 3, 4, 5, 6, 7]
const COSTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** Adds or removes one value from a multi-select filter array. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export function FilterPanel({ filters, index, onChange }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  const meta = index.meta

  // Newest sets first — that is what people are usually building for.
  const sets = useMemo(
    () => [...meta.sets].sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
    [meta.sets],
  )
  // 288 traits and 65 sets are far too many to lay out as chips, so both fold
  // into a searchable picker. Counting the pool once keeps the rows honest.
  const traits = useMemo(() => [...meta.types].sort((a, b) => a.localeCompare(b)), [meta.types])
  const traitsPerCard = useMemo(() => traitCounts(index), [index])
  const cardsPerSet = useMemo(() => setCounts(index), [index])

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
        <h3>Trait</h3>
        <MultiSelect
          emptyLabel="Any trait"
          searchPlaceholder="Search 288 traits…"
          options={traits}
          selected={filters.traits}
          counts={traitsPerCard}
          onChange={(next) => set({ traits: next })}
        />
        {filters.traits.length > 1 && (
          <label className="toggle-row" style={{ marginTop: 7 }}>
            <input
              type="checkbox"
              checked={filters.traitsExact}
              onChange={(e) => set({ traitsExact: e.target.checked })}
            />
            Must have all picked traits
          </label>
        )}
      </div>

      <div className="group">
        <h3>Set</h3>
        <MultiSelect
          emptyLabel="Any set"
          searchPlaceholder="Search sets…"
          options={sets}
          selected={filters.sets}
          counts={cardsPerSet}
          onChange={(next) => set({ sets: next })}
        />
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

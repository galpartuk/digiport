import { useEffect, useRef } from 'react'

export type MenuItem =
  | { kind: 'title'; label: string }
  | { kind: 'sep' }
  | { kind: 'item'; label: string; run: () => void }

type Props = { x: number; y: number; items: MenuItem[]; onClose: () => void }

/**
 * A card's right-click menu. Deliberately tiny and dependency-free: it is a
 * fixed-position list that closes on Escape or on any pointer press outside
 * itself. The outside-press listener runs in the capture phase so the click
 * that dismisses the menu cannot also land on the card underneath it.
 */
export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', escape)
    }
  }, [onClose])

  // Keep the whole menu on screen. The height is estimated from the row count
  // rather than measured, which avoids a second render pass for a few pixels.
  const height = items.reduce((h, it) => h + (it.kind === 'item' ? 25 : it.kind === 'sep' ? 9 : 22), 8)
  const left = Math.max(6, Math.min(x, window.innerWidth - 190))
  const top = Math.max(6, Math.min(y, window.innerHeight - height - 6))

  return (
    <div className="ctx-menu" ref={ref} style={{ left, top }}>
      {items.map((item, i) => {
        if (item.kind === 'sep') return <hr key={i} />
        if (item.kind === 'title') return <div className="ctx-title" key={i}>{item.label}</div>
        return (
          <button
            key={i}
            type="button"
            onClick={() => {
              item.run()
              onClose()
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

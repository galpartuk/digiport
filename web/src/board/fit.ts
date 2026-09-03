import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Making the battle area fit, instead of letting it scroll.
 *
 * A card you cannot see is a card you forget you have, so the field never
 * scrolls and never clips: the whole battle area is always on screen. The mat
 * has a fixed height and the number of cards on it is what varies, so the thing
 * that gives is the layout inside the zone — and in a deliberate order.
 *
 *   1. Full size, normal spacing. A three-Digimon board never changes.
 *   2. The gap between cards closes.
 *   3. The cards start to overlap, like a hand — an eight-Digimon row at full
 *      size beats a six-Digimon row shrunk to fit, because the part that gets
 *      covered is the right edge of the art and the part that stays is the
 *      name, the DP plate and the source spread.
 *   4. Only then does the card size step down.
 *
 * This is a prediction rather than a feedback loop. The zone's own box is
 * content-independent — it is a grid item whose row is `minmax(0, 1fr)` and
 * whose `min-height` is 0, so nothing inside it can make it grow — which means
 * measuring the box, computing the largest layout that fits, and writing three
 * custom properties settles in one pass with nothing to oscillate against.
 */

const RATIO = 601 / 430

/** Flex gap between the front and back rows: 6px gap + 5px padding + 1px rule. */
const ROW_SPLIT = 13

/** What an empty back row costs. It is a landing strip, not a reserved row. */
const EMPTY_STRIP = 14

/** A couple of pixels of slack so a rounding error is never a clipped card. */
const SLACK = 3

/**
 * Spacing, tightened one step at a time. `lap` is the fraction of a card the
 * next one covers; past about a quarter the art stops being recognisable, so
 * that is where the ladder ends and the card size starts giving instead.
 */
const TIGHTEN: Array<{ gap: number; lap: number }> = [
  { gap: 8, lap: 0 },
  { gap: 5, lap: 0 },
  { gap: 3, lap: 0 },
  { gap: 2, lap: 0.08 },
  { gap: 2, lap: 0.15 },
  { gap: 2, lap: 0.22 },
]

/** Card scale, largest first. The floor is a genuinely crowded board. */
const SCALES: number[] = []
for (let s = 100; s >= 44; s -= 3) SCALES.push(s / 100)

export type Fit = { scale: number; gap: number; lap: number }

/**
 * What is actually in the zone. Stack depth matters as much as the count: a
 * digivolved Digimon spreads its sources downwards (§4-7-4) and so is taller
 * than a card that was played flat.
 */
export type BattleShape = {
  /** Digivolution-source counts, one per card in the front row. */
  front: number[]
  /** The same for the back row; empty when the rows are turned off. */
  back: number[]
  /** Is the back row drawn at all? */
  rows: boolean
}

/** How far below a card its digivolution sources spread. Mirrors `.bcard.stacked`. */
function spread(depth: number, h: number): number {
  if (depth < 1) return 0
  return Math.max(9 * depth, Math.min(h * 0.15 * depth, h * 0.6))
}

/** How many cards go on one line at this width, spacing and overlap. */
function columns(width: number, w: number, gap: number, lap: number): number {
  if (width < w) return 1
  const step = w * (1 - lap) + gap
  return Math.max(1, Math.floor((width - w) / step) + 1)
}

/** The height a set of cards takes once it has wrapped. */
function block(depths: number[], cols: number, h: number, gapV: number): number {
  const rows = Math.max(1, Math.ceil(depths.length / cols))
  // The deepest stack in the zone sets every row's height — which row a given
  // stack lands in is not knowable before layout, and over-reserving is the
  // side to be wrong on.
  const tallest = depths.length ? Math.max(...depths) : 0
  return rows * (h + spread(tallest, h)) + (rows - 1) * gapV
}

function fits(
  width: number, height: number, w: number, gap: number, lap: number, shape: BattleShape,
): boolean {
  const h = w * RATIO
  const cols = columns(width, w, gap, lap)
  const gapV = Math.max(4, gap)

  if (!shape.rows) return block(shape.front, cols, h, gapV) <= height

  const back = shape.back.length ? block(shape.back, cols, h, gapV) : EMPTY_STRIP
  return block(shape.front, cols, h, gapV) + ROW_SPLIT + back <= height
}

/**
 * The largest layout that fits, preferring a big card in a tight row over a
 * small card in a loose one.
 */
export function fitFor(width: number, height: number, base: number, shape: BattleShape): Fit {
  for (const scale of SCALES) {
    for (const { gap, lap } of TIGHTEN) {
      if (fits(width, height, base * scale, gap, lap, shape)) return { scale, gap, lap }
    }
  }
  const last = TIGHTEN[TIGHTEN.length - 1]
  return { scale: SCALES[SCALES.length - 1], gap: last.gap, lap: last.lap }
}

/**
 * The base card width in pixels.
 *
 * `--bcard-base` is a `clamp()` of viewport units, and an unregistered custom
 * property keeps its token stream in the computed style — `getPropertyValue`
 * hands back the whole `clamp(...)` string, not a length. So the width is read
 * off a probe element that is one `var(--bcard-base)` wide and nothing else.
 */
function baseWidth(zone: HTMLElement): number {
  const probe = zone.querySelector<HTMLElement>('.fit-probe')
  // `offsetWidth` and not the bounding rect: the box below is measured with
  // `clientWidth`, and the two agree under a CSS zoom where the rect does not.
  // It rounds up as often as down, and the 3px of slack absorbs that.
  return probe ? probe.offsetWidth : 0
}

function applyFit(zone: HTMLElement, shape: BattleShape): void {
  const base = baseWidth(zone)
  if (base <= 0) return

  const style = getComputedStyle(zone)
  const px = (v: string) => parseFloat(v) || 0
  const width = zone.clientWidth - px(style.paddingLeft) - px(style.paddingRight)
  const height =
    zone.clientHeight - px(style.paddingTop) - px(style.paddingBottom) - SLACK
  if (width <= 0 || height <= 0) return

  const fit = fitFor(width, height, base, shape)
  zone.style.setProperty('--fit', String(fit.scale))
  zone.style.setProperty('--fit-gap', `${fit.gap}px`)
  zone.style.setProperty('--fit-lap', String(fit.lap))
}

/**
 * Keeps one battle area fitted. Returns the ref to put on the zone element.
 *
 * Writing custom properties straight onto the node rather than through state is
 * deliberate: the measurement depends on the layout, so a render triggered by
 * the measurement would be a loop waiting to happen.
 */
export function useBattleFit(shape: BattleShape): (node: HTMLElement | null) => void {
  const node = useRef<HTMLElement | null>(null)
  const latest = useRef(shape)
  latest.current = shape

  // What is on the field, as one string, so the effect re-runs when the field
  // changes and not on every unrelated render.
  const key = `${shape.rows}|${shape.front.join(',')}|${shape.back.join(',')}`

  useLayoutEffect(() => {
    const el = node.current
    if (!el) return
    applyFit(el, latest.current)
  }, [key])

  useEffect(() => {
    const el = node.current
    if (!el) return
    const measure = () => applyFit(el, latest.current)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // The base size is a viewport clamp, so the window can change it without
    // this element's own box changing at all.
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Stable, so React does not detach and re-attach the ref on every render —
  // measuring forces a reflow, and doing that per keystroke in the chat box
  // would be a real cost for no gain.
  return useCallback((el: HTMLElement | null) => {
    node.current = el
    if (el) applyFit(el, latest.current)
  }, [])
}

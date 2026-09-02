import { createContext, useContext } from 'react'
import type { CardIndex } from '../cards'
import type { Action, PlayerId, Zone } from '../game/types'
import type { ViewCard } from '../game/view'

/**
 * What travels with a dragged card. Only cards the viewer can actually see get
 * dragged, so `cardId` is never null here — a masked card carries a positional
 * placeholder iid that the reducer would reject, and must never reach an action.
 */
export type DragData = {
  iid: string
  cardId: string
  owner: PlayerId
  zone: Zone
}

/** The card a right-click opened the context menu on, plus where it lives. */
export type MenuTarget = { card: ViewCard; owner: PlayerId; zone: Zone }

/**
 * Board-wide handles the card components need. Passing these through props
 * would mean threading six values through four layers of markup for no gain;
 * none of it is game state, so a context is the honest shape.
 */
export type BoardUi = {
  seat: PlayerId
  index: CardIndex
  dispatch: (action: Action) => void
  /** Show (or with null, hide) the floating CardDetail panel at the cursor. */
  hoverCard: (cardId: string | null, at?: { clientX: number; clientY: number }) => void
  openMenu: (target: MenuTarget, x: number, y: number) => void
}

export const UiCtx = createContext<BoardUi | null>(null)

export function useUi(): BoardUi {
  const ui = useContext(UiCtx)
  if (!ui) throw new Error('BoardCard used outside <Board>')
  return ui
}

/**
 * Zones an opponent's card may legally be pushed into by the acting player —
 * the same set the reducer enforces. The board checks it too so that an illegal
 * drop is simply inert instead of producing a red error the player did not ask
 * for.
 */
export const OPPONENT_DESTINATIONS: ReadonlySet<Zone> =
  new Set<Zone>(['reveal', 'trash', 'hand', 'deck', 'security'])

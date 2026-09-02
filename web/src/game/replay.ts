import { apply, emptyState } from './reducer'
import { CHATTER, type Action, type GameState } from './types'

/**
 * The whole game from its action log. The log is the source of truth — state
 * is only ever a fold over it — which is what makes undo and spectator
 * catch-up free, and lets the server hand a reconnecting client the actions
 * rather than a snapshot.
 */
export function replay(actions: Action[]): GameState {
  return actions.reduce(apply, emptyState())
}

/**
 * The action list with the last board-changing action taken out. Chat and undo
 * requests are skipped over rather than removed: undoing "so-and-so said hello"
 * is not what anyone means by undo.
 */
export function withoutLastAction(actions: Action[]): Action[] {
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i].t === 'setup') break        // the setup is the floor
    if (!CHATTER.has(actions[i].t)) return [...actions.slice(0, i), ...actions.slice(i + 1)]
  }
  return actions
}

/** Undo as replay-minus-one. Returns the trimmed log and the state it folds to. */
export function undo(actions: Action[]): { actions: Action[]; state: GameState } {
  const trimmed = withoutLastAction(actions)
  return { actions: trimmed, state: replay(trimmed) }
}

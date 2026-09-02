import { useCallback, useRef, useState } from 'react'
import { apply, emptyState } from '../game/reducer'
import { replay, undo as undoActions } from '../game/replay'
import { IllegalAction, type Action, type GameState } from '../game/types'

type Session = { actions: Action[]; state: GameState }

/**
 * A whole game running locally. The action log is the record and the state is
 * folded from it, exactly as the Room durable object will do in Phase 2 — the
 * only difference there is that `dispatch` goes over a socket instead.
 *
 * Actions are applied incrementally rather than by re-folding the log each
 * time; the log is only replayed for undo, where the cost is paid once.
 */
export function useGame(setup: Action | null) {
  const [session, setSession] = useState<Session>(() => {
    if (!setup) return { actions: [], state: emptyState() }
    return { actions: [setup], state: apply(emptyState(), setup) }
  })
  const [refused, setRefused] = useState<string | null>(null)

  // Errors are reported outside the state updater, which React may run twice.
  const ref = useRef(session)
  ref.current = session

  const dispatch = useCallback((action: Action) => {
    const current = ref.current
    try {
      const state = apply(current.state, action)
      const next = { actions: [...current.actions, action], state }
      ref.current = next
      setSession(next)
      setRefused(null)
      return true
    } catch (err) {
      setRefused(err instanceof IllegalAction ? err.message : String(err))
      return false
    }
  }, [])

  const undo = useCallback(() => {
    const next = undoActions(ref.current.actions)
    ref.current = next
    setSession(next)
    setRefused(null)
  }, [])

  const restart = useCallback((action: Action) => {
    const next = { actions: [action], state: replay([action]) }
    ref.current = next
    setSession(next)
    setRefused(null)
  }, [])

  return { state: session.state, actions: session.actions, dispatch, undo, restart, refused }
}

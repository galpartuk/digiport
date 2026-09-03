import { useEffect, useState } from 'react'
import { TokenFace } from './BoardCard'
import { PRINTED_TOKENS } from './tokens'

/**
 * Picking a token to put on the field (§4-21).
 *
 * `playToken` takes a name as a string, and a string is the wrong thing to ask
 * a player for: "Volée & Zerdrücken" is not a word anyone types correctly under
 * a turn timer, and a typo makes a second, different token that the log and the
 * field then disagree about. So the printed tokens are a list you point at.
 *
 * The list is not a rule, though — it is a snapshot of what has been printed,
 * and it goes stale on the next set (see `tokens.ts`). The field underneath is
 * the whole reason this is not a closed menu: a player who needs a token we
 * have not listed has to be able to put it down anyway.
 */
export function TokenPicker(
  { onPick, onClose }: { onPick: (name: string) => void; onClose: () => void },
) {
  const [typed, setTyped] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const custom = typed.trim()

  return (
    <div className="browser-scrim" onClick={onClose} role="presentation">
      <div className="browser tokenpick" onClick={(e) => e.stopPropagation()} role="presentation">
        <header className="browser-head">
          <b>Play a token</b>
          <span>{PRINTED_TOKENS.length} printed · §4-21</span>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </header>

        <p className="tp-note">
          A token is not a card: it has no card number, it cannot be stacked with
          (§4-21-3) or linked (§4-21-4), and when it leaves the field it is removed
          from the game rather than trashed (§4-21-5).
        </p>

        <div className="tp-grid">
          {PRINTED_TOKENS.map((name) => (
            <button
              key={name}
              type="button"
              className="tp-token"
              title={`Put a ${name} token into your battle area`}
              onClick={() => { onPick(name); onClose() }}
            >
              <TokenFace name={name} />
            </button>
          ))}
        </div>

        <form
          className="tp-foot"
          onSubmit={(e) => {
            e.preventDefault()
            if (!custom) return
            onPick(custom)
            onClose()
          }}
        >
          {/*
            The escape hatch. Sets print new tokens and this file does not know
            about them yet; being one release behind must not be the reason a
            game stops.
          */}
          <label className="zone-label" htmlFor="tp-other">Not listed</label>
          <input
            id="tp-other"
            className="log-input"
            value={typed}
            placeholder="Name it yourself"
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="submit" className="btn btn-sm btn-primary" disabled={!custom}>
            Place
          </button>
        </form>
      </div>
    </div>
  )
}

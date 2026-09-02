import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'

/**
 * The one bar at the top of the site.
 *
 * It is deliberately not a layout route: the board at `/play` is full-screen
 * and already carries its own Exit on the right rail, so a second bar there
 * would only eat playfield. Each page that wants the nav renders it, and the
 * builder hangs its own controls (Play, card count) off the end of it rather
 * than growing a second row.
 */
export function Nav({ label, children }: { label?: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      <Link className="brand" to="/">
        Digi<em>port</em>
        {label ? <span>{label}</span> : null}
      </Link>

      <nav className="nav-links" aria-label="Main">
        <NavLink className={linkClass} to="/" end>Home</NavLink>
        <NavLink className={linkClass} to="/decks">Deck builder</NavLink>
        <NavLink className={linkClass} to="/play">Play</NavLink>
      </nav>

      <div className="spacer" />
      {children}
    </header>
  )
}

/** NavLink marks the route it is on; `aria-current="page"` comes for free. */
function linkClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'nav-link active' : 'nav-link'
}

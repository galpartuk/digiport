import { hashPayload, hashWithoutPayload } from './share'

/**
 * A shared deck arriving in the URL, on its way to the deck builder.
 *
 * Share links come in two shapes — the current `#/?d=<code>` and the original
 * `#d=<code>`, which is already out in the world — and both mean the same
 * thing: "open this deck in the deck builder". The builder no longer sits at
 * `/`, so the payload is lifted out of the hash here rather than inside the
 * builder: once, at module scope, before React mounts and before the router
 * has read the hash. It is then held until the builder has actually adopted
 * it, and the home route forwards to `/decks` while one is waiting.
 *
 * Reading it here rather than in a component matters for three reasons: a
 * `#d=<code>` hash would otherwise read as the route `/d=<code>`; StrictMode
 * throws its first effect pass away, so "read it" and "used it" have to be two
 * separate moments; and the builder unmounts whenever another route is open.
 */

let pending: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const fn of [...listeners]) fn()
}

/** Where a shared deck is going, now that the builder is not at `/`. */
const BUILDER = '#/decks'

/**
 * Takes any deck payload out of the URL, leaving a route behind, and holds it.
 * Returns the code, or null when the hash carries none.
 *
 * Both share forms name `/`, which is the home page now — so the route left
 * behind for those is the builder, not the root. That is not cosmetic: it
 * means a link pasted into a tab already sitting on `/decks` never leaves the
 * builder, where a bounce out to `/` and back would unmount it mid-decode and
 * throw the adopted deck away with it. A payload that arrived on some other
 * route — a hand-written `#/?from=chat&d=…`, say — keeps that route and is
 * forwarded by the home page instead.
 */
export function captureSharedCode(): string | null {
  const code = hashPayload(location.hash)
  if (!code) return null
  const rest = hashWithoutPayload(location.hash)
  const route = rest === '#/' ? BUILDER : rest
  history.replaceState(null, '', location.pathname + location.search + route)
  pending = code
  return code
}

/** The deck waiting to be adopted, if any. Safe to read during a render. */
export function pendingSharedCode(): string | null {
  return pending
}

/**
 * Called once the builder has adopted the deck — or has found it unreadable,
 * which also clears it, so a corrupt link cannot bounce the visitor between
 * the home page and the builder forever.
 */
export function clearSharedCode(code: string): void {
  if (pending !== code) return
  pending = null
  emit()
}

export function subscribeSharedCode(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

// Module scope: this runs on import, which is before `createRoot` and so
// before the router first looks at the hash.
captureSharedCode()

// A link pasted into a tab that is already open arrives as a hashchange. This
// listener is registered on import too, ahead of the router's own, so the
// payload is gone from the hash by the time the router reads it.
window.addEventListener('hashchange', () => {
  if (captureSharedCode()) emit()
})

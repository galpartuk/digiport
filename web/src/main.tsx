import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { App } from './App'
import { Home } from './Home'
import { Play } from './board/Play'
import './styles.css'

/**
 * Hash routing, not paths. The build ships to GitHub Pages under
 * /digiport/, which serves files and nothing else: a reload on a real
 * /digiport/play would 404 because there is no SPA fallback to rewrite it.
 * A hash keeps every route inside one served document.
 *
 * The hash is shared with deck links, which is why share.ts emits
 * `#/?d=<code>` — a route the router understands with the payload as an
 * ordinary query parameter — while still reading the older `#d=<code>`.
 * Both of those name `/`, which is now the home page rather than the builder.
 * The payload is therefore lifted out of the hash before this file runs
 * (sharedDeck.ts), which points the link at `/decks` on its way past; `/`
 * forwards any deck still waiting when it renders. Either way a share link
 * ends with the deck imported and open in the builder.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/decks" element={<App />} />
        <Route path="/play" element={<Play />} />
        {/* An unknown route lands on the home page rather than a blank one. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)

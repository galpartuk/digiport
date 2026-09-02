import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { App } from './App'
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
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/play" element={<Play />} />
        {/* An unknown route lands on the builder rather than a blank page. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)

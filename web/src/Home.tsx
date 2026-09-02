import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { COLORS, loadCards, type CardIndex, type Meta } from './cards'
import { loadDecks, stats, total, validate, type Deck } from './deck'
import { Nav } from './Nav'
import { PRESETS } from './presets'
import { pendingSharedCode, subscribeSharedCode } from './sharedDeck'

/**
 * The front page.
 *
 * It is also the backstop for a share link. Both share forms name `/` — the
 * emitted `#/?d=…` and the original `#d=…` — and the payload is out of the
 * hash before anything renders (see sharedDeck.ts). A plain share link is
 * pointed straight at the builder there; anything that still arrives here
 * holding a deck, such as `#/?from=chat&d=…`, is forwarded, because a shared
 * deck belongs in the builder either way.
 */

/** The game's own palette, keyed the way the card data spells the colours. */
const COLOR_VAR: Record<string, string> = {
  Red: 'var(--c-red)',
  Blue: 'var(--c-blue)',
  Yellow: 'var(--c-yellow)',
  Green: 'var(--c-green)',
  Black: 'var(--c-black)',
  Purple: 'var(--c-purple)',
  White: 'var(--c-white)',
}

type Row = {
  deck: Deck
  main: number
  eggs: number
  colors: string[]
  /** null until the card index has loaded — legality is judged with it. */
  errors: number | null
}

function rowsFor(decks: Deck[], index: CardIndex | null): Row[] {
  return decks.map((deck) => {
    const byColor = index ? stats(deck, index).byColor : {}
    const colors = COLORS.filter((c) => (byColor[c] ?? 0) > 0)
    return {
      deck,
      main: total(deck.main),
      eggs: total(deck.eggs),
      colors,
      errors: index ? validate(deck, index).filter((p) => p.level === 'error').length : null,
    }
  })
}

export function Home() {
  // A deck waiting in the URL. Read through the store so a link pasted into
  // this tab while the home page is open is picked up too.
  const incoming = useSyncExternalStore(subscribeSharedCode, pendingSharedCode, pendingSharedCode)

  // Newest first: "what was I working on" is the question this page answers.
  const decks = useMemo(
    () => loadDecks().slice().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [],
  )
  const [index, setIndex] = useState<CardIndex | null>(null)
  const [meta, setMeta] = useState<Meta | null>(null)

  useEffect(() => {
    if (incoming) return
    let live = true
    if (decks.length) {
      loadCards().then((loaded) => {
        if (!live) return
        setIndex(loaded)
        setMeta(loaded.meta)
      }).catch(() => {})
    } else {
      // Nothing on this page needs a card when there are no decks to judge, so
      // a first-time visitor gets the headline numbers without the card
      // payload behind them.
      fetch(`${import.meta.env.BASE_URL}data/meta.json`)
        .then((r) => r.json() as Promise<Meta>)
        .then((m) => { if (live) setMeta(m) })
        .catch(() => {})
    }
    return () => { live = false }
  }, [decks.length, incoming])

  const rows = useMemo(() => rowsFor(decks, index), [decks, index])
  const shown = rows.slice(0, 6)
  const playable = rows.find((r) => r.errors === 0)

  // A shared deck belongs in the builder, selected. The root route only ever
  // holds it for the length of one render.
  if (incoming) return <Navigate to="/decks" replace />

  const goldfish = playable
    ? `/play?mode=goldfish&deck=${encodeURIComponent(playable.deck.id)}`
    : '/play?mode=goldfish'

  return (
    <div className="app">
      <Nav />

      <main className="home">
        <section className="home-hero">
          <div className="home-colors" aria-hidden="true">
            {COLORS.map((c) => (
              <i key={c} style={{ background: COLOR_VAR[c] }} />
            ))}
          </div>

          <h1>Build it, then actually play it.</h1>
          <p className="home-lede">
            Digiport is a fan-made Digimon Card Game deck builder and play client that runs
            entirely in your browser. Every English-legal card, validation against the 50 main
            deck / 5 Digi-Egg deck limits and the ban list, and a manual board with the assists
            a kitchen table cannot give you: a memory gauge that flips at 0 and ends the turn, a
            security stack that stays fanned and countable, a breeding area kept properly
            separate, and digivolution stacks that remember what is underneath them.
          </p>

          <div className="home-cta">
            <Link className="btn btn-primary home-btn" to="/decks">Build a deck</Link>
            <Link className="btn home-btn" to={goldfish}>Goldfish a deck</Link>
            <Link className="btn home-btn" to="/play?mode=hotseat">Hotseat</Link>
          </div>

          {meta && (
            <ul className="home-stats">
              <li><b>{meta.count.toLocaleString()}</b> cards</li>
              <li><b>{meta.sets.length}</b> sets</li>
              <li><b>{meta.banned.length + meta.restricted.length}</b> on the ban list</li>
              <li><b>no</b> account, <b>no</b> server</li>
            </ul>
          )}
        </section>

        <section className="home-section">
          <h2>Your decks</h2>
          {decks.length === 0 ? (
            <div className="home-empty">
              <p>
                Nothing saved on this device yet. Decks live in this browser's storage — there is
                no account and nothing to sign up for — so the first one is a blank slate.
              </p>
              <p className="hint">
                Already have a list somewhere? The builder's <b>Import</b> tab reads the plain{' '}
                <code>4 BT1-010</code> format that the rest of the community exports, and its{' '}
                <b>Share</b> tab turns a deck into a single link you can paste into a chat.
              </p>
              <div className="home-empty-actions">
                <Link className="btn btn-primary home-btn" to="/decks">Build your first deck</Link>
                <Link className="btn home-btn" to="/decks?io=presets">
                  Start from a ready-made deck
                </Link>
              </div>
              <p className="hint">
                {PRESETS.length === 1
                  ? `“${PRESETS[0].name}” is complete and legal — add it and you can be on the board in two clicks.`
                  : `${PRESETS.length} complete, legal decks are ready to add.`}
              </p>
            </div>
          ) : (
            <>
              <div className="home-decks">
                {shown.map((row) => (
                  <article className="home-deck" key={row.deck.id}>
                    <Link
                      className="home-deck-name"
                      to={`/decks?deck=${encodeURIComponent(row.deck.id)}`}
                    >
                      {row.deck.name || 'Untitled deck'}
                    </Link>

                    <div className="home-deck-meta">
                      <span className="home-dots">
                        {row.colors.map((c) => (
                          <i key={c} title={c} style={{ background: COLOR_VAR[c] }} />
                        ))}
                      </span>
                      <span>{row.main} main · {row.eggs} egg{row.eggs === 1 ? '' : 's'}</span>
                    </div>

                    <div className="home-deck-foot">
                      {row.errors === null ? (
                        <span className="home-pill">saved</span>
                      ) : row.errors === 0 ? (
                        <span className="home-pill ok">legal</span>
                      ) : (
                        <span className="home-pill bad">
                          {row.errors} problem{row.errors === 1 ? '' : 's'}
                        </span>
                      )}
                      <span className="spacer" />
                      <Link
                        className="btn btn-sm"
                        to={`/decks?deck=${encodeURIComponent(row.deck.id)}`}
                      >
                        Edit
                      </Link>
                      {row.errors === 0 && (
                        <Link
                          className="btn btn-sm btn-primary"
                          to={`/play?mode=goldfish&deck=${encodeURIComponent(row.deck.id)}`}
                          title={`Goldfish “${row.deck.name}” against an empty seat`}
                        >
                          Goldfish
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {rows.length > shown.length && (
                <p className="hint">
                  <Link className="home-more" to="/decks">
                    {rows.length - shown.length} more in the deck builder →
                  </Link>
                </p>
              )}
            </>
          )}
        </section>

        <section className="home-section">
          <h2>Three ways in</h2>
          <div className="home-ways">
            <Link className="home-way" to="/decks">
              <h3>Build a deck</h3>
              <p>
                Filter the whole English pool by colour, level, cost, type and trait, and watch
                the cost curve and colour spread move as you add cards. The 4-copy cap, the ban
                list and the 50 + 5 counts are checked while you type, not at the end. Import and
                export in the plain-text list format every other Digimon site already speaks.
              </p>
              <span className="home-way-go">Open the builder →</span>
            </Link>

            <Link className="home-way" to={goldfish}>
              <h3>Goldfish a deck</h3>
              <p>
                Deal a hand against a seat that only ever passes, and see how the deck actually
                opens: hatch out of the Digi-Egg deck, move up from the breeding area, spend down
                the memory gauge, check security. The fastest way to find out that your curve is
                a card too heavy.
              </p>
              <span className="home-way-go">
                {playable ? `Goldfish “${playable.deck.name}” →` : 'Pick a deck →'}
              </span>
            </Link>

            <Link className="home-way" to="/play?mode=hotseat">
              <h3>Hotseat</h3>
              <p>
                Two players, one screen, one turn each. The board covers itself between turns so
                that neither hand nor security is on show when the device changes hands, and the
                full action log means you can always settle what just happened. Online play over
                a real server is the next phase.
              </p>
              <span className="home-way-go">Start a hotseat game →</span>
            </Link>
          </div>
        </section>

        <footer className="home-foot">
          <p>
            Digiport is an unofficial fan project. It is not affiliated with, endorsed by or
            sponsored by Bandai. Digimon and the Digimon Card Game are trademarks of their
            respective owners; all card text and art belong to them. Nothing here is sold, and
            the project will be taken down on request from the rights holders.
          </p>
        </footer>
      </main>
    </div>
  )
}

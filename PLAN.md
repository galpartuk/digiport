# Digiport — Digimon TCG deck builder + play client

Fan-made, non-commercial, in-browser Digimon Card Game simulator in the spirit of
Project Drasil (project-drasil.online). Own code, own design; Drasil's repo has
no licence so nothing is copied from it.

## What Drasil is (so we know what we're matching)

- React 19 + TS + Vite + MUI + zustand frontend, Java Spring Boot backend over
  WebSockets, Python bots. ~1.4M lines total across 1,459 commits.
- **Manual / tabletop** simulator: no rules engine. Players drag cards, set
  memory, flip security themselves. The server just relays state.
- Deck builder, lobby with player list, game board, chat, bots (being rebuilt),
  spectator + desktop client on the roadmap.

## Core decision: manual board with "assists", not a rules engine

A full rules engine for 4,399 cards of free-text effects is a multi-year job
(every set adds ~100 new effects to script). Drasil proved the tabletop model
is what players accept. We do the same, but with assists a tabletop can't give:

- memory gauge that flips ownership at 0 automatically and ends the turn
- digivolution stacks as real objects (stack, un-stack, inherited effects shown)
- security stack with count, reveal-one, add-to-top/bottom, shuffle
- phase tracker (Unsuspend → Draw → Breeding → Main → End) with auto-draw
- DP / +1000 counters, suspend/unsuspend, "tap all" at unsuspend phase
- attack targeting arrows, security-battle helper (compare DP, prompt outcome)
- hidden information kept server-side (deck order, hand, opponent security)
- full action log, undo by mutual consent, replay from the log

Scripted effects for common keywords (Blocker, Rush, Piercing, Draw N,
Recovery+N, Security Attack +N) come later as an opt-in layer on top of that.

## Architecture

```
digiport/
  build_cards.py          digimondle cards.json -> web/public/data/cards.json (done)
  web/                    Vite + React 18 + TS, no UI framework (own CSS)
    src/cards.ts          card index + image URL expansion (done)
    src/deck.ts           deck model, limits, validation (done)
    src/components/       CardGrid / Filters / CardDetail (done), DeckPanel (todo)
    src/game/             PURE state + reducer: applyAction(state, action) -> state
    src/board/            React board UI driven only by game/ state
    src/net/              WebSocket client; solo mode uses the reducer locally
  server/                 Cloudflare Worker + Durable Objects
    Lobby DO              room list, matchmaking queue
    Room DO (one/game)    authoritative game state, per-player views, chat
```

- **Game logic is a pure reducer** with an append-only action log. The same
  code runs client-side in solo/hotseat mode and server-side in the Room DO.
  That makes it unit-testable without a browser and gives replay for free.
- **Server authority + per-player projection.** The DO holds the true state;
  each socket receives only what that player may see (own hand, deck as a
  count, opponent's hand as a count, security face-down). Cheating by editing
  client state becomes impossible.
- **Hosting: Cloudflare Workers + Durable Objects** — same account and deploy
  flow as tcgdles.com, DOs are on the free plan, WebSocket hibernation means an
  idle room costs nothing. Fallback if DOs annoy us: Node `ws` server in Docker
  on all-good.co.il, same reducer code.
- **Data** comes from the digimondle pipeline (TakaOtaku MIT + digimoncard.io).
  Rebuild after each set: run digimondle's fetch/build, then `build_cards.py`.
- **Images** hotlinked from digimoncard.app with digimoncard.io fallback, like
  digimondle. A game loads ~110 images per player; if hosts complain, mirror to
  Cloudflare R2 behind the worker.
- **Accounts: none at first.** Decks in localStorage + export/import text +
  share-by-URL. Rooms joined by 6-char code. Accounts (Google/Discord login,
  cloud decks, stats) are a later phase and change nothing in the game code.

## Phases

### Phase 0 — Deck builder — DONE, live at galpartuk.github.io/digiport
- [x] card payload, index, filters, grid, detail panel
- [x] deck panel: main 50 / eggs 0-5, 4-copy cap, ban list, colour + level curve
- [x] validation messages, deck list persistence (localStorage), rename/duplicate/delete
- [x] import/export in the common text format (`4 BT1-010`), which Drasil,
      digimoncard.dev and TTS all read — instant migration for existing players
- [x] share deck via URL (compressed card list in the hash)
- [x] deploy as a static site — GitHub Pages, tests gate the deploy
- [x] sort the grid by name / number / cost / level / DP / set release
- [x] trait filter, with traits and sets folded into a searchable picker

### Phase 1 — Board, solo & hotseat — DONE
- [x] `game/` types: zones, card instances with stack + attached, suspended,
      DP mods, memory, turn, phase
- [x] actions: draw, mulligan, hatch, move, digivolve, de-digivolve, attach,
      suspend, memory, security check/reveal, shuffle, counters, concede, chat
- [x] reducer + tests (vitest): every action, undo, log replay, random walk
- [x] board UI: dnd-kit drag & drop, context menus, hover card, mirrored
      opponent, phase bar, memory gauge, log panel
- [x] "Goldfish" mode: play against an empty seat to test decks
- [x] hotseat: both players on one screen, pass-device scrim between turns

### Phase 1.5 — App shell and navigation (next)

The deck builder is currently the front page, which is wrong: it is one tool
among several and it is the least useful thing to land a first-time visitor on.

- [ ] a real home page at `/` — what Digiport is, what you can do, entry points
      to build a deck / goldfish / hotseat, and the Bandai disclaimer
- [ ] move the deck builder to its own route (`/decks`) and the board stays at
      `/play`
- [ ] a persistent top nav across every route, with the current one marked
- [ ] **share links must keep working.** Today's links are `#/?d=<payload>` and
      the older `#d=<payload>`, both of which mean "open this deck in the
      builder". Moving the builder off `/` must not break either; the root route
      has to keep adopting a `d=` payload and then send the user to the builder.
- [ ] the board is full-screen and has its own Exit; it should not grow a second
      nav bar on top of the rail

### Known gaps left by Phase 1

Worth closing before or during Phase 2, since online play makes them worse:

- [ ] **Your own security stack is hidden from you**, so `flip` on a specific
      security card has no reachable instance id. Same root cause as hatching
      (which got a positional `hatch` action); this wants the same treatment.
- [ ] **You cannot suspend, shrink or otherwise touch an opponent's Digimon.**
      The reducer only lets you push an opponent's card to reveal/trash/hand/
      deck/security. A great many real cards ask for exactly this, so the
      ownership rule needs widening — deliberately, with tests.
- [ ] **Security → Play is disabled**, because the revealed card sits in the
      opponent's reveal area and `move` to battle is not permitted for it.
      Falls out of the same rule.
- [ ] attack targeting arrows and the security-battle helper (compare DP,
      prompt outcome) from the assists list are not built yet

### Phase 2 — Online play (~2 weeks)
- [ ] Room Durable Object: state, action validation (is it your turn / your
      card), per-player projection, reconnect with resync, spectator sockets
- [ ] Lobby: create room (code), open rooms list, quick-match queue
- [ ] deck submitted at join, shuffled server-side, hand dealt server-side
- [ ] chat, emotes, timer (optional), undo request/accept, rematch
- [ ] deploy worker; wire into the deck builder ("Play with this deck")

### Phase 3 — Polish & growth (ongoing)
- [ ] mobile/tablet layout, sound, animations, keyboard shortcuts
- [ ] keyword assists (Blocker prompt, Rush, Draw N, Recovery) as opt-in
- [ ] accounts + cloud decks + match history; ELO ladder
- [ ] bots (simple scripted opponent for goldfishing)
- [ ] link from tcgdles.com / Digimondle; Ko-fi like the other projects

## Risks

- **Drag-and-drop on a dense board** is where these projects live or die.
  Budget time for it; test on touch early.
- **Image hosts**: a full game hotlinks hundreds of images. R2 mirror is the
  fix; keep the host-code indirection so switching is a one-line change.
- **Bandai IP**: same footing as Drasil and the -dles — non-commercial, clear
  disclaimer, take-down on request.
- **Scope creep toward a rules engine.** Say no until Phase 3 and only for
  keywords, never for card-specific text.

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

### Phase 0 — Deck builder (in progress, ~1 week)
- [x] card payload, index, filters, grid, detail panel
- [ ] deck panel: main 50 / eggs 0–5, 4-copy cap, ban list, colour + level curve
- [ ] validation messages, deck list persistence (localStorage), rename/duplicate/delete
- [ ] import/export in the common text format (`4 BT1-010`), which Drasil,
      digimoncard.dev and TTS all read — instant migration for existing players
- [ ] share deck via URL (compressed card list in the hash)
- [ ] deploy as static site (Cloudflare Pages / tcgdles worker) to get feedback early

### Phase 1 — Board, solo & hotseat (~3–4 weeks)
- [ ] `game/` types: zones (deck, hand, security, breeding egg deck, breeding
      area, battle area, trash, reveal), card instances with stack + attached
      (plug-ins, link cards), suspended flag, DP mods, memory, turn, phase
- [ ] actions: draw, mulligan, hatch, move (any zone→zone, top/bottom), digivolve
      onto, de-digivolve, attach, suspend, set memory, security check/reveal/
      recover, shuffle, reveal hand/deck top N, counters, concede, chat
- [ ] reducer + tests (vitest): every action, undo, log replay
- [ ] board UI: drag & drop (dnd-kit or pointer events), context menus,
      zoom-on-hover card, opponent view mirrored, phase bar, memory gauge, log panel
- [ ] "Goldfish" mode: play against an empty seat to test decks
- [ ] hotseat: both players on one screen, hidden zones blurred per turn

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

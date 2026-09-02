# Digiport — implementation brief

You are building **Digiport**: a fan-made, non-commercial, in-browser Digimon
Card Game deck builder + play client, in the spirit of Project Drasil
(project-drasil.online, github.com/WE-Kaito/digimon-tcg-simulator). Drasil has
no licence file, so **do not copy code or assets from it**; it is a reference
for feature parity only. Read `PLAN.md` first for the overall product plan.
This file is the work order: do the tasks in order, one commit per task.

The product decision is already made and is not up for debate: this is a
**manual tabletop simulator with assists, not a rules engine.** No card-text
scripting, ever, in this brief.

---

## 0. Environment and conventions

- Windows 11, PowerShell. Node + npm are installed; `web/node_modules` exists.
  Python 3 is on PATH.
- Project root: `C:\Users\Owner\digiport`. Not yet a git repo. `git init` on
  the first task, commit after every task with a message that names the task.
- Card data source of truth is the sibling project `C:\Users\Owner\digimondle`
  (`data/build/cards.json`, 4,399 cards, built from TakaOtaku MIT data +
  digimoncard.io). **Never edit anything in digimondle.** `build_cards.py` in
  this repo trims it into `web/public/data/cards.json` + `meta.json`; both are
  already generated.
- Frontend: Vite 6 + React 18 + TypeScript, strict mode, `noUnusedLocals`.
  **No UI framework, no CSS-in-JS.** All styling in `web/src/styles.css` using
  the CSS variables already defined there. Add dependencies only when a task
  says so.
- Pure logic lives in `.ts` files with no React import and gets vitest tests.
  React components stay thin.
- The user's standing rule: **an option is an added control, never a changed
  behaviour.** Do not alter how existing things work when adding new ones.
- Dev server: `cd web; npm run dev` → http://localhost:5180. Build check:
  `npm run build` must pass with zero TypeScript errors before each commit.
- Card images are hotlinked. `imageUrl(card, meta, attempt)` walks a host list
  on `onError`; use that helper everywhere an image is shown.

## 1. What already exists (read these files before writing anything)

```
build_cards.py                    digimondle -> web/public/data/{cards,meta}.json   DONE
web/index.html                    mounts /src/main.tsx (which does NOT exist yet)
web/src/cards.ts                  Card type, loadCards(), imageUrl(), Filters,
                                  filterCards(), sortCards(), COLORS/CARD_TYPES/FORMS DONE
web/src/deck.ts                   Deck {id,name,main,eggs,updatedAt}, newDeck, addCard
                                  (respects copyLimit / ban list), validate(), stats(),
                                  exportText(), importDeck() (text + JSON from
                                  digimoncard.dev / Drasil), loadDecks/saveDecks
                                  (localStorage key digiport.decks.v1)              DONE
web/src/components/Filters.tsx    FilterPanel: chips for colour/type/level/cost/form/set DONE
web/src/components/CardGrid.tsx   infinite-scroll grid; click = add, right-click =
                                  remove, hover -> onHover(card, mouseEvent)         DONE
web/src/components/CardDetail.tsx floating hover panel with art + effect text        DONE
web/src/styles.css                full stylesheet, including classes for pieces that
                                  do not exist yet: .app .topbar .brand .deck-switch
                                  .workspace .col .col-filters .col-deck .deck-head
                                  .deck-name .counters .counter .deck-scroll
                                  .deck-group .deck-row .step .stats .bar-row .bar
                                  .color-bar .problems .problem .modal-scrim .modal
                                  .hint .loading
```

Missing: `main.tsx`, `App.tsx`, the deck panel, the import/export modal, any
tests, everything under `server/`, everything about the game board.

---

## Phase 0 — Deck builder (finish it, ship it)

### Task 0.1 — App shell
Create `web/src/main.tsx` (React root, imports `styles.css`) and
`web/src/App.tsx`:
- `loadCards()` on mount; show `.loading` until ready.
- Layout `.app` > `.topbar` + `.workspace` with three `.col`s:
  `.col-filters` (FilterPanel), middle (grid head with result count + a
  search `.field`, then CardGrid), `.col-deck` (DeckPanel from 0.2).
- State: `filters`, `decks: Deck[]` (from `loadDecks()`), `currentId`,
  `hover: {card,x,y} | null`. Persist decks with `saveDecks` on every change
  (debounce 300 ms).
- The search box drives `filters.text`; filtering runs in `useMemo` over
  `filterCards` then `sortCards`.
- Hover renders `<CardDetail>` at the cursor; the grid's `onHover` already
  passes the mouse event, take `clientX/clientY` from it.
- Grid `onAdd/onRemove` call `addCard(deck, card, ±1)`.
- If there are no decks, create one named "New deck" so the panel is never
  empty.

Acceptance: app renders, filters narrow the grid, clicking a tile puts a
count badge on it, reload keeps the deck.

### Task 0.2 — Deck panel (`web/src/components/DeckPanel.tsx`)
- `.deck-head`: editable `.deck-name` (input; blur or Enter commits), a
  `.deck-switch` select of all decks, plus New / Duplicate / Delete buttons
  (Delete asks with an inline "Sure? Yes / No", **not** `window.confirm`).
- `.counters`: Main `n/50`, Eggs `n/5`; turn red when invalid.
- `.deck-scroll` with `.deck-group`s in this order: Digi-Eggs, Digimon
  grouped by level (Lv.2 … Lv.7), Tamers, Options. Each `.deck-row`: 28 px
  art thumbnail (same `imageUrl` fallback), name, id, colour dot(s), and a
  `.step` −/count/+ control. Row hover calls the same `onHover` as the grid.
- `.stats`: `stats()` rendered as `.bar-row`s: play-cost curve 0…10+, level
  distribution, and one `.color-bar` showing colour share.
- `.problems`: `validate()` output, errors before warnings.
- Buttons: **Import**, **Export**, **Share** (see 0.3), **Clear**.

Acceptance: build a legal 50+5 deck entirely from the UI; every count and
problem message updates live; switching decks swaps everything.

### Task 0.3 — Import / Export / Share modal
`web/src/components/DeckIO.tsx`, rendered in `.modal-scrim > .modal`.
- Import tab: textarea + "Import as new deck" / "Replace current". Uses
  `importDeck()`. Show `missing` ids as a `.problem` list; still import the
  rest. Pasting a `.json` export from digimoncard.dev or Drasil must work
  (deck.ts already parses that shape; verify with a test).
- Export tab: readonly textarea with `exportText()`, a Copy button, and a
  "Download .txt" link. Plain text, `4 BT1-010 Agumon` per line, which is
  the format Drasil, digimoncard.dev and Tabletop Simulator all read.
- Share: encode the deck as `#d=<base64url(deflate-raw(JSON{n,m,e}))>` in the
  URL hash using the browser's `CompressionStream`, no dependency. On load,
  if the hash is present, decode it, add it as a new deck named from the
  payload, and clear the hash. Round-trip test in vitest (Node 18+ has
  `CompressionStream` globally).

### Task 0.4 — Tests
`npm i -D vitest` and add `"test": "vitest run"`. Cover:
- `deck.ts`: addCard caps at 4 / 1 / 0 by restriction; eggs land in `eggs`;
  validate reports every error class; exportText → importDeck round-trips
  exactly; importDeck accepts `4 BT1-010`, `BT1-010 x4`, `4x BT1-010`,
  `BT1-10` (zero-pad), `BT1-010_P1` (alt art), and the JSON shape.
- `cards.ts`: filterCards for each filter field; `colorsExact` both ways;
  the `costs` 10+ bucket.
Load the real `web/public/data/cards.json` in tests (via `fs`) so fixtures
are the real pool.

### Task 0.5 — Deploy config and README
- `npm run build` → `web/dist`. Add `wrangler.toml` at repo root for a
  Cloudflare Worker named `digiport` serving `web/dist` as static assets.
  Mirror the pattern in `C:\Users\Owner\PycharmProjects\tcgdles\wrangler.toml`
  (read it), but **do not run `wrangler deploy` from this machine**; the user
  deploys. Add `.github/workflows/deploy.yml` that builds, tests, and runs
  `wrangler deploy` on push to `main` using secrets `CLOUDFLARE_API_TOKEN`
  and `CLOUDFLARE_ACCOUNT_ID`.
- Add `README.md`: what it is, how to run, how to refresh card data after a
  new set (`python fetch_data.py; python build_dataset.py` in digimondle,
  then `python build_cards.py` here), and the Bandai non-affiliation
  disclaimer.

Stop here and report. Phase 1 starts only after the user has seen Phase 0.

---

## Phase 1 — Game board, solo & hotseat (no server yet)

Everything in this phase is client-only. The state model and reducer written
here run unchanged inside the server later, so `web/src/game/` must stay free
of React, DOM and `window`.

### Task 1.1 — Game model (`web/src/game/types.ts`)

```ts
export type PlayerId = 0 | 1
export type Zone =
  | 'deck' | 'hand' | 'security' | 'eggDeck' | 'breeding'
  | 'battle' | 'trash' | 'reveal'            // reveal = temporary face-up area
export type Iid = string                     // instance id, unique per game

export type CardInstance = {
  iid: Iid
  cardId: string                             // e.g. "BT1-010"
  owner: PlayerId
  faceDown: boolean                          // true in deck / security / eggDeck
  suspended: boolean
  dpMod: number                              // ±1000 modifiers
  counters: number                           // generic counters
  /** digivolution sources beneath this card, bottom first. Card ids only;
      sources are not instances. */
  stack: string[]
  /** plug-ins / link cards attached to this card, top first. */
  attached: CardInstance[]
}

export type PlayerState = {
  name: string
  deck: CardInstance[]        // index 0 = top
  eggDeck: CardInstance[]
  hand: CardInstance[]
  security: CardInstance[]    // index 0 = top
  breeding: CardInstance[]    // 0 or 1 in practice; keep it a list
  battle: CardInstance[]      // Digimon, Tamers, delayed Options, display order
  trash: CardInstance[]       // index 0 = most recent
  reveal: CardInstance[]
  deckList: { main: Record<string, number>; eggs: Record<string, number> }
}

export type Phase = 'unsuspend' | 'draw' | 'breeding' | 'main' | 'end'

export type GameState = {
  seed: number                 // for deterministic shuffles
  rngState: number             // advanced by every shuffle; part of the state
  players: [PlayerState, PlayerState]
  turnPlayer: PlayerId
  turn: number                 // 1-based
  phase: Phase
  memory: number               // 0..10, always from the turn player's side
  firstPlayer: PlayerId
  winner: PlayerId | null
  log: LogEntry[]
  nextIid: number
}

export type LogEntry = { n: number; by: PlayerId | 'system'; text: string; action?: Action }
```

Memory rule to implement exactly: the gauge is −10…+10 physically, but the
state stores it from the turn player's perspective as `memory` (0…10 on their
side). `payMemory(cost)` subtracts. When the result would be below 0 the turn
ends automatically: the reducer applies `endTurn`, which flips `turnPlayer`,
sets `memory` to the overshoot on the new player's side (clamped to 10),
sets phase → `unsuspend`, and increments `turn`. `setMemory(value)` accepts
−10…10 and follows the same crossing rule. Explicit `endTurn` while memory
is still 0…10 on the ending player's side follows the official start-of-turn
rule: the new turn player begins with **3** memory (comprehensive rules: if
the marker is at 0 or on the turn player's side at the start of the turn, it
is set to 3 on the turn player's side). Write the test for both paths before
the reducer.

### Task 1.2 — Actions and reducer (`web/src/game/actions.ts`, `reducer.ts`)

Every action carries `by: PlayerId`. The reducer is
`apply(state, action): GameState`, pure, throws a typed `IllegalAction`
with a reason, never mutates. Use a seeded PRNG (mulberry32 over `rngState`).

| Action | Effect |
|---|---|
| `setup {decks, names, firstPlayer}` | build instances from both deck lists, shuffle both decks with the seed, deal 5 to hand then 5 face-down to security for each player, memory 0, phase `main`, turn 1. **Turn 1 for the first player has no draw.** |
| `mulligan` | only before that player's first other action in turn 1, once: shuffle hand back, redraw 5. |
| `draw {n}` | top n of deck → hand. Drawing from an empty deck sets `winner = opponent`. |
| `shuffleDeck` / `shuffleSecurity` | reshuffle that pile. |
| `move {iid, to: Zone, position?: 'top' \| 'bottom' \| number, faceDown?}` | any instance from any zone to any zone. The universal escape hatch: play from hand, trash, bottom-deck, return to hand, recovery (hand/deck → security), hatch (eggDeck top → breeding), promote (breeding → battle). Moving out of `battle` or `breeding` to anywhere but `battle`/`breeding` sends the stack and attached cards to trash too. |
| `digivolve {sourceIid, cardIid}` | card from hand, reveal, or another battle-area Digimon (DNA: that Digimon's stack merges under) goes on top: the instance keeps `suspended`, `dpMod`, `attached`; `stack = [...stack, previousCardId]`; `cardId` becomes the new card. |
| `deDigivolve {iid, n}` | pop n: the current top card goes to trash and the last stack entry becomes `cardId`. A card with an empty stack is trashed instead. |
| `attach {iid, targetIid}` | hand/battle card becomes `attached[0]` of the target. |
| `suspend {iid}` / `unsuspend {iid}` / `unsuspendAll` | flags. |
| `setDp {iid, delta}` / `setCounters {iid, delta}` | numbers. |
| `setMemory {value}` / `payMemory {cost}` | see the memory rule; may trigger `endTurn`. |
| `nextPhase` | unsuspend → draw → breeding → main → end → `endTurn`. Leaving `unsuspend` applies `unsuspendAll`; entering `draw` applies `draw 1`, except for the first player on turn 1. |
| `endTurn` | explicit; same as memory-driven. |
| `securityCheck` | top card of the **opponent's** security → that opponent's `reveal`, face-up. A follow-up `move` handles trash / hand / play. |
| `revealTop {n}` / `revealHand` | move top n deck cards to `reveal` (revealHand: all hand cards; they must be moved back with `move`). |
| `flip {iid}` | toggle faceDown, for showing a security card without removing it. |
| `concede` | winner = the other player. |
| `chat {text}` | log only. |
| `undoRequest` / `undoAccept` / `undoDecline` | accept → state replaced by replaying the log minus the last state-changing action. In solo/hotseat, `undoRequest` is auto-accepted. |

Rules enforced by the reducer (the assist layer, nothing more):
- a player acts only on their own cards, except a `move` of an opponent's
  card **into** `reveal` / `trash` / `hand` / `deck` / `security` (effects
  like "return 1 of your opponent's Digimon to hand" are done by the acting
  player) and `securityCheck`.
- `nextPhase`, `endTurn`, `payMemory`, `draw` are turn-player only.
- an instance is in exactly one place; assert this in tests after every
  action.

The reducer generates the log text in plain English, e.g.
"Gal plays Agumon (BT1-010) from hand", "Memory 3 → −2, turn passes to
Daniel". Never put hidden card ids into log text (a draw logs "draws 1").

### Task 1.3 — Replay and tests
- `replay(actions[]): GameState` folds `apply` from the `setup` action. Undo
  is replay minus the last action.
- vitest: setup deals correctly and deterministically for a fixed seed; the
  memory crossing rule; draw from an empty deck loses; digivolve keeps
  suspended + attached and grows the stack; deDigivolve reverses it; moving
  a stacked Digimon to trash trashes its sources; nextPhase auto-draw skips
  turn 1 for the first player only; ownership checks throw `IllegalAction`;
  every action type is covered at least once; a 200-action random walk over
  legal actions never throws, never duplicates an iid, and never loses a
  card (total instance count is constant).

### Task 1.4 — Player projection (`web/src/game/view.ts`)
`viewFor(state, viewer: PlayerId | 'spectator'): PlayerView`. Same shape as
`GameState`, but own deck / eggDeck / security are lists of face-down
instances with `cardId: null`; the opponent's hand is the same; `reveal`
zones are visible to everyone. **The board UI renders only a `PlayerView`,
never `GameState`**, so going online later needs no UI changes. The log is
passed through minus `action` payloads.

### Task 1.5 — Board UI (`web/src/board/`)
Add `react-router-dom` (allowed). `/` = deck builder, `/play` = board. Add
`@dnd-kit/core` + `@dnd-kit/utilities` for drag-and-drop (allowed). Nothing
else.

Layout, opponent on top mirrored, self at the bottom, in this order:
opponent hand (face-down fan, count) · opponent trash · deck · security
(fanned face-down) · opponent battle area · opponent breeding (left) ·
**memory gauge** as a horizontal 21-stop track in the exact middle with the
marker on the turn player's side · self breeding (left) · self battle area ·
self security (fanned) · deck · trash · self hand (fanned along the bottom).
Right rail: phase bar (5 steps, click to `nextPhase`, current one lit),
turn/memory readout, End Turn, Undo, Concede, and the log panel with chat
input, newest entry at the bottom.

Interactions (each maps to exactly one reducer action):
- drag a hand card to the battle area → `move to:'battle'`; drop onto a
  Digimon → `digivolve` (show a ghost outline on the drop target); drop onto
  a Digimon or Tamer with Shift held → `attach`.
- drag eggDeck top to breeding → `move`; drag a breeding Digimon to battle →
  `move`.
- drag any card to trash / deck top / deck bottom / security top / security
  bottom / hand: labelled drop zones appear while dragging.
- click a Digimon → suspend / unsuspend. Right-click → context menu (write a
  small `.ctx-menu` component; no library): Suspend, De-digivolve 1,
  DP +1000 / −1000, Counter + / −, Move to…, Reveal, Flip, Trash.
- click the opponent's security stack → `securityCheck` (main phase only).
  The assist shows "Security: <card>" and offers Trash / To hand / Play;
  each is a `move`.
- click a memory gauge stop → `setMemory`. Number keys 0–9 and a small cost
  strip under the gauge → `payMemory`.
- hover any face-up card → the existing `CardDetail` panel. Hovering a
  stacked Digimon fans its sources out so inherited effects are readable.
- a digivolution stack shows as offset card edges under the top card with a
  count; attached cards show as sideways tabs.
- keyboard: `D` draw, `S` shuffle deck, `Space` next phase, `E` end turn,
  `Ctrl+Z` undo.

### Task 1.6 — Solo and hotseat modes
- `/play?mode=goldfish&deck=<deckId>`: you vs an empty seat that only passes.
  The empty seat's phases advance automatically. This is the deck-testing
  mode.
- `/play?mode=hotseat&a=<deckId>&b=<deckId>`: both seats on one screen. The
  non-turn player's hand renders face-down, and a "Pass device" scrim covers
  the board on turn change until clicked. `viewFor` is called with the
  current turn player so nothing leaks.
- A **Play** button in the deck builder on a valid deck opens goldfish mode
  with it. No existing deck-builder behaviour changes.

Stop and report, with a screenshot of a mid-game board.

---

## Phase 2 — Online play (contracts only; implement after Phase 1 is approved)

- `server/` is a Cloudflare Worker (TypeScript, `wrangler`). Two Durable
  Objects: `Lobby` (open rooms list, quick-match queue) and `Room` (one per
  game). `Room` holds `GameState`, applies actions with **the same `apply()`
  from `web/src/game/`** (path alias or a shared workspace package, whichever
  is simplest while keeping one copy of the code), and broadcasts
  `viewFor(state, seat)` to each socket after every action. Use the
  WebSocket hibernation API so idle rooms cost nothing.
- Client protocol (JSON): `{t:'join', room, name, deck}` →
  `{t:'seat', seat, token, view}`; `{t:'act', action}` → `{t:'view', view}`
  to everyone, or `{t:'illegal', reason}` to the sender; `{t:'chat'}`;
  `{t:'undo'}` request / accept; `{t:'join', room, token}` resyncs after a
  reconnect.
- The seed is chosen server-side; clients never shuffle.
- Rooms are 6-character codes. Spectators receive `viewFor(state,'spectator')`.
- `web/src/net/` swaps the local reducer for the socket; the board UI is
  untouched because it only ever saw a `PlayerView`.

---

## Definition of done for every task
1. `npm run build` and `npm test` pass.
2. The dev server shows the feature working, and you actually exercised it.
3. One git commit, message `phase X.Y: <what>`.
4. Nothing in `digimondle/` touched; no dependency beyond the ones named.
5. Report: what was built, how it was verified, anything left open.

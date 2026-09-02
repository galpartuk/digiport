# How the game is actually played

Distilled from the **Digimon Card Game Comprehensive Rules** (`digimon_crm.pdf`,
48 pages). Section numbers below are the manual's own, so anything here can be
checked against the source.

Digiport is a **manual simulator with assists, not a rules engine** — it will
never read a card's effect text. But everything the *rules* say about areas,
turn structure, memory and the attack sequence is structural, applies to every
card, and is exactly what a board should make obvious. That is what this file
is for.

---

## 1. Areas (§3)

Six areas per player: **deck, Digi-Egg deck, field, hand, trash, security stack**.
The field is subdivided into the **breeding area** and the **battle area** (§3-4-6).

| Area | Public/private | Face | Notes |
|---|---|---|---|
| Deck | private (§3-2-2) | down | Nobody may look. Order can't be changed by its owner (§3-2-3). |
| Digi-Egg deck | private (§3-3-2) | down | Same. |
| Hand | private, owner may look (§3-5-3) | — | Owner may reorder at will (§3-5-2). |
| Trash | **public** (§3-6-3) | up | **Either player may look through it at any time** (§3-1-2-1-1). Owner may reorder (§3-6-2). |
| Security stack | private (§3-7-2) | down | **Spread out so the number of cards is visible** (§3-7-2). Order can't be changed (§3-7-3). |
| Breeding area | public | up | **Exactly one card** (§3-4-7-2). |
| Battle area | public | up | Any number of cards (§3-4-8-2). |

Two consequences the UI must respect:

- **The trash is browsable by both players.** It is not a face-down pile. A
  count alone is not enough.
- **Security is fanned, not stacked** — the point of the spread is that the
  count is public information (§3-1-3-2) while the faces are not.

The breeding area is almost entirely walled off from effects (§3-4-7-3 to
§3-4-7-8): cards there can't be chosen, can't trigger, can't be referenced.
Worth showing as a visually separate box, not just another slot.

## 2. The turn (§6-1-2)

**Unsuspend → Draw → Breeding → Main.** Four phases. There is **no end phase** —
the turn ends when the memory condition is met, not by reaching a final step.

- **Unsuspend** (§6-2-1) — the turn player unsuspends all their cards on the
  field, at the same time.
- **Draw** (§6-3-1) — the turn player draws 1. **The first player does not draw
  on their first turn** (§6-3-1-1).
- **Breeding** (§6-4-1) — **exactly one** of: hatch a Digi-Egg, move your
  Digimon from the breeding area to the battle area, or do nothing.
- **Main** (§6-5-1) — any number of: play a Digimon/Tamer, digivolve, use an
  Option, link, attack, activate an activation-type effect, or pass.

### Ending the turn

- **Turn end condition (§6-1-4-1):** the memory is at **1 or more on the
  opponent's side** and all processing is resolved. Memory at exactly 0 does
  **not** end the turn.
- **Passing (§6-5-1-7-1):** memory moves immediately to **3 on the opponent's
  side**.
- If memory moves back to 0 or more at end of turn, the end is postponed and
  the phase continues (§6-6-4).

## 3. Setup (§5-2-1)

1. Shuffle deck and Digi-Egg deck, both face down.
2. Decide who goes first.
3. Both draw 5. Each player may **re-draw once** — whole hand back, shuffle,
   draw 5 (§5-2-1-4, §5-2-1-5).
4. Security: take the **top 5 cards of the deck**, face down, one at a time,
   **so the top card of the deck becomes the bottom card of the security
   stack** (§5-2-1-6).
5. Memory marker to **0** (§5-2-1-7).

## 4. Playing and digivolving

- A card played into the battle area is placed **unsuspended** (§3-4-3).
- **A Digimon or Tamer can't attack the turn it was placed** (§7-1-2-1) —
  summoning sickness.
- Digivolving stacks the new card on top; the Digimon is considered to *change
  into* the new card, **not** to be a newly placed one (§3-4-5). This is why a
  digivolved Digimon keeps its suspended state and can still attack.
- A card that becomes the bottom of a stack is **not** a new card (§3-1-3-1-3).

## 5. Attacking (§11)

Only the turn player attacks (§11-1-2). The sequence is fixed:

**Attack declaration → counter timing → block timing → confirm success → end of attack** (§11-1-3)

- The attacker **suspends their Digimon** and declares (§11-2-1).
- The target is **either the opponent, or one of the opponent's _suspended_
  Digimon** (§11-2-7-1). Unsuspended Digimon cannot be attacked directly.
- One Digimon, one attack, one declaration (§11-2-3).
- **Blocking** (§12): the defender may switch the target to a Digimon with
  `<Blocker>`, suspending it. Once per attack (§12-1-2).

### Security checks (§13)

Triggered by an attack on the *player*, not by clicking a pile:

1. Reveal the **top** security card (§13-1-8-1-1).
2. Resolve anything the check triggered (§13-1-8-2).
3. If it is a Digimon card, it is a **Security Digimon** and **battles** the
   attacker (§13-1-7, §13-1-8-3-1).
4. **The revealed card goes to the trash** unless something puts it elsewhere
   (§13-1-8-4).

One check per attack unless an effect says otherwise (§13-1-2).

## 6. De-Digivolve (§16-12)

`<De-Digivolve X>`: trash X cards from the **top** of the chosen stack
(§16-12-1). It is mandatory once activated (§16-12-3).

**§16-12-4 — it can't trash cards from level 3 cards or lower.**

So de-digivolving a Digimon that has nothing underneath it must **not** delete
it. Refusing is correct; trashing the Digimon is not.

## 7. Copy limits (§2-3-4-6, §1-4-1)

- Deck: exactly 50, Digi-Egg deck: 5 or fewer (§1-4-1-2-1, §1-4-1-3-1).
- Up to 4 copies of a card number, in each (§1-4-1-2-2, §1-4-1-3-2).
- **(Rule) "A player can include up to X copies"** overrides that (§2-3-4-6-1).
- **(Rule) "Card number: Also treated as [XX]"** makes two printings share one
  allowance (§2-3-4-5-1).

Both are already implemented in `deck.ts`, parsed out of the `rule` field.

---

## What Digiport does and does not model

**Modelled:** areas and their privacy, the four phases, the memory gauge and its
crossing rule, first-player draw skip, hatching, digivolution stacks, attached
cards, security checks as a card reveal, copy limits.

**Deliberately not modelled** (it is a manual simulator): card effect text,
costs, colour/level digivolution requirements, DigiXros, Assembly, Link, Burst,
App Fusion, triggered and inherited effects, and the attack/block/battle
sequence. Players do those themselves.

**Known divergences still open** — see PLAN.md:

- The breeding phase allows any number of actions; the rules allow exactly one.
- There is no attack action, so no summoning sickness, no attack targeting
  restriction to suspended Digimon, no blocker prompt, and a security check is
  a manual click rather than a step in an attack.
- The reducer has no card database, so rules keyed on **level** (§16-12-4) or
  DP are approximated by structure: "has no digivolution sources" stands in for
  "is level 3 or lower".

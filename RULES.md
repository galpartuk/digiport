# How the game is actually played

Distilled from the **Digimon Card Game Comprehensive Rules** (`digimon_crm.pdf`,
Ver. 4.2, 48 pages), read end to end. Section numbers below are the manual's
own, so anything here can be checked against the source.

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
  digivolved Digimon keeps its suspended state (§8-1-2-3) and can still attack.
- A card that becomes the bottom of a stack is **not** a new card (§3-1-3-1-3).
- **Digivolving draws a card** (§8-1-3-3), and so do DNA (§8-2-3-3), Burst
  (§8-3-3-4) and App Fusion (§8-4-3-3). The draw is part of the procedure, not a
  separate act. With an empty deck the digivolution still happens and the draw is
  simply skipped (§8-1-2-8) — it is **not** a loss.
- **Only Digimon with DP can be moved** breeding → battle (§4-17-2). A Digi-Egg
  has no DP, so it must digivolve before it can be promoted. A moved card keeps
  its orientation (§4-17-3).
- **Digi-Egg cards on the field are Digimon** (§4-3-1), and a Digimon gains the
  inherited effects of everything under it (§4-3-3).

### The five ways onto the field, and where the cards come from

| | The card | What goes under it | Cost |
|---|---|---|---|
| Play (§7-1) | hand | nothing | play cost |
| DigiXros (§7-2) | hand | named cards from **hand and/or battle area** | reduced per card placed |
| Assembly (§7-3) | hand | named cards from the **trash**, the exact number (§7-3-2-4) | reduced by a fixed amount |
| Digivolve (§8-1) | hand | the Digimon already there | digivolution cost |
| DNA / Jogress (§8-2) | hand | **several** of your battle-area Digimon, with their own sources (§8-2-2-3) | as printed |

DNA differs from ordinary digivolution in ways that matter: the result is
**unsuspended** regardless of what it came from (§8-2-2-1-1), every card that
becomes a source is a **new card** (§8-2-2-1-2), and a Digimon that DNA
digivolves the turn it was played **loses its summoning sickness** and can
attack (§8-2-2-1-7).

Placing under a **Tamer** defaults to the **bottom** of the stack (§4-4-2), the
opposite of digivolving onto a Digimon. Link cards likewise plug in at the
bottom (§10-1-2-1).

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

## 6. Battles (§14)

Battle is a DP comparison, nothing more: the higher DP wins, the lower loses and
is **deleted immediately**, and equal DP deletes **both** (§14-2-1, §14-2-2).

**A Security Digimon is never deleted for losing a battle** (§14-2-3).

Attacking a player who has **0 security cards** wins the game outright, unless
the attacker cannot perform a security check at all (§11-5-1-2-1, §1-2-3-1).

## 7. Rule checks (§17) — what the game does by itself

At every timing where a rule check is possible, all of this happens at once and
without anyone asking:

- a Digimon in the battle area at **0 DP** is deleted (§17-1-3-1-1)
- a Digimon **without DP** in the battle area is trashed (§17-1-3-2-1)
- an **Option card** in the battle area is trashed — unless an effect put it
  there (§17-1-3-2-2, and §4-28 defines that exception)
- a **non-Digimon in the breeding area** is trashed, same exception (§17-1-3-2-3)
- a **face-down card on the field** is trashed (§17-1-3-2-4)
- link cards **over the limit** or failing their requirements are trashed
  (§17-1-3-2-5 to §17-1-3-2-7); the limit is **one per card** (§4-9-5) unless
  `<Link +>` raises it (§16-40)

Rule checks do **not** run during rule processing or effect processing
(§17-1-2) — they wait for the current thing to finish.

## 8. De-Digivolve (§16-12)

`<De-Digivolve X>`: trash X cards from the **top** of the chosen stack
(§16-12-1). It is mandatory once activated (§16-12-3).

**§16-12-4 — it can't trash cards from level 3 cards or lower.**

So de-digivolving a Digimon that has nothing underneath it must **not** delete
it. Refusing is correct; trashing the Digimon is not.

## 9. Copy limits (§2-3-4-6, §1-4-1)

- Deck: exactly 50, Digi-Egg deck: 5 or fewer (§1-4-1-2-1, §1-4-1-3-1).
- Up to 4 copies of a card number, in each (§1-4-1-2-2, §1-4-1-3-2).
- **(Rule) "A player can include up to X copies"** overrides that (§2-3-4-6-1).
- **(Rule) "Card number: Also treated as [XX]"** makes two printings share one
  allowance (§2-3-4-5-1).

Both are already implemented in `deck.ts`, parsed out of the `rule` field.

---

## What Digiport does and does not model

**Modelled:** areas and their privacy, the four phases, the memory gauge and its
crossing rule, first-player draw skip, hatching, digivolution stacks and the
draw that comes with them, placing cards under another card, attached/link
cards, attack declarations, security checks as a card reveal, copy limits.

**Deliberately not modelled** — it is a manual simulator: card effect text,
costs, colour and level digivolution requirements, triggered and inherited
effects, and the counter/block/battle steps of an attack. Players do those.

## Still open

Everything below is a real divergence, found by reading the manual and left
undone on purpose. Nothing here is a surprise.

**The reducer has no card database.** `game/` never sees a card's name, level,
DP or text — only its id. Every rule keyed on those is therefore either
approximated by structure or left to the board, which does have the index:

- §16-12-4 keys de-digivolve on **level 3 or lower**; the reducer uses "has no
  digivolution sources" as the stand-in.
- §4-17-2 forbids moving a Digimon **without DP** out of the breeding area. Not
  enforced; a Digi-Egg can currently be promoted.
- §4-4-2 places cards under a **Tamer** at the bottom by default. `placeUnder`
  defaults to the top regardless, because it cannot tell a Tamer from a Digimon.
  The board can, and should pass `'bottom'`.

**Rule checks (§17) are not run or flagged at all.** Every one of them is
computable from what the board already knows, and two of them (§17-1-3-2-2,
§17-1-3-2-3) carry an "unless an effect placed it there" exception the simulator
cannot evaluate — so they belong on screen as advisories, never as automatic
deletions.

**No attack sequence beyond the declaration.** No summoning sickness
(§7-1-2-1), no restriction to suspended targets (§11-2-7-1), no counter or block
timing (§11-1-3, §12), and a security check is a manual click rather than a step
inside an attack (§13-1-8). Battle outcome is shown as a DP comparison and never
acted on.

**No tokens** (§4-21). Effects that play tokens have nothing to play.

**No Overflow** (§4-19). An ACE card leaving the field should move the memory
marker immediately; `aceEffect` is in the payload, so this is at least flaggable.

**Deletion and trashing are the same action here.** §4-15 and §4-16 are
different events — `[On Deletion]` keys off one and not the other — and the log
does not distinguish them.

**Keyword effects (§16) are the Phase 3 assists roadmap**, not a gap. The
structural ones worth building first are the ones that change what is legal
rather than what a card says: `<Blocker>` (§16-5), `<Rush>` (§16-15),
`<Blitz>` (§16-16), `<Security A.>` (§16-4), `<Piercing>` (§16-7),
`<Recovery>` (§16-6), `<Reboot>` (§16-11), `<Jamming>` (§16-9) and
`<Link +>` (§16-40).

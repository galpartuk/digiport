/**
 * The printed tokens.
 *
 * A token is **not a card** (§4-21). An effect that says "play 1 <Diaboromon>
 * token" puts a *non-game card* onto the field, and a non-game card has no
 * card number: there is nothing in `cards.json` to look one up by, no art to
 * draw it with, and no copy allowance to count it against. That is the whole
 * reason this is a hardcoded list in the board rather than a query into the
 * card index — `game/` already treats a token instance's `cardId` as whatever
 * the effect calls it instead of as a real id, and the index would return
 * `undefined` for every one of these names.
 *
 * Three consequences the board has to respect, all from the same section:
 *
 *   · §4-21-3 — a token cannot be stacked with, in either direction. It is
 *     neither a digivolution source nor something you can digivolve onto.
 *   · §4-21-4 — a token cannot be linked, and cannot be linked to.
 *   · §4-21-5 — when a token leaves the field it is **removed from the game**
 *     rather than placed in another area. It never reaches a trash, a hand or
 *     a deck, so "move it to your hand" is not a thing to offer.
 *
 * The list will go stale. Every set that prints a new token adds a name that
 * is not in this file yet, and a release is not a reason a player cannot
 * finish their game — which is why the picker keeps a free-text field beside
 * the list rather than treating this as the complete set of legal answers.
 *
 * Alphabetical, because that is the only order 18 unrelated names have.
 */
export const PRINTED_TOKENS: readonly string[] = [
  'Amon of Crimson Flame',
  'Atho, Rene & Por',
  'Diaboromon',
  'Familiar',
  'Fujitsumon',
  'Gyuukimon',
  'Hinukamuy',
  'KoHagurumon',
  'Kotenken',
  'Paishu',
  'Petrification',
  'Pipe Fox',
  'Rapidmon',
  'Taomon',
  'Uka no Mitama',
  'Umon of Blue Thunder',
  'Volée & Zerdrücken',
  'WarGrowlmon',
]

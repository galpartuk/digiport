import type { Card } from '../cards'
import type { Zone } from '../game/types'

/**
 * Reading the special digivolution rules off a card, so the board can offer the
 * cards you could use.
 *
 * This is a **parser, not a judge**. Digiport is a manual simulator (see
 * RULES.md) and the printed requirements are prose: traits, levels, colours,
 * "in name", "in text", "w/different names", counts, and card names that are
 * themselves substrings of other card names. Everything below exists to make a
 * good first guess at what you probably want to pick — never to decide what you
 * are allowed to pick. The picker always offers everything in the zones the
 * rule draws from, with the guesses floated to the top.
 *
 * The rules parsed here, with the comprehensive-rules section each comes from:
 *
 *   · DigiXros (§7-2) — play the card, placing any number of the named cards
 *     from the hand and/or the battle area underneath. The play cost drops by
 *     the printed amount **per card placed** (§7-2-2-1).
 *   · Assembly (§7-3) — the same shape, but the cards come from the trash, and
 *     the exact number named has to be placed (§7-3-2-4).
 *   · DNA Digivolve / Jogress (§8-2) — several of your battle-area Digimon
 *     become one card, which goes on top with all of them underneath.
 *   · Burst Digivolve (§8-3) — digivolve into the card off its own requirement
 *     rather than off a colour and a level.
 *   · Link (§4-9) — plugged in sideways, and never a digivolution card.
 */

export type RuleKind = 'digiXros' | 'assembly' | 'dna' | 'burst' | 'link'

/** One thing a requirement asks of a card. */
export type ReqToken =
  | { t: 'name'; text: string }
  | { t: 'trait'; text: string }
  | { t: 'text'; text: string }
  | { t: 'level'; n: number; cmp: 'eq' | 'lte' | 'gte' }
  | { t: 'color'; text: string }

/**
 * One requirement, as printed between the `x` or `+` separators. Its groups are
 * ANDed and the alternatives inside a group (the `[A]/[B]/[C]` form) are ORed,
 * which is exactly how the card text reads.
 */
export type ReqClause = {
  label: string
  groups: ReqToken[][]
  /** How many cards this clause names, when it says so ("4 [Negamon]"). */
  count: number
}

export type RuleSpec = {
  kind: RuleKind
  /** What the rule is called on the card. */
  label: string
  /** The requirement exactly as printed. */
  raw: string
  /**
   * DigiXros and Assembly: memory taken off the play cost per card placed.
   * DNA, Burst and Link: the flat cost the text names. Null when unparsed.
   */
  amount: number | null
  /** True when `amount` is per card placed rather than a flat cost. */
  perCard: boolean
  /**
   * True when `amount` comes off the play cost as a single total (Assembly,
   * 7-3-2-1) rather than being the cost itself.
   */
  flatReduction?: boolean
  clauses: ReqClause[]
  /** Where the cards it takes come from. */
  from: Zone[]
  /** How many cards the text names altogether, when it says. */
  need: number | null
  /** One card, or several? Burst and Link take exactly one. */
  single: boolean
}

// ------------------------------------------------------------------ matching

const COLOR_WORDS = ['red', 'blue', 'yellow', 'green', 'black', 'purple', 'white']

function norm(text: string): string {
  // Card names differ across printings by punctuation and spacing far more
  // often than by letters, so neither survives the comparison.
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * §2-3-4-5-1's sibling: `(Rule) Name: Also treated as [X]/[Y]` makes one card
 * answer to another card's name, which is exactly what a DigiXros requirement
 * is looking at.
 */
function aliases(card: Card): string[] {
  const rule = card.rule
  if (!rule || !/name\s*:/i.test(rule)) return []
  const tail = rule.slice(rule.search(/name\s*:/i))
  return [...tail.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])
}

function tokenOk(card: Card, token: ReqToken): boolean {
  switch (token.t) {
    case 'name': {
      const want = norm(token.text)
      if (!want) return false
      // Directional on purpose: AtlurBallistamon answers to [Ballistamon], but
      // plain Shoutmon must not answer to [Shoutmon X4].
      if (norm(card.name).includes(want)) return true
      return aliases(card).some((a) => norm(a).includes(want))
    }
    case 'trait':
      return (card.types ?? []).some((t) => norm(t) === norm(token.text))
    case 'text': {
      const hay = norm(
        [card.name, card.effect, card.inheritedEffect, card.securityEffect, card.aceEffect]
          .filter(Boolean).join(' '),
      )
      return hay.includes(norm(token.text))
    }
    case 'level': {
      if (card.level === undefined) return false
      if (token.cmp === 'lte') return card.level <= token.n
      if (token.cmp === 'gte') return card.level >= token.n
      return card.level === token.n
    }
    case 'color':
      return card.colors.some((c) => norm(c) === norm(token.text))
  }
}

function clauseOk(card: Card, clause: ReqClause): boolean {
  if (clause.groups.length === 0) return false
  return clause.groups.every((group) => group.some((token) => tokenOk(card, token)))
}

/** The clauses this card could stand in for, by label. Empty means no guess. */
export function clausesFor(card: Card | undefined, spec: RuleSpec): string[] {
  if (!card) return []
  return spec.clauses.filter((c) => clauseOk(card, c)).map((c) => c.label)
}

// ------------------------------------------------------------------- parsing

/** Card text uses a non-breaking space between a token and its qualifier. */
function tidy(text: string): string {
  return text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
}

function parseClause(text: string): ReqClause {
  const groups: ReqToken[][] = []

  // `[A]/[B]/[C] trait` is one requirement with three answers, so a run of
  // slash-joined brackets is read as one group and the qualifier after it
  // applies to all of them. ＜Save＞ is a keyword rather than a name, but it
  // appears in the same position and reads the same way, so it parses the same.
  const runs = /[[＜][^\]＞]+[\]＞](?:\s*\/\s*[[＜][^\]＞]+[\]＞])*/g
  let match: RegExpExecArray | null
  while ((match = runs.exec(text)) !== null) {
    const after = text.slice(match.index + match[0].length)
    // "trait", "in any trait" and "in one of their traits" are the same ask.
    const qualifier = /^\s*(?:in\s+(?:any|one\s+of\s+their)\s+)?(traits?|in name|in text)/i.exec(after)
    const kind: ReqToken['t'] = !qualifier
      ? 'name'
      : /trait/i.test(qualifier[1]) ? 'trait'
        : /text/i.test(qualifier[1]) ? 'text' : 'name'
    const names = match[0].split('/').map((s) => s.trim().replace(/^[[＜]|[\]＞]$/g, '').trim())
    groups.push(names.filter(Boolean).map((name) => ({ t: kind, text: name }) as ReqToken))
  }

  // Levels and colours are read from what is left once the bracketed tokens are
  // out of the way, so a card *named* "Red Card" cannot become a colour.
  const bare = text.replace(runs, ' ')
  const level = /(?:lv\.?|level)\s*(\d+)\s*(or lower|or higher)?/i.exec(bare)
  if (level) {
    groups.push([{
      t: 'level',
      n: Number(level[1]),
      cmp: !level[2] ? 'eq' : /lower/i.test(level[2]) ? 'lte' : 'gte',
    }])
  }
  const colors = COLOR_WORDS.filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(bare))
  if (colors.length) groups.push(colors.map((c) => ({ t: 'color', text: c }) as ReqToken))

  const count = /^\s*(\d+)\s/.exec(text)
  return { label: tidy(text), groups, count: count ? Number(count[1]) : 1 }
}

/**
 * "[A] or [B]", "[A], [B]" and "[A] or w/[B]" all say the same thing as the
 * "[A]/[B]" form the parser already reads as one group of answers, so they are
 * spelled that way before the clause is read. `x` and `+` stay separators —
 * those genuinely name a second card.
 */
function alternations(text: string): string {
  return text.replace(/([\]＞])\s*(?:,|or)\s*(?:w\/)?\s*([[＜])/gi, '$1/$2')
}

/** The clauses of a requirement, split on the printed `x` / `+` separators. */
function parseClauses(text: string): ReqClause[] {
  return alternations(tidy(text))
    .split(/\s+(?:x|\+)\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseClause)
}

/** `: Cost 3` at the end of a DNA / Burst / Link requirement. */
function trailingCost(text: string): { cost: number | null; body: string } {
  const match = /:\s*cost\s*(\d+)/i.exec(text)
  if (!match) return { cost: null, body: text }
  return { cost: Number(match[1]), body: text.slice(0, match.index) }
}

/**
 * Every requirement field a card can carry, as one block, one rule per line.
 *
 * Read together rather than one at a time because the printed header is what
 * actually identifies a rule and the fields do not always agree with it: three
 * cards in the current payload (EX12-015, EX12-029, EX12-056) carry `[DigiXros
 * -2] …` in their `assembly` field. Searching the block for the header finds
 * those, and a field holding the rule it says it holds is unaffected.
 */
function requirementText(card: Card): string {
  return [
    card.digiXros, card.assembly, card.dnaDigivolve, card.burstDigivolve, card.linkRequirement,
  ].filter(Boolean).join('\n')
}

type Reader = {
  kind: RuleKind
  label: string
  /** Finds the requirement in the block; a line may also hold a plain [Digivolve]. */
  head: RegExp
  from: Zone[]
  single: boolean
  perCard: boolean
  flatReduction?: boolean
}

const READERS: Reader[] = [
  {
    kind: 'digiXros',
    label: 'DigiXros',
    head: /\[DigiXros\s*-?\s*(\d+)?\]/i,
    from: ['hand', 'battle'],
    single: false,
    perCard: true,
  },
  {
    kind: 'assembly',
    label: 'Assembly',
    head: /\[Assembly\s*-?\s*(\d+)?\]/i,
    from: ['trash'],
    single: false,
    // Assembly's reduction is a FLAT total, unlike DigiXros's per-card one.
    // Comprehensive rules 7-3-2-1: "For Assembly requirements that read
    // 'Assembly -6: 4 [Negamon] cards,' a player can use Assembly to place 4
    // [Negamon] cards under the card to be played, and the play cost will be
    // reduced by 6." Six for the set, not six for each.
    perCard: false,
    flatReduction: true,
  },
  {
    kind: 'dna',
    label: 'DNA Digivolve',
    head: /\[DNA Digivolve\]/i,
    from: ['battle'],
    single: false,
    perCard: false,
  },
  {
    kind: 'burst',
    label: 'Burst Digivolve',
    head: /\[Burst Digivolve\]/i,
    from: ['battle'],
    single: true,
    perCard: false,
  },
  {
    kind: 'link',
    label: 'Link',
    head: /\[Link\]/i,
    from: ['battle'],
    single: true,
    perCard: false,
  },
]

function read(field: string, reader: Reader): RuleSpec | null {
  const found = reader.head.exec(field)
  if (!found) return null

  // A field can carry an ordinary [Digivolve] line as well; the requirement is
  // whatever follows its own header, up to the end of that line.
  const rest = field.slice(found.index + found[0].length)
  const line = rest.split('\n')[0]
  const { cost, body } = trailingCost(line)

  // "Cost 0 by returning 1 [Marcus Damon] to the hand" is an extra price, not a
  // second card to pick, so the requirement stops where the sentence turns.
  const requirement = reader.kind === 'burst' ? body.split(/\bby\b/i)[0] : body

  const clauses = parseClauses(requirement)
  const named = clauses.reduce((sum, c) => sum + c.count, 0)

  return {
    kind: reader.kind,
    label: reader.label,
    raw: tidy(field.slice(found.index).split('\n')[0]),
    amount: (reader.perCard || reader.flatReduction)
      ? (found[1] ? Number(found[1]) : null)
      : cost,
    perCard: reader.perCard,
    flatReduction: reader.flatReduction,
    clauses,
    from: reader.from,
    need: reader.kind === 'digiXros' ? null : named || null,
    single: reader.single,
  }
}

/** Every special rule this card carries, in the order they read best. */
export function rulesOn(card: Card | undefined): RuleSpec[] {
  if (!card) return []
  const field = requirementText(card)
  if (!field) return []
  return READERS.map((r) => read(field, r)).filter((s): s is RuleSpec => s !== null)
}

/** The same, keyed by kind, for the one-line lookups the board does per card. */
export function ruleOn(card: Card | undefined, kind: RuleKind): RuleSpec | null {
  return rulesOn(card).find((s) => s.kind === kind) ?? null
}

/**
 * The short badge a card in hand wears. Kept to four characters: it sits on a
 * card in an overlapping fan, and a word would cover the art it is stuck to.
 */
export const RULE_BADGE: Record<RuleKind, string> = {
  digiXros: 'XROS',
  assembly: 'ASM',
  dna: 'DNA',
  burst: 'BURST',
  link: 'LINK',
}

/** What the button says it will do, spelled out for the tooltip. */
export function ruleHint(spec: RuleSpec): string {
  switch (spec.kind) {
    case 'digiXros':
      return 'DigiXros (§7-2) — play it, placing cards from your hand and field underneath'
    case 'assembly':
      return 'Assembly (§7-3) — play it, placing cards from your trash underneath'
    case 'dna':
      return 'DNA Digivolve / Jogress (§8-2) — several of your Digimon become this card'
    case 'burst':
      return 'Burst Digivolve (§8-3) — digivolve into this card off its own requirement'
    case 'link':
      return 'Link (§4-9) — plug this card in sideways'
  }
}

/** Whether a card in this zone should offer this rule at all. */
export function offeredIn(spec: RuleSpec, zone: Zone): boolean {
  if (zone === 'hand' || zone === 'reveal') return true
  // Assembly takes its sources from the trash, and a card sitting in the trash
  // beside them is exactly the card a player is looking at when they want it.
  return zone === 'trash' && spec.kind === 'assembly'
}

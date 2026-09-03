import { useEffect, useMemo, useState } from 'react'
import type { Card, CardIndex } from '../cards'
import { act } from '../game/actions'
import type { Action, Iid, PlayerId, Zone } from '../game/types'
import type { ViewCard, ViewPlayer } from '../game/view'
import { Art } from './BoardCard'
import { clausesFor, type RuleSpec } from './rules'

/**
 * The picker behind the DigiXros / Assembly / Jogress / Burst / Link buttons.
 *
 * Two things it is deliberately not. It is **not a validator**: the parse in
 * `rules.ts` is a guess at prose, so everything in the zones the rule draws from
 * is on offer and the guesses are only floated to the top and labelled. And it
 * is **not a cost engine**: the arithmetic is shown and the payment is offered
 * exactly the way the board's existing cost offers work, because "play this
 * without paying its cost" is card text this board never reads.
 *
 * What it does buy is real: a three-card DigiXros is one confirm, which the
 * reducer records as one `placeUnder` — one log line, one undo.
 */

/** Where a card the picker can offer lives, and what it is. */
export type Pick = {
  iid: Iid
  cardId: string
  card: Card | undefined
  zone: Zone
  /** The clause labels this card looks like an answer to. Empty means a guess. */
  matches: string[]
}

/** The subject: the card whose button was pressed. */
export type RuleSubject = {
  iid: Iid
  cardId: string
  zone: Zone
  owner: PlayerId
}

type Props = {
  subject: RuleSubject
  spec: RuleSpec
  me: ViewPlayer
  index: CardIndex
  seat: PlayerId
  /** The actions to run, in order, plus the cost the picker worked out. */
  onCommit: (actions: Action[], cost: { name: string; costs: number[]; note: string }) => void
  onPeek: (cardId: string) => void
  onClose: () => void
}

const ZONE_LABEL: Record<string, string> = {
  hand: 'Your hand',
  battle: 'Your battle area',
  trash: 'Your trash',
  breeding: 'Your breeding area',
}

/** What the confirm button will actually do, spelled out in one sentence. */
function plan(spec: RuleSpec, n: number, name: string): string {
  switch (spec.kind) {
    case 'digiXros':
      return `Play ${name} into your battle area and place ${n} card${n === 1 ? '' : 's'} ` +
        'underneath it as digivolution cards (§7-2).'
    case 'assembly':
      return `Play ${name} into your battle area and place ${n} card${n === 1 ? '' : 's'} ` +
        'from your trash underneath it (§7-3).'
    case 'dna':
      // §8-2 joins two or more Digimon, so one pick is half a Jogress.
      return n < 2
        ? `Pick at least one more of your Digimon — a Jogress joins two (§8-2).`
        : `The first Digimon you picked digivolves into ${name}; the ` +
          `other ${n - 1} go underneath as digivolution cards (§8-2).`
    case 'burst':
      return `Digivolve the picked Digimon into ${name} (§8-3).`
    case 'link':
      return `Plug ${name} into the picked Digimon sideways (§4-9).`
  }
}

export function RulePicker(
  { subject, spec, me, index, seat, onCommit, onPeek, onClose }: Props,
) {
  const [chosen, setChosen] = useState<Iid[]>([])
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const subjectCard = index.byId.get(subject.cardId)
  const name = subjectCard?.name ?? subject.cardId

  /**
   * Everything the rule could reach, in the zones it draws from. A masked card
   * carries a positional placeholder iid, not a real one, so it can never be
   * the subject of an action and is dropped here rather than offered.
   */
  const pool = useMemo<Pick[]>(() => {
    const out: Pick[] = []
    for (const zone of spec.from) {
      const cards = (me[zone as keyof ViewPlayer] as ViewCard[] | undefined) ?? []
      for (const c of cards) {
        if (c.cardId === null || c.iid === subject.iid) continue
        const card = index.byId.get(c.cardId)
        out.push({ iid: c.iid, cardId: c.cardId, card, zone, matches: clausesFor(card, spec) })
      }
    }
    return out
  }, [me, spec, index, subject.iid])

  const suggested = pool.filter((p) => p.matches.length > 0)
  const rest = pool.filter((p) => p.matches.length === 0)
  const offered = showAll ? [...suggested, ...rest] : suggested

  const toggle = (iid: Iid) => {
    setChosen((list) => {
      if (list.includes(iid)) return list.filter((x) => x !== iid)
      // Burst and Link take exactly one card, so picking a second replaces the
      // first rather than quietly building an illegal set.
      return spec.single ? [iid] : [...list, iid]
    })
  }

  const printed = subjectCard?.playCost
  // DigiXros takes its amount off per card placed (7-2-2-1); Assembly takes it
  // off once for the whole set (7-3-2-1).
  const reduction = spec.amount === null ? 0
    : spec.perCard ? spec.amount * chosen.length
      : spec.flatReduction ? spec.amount
        : 0
  const reduced = printed === undefined ? null : Math.max(0, printed - reduction)

  /**
   * The costs on offer. The reduced one first because it is nearly always the
   * one meant — the printed cost stays on the row so a parse that read the
   * wrong number never leaves a player unable to pay what the card says.
   */
  const costs = (): number[] => {
    if (spec.perCard || spec.flatReduction) {
      const list: number[] = []
      if (reduced !== null) list.push(reduced)
      if (printed !== undefined && printed !== reduced) list.push(printed)
      return list
    }
    return spec.amount === null ? [] : [spec.amount]
  }

  const enough = spec.single ? chosen.length === 1 : chosen.length >= (spec.kind === 'dna' ? 2 : 1)

  const commit = () => {
    if (!enough) return
    const actions: Action[] = []
    if (spec.kind === 'digiXros' || spec.kind === 'assembly') {
      // §7-2 / §7-3: the card is played, and the sources go underneath it. One
      // `placeUnder` for the whole set, so it is one log line and one undo.
      actions.push(act.move(seat, subject.iid, 'battle'))
      actions.push(act.placeUnder(seat, chosen, subject.iid, 'top'))
    } else if (spec.kind === 'dna') {
      // §8-2: the card goes on top and every picked Digimon ends up underneath.
      // The first pick is the one that digivolves; the rest slide under it.
      const [base, ...others] = chosen
      actions.push(act.digivolve(seat, base, subject.iid))
      if (others.length) actions.push(act.placeUnder(seat, others, base, 'bottom'))
    } else if (spec.kind === 'burst') {
      actions.push(act.digivolve(seat, chosen[0], subject.iid))
    } else {
      actions.push(act.attach(seat, subject.iid, chosen[0]))
    }
    onCommit(actions, {
      name,
      costs: costs(),
      note: spec.amount !== null && (spec.perCard || spec.flatReduction)
        ? (spec.perCard
          ? `${spec.label} −${spec.amount} per card × ${chosen.length}`
          : `${spec.label} −${spec.amount}`)
        : spec.label,
    })
  }

  const thumb = (p: Pick) => {
    const order = chosen.indexOf(p.iid)
    const on = order >= 0
    return (
      <button
        key={p.iid}
        type="button"
        className={on ? 'rp-card on' : 'rp-card'}
        title={p.matches.length
          ? `${p.card?.name ?? p.cardId} — matches ${p.matches.join(' / ')}`
          : `${p.card?.name ?? p.cardId} — not one the requirement names`}
        onClick={() => { toggle(p.iid); onPeek(p.cardId) }}
      >
        <Art cardId={p.cardId} index={index} alt={false} />
        {on && (
          <span className="rp-tick">
            {spec.kind === 'dna' ? (order === 0 ? 'base' : order + 1) : '✓'}
          </span>
        )}
        {p.matches.length === 0 && <span className="rp-loose">?</span>}
      </button>
    )
  }

  const zones = spec.from.map((z) => ZONE_LABEL[z] ?? z).join(' and ')

  return (
    <div className="browser-scrim" onClick={onClose} role="presentation">
      <div className="browser rulepick" onClick={(e) => e.stopPropagation()} role="presentation">
        <header className="browser-head">
          <b>{name}</b>
          <span className="rp-kind">{spec.label}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </header>

        <div className="rp-req">
          <span className="rp-raw">{spec.raw}</span>
          {spec.clauses.length > 0 && (
            <span className="rp-chips">
              {spec.clauses.map((c) => (
                <em key={c.label} className="rp-chip">{c.label}</em>
              ))}
            </span>
          )}
        </div>

        <div className="rp-body">
          {offered.length === 0 ? (
            <p className="browser-empty">
              Nothing in {zones} looks like a match — open everything below and pick what you
              know is legal.
            </p>
          ) : (
            spec.from.map((zone) => {
              const here = offered.filter((p) => p.zone === zone)
              if (here.length === 0) return null
              return (
                <section key={zone} className="rp-zone">
                  <div className="zone-label">{ZONE_LABEL[zone] ?? zone}</div>
                  <div className="rp-grid">{here.map(thumb)}</div>
                </section>
              )
            })
          )}
        </div>

        <footer className="rp-foot">
          {/*
            The escape hatch. The parse will miss things — a rule alias it did
            not read, an effect that widens the requirement — and refusing a
            legal play is far worse than offering an illegal one in a simulator
            where the player is the referee.
          */}
          <button
            type="button"
            className={showAll ? 'btn btn-sm on' : 'btn btn-sm'}
            title="Everything in the zones this rule takes from, matching or not"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? `Suggested only (${suggested.length})` : `Anything else… (${rest.length})`}
          </button>

          <span className="rp-plan">
            {chosen.length === 0
              ? `Pick the cards to place${spec.need ? ` — the text names ${spec.need}` : ''}.`
              : plan(spec, chosen.length, name)}
          </span>

          <span className="spacer" />

          {costs().length > 0 && (
            <span className="rp-cost" title="Offered, never deducted — card text changes costs">
              {spec.perCard && printed !== undefined
                ? <>{printed} − {reduction} = <b>{reduced}</b></>
                : <>cost <b>{spec.amount}</b></>}
            </span>
          )}

          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!enough}
            title={enough ? plan(spec, chosen.length, name) : 'Pick at least one card first'}
            onClick={commit}
          >
            {spec.label}
            {chosen.length > 0 ? ` ${chosen.length}` : ''}
          </button>
        </footer>
      </div>
    </div>
  )
}

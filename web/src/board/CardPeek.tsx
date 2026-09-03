import { useEffect, useState, type ReactNode } from 'react'
import { imageUrl, type Card, type Meta } from '../cards'

/**
 * The board's card reader: a drawer that slides in over the left edge of the
 * mat, holding whatever card was last clicked.
 *
 * It is deliberately not `<CardDetail>`. That panel chases the cursor, which is
 * right for a deck-builder grid — you point at a thumbnail and the reader opens
 * beside it — and wrong for a playmat, where the thing it opens over is the
 * board you are trying to read. This one never moves.
 *
 * It is also **sticky**: the pointer leaving a card does not empty it. During a
 * game you hover a card, then look away to work out what to do about it, and a
 * reader that blanks the instant you move is worse than no reader at all.
 *
 * What changed is that it is no longer a *column*. A reference panel you
 * consult a few times a turn was holding 17% of the screen open permanently,
 * and the field is the thing that has to be big. So it is an overlay: clicking
 * a card slides it in, Escape or the tab pushes it back out, and the mat keeps
 * the width either way.
 */

/** Highlights the [Bracketed] timings and ＜Keywords＞ the way the card prints them. */
function Effect({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]|＜[^＞]+＞)/g)
  return (
    <div className="peek-text">
      {parts.map((part, i) =>
        part.startsWith('[') || part.startsWith('＜')
          ? <b key={i}>{part}</b>
          : <span key={i}>{part}</span>,
      )}
    </div>
  )
}

const COLOR_VAR: Record<string, string> = {
  Red: 'var(--c-red)', Blue: 'var(--c-blue)', Yellow: 'var(--c-yellow)',
  Green: 'var(--c-green)', Black: 'var(--c-black)', Purple: 'var(--c-purple)',
  White: 'var(--c-white)',
}

type Props = {
  card: Card | null
  meta: Meta
  /**
   * Buttons for whatever this card can actually do from where it is sitting —
   * DigiXros, Assembly, Jogress, Burst, Link. The reader takes them rendered
   * rather than working them out, because doing anything needs the card's
   * *instance*, which is board state and not a card record.
   */
  actions?: ReactNode
  /** Is the drawer slid in over the mat? */
  open: boolean
  /** The tab on the drawer's edge, which is the only part of it always on screen. */
  onToggle: () => void
}

/**
 * The drawer's shell. The tab lives outside the scrolling body so it stays
 * reachable when the panel itself is parked off-screen.
 */
function Shell(
  { open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode },
) {
  return (
    <aside className={open ? 'peek open' : 'peek'}>
      <button
        type="button"
        className="peek-tab"
        aria-expanded={open}
        title={open ? 'Close the card reader (Esc)' : 'Open the card reader'}
        onClick={onToggle}
      >
        <span className="peek-tab-mark">{open ? '‹' : '›'}</span>
        <span className="peek-tab-label">Card</span>
      </button>
      <div className="peek-scroll">{children}</div>
    </aside>
  )
}

export function CardPeek({ card, meta, actions, open, onToggle }: Props) {
  const [attempt, setAttempt] = useState(0)

  // A new card starts its own image-fallback walk.
  useEffect(() => setAttempt(0), [card?.id])

  if (!card) {
    return (
      <Shell open={open} onToggle={onToggle}>
        <div className="peek-idle">
          <div className="peek-idle-card" />
          <p>Click any card on the mat — in a hand, in play, in a trash — and it opens here.</p>
        </div>
      </Shell>
    )
  }

  const stats: Array<[string, string]> = []
  if (card.level !== undefined) stats.push(['Lv', String(card.level)])
  if (card.playCost !== undefined) stats.push(['Cost', String(card.playCost)])
  if (card.dp !== undefined) stats.push(['DP', card.dp.toLocaleString('en-US')])

  return (
    <Shell open={open} onToggle={onToggle}>
      <div className="peek-art">
        <img
          src={imageUrl(card, meta, attempt)}
          alt={card.name}
          draggable={false}
          onError={() => setAttempt((a) => (a + 1 < meta.hosts.length ? a + 1 : a))}
        />
      </div>

      <div className="peek-body">
        <div className="peek-name">{card.name}</div>
        <div className="peek-sub">
          <span className="peek-id">{card.id}</span>
          <span>{card.cardType}</span>
          {card.form && <span>{card.form}</span>}
          {card.attribute && <span>{card.attribute}</span>}
        </div>

        {actions ? <div className="peek-actions">{actions}</div> : null}

        <div className="peek-colors">
          {card.colors.map((c) => (
            <span key={c} className="peek-dot" style={{ background: COLOR_VAR[c] ?? 'var(--line)' }} title={c} />
          ))}
          {card.types?.length ? <span className="peek-types">{card.types.join(' / ')}</span> : null}
        </div>

        {stats.length > 0 && (
          <div className="peek-stats">
            {stats.map(([label, value]) => (
              <div key={label}><b>{value}</b><span>{label}</span></div>
            ))}
          </div>
        )}

        {card.digivolveCondition?.length ? (
          <>
            <div className="peek-label">Digivolve</div>
            <div className="peek-text">
              {card.digivolveCondition
                .map((d) => `Lv.${d.level} ${d.color} — cost ${d.cost}`)
                .join('\n')}
            </div>
          </>
        ) : null}

        {card.effect && (<><div className="peek-label">Effect</div><Effect text={card.effect} /></>)}
        {card.inheritedEffect && (
          <><div className="peek-label">Inherited</div><Effect text={card.inheritedEffect} /></>
        )}
        {card.securityEffect && (
          <><div className="peek-label">Security</div><Effect text={card.securityEffect} /></>
        )}
        {card.aceEffect && (<><div className="peek-label">ACE</div><Effect text={card.aceEffect} /></>)}
        {card.dnaDigivolve && (
          <><div className="peek-label">DNA Digivolve</div><Effect text={card.dnaDigivolve} /></>
        )}
        {card.digiXros && (
          <><div className="peek-label">DigiXros</div><Effect text={card.digiXros} /></>
        )}
        {/* §7-3 and §8-3. Both fields are in the payload; neither was ever shown. */}
        {card.assembly && (
          <><div className="peek-label">Assembly</div><Effect text={card.assembly} /></>
        )}
        {card.burstDigivolve && (
          <><div className="peek-label">Burst Digivolve</div><Effect text={card.burstDigivolve} /></>
        )}
        {card.linkRequirement && (
          <>
            <div className="peek-label">Link{card.linkDP ? ` — ${card.linkDP} DP` : ''}</div>
            <Effect text={card.linkRequirement} />
          </>
        )}
        {card.rule && (<><div className="peek-label">Rule</div><Effect text={card.rule} /></>)}

        {card.restriction && card.restriction !== 'Unrestricted' && (
          <div className="peek-label warn">{card.restriction}</div>
        )}
      </div>
    </Shell>
  )
}

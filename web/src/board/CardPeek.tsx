import { useEffect, useState } from 'react'
import { imageUrl, type Card, type Meta } from '../cards'

/**
 * The board's card reader: a panel docked down the left edge, opposite the
 * rail, holding whatever card the pointer last touched.
 *
 * It is deliberately not `<CardDetail>`. That panel chases the cursor, which is
 * right for a deck-builder grid — you point at a thumbnail and the reader opens
 * beside it — and wrong for a playmat, where the thing it opens over is the
 * board you are trying to read. Docked, it never moves and never covers
 * anything.
 *
 * It is also **sticky**: the pointer leaving a card does not empty it. During a
 * game you hover a card, then look away to work out what to do about it, and a
 * reader that blanks the instant you move is worse than no reader at all.
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

type Props = { card: Card | null; meta: Meta }

export function CardPeek({ card, meta }: Props) {
  const [attempt, setAttempt] = useState(0)

  // A new card starts its own image-fallback walk.
  useEffect(() => setAttempt(0), [card?.id])

  if (!card) {
    return (
      <aside className="peek">
        <div className="peek-idle">
          <div className="peek-idle-card" />
          <p>Click any card on the mat — in a hand, in play, in a trash — and it opens here.</p>
        </div>
      </aside>
    )
  }

  const stats: Array<[string, string]> = []
  if (card.level !== undefined) stats.push(['Lv', String(card.level)])
  if (card.playCost !== undefined) stats.push(['Cost', String(card.playCost)])
  if (card.dp !== undefined) stats.push(['DP', card.dp.toLocaleString('en-US')])

  return (
    <aside className="peek">
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
    </aside>
  )
}

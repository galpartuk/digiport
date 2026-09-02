import { useEffect, useState } from 'react'
import { imageUrl, type Card, type Meta } from '../cards'

/** Highlights the [Bracketed] timings and keywords the way the printed card does. */
function Effect({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]|＜[^＞]+＞)/g)
  return (
    <div className="detail-effect">
      {parts.map((part, i) =>
        part.startsWith('[') || part.startsWith('＜')
          ? <b key={i}>{part}</b>
          : <span key={i}>{part}</span>,
      )}
    </div>
  )
}

type Props = { card: Card; meta: Meta; x: number; y: number }

export function CardDetail({ card, meta, x, y }: Props) {
  const [attempt, setAttempt] = useState(0)

  // A new card starts its own image-fallback walk.
  useEffect(() => setAttempt(0), [card.id])

  const stat = [
    card.level !== undefined ? `Lv.${card.level}` : null,
    card.playCost !== undefined ? `${card.playCost} cost` : null,
    card.dp !== undefined ? `${card.dp} DP` : null,
    card.form,
    card.attribute,
  ].filter(Boolean).join(' · ')

  // Keep the panel on screen: flip to the left of the cursor when it would
  // overflow, and lift it up when it would run off the bottom.
  const width = 316
  const height = 620
  const left = x + width + 24 > window.innerWidth ? Math.max(8, x - width - 18) : x + 18
  const top = Math.max(8, Math.min(y - 60, window.innerHeight - height - 8))

  return (
    <div className="detail" style={{ left, top }}>
      <img
        src={imageUrl(card, meta, attempt)}
        alt={card.name}
        onError={() => setAttempt((a) => (a + 1 < meta.hosts.length ? a + 1 : a))}
      />
      <div className="detail-body">
        <div className="detail-name">{card.name}</div>
        <div className="detail-meta">
          {card.id} · {card.colors.join('/')} · {card.cardType}
          {stat && <> · {stat}</>}
        </div>
        {card.types?.length ? <div className="detail-meta">{card.types.join(' / ')}</div> : null}

        {card.digivolveCondition?.length ? (
          <>
            <div className="detail-label">Digivolve</div>
            <div className="detail-effect">
              {card.digivolveCondition
                .map((d) => `Lv.${d.level} ${d.color} — cost ${d.cost}`)
                .join('\n')}
            </div>
          </>
        ) : null}

        {card.effect && (<><div className="detail-label">Effect</div><Effect text={card.effect} /></>)}
        {card.inheritedEffect && (
          <><div className="detail-label">Inherited</div><Effect text={card.inheritedEffect} /></>
        )}
        {card.securityEffect && (
          <><div className="detail-label">Security</div><Effect text={card.securityEffect} /></>
        )}
        {card.aceEffect && (<><div className="detail-label">ACE</div><Effect text={card.aceEffect} /></>)}
        {card.dnaDigivolve && (
          <><div className="detail-label">DNA Digivolve</div><Effect text={card.dnaDigivolve} /></>
        )}
        {card.digiXros && (
          <><div className="detail-label">DigiXros</div><Effect text={card.digiXros} /></>
        )}
        {card.linkRequirement && (
          <>
            <div className="detail-label">Link{card.linkDP ? ` — ${card.linkDP} DP` : ''}</div>
            <Effect text={card.linkRequirement} />
          </>
        )}
        {card.rule && (<><div className="detail-label">Rule</div><Effect text={card.rule} /></>)}

        {card.restriction && card.restriction !== 'Unrestricted' && (
          <div className="detail-label" style={{ color: 'var(--warn)' }}>{card.restriction}</div>
        )}
      </div>
    </div>
  )
}

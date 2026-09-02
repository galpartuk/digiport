import { useEffect, useMemo, useRef, useState } from 'react'
import type { CardIndex } from '../cards'
import { exportText, importDeck, type Deck } from '../deck'
import { shareHash } from '../share'
import { PRESETS, deckFromPreset, presetMisses } from '../presets'

export type IoTab = 'presets' | 'import' | 'export' | 'share'

type Props = {
  deck: Deck
  index: CardIndex
  tab: IoTab
  onTab: (tab: IoTab) => void
  onClose: () => void
  onImport: (deck: Deck, mode: 'new' | 'replace') => void
}

/** Copy-to-clipboard that says so, and falls back to selecting the text. */
function CopyButton({ text, target }: { text: string; target?: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null> }) {
  const [done, setDone] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      target?.current?.select()
      document.execCommand?.('copy')
    }
    setDone(true)
    setTimeout(() => setDone(false), 1400)
  }

  return <button className="btn" onClick={copy}>{done ? 'Copied' : 'Copy'}</button>
}

/** Ready-made decks, so a new player has something legal to take to the board. */
function PresetsTab({ index, onImport }: Pick<Props, 'index' | 'onImport'>) {
  const [added, setAdded] = useState<string | null>(null)

  return (
    <>
      <p className="hint">
        Complete, legal decks you can play straight away. Adding one makes your own copy —
        edit it however you like without touching the original.
      </p>
      <div className="preset-list">
        {PRESETS.map((preset) => {
          const missing = presetMisses(preset, index)
          return (
            <div className="preset" key={preset.id}>
              <div className="preset-text">
                <b>{preset.name}</b>
                <span>{preset.blurb}</span>
                {missing.length > 0 && (
                  <span className="problem warn">
                    {missing.length} card{missing.length === 1 ? '' : 's'} missing from the
                    current pool — add it anyway and the rest will import.
                  </span>
                )}
              </div>
              <button
                className="btn btn-primary"
                onClick={() => {
                  onImport(deckFromPreset(preset, index), 'new')
                  setAdded(preset.name)
                }}
              >
                {added === preset.name ? 'Added' : 'Add to my decks'}
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}

function ImportTab({ index, onImport }: Pick<Props, 'index' | 'onImport'>) {
  const [raw, setRaw] = useState('')
  const [missing, setMissing] = useState<string[] | null>(null)
  const [added, setAdded] = useState<number | null>(null)

  const run = (mode: 'new' | 'replace') => {
    const result = importDeck(raw, index)
    setMissing(result.missing)
    setAdded(
      Object.values(result.deck.main).reduce((a, b) => a + b, 0) +
      Object.values(result.deck.eggs).reduce((a, b) => a + b, 0),
    )
    onImport(result.deck, mode)
  }

  return (
    <>
      <p className="hint">
        One card per line — <code>4 BT1-010 Agumon</code>, <code>BT1-010 x4</code> and bare ids all
        work, and a JSON export from digimoncard.dev or Project Drasil can be pasted straight in.
      </p>
      <textarea
        className="field"
        placeholder={'4 BT1-010 Agumon\n4 ST1-03 Agumon\n…'}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
      />
      {added !== null && (
        <div className={`problem ${missing?.length ? 'warn' : 'ok'}`}>
          Imported {added} card{added === 1 ? '' : 's'}
          {missing?.length ? `, ${missing.length} id${missing.length === 1 ? '' : 's'} not recognised` : ''}.
        </div>
      )}
      {missing?.map((id) => (
        <div className="problem warn" key={id}>Unknown card id {id} — skipped.</div>
      ))}
      <footer style={{ padding: '12px 0 0' }}>
        <button className="btn" disabled={!raw.trim()} onClick={() => run('replace')}>
          Replace current
        </button>
        <button className="btn btn-primary" disabled={!raw.trim()} onClick={() => run('new')}>
          Import as new deck
        </button>
      </footer>
    </>
  )
}

function ExportTab({ deck, index }: Pick<Props, 'deck' | 'index'>) {
  const text = useMemo(() => exportText(deck, index), [deck, index])
  const area = useRef<HTMLTextAreaElement>(null)

  // The object URL is rebuilt whenever the list changes, and revoked with it.
  const [href, setHref] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    setHref(url)
    return () => URL.revokeObjectURL(url)
  }, [text])

  const filename = `${deck.name.replace(/[^\w -]+/g, '').trim() || 'deck'}.txt`

  return (
    <>
      <p className="hint">
        Plain text, the format Project Drasil, digimoncard.dev and Tabletop Simulator all read.
      </p>
      <textarea className="field" ref={area} readOnly value={text} />
      <footer style={{ padding: '12px 0 0' }}>
        <CopyButton text={text} target={area} />
        <a className="btn" href={href} download={filename}>Download .txt</a>
      </footer>
    </>
  )
}

function ShareTab({ deck }: Pick<Props, 'deck'>) {
  const [url, setUrl] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    shareHash(deck).then((hash) => {
      if (live) setUrl(`${location.origin}${location.pathname}${hash}`)
    })
    return () => { live = false }
  }, [deck])

  return (
    <>
      <p className="hint">
        The whole deck list travels inside the link — no account, no server, nothing stored.
        Opening it adds the deck as a copy; the sender keeps their own.
      </p>
      <input className="field" ref={input} readOnly value={url} onFocus={(e) => e.target.select()} />
      <div className="hint" style={{ marginTop: 8 }}>{url.length} characters</div>
      <footer style={{ padding: '12px 0 0' }}>
        <CopyButton text={url} target={input} />
      </footer>
    </>
  )
}

export function DeckIO(props: Props) {
  const { deck, index, tab, onTab, onClose, onImport } = props

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="modal" role="dialog" aria-label="Deck import and export">
        <header>
          <div className="tabs">
            {(['presets', 'import', 'export', 'share'] as IoTab[]).map((t) => (
              <button
                key={t}
                className="tab"
                aria-pressed={tab === t}
                onClick={() => onTab(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
            <span className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>
        <div className="body">
          {tab === 'presets' && <PresetsTab index={index} onImport={onImport} />}
          {tab === 'import' && <ImportTab index={index} onImport={onImport} />}
          {tab === 'export' && <ExportTab deck={deck} index={index} />}
          {tab === 'share' && <ShareTab deck={deck} />}
        </div>
      </div>
    </div>
  )
}

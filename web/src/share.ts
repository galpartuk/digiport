import { newDeck, type Deck } from './deck'

/**
 * A deck in a URL hash: `#d=<base64url(deflate-raw(JSON))>`.
 *
 * The payload keeps single-letter keys because it has to survive being pasted
 * into a chat window — a 50-card list lands around 200 characters. Compression
 * uses the platform's own CompressionStream, so there is no dependency here
 * and the same code runs in Node for the round-trip test.
 */
type Payload = {
  n: string
  m: Record<string, number>
  e: Record<string, number>
}

/**
 * The original share form, `#d=<code>`. Links in this shape are already out in
 * the world, so it is still read — it is simply no longer emitted, because the
 * app now routes on the hash and `#d=…` would read as a route.
 */
export const HASH_PREFIX = '#d='

/**
 * The form emitted now: the hash router's `/` route with the payload as an
 * ordinary query parameter, so a share link and a route can coexist in the
 * one hash the page gets.
 */
export const ROUTE_HASH_PREFIX = '#/?d='

/** TS 5.7 made Uint8Array generic; BufferSource only accepts the ArrayBuffer one. */
type Bytes = Uint8Array<ArrayBuffer>

async function through(
  bytes: Bytes,
  transform: CompressionStream | DecompressionStream,
): Promise<Bytes> {
  // BufferSource, not Uint8Array: that is what a (De)CompressionStream's
  // writable side declares, and TypeScript will not widen it for us.
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return new Uint8Array(await new Response(source.pipeThrough(transform)).arrayBuffer())
}

function toBase64Url(bytes: Bytes): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Bytes {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The `d=` value only — `shareHash` wraps it for a URL. */
export async function encodeDeck(deck: Deck): Promise<string> {
  const payload: Payload = { n: deck.name, m: deck.main, e: deck.eggs }
  const json = new TextEncoder().encode(JSON.stringify(payload))
  return toBase64Url(await through(json, new CompressionStream('deflate-raw')))
}

/** Returns a brand-new deck (fresh id), or null for anything unreadable. */
export async function decodeDeck(code: string): Promise<Deck | null> {
  try {
    const bytes = await through(fromBase64Url(code), new DecompressionStream('deflate-raw'))
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as Payload
    if (!payload || typeof payload !== 'object') return null
    const deck = newDeck(typeof payload.n === 'string' && payload.n ? payload.n : 'Shared deck')
    return { ...deck, main: sanitise(payload.m), eggs: sanitise(payload.e) }
  } catch {
    return null
  }
}

/** A shared link is untrusted input; only `id -> positive count` survives. */
function sanitise(pile: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!pile || typeof pile !== 'object') return out
  for (const [id, n] of Object.entries(pile as Record<string, unknown>)) {
    const count = Math.floor(Number(n))
    if (id && Number.isFinite(count) && count > 0) out[id] = count
  }
  return out
}

export async function shareHash(deck: Deck): Promise<string> {
  return ROUTE_HASH_PREFIX + (await encodeDeck(deck))
}

/** Splits `#/path?a=1` into its route and its query, tolerating a bare `#`. */
function splitHash(hash: string): { path: string; query: URLSearchParams } {
  const body = hash.startsWith('#') ? hash.slice(1) : hash
  const q = body.indexOf('?')
  if (q < 0) return { path: body, query: new URLSearchParams() }
  return { path: body.slice(0, q), query: new URLSearchParams(body.slice(q + 1)) }
}

/**
 * Pulls the payload out of a share hash, in either form: the current
 * `#/?d=<code>` and the original `#d=<code>`. Null when the hash carries no
 * deck — an ordinary route included.
 */
export function hashPayload(hash: string): string | null {
  // Checked first: as a route this would read as the path `/d=<code>`, so the
  // query parser below would never see it.
  if (hash.startsWith(HASH_PREFIX)) return hash.slice(HASH_PREFIX.length) || null
  return splitHash(hash).query.get('d') || null
}

/**
 * The same hash with the deck payload taken out, so consuming a shared link
 * leaves the route it arrived on intact. The original form carried nothing but
 * the payload, so it collapses to the builder route.
 */
export function hashWithoutPayload(hash: string): string {
  if (hash.startsWith(HASH_PREFIX)) return '#/'
  const { path, query } = splitHash(hash)
  if (!query.has('d')) return hash
  query.delete('d')
  const rest = query.toString()
  return '#' + (path || '/') + (rest ? '?' + rest : '')
}

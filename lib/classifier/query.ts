/**
 * The GET surface has two spellings of the same request. The path form is the
 * one people type: /spam,not+spam/Win+a+free+iPhone. The query form is the one
 * URL builders emit: /?labels=spam,not+spam&text=Win+a+free+iPhone. The two
 * mix, and a malformed request is answered with a URL that would have worked.
 */
import { readTier, type Tier } from './core'

export type GetRequest = {
  labels: string[]
  text: string
  tier: Tier
  instructions?: string
  multi?: { max?: number }
  verbose: boolean
  /** Which spelling the caller used; the usage hint mirrors it. */
  form: 'path' | 'query'
  /** Nothing here reads as a classification request: a single segment with no comma and no query. */
  nothing: boolean
  /** A tier the caller named that is neither fast nor smart, verbatim, so the error can quote it. */
  badTier?: string
}

// Names an agent guesses before reading the docs.
const ALIASES: Record<'text' | 'labels', string[]> = {
  text: ['input', 'content', 'message', 'body', 'sentence', 'query', 'q'],
  labels: ['label', 'classes', 'categories', 'options'],
}

const flag = (v: string | null) => v !== null && /^(1|true|yes|on)$/i.test(v)

function aliased(params: URLSearchParams, canonical: 'text' | 'labels'): string | null {
  if (params.has(canonical)) return params.get(canonical)
  const hit = ALIASES[canonical].find((n) => params.has(n))
  return hit ? params.get(hit) : null
}

/** True when the query string carries the request itself, not just options. */
export function hasClassifyQuery(url: URL): boolean {
  const p = url.searchParams
  return ['text', 'labels', ...ALIASES.text, ...ALIASES.labels].some((k) => p.has(k))
}

// The path arrives undecoded, so that a percent-encoded comma, slash or plus
// inside a label or the text stays a character while the raw ones stay
// separators: /C%2B%2B,python/x reads as the labels "C++" and "python".
const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
const plus = (s: string) => decode(s.replace(/\+/g, ' ')).trim()
const splitLabels = (s: string) => s.split(',').map(plus).filter(Boolean)

/**
 * Merge both spellings into one request. The query string wins where both say
 * something; the path fills whatever it left out.
 *
 * `path` is the raw pathname after the route's own prefix, still percent-encoded.
 */
export function readGet(path: string, url: URL): GetRequest {
  const params = url.searchParams
  const rawTier = params.get('tier')
  const tier = readTier(rawTier) ?? 'fast'
  const badTier = rawTier !== null && readTier(rawTier) === null ? rawTier : undefined
  const slash = path.indexOf('/')
  const pathLabels = splitLabels(slash > 0 ? path.slice(0, slash) : path)
  const pathText = slash > 0 ? plus(path.slice(slash + 1)) : ''
  const fromQuery = hasClassifyQuery(url)
  const qLabels = aliased(params, 'labels')
  const qText = aliased(params, 'text')
  const labels = qLabels !== null ? qLabels.split(',').map((l) => l.trim()).filter(Boolean) : pathLabels
  const text = qText !== null ? qText.trim() : pathText
  const maxRaw = params.get('max_labels')
  const maxNum = maxRaw !== null && maxRaw.trim() ? Number.parseInt(maxRaw, 10) : NaN
  const max = Number.isFinite(maxNum) && maxNum > 0 ? maxNum : undefined
  const instructions = params.get('instructions')
  return {
    labels,
    text,
    tier,
    instructions: instructions ?? undefined,
    multi: flag(params.get('multi')) || max ? { max } : undefined,
    verbose: flag(params.get('verbose')),
    form: fromQuery ? 'query' : 'path',
    nothing: !fromQuery && slash <= 0 && !path.includes(','),
    ...(badTier !== undefined ? { badTier } : {}),
  }
}

export const USAGE = 'GET /{labels}/{text}  or  GET /?labels={a,b}&text={text}'

const pathSegment = (s: string) => encodeURIComponent(s).replace(/%20/g, '+')
const querySegment = (s: string) => encodeURIComponent(s).replace(/%20/g, '+').replace(/%2C/gi, ',')

/**
 * A URL that would have worked, built from what the caller sent. Missing
 * pieces are filled with the same example the docs use.
 */
export function suggest(base: string, req: Pick<GetRequest, 'labels' | 'text' | 'form'>): string {
  let labels = [...new Set(req.labels.filter(Boolean))]
  if (labels.length === 0) labels = ['spam', 'not spam']
  else if (labels.length === 1) labels = [labels[0], `not ${labels[0]}`]
  const text = req.text.length > 0 && req.text.length <= 200 ? req.text : 'Win a free iPhone'
  if (req.form === 'query') return `${base}?labels=${querySegment(labels.join(','))}&text=${querySegment(text)}`
  return `${base}/${labels.map(pathSegment).join(',')}/${pathSegment(text)}`
}

/**
 * The classifier API, after classifier.dev:
 *
 *   GET  /api/classify                          the docs, plain text
 *   GET  /api/classify/{labels}/{text}          one classification, bare label
 *   GET  /api/classify?labels=a,b&text=...      the same, query form
 *   POST /api/classify                          JSON in, JSON out, batches
 *
 * Both GET forms answer a bare label unless ?verbose=1 or Accept: application/json.
 */
import { NextRequest } from 'next/server'
import {
  classifyMany,
  readTier,
  summarizeModels,
  upstreamReason,
  MAX_CHARS,
  MAX_INPUTS_PER_REQUEST,
  MAX_LABELS,
  TIERS,
  type ErrorCode,
  type MultiOpts,
  type Result,
  type Tier,
} from '@/lib/classifier/core'
import { readGet, suggest, USAGE, type GetRequest } from '@/lib/classifier/query'
import { limited } from '@/lib/classifier/limiter'
import { docs, API_PATH } from '@/lib/classifier/docs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A smart-tier batch re-asks a reasoning model per uncertain item.
export const maxDuration = 120

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Accept',
  'access-control-expose-headers': 'RateLimit-Limit, RateLimit-Remaining, Retry-After',
}

const text = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS, ...extra } })

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra },
  })

function originOf(req: NextRequest) {
  const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '')
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host
  return `${proto}://${host}`
}

function ipOf(req: NextRequest) {
  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  )
}

const shown = (ls: unknown[]) =>
  ls
    .slice(0, 5)
    .map((v) => {
      const l = typeof v === 'string' ? v : (JSON.stringify(v) ?? '')
      return `"${l.length > 40 ? l.slice(0, 37) + '...' : l}"`
    })
    .join(', ') + (ls.length > 5 ? ', ...' : '')

const truthy = (v: unknown) => v === true || v === 1 || (typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim()))

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return handle(req, ctx)
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  return handle(req, ctx)
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const url = new URL(req.url)
  const origin = originOf(req)
  const base = `${origin}${API_PATH}`
  const accept = req.headers.get('accept') ?? ''
  let wantJson = req.method === 'POST' || /\bapplication\/json\b/.test(accept)

  // The raw, still percent-encoded path after /api/classify, so a %2C inside
  // a label survives. Next has already decoded ctx.params, which is why the
  // pathname is read instead.
  const { path: segments } = await ctx.params
  const rawPath = segments?.length ? url.pathname.replace(/^\/api\/classify\/?/, '') : ''

  let getReq: GetRequest | undefined
  let inputs: string[] = []
  let labels: string[] = []
  let tier: Tier = 'fast'
  let instructions: string | undefined
  let multi: MultiOpts | undefined

  const fail = (message: string, status: number, code: ErrorCode, extra: Record<string, string> = {}) => {
    const hint = getReq && status === 400 ? { usage: USAGE, try: suggest(base, getReq) } : {}
    if (wantJson) return json({ error: message, code, ...hint }, status, extra)
    const lines = [`error: ${message}`]
    if (getReq && status === 400) lines.push(`usage: ${USAGE}`, `try: ${suggest(base, getReq)}`)
    return text(lines.join('\n') + '\n', status, extra)
  }

  if (req.method === 'POST') {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return fail(`Body must be JSON. See ${base}`, 400, 'bad_json')
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return fail(`Body must be a JSON object such as {"input":"...","labels":["a","b"]}. See ${base}`, 400, 'bad_json')
    }
    const b = body as Record<string, unknown>
    inputs = Array.isArray(b.inputs)
      ? (b.inputs as string[])
      : typeof b.inputs === 'string'
        ? [b.inputs]
        : typeof b.input === 'string'
          ? [b.input]
          : []
    labels = Array.isArray(b.labels) ? (b.labels as string[]) : []
    const named = readTier(b.tier)
    if (named === null) return fail(`tier must be "fast" or "smart"; got ${JSON.stringify(b.tier).slice(0, 40)}`, 400, 'bad_tier')
    tier = named
    if (typeof b.instructions === 'string') instructions = b.instructions
    const maxRaw = typeof b.max_labels === 'string' && b.max_labels.trim() ? Number(b.max_labels) : b.max_labels
    if (truthy(b.multi) || typeof maxRaw === 'number') {
      const max = typeof maxRaw === 'number' && Number.isFinite(maxRaw) ? Math.floor(maxRaw) : undefined
      multi = { max: max && max > 0 ? max : undefined }
    }
  } else {
    getReq = readGet(rawPath, url)
    if (getReq.nothing) {
      // Bare GET /api/classify: the documentation, exactly as the page shows it.
      if (!rawPath) return text(docs(origin), 200, { 'cache-control': 'public, max-age=300' })
      return fail(`Not found. The API is POST ${base}, GET ${base}/{labels}/{text} or GET ${base}?labels=a,b&text=...`, 404, 'not_found')
    }
    labels = getReq.labels
    inputs = [getReq.text]
    tier = getReq.tier
    instructions = getReq.instructions
    multi = getReq.multi
    wantJson = getReq.verbose || wantJson
    if (getReq.badTier !== undefined) return fail(`tier must be "fast" or "smart"; got ${JSON.stringify(getReq.badTier).slice(0, 40)}`, 400, 'bad_tier')
  }

  if (!inputs.length || !inputs[0]) {
    return fail(
      getReq && labels.length
        ? `No text to classify. Got ${labels.length} label${labels.length === 1 ? '' : 's'} (${shown(labels)}) and no text.`
        : `Provide text to classify. See ${base}`,
      400,
      'no_input',
    )
  }
  if (inputs.length > MAX_INPUTS_PER_REQUEST) return fail(`Maximum ${MAX_INPUTS_PER_REQUEST} inputs per request`, 400, 'too_many_inputs')
  if (labels.length < 2) {
    return fail(
      labels.length
        ? `Provide at least 2 labels; got ${labels.length} (${shown(labels)}).` + (getReq ? ' Separate labels with commas.' : '')
        : 'Provide at least 2 labels; none given.' + (getReq ? ' Put them in ?labels=a,b or as the first path segment.' : ''),
      400,
      'too_few_labels',
    )
  }
  if (labels.length > MAX_LABELS) return fail(`Maximum ${MAX_LABELS} labels`, 400, 'too_many_labels')
  if (labels.some((l) => typeof l !== 'string' || !l.trim())) return fail('Labels must be non-empty strings', 400, 'empty_label')
  if (new Set(labels).size !== labels.length) return fail('Labels must be distinct', 400, 'duplicate_labels')
  if (inputs.some((i) => typeof i !== 'string' || !i.trim())) return fail('Inputs must be non-empty strings', 400, 'empty_input')
  if (inputs.some((i) => i.length > MAX_CHARS)) return fail(`Each input must be at most ${MAX_CHARS.toLocaleString('en-US')} characters`, 400, 'input_too_long')

  const gate = limited(tier, ipOf(req), inputs.length)
  const limitHeaders = {
    'ratelimit-limit': String(TIERS[tier].rpm),
    'ratelimit-remaining': String(gate.remaining),
  }
  if (gate.limited) {
    const perDay = gate.scope === 'day'
    return fail(
      perDay
        ? `Daily limit reached: ${TIERS[tier].daily} ${tier} classifications per IP per day.`
        : `Rate limit: ${TIERS[tier].rpm} ${tier} classifications/minute per IP.`,
      429,
      perDay ? 'rate_limit_day' : 'rate_limit_minute',
      { ...limitHeaders, 'retry-after': String(gate.resetIn) },
    )
  }

  const started = Date.now()
  let results: Result[]
  let escalationFailed = 0
  try {
    ;({ results, escalationFailed } = await classifyMany(inputs, labels, tier, instructions, multi))
  } catch (e) {
    const msg = (e as Error).message
    const code = upstreamReason(msg)
    return fail(`upstream: ${msg}`, code === 'no_provider' ? 503 : 502, code, limitHeaders)
  }
  const ms = Date.now() - started

  if (!wantJson) {
    // The answer, nothing else. Multi-label answers are one label per line.
    const body = multi ? results.map((r) => (r.labels ?? []).join('\n')).join('\n') : results.map((r) => r.label).join('\n')
    return text(body + '\n', 200, limitHeaders)
  }
  if (req.method === 'GET') {
    return json({ ...results[0], tier }, 200, limitHeaders)
  }
  return json(
    {
      tier,
      ...summarizeModels(results),
      results: results.map((r) =>
        multi
          ? { labels: r.labels ?? [], scores: r.scores, unscored: r.unscored, ms: r.ms, model: r.model }
          : {
              label: r.label,
              confidence: r.confidence,
              scores: r.scores,
              unscored: r.unscored,
              escalated: r.escalated,
              ms: r.ms,
              model: r.model,
            },
      ),
      usage: {
        classifications: results.length,
        escalated: results.filter((r) => r.escalated).length,
        ...(escalationFailed ? { escalation_failed: escalationFailed } : {}),
        ms,
      },
    },
    200,
    limitHeaders,
  )
}

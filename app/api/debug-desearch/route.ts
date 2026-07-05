import { NextResponse } from 'next/server'

export const maxDuration = 60

// TEMPORARY diagnostic endpoint to inspect what Desearch actually returns in prod.
// Remove after debugging.
export async function GET() {
  const apiKey = process.env.DESEARCH_API_KEY
  const out: Record<string, unknown> = {
    keyPresent: !!apiKey,
    keyLen: apiKey ? apiKey.length : 0,
  }

  if (!apiKey) {
    return NextResponse.json(out)
  }

  const body = {
    prompt: 'who is the president',
    model: 'NOVA',
    tools: ['web'],
    date_filter: 'PAST_WEEK',
  }

  const start = Date.now()
  try {
    const r = await fetch('https://api.desearch.ai/desearch/ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify(body),
    })
    const text = await r.text()
    const ms = Date.now() - start

    // Parse SSE-style lines and collect the event types present
    const dataLines = text.split('\n').filter((l) => l.startsWith('data: '))
    const types: Record<string, number> = {}
    const sampleObjs: unknown[] = []
    for (const line of dataLines) {
      try {
        const d = JSON.parse(line.replace('data: ', ''))
        const t = (d && d.type) || 'unknown'
        types[t] = (types[t] || 0) + 1
        if (sampleObjs.length < 6) sampleObjs.push(d)
      } catch {
        // ignore
      }
    }

    out.status = r.status
    out.ms = ms
    out.contentType = r.headers.get('content-type')
    out.bytes = text.length
    out.dataLineCount = dataLines.length
    out.sseTypes = types
    out.isJsonNotSse = dataLines.length === 0
    out.bodySample = text.slice(0, 2500)
    out.sampleParsed = sampleObjs
  } catch (e) {
    out.fetchError = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    out.ms = Date.now() - start
  }

  return NextResponse.json(out)
}

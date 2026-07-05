import { NextResponse } from 'next/server'

export const maxDuration = 60

// TEMPORARY diagnostic endpoint for the Desearch outage. Remove after debugging.
export async function GET() {
  const apiKey = process.env.DESEARCH_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'DESEARCH_API_KEY not set' })
  }

  const started = Date.now()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55000)

    const response = await fetch('https://api.desearch.ai/desearch/ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({
        prompt: 'who is the current president of the united states',
        model: 'NOVA',
        tools: ['web'],
        date_filter: 'PAST_WEEK',
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const elapsedMs = Date.now() - started
    const text = await response.text()

    // Summarize the streaming event types so we can verify the parse format.
    const lines = text.split('\n').filter((l) => l.startsWith('data: '))
    const types: Record<string, number> = {}
    for (const line of lines) {
      try {
        const data = JSON.parse(line.replace('data: ', ''))
        const t = data?.type ?? 'unknown'
        types[t] = (types[t] || 0) + 1
      } catch {
        types['__unparseable_line'] = (types['__unparseable_line'] || 0) + 1
      }
    }

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      elapsedMs,
      keyPrefix: apiKey.slice(0, 4),
      bytes: text.length,
      dataLineCount: lines.length,
      eventTypes: types,
      rawHead: text.slice(0, 2500),
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      elapsedMs: Date.now() - started,
      error: (e as Error)?.name,
      message: (e as Error)?.message,
    })
  }
}

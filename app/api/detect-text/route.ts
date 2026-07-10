import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 60

// Lazy initialization to avoid build-time errors
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return null
  }
  return createClient(url, key)
}

// Track analytics event
async function trackDetectTextEvent(
  result: { isAI: boolean; confidence: number } | null,
  charCount: number,
  country?: string,
  city?: string,
) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) return

    await supabaseAdmin.from('analytics_events').insert({
      event_type: 'ai_detection',
      prompt: result
        ? `TEXT (${charCount} chars) — AI: ${result.isAI}, Confidence: ${(result.confidence * 100).toFixed(1)}%`
        : 'Text detection failed',
      model: 'its-ai-sn32',
      cost_estimate: 0.01,
      country,
      city,
    })
  } catch (e) {
    console.log('[Analytics] Could not track detect-text event:', e)
  }
}

type Sentence = { text: string; score: number }

// Normalize a value that may be 0-1 or 0-100 into a 0-1 probability
function toProbability(value: unknown): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  const p = value > 1 ? value / 100 : value
  return Math.max(0, Math.min(1, p))
}

export async function POST(req: NextRequest) {
  const country = req.headers.get('x-vercel-ip-country') || undefined
  const city = req.headers.get('x-vercel-ip-city') || undefined

  try {
    const body = await req.json()
    const text: string = typeof body?.text === 'string' ? body.text : ''
    const deepScan: boolean = Boolean(body?.deepScan)

    const trimmed = text.trim()
    if (!trimmed) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 })
    }
    if (trimmed.length > 500000) {
      return NextResponse.json(
        { error: 'Text is too long (500,000 character limit)' },
        { status: 400 },
      )
    }

    const apiKey = process.env.ITS_AI_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: "It's AI API key not configured" },
        { status: 500 },
      )
    }

    // It's AI (Bittensor Subnet 32) API contract:
    //   POST https://api.its-ai.org/api/text
    //   headers: Authorization: APIKey <key>
    //   body: { text, deep_scan }
    //   response: { status, answer: float[0,1] (AI probability),
    //               segmentation_tokens: float[] aligned to words (deep scan) }
    const response = await fetch('https://api.its-ai.org/api/text', {
      method: 'POST',
      headers: {
        Authorization: `APIKey ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: trimmed, deep_scan: deepScan }),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok || (data && data.status === 'error')) {
      const apiMsg: string | undefined =
        data?.error?.message || (typeof data?.error === 'string' ? data.error : undefined)
      console.error('[v0] Its AI API error:', response.status, JSON.stringify(data))

      // Surface auth/config problems clearly so they can be fixed.
      if (response.status === 401 || response.status === 403) {
        return NextResponse.json(
          {
            error:
              "It's AI rejected the API key. Add a valid ITS_AI_API_KEY from your its-ai.org account.",
          },
          { status: 502 },
        )
      }
      return NextResponse.json(
        { error: apiMsg || 'Failed to analyze text. Please try again.' },
        { status: 502 },
      )
    }

    // `answer` is the probability the text is AI-generated, in [0, 1].
    const aiProbability = toProbability(data?.answer) ?? 0
    const isAI = aiProbability >= 0.5

    // Deep scan returns per-word scores in `segmentation_tokens`, aligned to
    // whitespace-separated words. Build a word-level heatmap from them.
    let sentences: Sentence[] | undefined
    const tokens: unknown = data?.segmentation_tokens
    if (Array.isArray(tokens) && tokens.length > 0) {
      const words = trimmed.split(/(\s+)/) // keep whitespace to preserve spacing
      const wordScores: Sentence[] = []
      let tokenIndex = 0
      for (const chunk of words) {
        if (/^\s+$/.test(chunk) || chunk === '') {
          wordScores.push({ text: chunk, score: -1 }) // whitespace, no color
        } else {
          const raw = tokens[tokenIndex]
          const score = toProbability(raw) ?? 0
          wordScores.push({ text: chunk, score })
          tokenIndex++
        }
      }
      sentences = wordScores
    }

    trackDetectTextEvent(
      { isAI, confidence: isAI ? aiProbability : 1 - aiProbability },
      trimmed.length,
      country,
      city,
    )

    return NextResponse.json({
      isAI,
      // confidence is expressed as confidence in the reported verdict
      confidence: isAI ? aiProbability : 1 - aiProbability,
      aiProbability,
      sentences,
    })
  } catch (error) {
    console.error('[v0] Detect-text API error:', error)
    return NextResponse.json(
      { error: 'An error occurred while analyzing the text' },
      { status: 500 },
    )
  }
}

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

    const response = await fetch('https://api.its-ai.org/analyze-text', {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: trimmed, deep_scan: deepScan }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[v0] Its AI API error:', response.status, errorText)
      return NextResponse.json(
        { error: 'Failed to analyze text. Please try again.' },
        { status: response.status },
      )
    }

    const data = await response.json()

    // Be defensive about the response shape — normalize the AI probability
    // from whichever field the API returns it in.
    const aiProbability =
      toProbability(data?.ai_probability) ??
      toProbability(data?.probability) ??
      toProbability(data?.machine_generated_probability) ??
      toProbability(data?.score) ??
      toProbability(data?.fake_probability) ??
      0

    // A label may be provided directly; otherwise fall back to a 0.5 threshold.
    const labelSaysAI =
      typeof data?.label === 'string'
        ? /ai|machine|fake|generated/i.test(data.label)
        : typeof data?.is_ai === 'boolean'
          ? data.is_ai
          : undefined
    const isAI = labelSaysAI ?? aiProbability >= 0.5

    // Sentence-level heatmap (if returned by deep scan).
    const rawSentences: unknown =
      data?.sentences ?? data?.sentence_scores ?? data?.spans ?? null
    let sentences: Sentence[] | undefined
    if (Array.isArray(rawSentences)) {
      sentences = rawSentences
        .map((s: any): Sentence | null => {
          const sText =
            typeof s?.text === 'string'
              ? s.text
              : typeof s?.sentence === 'string'
                ? s.sentence
                : null
          const sScore =
            toProbability(s?.ai_probability) ??
            toProbability(s?.probability) ??
            toProbability(s?.score) ??
            0
          if (!sText) return null
          return { text: sText, score: sScore }
        })
        .filter((s): s is Sentence => s !== null)
      if (sentences.length === 0) sentences = undefined
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

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120 // 2 minutes for music generation

// ACE-Step text-to-music on Chutes (Bittensor SN64)
// Returns MP3 (audio/mpeg) binary directly for a { prompt, lyrics, audio_duration } POST body.
const CHUTES_MUSIC_ENDPOINTS = [
  'https://vonkaiser-ace-step-15-music-generator.chutes.ai/generate',
]

// Lazy initialization to avoid build-time errors
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(url, key)
}

// Track analytics event with location
async function trackEvent(
  eventType: string,
  prompt: string,
  model: string,
  costEstimate: number,
  location?: { country?: string; city?: string; region?: string }
) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    await supabaseAdmin.from('analytics_events').insert({
      event_type: eventType,
      prompt: prompt?.substring(0, 500),
      model,
      cost_estimate: costEstimate,
      country: location?.country,
      city: location?.city,
      region: location?.region,
    })
  } catch (e) {
    // Table may not exist, silently fail
    console.log('[Analytics] Could not track event:', e)
  }
}

// Generate music using ACE-Step on Chutes.
// Tries each deployment in order; if one is scaled-to-zero (503) it moves
// on to the next before giving up.
async function generateWithChutes(
  prompt: string,
  lyrics: string,
  duration: number,
  apiKey: string
): Promise<{ success: boolean; audioUrl?: string; error?: string }> {
  let lastError = 'Unknown error'

  for (const endpoint of CHUTES_MUSIC_ENDPOINTS) {
    try {
      console.log('[Music Gen] Trying ACE-Step:', endpoint)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          lyrics: lyrics || '[inst]',
          audio_duration: duration,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Music Gen] Chutes API error:', response.status, errorText.substring(0, 200))
        lastError = `Chutes error: ${response.status}`
        continue
      }

      // ACE-Step returns MP3 binary directly
      const audioBuffer = await response.arrayBuffer()

      if (audioBuffer.byteLength < 1000) {
        console.error('[Music Gen] Chutes returned too small response, likely error')
        lastError = 'Invalid audio response'
        continue
      }

      // Convert to base64 data URL
      const base64 = Buffer.from(audioBuffer).toString('base64')
      const audioUrl = `data:audio/mpeg;base64,${base64}`

      console.log('[Music Gen] ACE-Step success, audio size:', audioBuffer.byteLength)
      return { success: true, audioUrl }
    } catch (e) {
      console.error('[Music Gen] Chutes error:', e)
      lastError = e instanceof Error ? e.message : 'Unknown error'
    }
  }

  return { success: false, error: lastError }
}

export async function POST(req: Request) {
  try {
    // Extract geolocation from Vercel headers
    const country = req.headers.get('x-vercel-ip-country') || undefined
    const city = req.headers.get('x-vercel-ip-city') || undefined
    const region = req.headers.get('x-vercel-ip-country-region') || undefined
    const location = { country, city, region }

    const body = await req.json()
    const prompt: unknown = body?.prompt
    const lyrics: string = typeof body?.lyrics === 'string' ? body.lyrics : ''
    // Clamp duration to a sane range to avoid timeouts (8-60 seconds)
    const requestedDuration = Number(body?.duration)
    const duration = Number.isFinite(requestedDuration)
      ? Math.min(60, Math.max(8, Math.round(requestedDuration)))
      : 30

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }

    const chutesKey = process.env.CHUTES_API_KEY || 'cpk_afde1f0b527846fdbbbd5a7d93c03da3.76529c1096d454ef926e723b84884c28.D4SlcUViJeOli3X9N37tp76DzF3vP0Di'

    if (!chutesKey) {
      return NextResponse.json(
        { error: 'Music generation is temporarily unavailable. No API key configured.' },
        { status: 503 }
      )
    }

    const result = await generateWithChutes(prompt, lyrics, duration, chutesKey)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Music generation failed' },
        { status: 500 }
      )
    }

    // Track the music generation event
    await trackEvent('music_generation', prompt, 'chutes/ace-step', 0.02, location)

    return NextResponse.json({
      success: true,
      audioUrl: result.audioUrl,
      prompt,
      model: 'chutes/ace-step',
    })
  } catch (error) {
    console.error('[Music Gen] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Music generation failed' },
      { status: 500 }
    )
  }
}

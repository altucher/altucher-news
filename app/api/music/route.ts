import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120 // ACE-Step generation can take ~30-40s

// ACE-Step text-to-music on Chutes (Bittensor SN64)
const CHUTES_ACE_STEP_API = 'https://vonkaiser-ace-step-15-music-generator.chutes.ai/generate'

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

export async function POST(req: Request) {
  try {
    // Extract geolocation from Vercel headers
    const country = req.headers.get('x-vercel-ip-country') || undefined
    const city = req.headers.get('x-vercel-ip-city') || undefined
    const region = req.headers.get('x-vercel-ip-country-region') || undefined
    const location = { country, city, region }

    const { prompt, lyrics, duration } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    const chutesKey =
      process.env.CHUTES_API_KEY ||
      'cpk_afde1f0b527846fdbbbd5a7d93c03da3.76529c1096d454ef926e723b84884c28.D4SlcUViJeOli3X9N37tp76DzF3vP0Di'

    if (!chutesKey) {
      return NextResponse.json(
        { error: 'Music generation is temporarily unavailable. No API key configured.' },
        { status: 503 }
      )
    }

    // Clamp duration to a sane range (default 30s)
    const audioDuration = Math.min(Math.max(Number(duration) || 30, 10), 120)

    console.log('[Music Gen] Requesting ACE-Step on Chutes (SN64)...')
    const response = await fetch(CHUTES_ACE_STEP_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chutesKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        lyrics: typeof lyrics === 'string' ? lyrics : '',
        audio_duration: audioDuration,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Music Gen] Chutes ACE-Step error:', response.status, errorText.substring(0, 200))
      // 503 = chute scaled to zero / no instances available
      if (response.status === 503) {
        return NextResponse.json(
          { error: 'The music generator is warming up. Please try again in a moment.' },
          { status: 503 }
        )
      }
      return NextResponse.json({ error: `Music generation failed (${response.status})` }, { status: 500 })
    }

    // ACE-Step returns MP3 (audio/mpeg) binary directly
    const audioBuffer = await response.arrayBuffer()

    if (audioBuffer.byteLength < 1000) {
      console.error('[Music Gen] Response too small, likely an error')
      return NextResponse.json({ error: 'Invalid audio response' }, { status: 500 })
    }

    const base64 = Buffer.from(audioBuffer).toString('base64')
    const audioUrl = `data:audio/mpeg;base64,${base64}`

    console.log('[Music Gen] ACE-Step success, audio size:', audioBuffer.byteLength)

    // Track the music generation event
    await trackEvent('music_generation', prompt, 'chutes/ace-step-1.5', 0.02, location)

    return NextResponse.json({
      success: true,
      audioUrl,
      prompt,
      model: 'chutes/ace-step-1.5',
    })
  } catch (error) {
    console.error('[Music Gen] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Music generation failed' },
      { status: 500 }
    )
  }
}

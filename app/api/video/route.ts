import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 300 // LTX video generation can take a few minutes

// LTX-23-Video text-to-video on Chutes (Bittensor SN64)
// NOTE: this chute expects a FLAT JSON body (no "args" wrapper) and returns
// an mp4 binary directly.
const CHUTES_LTX_VIDEO_API = 'https://vonkaiser-ltx-23-video.chutes.ai/generate'

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

    const { prompt } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    const chutesKey = process.env.CHUTES_API_KEY

    if (!chutesKey) {
      return NextResponse.json(
        { error: 'Video generation is temporarily unavailable. No API key configured.' },
        { status: 503 }
      )
    }

    console.log('[Video Gen] Requesting LTX-23-Video on Chutes (SN64)...')

    // Flat body (no "args" wrapper). Keep steps/frames/resolution modest so a
    // generation completes well within the serverless time budget.
    const requestBody = JSON.stringify({
      prompt,
      num_frames: 25,
      num_inference_steps: 5,
      width: 640,
      height: 384,
      video_format: 'mp4',
    })

    // The chute scales to zero, so the first call after idle often returns a
    // 502/503 while it cold-starts. Retry a few times with backoff so a warm-up
    // blip doesn't surface to the user as a hard failure.
    let response: Response | null = null
    const maxAttempts = 4
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      response = await fetch(CHUTES_LTX_VIDEO_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${chutesKey}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      })

      // 502/503 = chute cold-starting / no instances yet. Wait and retry.
      if (response.status === 502 || response.status === 503) {
        console.log(`[Video Gen] Chute warming up (${response.status}), attempt ${attempt}/${maxAttempts}`)
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 8000))
          continue
        }
      }
      break
    }

    if (!response || !response.ok) {
      const status = response?.status ?? 500
      const errorText = response ? await response.text().catch(() => '') : ''
      console.error('[Video Gen] Chutes LTX error:', status, errorText.substring(0, 200))
      // Cold-start / capacity errors: ask the user to retry shortly.
      if (status === 502 || status === 503) {
        return NextResponse.json(
          { error: 'The video generator is warming up (it scales down when idle). Please try again in about 30 seconds.' },
          { status: 503 }
        )
      }
      return NextResponse.json({ error: `Video generation failed (${status})` }, { status: 500 })
    }

    // LTX returns mp4 (video/mp4) binary directly
    const videoBuffer = await response.arrayBuffer()

    if (videoBuffer.byteLength < 5000) {
      console.error('[Video Gen] Response too small, likely an error')
      return NextResponse.json({ error: 'Invalid video response' }, { status: 500 })
    }

    const base64 = Buffer.from(videoBuffer).toString('base64')
    const videoUrl = `data:video/mp4;base64,${base64}`

    console.log('[Video Gen] LTX-23-Video success, video size:', videoBuffer.byteLength)

    // Track the video generation event
    await trackEvent('video_generation', prompt, 'chutes/ltx-23-video', 0.05, location)

    return NextResponse.json({
      success: true,
      videoUrl,
      prompt,
      model: 'chutes/ltx-23-video',
    })
  } catch (error) {
    console.error('[Video Gen] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Video generation failed' },
      { status: 500 }
    )
  }
}

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120 // 2 minutes for image generation

// Chutes Image API (Bittensor SN64) with DreamShaper XL 1.0
const CHUTES_IMAGE_API = 'https://image.chutes.ai/generate'
const DREAMSHAPER_MODEL = 'Lykon/dreamshaper-xl-1-0'

// Supabase admin client for analytics tracking
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Track analytics event with location
async function trackEvent(
  eventType: string, 
  prompt: string, 
  model: string, 
  costEstimate: number,
  location?: { country?: string; city?: string; region?: string }
) {
  try {
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
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }

    const apiKey = process.env.CHUTES_API_KEY || 'cpk_afde1f0b527846fdbbbd5a7d93c03da3.76529c1096d454ef926e723b84884c28.D4SlcUViJeOli3X9N37tp76DzF3vP0Di'

    console.log('[Image Gen] Generating image via Chutes DreamShaper XL for prompt:', prompt.substring(0, 50))

    const response = await fetch(CHUTES_IMAGE_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DREAMSHAPER_MODEL,
        prompt: prompt,
        negative_prompt: 'blur, distortion, low quality, ugly, deformed',
        guidance_scale: 7.5,
        width: 1024,
        height: 1024,
        num_inference_steps: 25,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Image Gen] Chutes API error:', response.status, errorText)
      return NextResponse.json(
        { error: `Image generation failed: ${errorText.substring(0, 200)}` },
        { status: response.status }
      )
    }

    // The API returns the raw JPEG image
    const imageBuffer = await response.arrayBuffer()
    
    // Convert to base64 data URL
    const base64 = Buffer.from(imageBuffer).toString('base64')
    const imageUrl = `data:image/jpeg;base64,${base64}`

    console.log('[Image Gen] Success, generated image size:', imageBuffer.byteLength)

    // Track the image generation event
    await trackEvent('image_generation', prompt, DREAMSHAPER_MODEL, 0.02, location)

    return NextResponse.json({
      success: true,
      imageUrl,
      prompt,
    })
  } catch (error) {
    console.error('[Image Gen] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Image generation failed' },
      { status: 500 }
    )
  }
}

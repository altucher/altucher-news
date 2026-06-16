import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120 // 2 minutes for image generation

// Z Image Turbo on Chutes (Bittensor SN64) - Primary
// Multiple chute deployments are tried in order so a single chute being
// scaled-to-zero ("No instances available") doesn't break image generation.
const CHUTES_Z_IMAGE_ENDPOINTS = [
  'https://vonkaiser-z-image-turbo.chutes.ai/generate',
  'https://chutes-z-image-turbo.chutes.ai/generate',
]

// Fal.ai FLUX schnell - Fallback
const FAL_API_URL = 'https://fal.run/fal-ai/flux/schnell'

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

// Generate image using Chutes Z Image Turbo.
// Tries each deployment in order; if one is scaled-to-zero (503) it moves
// on to the next before giving up.
async function generateWithChutes(prompt: string, apiKey: string): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  let lastError = 'Unknown error'

  for (const endpoint of CHUTES_Z_IMAGE_ENDPOINTS) {
    try {
      console.log('[Image Gen] Trying Chutes Z Image Turbo:', endpoint)

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Image Gen] Chutes API error:', response.status, errorText.substring(0, 200))
        lastError = `Chutes error: ${response.status}`
        continue
      }

      // Z Image Turbo returns PNG binary directly
      const imageBuffer = await response.arrayBuffer()

      if (imageBuffer.byteLength < 1000) {
        console.error('[Image Gen] Chutes returned too small response, likely error')
        lastError = 'Invalid image response'
        continue
      }

      // Convert to base64 data URL
      const base64 = Buffer.from(imageBuffer).toString('base64')
      const imageUrl = `data:image/png;base64,${base64}`

      console.log('[Image Gen] Chutes Z Image Turbo success, image size:', imageBuffer.byteLength)
      return { success: true, imageUrl }
    } catch (e) {
      console.error('[Image Gen] Chutes error:', e)
      lastError = e instanceof Error ? e.message : 'Unknown error'
    }
  }

  return { success: false, error: lastError }
}

// Generate image using Fal.ai FLUX (fallback)
async function generateWithFal(prompt: string, apiKey: string): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  try {
    console.log('[Image Gen] Trying Fal.ai FLUX schnell (fallback)...')
    
    const response = await fetch(FAL_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt,
        image_size: 'landscape_16_9',
        num_inference_steps: 4,
        num_images: 1,
        enable_safety_checker: false,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Image Gen] Fal.ai API error:', response.status, errorText.substring(0, 200))
      return { success: false, error: `Fal error: ${response.status}` }
    }

    const data = await response.json()
    const imageUrl = data.images?.[0]?.url
    
    if (!imageUrl) {
      console.error('[Image Gen] No image URL in Fal response:', data)
      return { success: false, error: 'No image in response' }
    }

    console.log('[Image Gen] Fal.ai FLUX success')
    return { success: true, imageUrl }
  } catch (e) {
    console.error('[Image Gen] Fal error:', e)
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
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

    const chutesKey = process.env.CHUTES_API_KEY || 'cpk_afde1f0b527846fdbbbd5a7d93c03da3.76529c1096d454ef926e723b84884c28.D4SlcUViJeOli3X9N37tp76DzF3vP0Di'
    const falKey = process.env.FAL_KEY
    
    if (!chutesKey && !falKey) {
      return NextResponse.json(
        { error: 'Image generation is temporarily unavailable. No API keys configured.' },
        { status: 503 }
      )
    }

    let result: { success: boolean; imageUrl?: string; error?: string } = { success: false }
    let model = 'unknown'

    // Try Chutes Z Image Turbo first (decentralized, on Bittensor)
    if (chutesKey) {
      result = await generateWithChutes(prompt, chutesKey)
      if (result.success) {
        model = 'chutes/z-image-turbo'
      }
    }

    // Fallback to Fal.ai FLUX if Chutes failed
    if (!result.success && falKey) {
      result = await generateWithFal(prompt, falKey)
      if (result.success) {
        model = 'fal-ai/flux/schnell'
      }
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Image generation failed' },
        { status: 500 }
      )
    }

    // Track the image generation event
    await trackEvent('image_generation', prompt, model, model.includes('chutes') ? 0.01 : 0.003, location)

    return NextResponse.json({
      success: true,
      imageUrl: result.imageUrl,
      prompt,
      model,
    })
  } catch (error) {
    console.error('[Image Gen] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Image generation failed' },
      { status: 500 }
    )
  }
}

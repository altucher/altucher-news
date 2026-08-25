import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120 // 2 minutes for image generation

// Chutes image models (Bittensor SN64), tried in order.
// Qwen-Image-2512 is the latest / highest-quality model; Z Image Turbo is the
// fast fallback that also covers the case where Qwen is scaled to zero (503).
const CHUTES_IMAGE_MODELS: { label: string; endpoint: string }[] = [
  { label: 'chutes/qwen-image-2512', endpoint: 'https://vonkaiser-qwen-image-2512.chutes.ai/generate' },
  { label: 'chutes/z-image-turbo', endpoint: 'https://vonkaiser-z-image-turbo.chutes.ai/generate' },
]

// Fal.ai FLUX schnell - last-resort fallback
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

// Generate image using a Chutes image model. These endpoints return the image
// binary directly (JPEG or PNG depending on the model).
async function generateWithChutes(
  prompt: string,
  apiKey: string,
  endpoint: string,
  label: string,
): Promise<{ success: boolean; imageUrl?: string; error?: string }> {
  try {
    console.log(`[Image Gen] Trying ${label}...`)

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
      console.error(`[Image Gen] ${label} error:`, response.status, errorText.substring(0, 200))
      return { success: false, error: `Chutes error: ${response.status}` }
    }

    // Chutes image chutes return the image binary directly.
    const imageBuffer = await response.arrayBuffer()

    if (imageBuffer.byteLength < 1000) {
      console.error(`[Image Gen] ${label} returned too small response, likely error`)
      return { success: false, error: 'Invalid image response' }
    }

    // Preserve the actual image format returned by the model.
    const contentType = response.headers.get('content-type') || 'image/png'
    const mime = contentType.startsWith('image/') ? contentType : 'image/png'
    const base64 = Buffer.from(imageBuffer).toString('base64')
    const imageUrl = `data:${mime};base64,${base64}`

    console.log(`[Image Gen] ${label} success, image size:`, imageBuffer.byteLength)
    return { success: true, imageUrl }
  } catch (e) {
    console.error(`[Image Gen] ${label} error:`, e)
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
  }
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

    const chutesKey = process.env.CHUTES_API_KEY
    const falKey = process.env.FAL_KEY
    
    if (!chutesKey && !falKey) {
      return NextResponse.json(
        { error: 'Image generation is temporarily unavailable. No API keys configured.' },
        { status: 503 }
      )
    }

    let result: { success: boolean; imageUrl?: string; error?: string } = { success: false }
    let model = 'unknown'

    // Try Chutes image models in order: latest (Qwen-Image-2512) first, then the
    // fast Z Image Turbo fallback (also covers Qwen scaled-to-zero 503s).
    if (chutesKey) {
      for (const { label, endpoint } of CHUTES_IMAGE_MODELS) {
        result = await generateWithChutes(prompt, chutesKey, endpoint, label)
        if (result.success) {
          model = label
          break
        }
      }
    }

    // Last-resort fallback to Fal.ai FLUX if all Chutes models failed
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

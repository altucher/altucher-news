import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 120 // 2 minutes for image generation

// Fal.ai API for image generation (FLUX schnell - fast and high quality)
const FAL_API_URL = 'https://fal.run/fal-ai/flux/schnell'
const FAL_MODEL = 'fal-ai/flux/schnell'

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
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }

    const apiKey = process.env.FAL_KEY
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Image generation is temporarily unavailable. FAL_KEY not configured.' },
        { status: 503 }
      )
    }

    console.log('[Image Gen] Generating image via Fal.ai FLUX schnell for prompt:', prompt.substring(0, 50))

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
      console.error('[Image Gen] Fal.ai API error:', response.status, errorText)
      return NextResponse.json(
        { error: `Image generation failed: ${errorText.substring(0, 200)}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    
    // Fal.ai returns an object with images array containing URLs
    const imageUrl = data.images?.[0]?.url
    
    if (!imageUrl) {
      console.error('[Image Gen] No image URL in response:', data)
      return NextResponse.json(
        { error: 'No image generated' },
        { status: 500 }
      )
    }

    console.log('[Image Gen] Success, generated image URL:', imageUrl.substring(0, 50))

    // Track the image generation event
    await trackEvent('image_generation', prompt, FAL_MODEL, 0.003, location)

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

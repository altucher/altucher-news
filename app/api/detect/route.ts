import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
async function trackDetectEvent(result: { isAI: boolean; confidence: number } | null, country?: string, city?: string) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    if (!supabaseAdmin) return
    
    await supabaseAdmin.from('analytics_events').insert({
      event_type: 'ai_detection',
      prompt: result ? `AI: ${result.isAI}, Confidence: ${(result.confidence * 100).toFixed(1)}%` : 'Detection failed',
      model: 'bitmind',
      cost_estimate: 0.01,
      country,
      city,
    })
  } catch (e) {
    console.log('[Analytics] Could not track detect event:', e)
  }
}

export async function POST(req: NextRequest) {
  // Extract geolocation from Vercel headers
  const country = req.headers.get('x-vercel-ip-country') || undefined
  const city = req.headers.get('x-vercel-ip-city') || undefined
  
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const url = formData.get('url') as string | null

    const apiKey = process.env.BITMIND_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'BitMind API key not configured' },
        { status: 500 }
      )
    }

    let response: Response

    if (file) {
      // Upload file directly to BitMind
      const bitmindFormData = new FormData()
      bitmindFormData.append('image', file)

      response = await fetch('https://api.bitmind.ai/detect-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: bitmindFormData,
      })
    } else if (url) {
      // Send URL to BitMind
      response = await fetch('https://api.bitmind.ai/detect-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: url }),
      })
    } else {
      return NextResponse.json(
        { error: 'No image provided' },
        { status: 400 }
      )
    }

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[v0] BitMind API error:', response.status, errorText)
      return NextResponse.json(
        { error: 'Failed to analyze image. Please try again.' },
        { status: response.status }
      )
    }

    const data = await response.json()
    
    // Track successful detection
    trackDetectEvent({ isAI: data.isAI, confidence: data.confidence }, country, city)
    
    return NextResponse.json({
      isAI: data.isAI,
      confidence: data.confidence,
      similarity: data.similarity,
    })
  } catch (error) {
    console.error('[v0] Detect API error:', error)
    return NextResponse.json(
      { error: 'An error occurred while analyzing the image' },
      { status: 500 }
    )
  }
}

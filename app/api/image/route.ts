import { NextResponse } from 'next/server'

export const maxDuration = 120 // 2 minutes for image generation

// Use Corcel API (TAO Subnet 26 - Tensor Alchemy) for image generation
// OpenAI-compatible endpoint: https://api.corcel.io/bittensor/v1/images/generations
const CORCEL_API_URL = 'https://api.corcel.io/bittensor/v1/images/generations'

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }

    const apiKey = process.env.CORCEL_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'CORCEL_API_KEY not configured' },
        { status: 500 }
      )
    }

    console.log('[Image Gen] Generating image via Corcel for prompt:', prompt.substring(0, 50))

    const response = await fetch(CORCEL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        prompt,
        model: 'flux-schnell',
        n: 1,
        size: '1024x1024',
      }),
    })

    const responseText = await response.text()
    console.log('[Image Gen] Response status:', response.status)

    if (!response.ok) {
      console.error('[Image Gen] Corcel error:', response.status, responseText.substring(0, 200))
      return NextResponse.json(
        { error: `Image generation failed: ${responseText.substring(0, 200)}` },
        { status: response.status }
      )
    }

    let data
    try {
      data = JSON.parse(responseText)
    } catch {
      console.error('[Image Gen] Invalid JSON response')
      return NextResponse.json(
        { error: 'Invalid response from Corcel' },
        { status: 500 }
      )
    }

    console.log('[Image Gen] Success, response keys:', Object.keys(data))

    // Handle various response formats
    const imageUrl = data.url || data.image_url || data.data?.[0]?.url || data.data?.[0]?.b64_json || data.image

    if (!imageUrl) {
      console.error('[Image Gen] No image URL in response:', JSON.stringify(data).substring(0, 300))
      return NextResponse.json(
        { error: 'No image URL in response' },
        { status: 500 }
      )
    }

    // If it's base64, prefix it
    const finalUrl = imageUrl.startsWith('http') || imageUrl.startsWith('data:') 
      ? imageUrl 
      : `data:image/png;base64,${imageUrl}`

    return NextResponse.json({
      success: true,
      imageUrl: finalUrl,
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

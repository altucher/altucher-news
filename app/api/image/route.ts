import { NextResponse } from 'next/server'

export const maxDuration = 120 // 2 minutes for image generation

const CHUTES_API_URL = 'https://chutes.ai/api/chutes/chutes/z-image-turbo/run'

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }

    const apiKey = process.env.CHUTES_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'CHUTES_API_KEY not configured' },
        { status: 500 }
      )
    }

    console.log('[Image Gen] Generating image for prompt:', prompt.substring(0, 50))

    const response = await fetch(CHUTES_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        num_inference_steps: 4,
        guidance_scale: 0,
        width: 1024,
        height: 1024,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Image Gen] Chutes API error:', response.status, errorText)
      return NextResponse.json(
        { error: `Image generation failed: ${errorText}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log('[Image Gen] Success, response keys:', Object.keys(data))

    // The response format may vary - handle different possible formats
    let imageUrl = data.image || data.url || data.output || data.image_url
    
    // If it's base64, prefix it
    if (imageUrl && !imageUrl.startsWith('http') && !imageUrl.startsWith('data:')) {
      imageUrl = `data:image/png;base64,${imageUrl}`
    }

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

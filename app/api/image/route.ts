import { NextResponse } from 'next/server'

export const maxDuration = 120 // 2 minutes for image generation

// Use the Chutes invocations API for calling public chutes
const CHUTES_API_URL = 'https://api.chutes.ai/v1/chutes/chutes/z-image-turbo/run'

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
        { error: 'CHUTES_API_KEY not configured. Please add your Chutes API key in the environment variables.' },
        { status: 500 }
      )
    }

    console.log('[Image Gen] Generating image for prompt:', prompt.substring(0, 50))
    console.log('[Image Gen] API Key prefix:', apiKey.substring(0, 10))

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

    const responseText = await response.text()
    console.log('[Image Gen] Response status:', response.status)
    console.log('[Image Gen] Response preview:', responseText.substring(0, 200))

    if (!response.ok) {
      console.error('[Image Gen] Chutes API error:', response.status, responseText)
      return NextResponse.json(
        { error: `Image generation failed: ${responseText.substring(0, 200)}` },
        { status: response.status }
      )
    }

    // Try to parse as JSON
    let data
    try {
      data = JSON.parse(responseText)
    } catch {
      // If not JSON, might be binary image data
      console.log('[Image Gen] Response is not JSON, treating as binary')
      const base64 = Buffer.from(responseText).toString('base64')
      return NextResponse.json({
        success: true,
        imageUrl: `data:image/png;base64,${base64}`,
        prompt,
      })
    }

    console.log('[Image Gen] Success, response keys:', Object.keys(data))

    // The response format may vary - handle different possible formats
    let imageUrl = data.image || data.url || data.output || data.image_url || data.b64_json
    
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

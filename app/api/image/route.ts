import { NextResponse } from 'next/server'

export const maxDuration = 120 // 2 minutes for image generation

// Use Vercel AI Gateway for image generation (simpler than Chutes custom chutes)
const AI_GATEWAY_URL = 'https://api.vercel.ai/v1/images/generations'

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }

    console.log('[Image Gen] Generating image for prompt:', prompt.substring(0, 50))

    // Use Vercel AI Gateway - works out of the box in v0
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[Image Gen] AI Gateway error:', response.status, errorText)
      return NextResponse.json(
        { error: `Image generation failed: ${errorText.substring(0, 200)}` },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log('[Image Gen] Success, response:', JSON.stringify(data).substring(0, 200))

    // OpenAI-style response format
    const imageUrl = data.data?.[0]?.url || data.data?.[0]?.b64_json

    if (!imageUrl) {
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

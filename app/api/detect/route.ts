import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
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

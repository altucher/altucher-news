import { NextResponse } from 'next/server'

export const maxDuration = 120 // 2 minutes for image generation

// WOMBO Dream API (Bittensor Subnet 30)
// Uses the dream-api npm package

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json()

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      )
    }

    const apiKey = process.env.WOMBO_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'WOMBO_API_KEY not configured. Get your API key from https://dream.ai' },
        { status: 500 }
      )
    }

    console.log('[Image Gen] Generating image via WOMBO Dream (SN30) for prompt:', prompt.substring(0, 50))

    // WOMBO Dream API endpoint
    // First, create a task
    const createTaskResponse = await fetch('https://api.luan.tools/api/tasks/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        use_target_image: false,
      }),
    })

    if (!createTaskResponse.ok) {
      const errorText = await createTaskResponse.text()
      console.error('[Image Gen] Failed to create task:', errorText)
      return NextResponse.json(
        { error: `Failed to create image task: ${errorText.substring(0, 200)}` },
        { status: createTaskResponse.status }
      )
    }

    const taskData = await createTaskResponse.json()
    const taskId = taskData.id

    console.log('[Image Gen] Created task:', taskId)

    // Start the image generation
    const generateResponse = await fetch(`https://api.luan.tools/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input_spec: {
          style: 115, // FLUX style
          prompt: prompt,
          display_freq: 10,
          width: 1024,
          height: 1024,
        },
      }),
    })

    if (!generateResponse.ok) {
      const errorText = await generateResponse.text()
      console.error('[Image Gen] Failed to start generation:', errorText)
      return NextResponse.json(
        { error: `Failed to start generation: ${errorText.substring(0, 200)}` },
        { status: generateResponse.status }
      )
    }

    // Poll for completion
    let imageUrl = null
    let attempts = 0
    const maxAttempts = 60 // 60 seconds max

    while (!imageUrl && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const statusResponse = await fetch(`https://api.luan.tools/api/tasks/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      })

      if (!statusResponse.ok) {
        attempts++
        continue
      }

      const statusData = await statusResponse.json()
      
      if (statusData.state === 'completed' && statusData.result) {
        imageUrl = statusData.result
        break
      } else if (statusData.state === 'failed') {
        console.error('[Image Gen] Generation failed:', statusData)
        return NextResponse.json(
          { error: 'Image generation failed' },
          { status: 500 }
        )
      }
      
      attempts++
    }

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Image generation timed out' },
        { status: 504 }
      )
    }

    console.log('[Image Gen] Success, image URL:', imageUrl.substring(0, 50))

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

import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

// Vocence PromptTTS proxy (Bittensor Subnet 78)
// Configure with VOCENCE_API_URL and VOCENCE_API_KEY environment variables.
// Until those are set, this route returns 503 so the client can fall back to
// the browser's built-in speech synthesis.

const VOCENCE_API_URL = process.env.VOCENCE_API_URL // e.g. https://api.vocence.ai
const VOCENCE_API_KEY = process.env.VOCENCE_API_KEY

export async function POST(req: NextRequest) {
  try {
    const { text, instruction } = await req.json()

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 })
    }

    // Vocence has a practical per-request length limit; trim very long inputs.
    const trimmedText = text.length > 2000 ? text.slice(0, 2000) : text

    // If Vocence isn't configured yet, tell the client to use its local fallback.
    if (!VOCENCE_API_URL || !VOCENCE_API_KEY) {
      return NextResponse.json(
        {
          error: 'Vocence TTS not configured',
          fallback: 'browser',
        },
        { status: 503 }
      )
    }

    const voiceInstruction =
      typeof instruction === 'string' && instruction.trim()
        ? instruction
        : 'gender: female | pitch: mid | speed: normal | emotion: neutral'

    const response = await fetch(`${VOCENCE_API_URL.replace(/\/$/, '')}/speak`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${VOCENCE_API_KEY}`,
      },
      body: JSON.stringify({
        text: trimmedText,
        instruction: voiceInstruction,
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      console.log('[v0] Vocence TTS error:', response.status, errText.slice(0, 200))
      return NextResponse.json(
        { error: 'Vocence TTS request failed', fallback: 'browser' },
        { status: 502 }
      )
    }

    // Vocence returns audio (WAV). Stream it straight back to the client.
    const audioBuffer = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || 'audio/wav'

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.log('[v0] TTS route error:', error)
    return NextResponse.json(
      { error: 'Text-to-speech failed', fallback: 'browser' },
      { status: 500 }
    )
  }
}

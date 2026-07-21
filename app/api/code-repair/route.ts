import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { extractProjectArtifact, serializeProject, validateInteractiveBuild, validateProject } from '@/lib/project-document'

export const maxDuration = 300

const MAX_INPUT_BYTES = 1_500_000

export async function POST(request: Request) {
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_INPUT_BYTES) {
      return Response.json({ error: 'Build is too large to repair.' }, { status: 413 })
    }

    const body = JSON.parse(raw) as { responseText?: string; instruction?: string }
    const responseText = typeof body.responseText === 'string' ? body.responseText : ''
    const instruction = typeof body.instruction === 'string' ? body.instruction.slice(0, 4_000) : ''
    if (!responseText.trim()) return Response.json({ error: 'Missing build output.' }, { status: 400 })

    const apiKey = process.env.CHUTES_API_KEY
    if (!apiKey) return Response.json({ error: 'Repair service is not configured.' }, { status: 503 })
    const chutes = createOpenAICompatible({
      name: 'chutes-repair',
      apiKey,
      baseURL: 'https://llm.chutes.ai/v1',
    })

    const { text } = await generateText({
      model: chutes('Qwen/Qwen3.5-397B-A17B-TEE'),
      maxOutputTokens: 24_000,
      temperature: 0.15,
      abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(3 * 60_000)]),
      system: `You repair malformed, unfinished, or functionally incomplete BlueTAO web builds. Return ONLY one fenced html block containing a complete self-contained HTML document with all authored CSS inside style tags and all authored JavaScript inside script tags. Include the doctype, html, head, responsive viewport metadata, body, closing html tag, and closing markdown fence. Produce a complete responsive website or fully playable game, not a fragment. For games, implement the complete requested mechanics including controls, update loop, collision detection, score, lives/game-over, restart, responsive play area, and all subject-specific rules; Space Invaders must include a moving enemy formation, player and enemy projectiles, waves or victory progression, and desktop plus touch controls. Never include escaped source, placeholders, TODOs, duplicate local asset tags, prose, or markdown outside the single artifact. Preserve valid intent, but replace weak or broken implementation completely when necessary.`,
      prompt: `ORIGINAL USER REQUEST:\n${instruction || 'Build the requested complete website.'}\n\nFAILED OR INCOMPLETE MODEL OUTPUT:\n${responseText}`,
    })

    const project = extractProjectArtifact(text)
    if (!project) return Response.json({ error: 'Repair did not return a valid project.' }, { status: 422 })
    const errors = [...validateProject(project), ...validateInteractiveBuild(project, instruction)]
    if (errors.length) return Response.json({ error: 'Repair remained incomplete.', details: errors }, { status: 422 })

    return Response.json({ code: serializeProject(project), status: 'repaired' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown repair error'
    return Response.json({ error: message }, { status: 500 })
  }
}

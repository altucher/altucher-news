import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { gateway } from '@ai-sdk/gateway'
import { applyProjectPatches, bundleProject, extractPatchArtifact, extractProjectArtifact, normalizeProject, serializeProject, validateProject } from '@/lib/project-document'
import { validateHtmlDocument } from '@/lib/code-validation'

// Best Quality uses Kimi K2.6, a light reasoning model (~2.8k chars of thinking,
// first output at ~18s). 800s is the standard Vercel Pro maximum and is ample.
// This was briefly Kimi K3, which needed the 1800s beta extended duration and
// still truncated edits - see the detailed note in app/api/chat/route.ts.
export const maxDuration = 800

const QUICK_MODEL = 'Qwen/Qwen3.5-397B-A17B-TEE'
const BEST_MODEL = 'moonshotai/Kimi-K2.6-TEE'

function getModel(best: boolean) {
  const key = process.env.CHUTES_API_KEY
  if (!key) return gateway('openai/gpt-4o-mini')
  const chutes = createOpenAICompatible({ name: 'chutes', baseURL: 'https://llm.chutes.ai/v1', apiKey: key })
  return chutes.chatModel(best ? BEST_MODEL : QUICK_MODEL)
}

function validProject(project: ReturnType<typeof normalizeProject>) {
  return validateProject(project).length === 0 && validateHtmlDocument(bundleProject(project)).valid
}

export async function POST(req: Request) {
  try {
    const { originalCode, responseText, instruction, buildQuality } = await req.json() as {
      originalCode?: string
      responseText?: string
      instruction?: string
      buildQuality?: 'quick' | 'best'
    }
    if (!originalCode || !responseText) return Response.json({ error: 'Missing project data.' }, { status: 400 })
    const original = normalizeProject(originalCode)

    const complete = extractProjectArtifact(responseText)
    if (complete && validProject(complete)) {
      return Response.json({ code: serializeProject(complete), strategy: 'complete' })
    }

    const patches = extractPatchArtifact(responseText)
    if (patches) {
      try {
        const patched = applyProjectPatches(original, patches)
        if (validProject(patched)) return Response.json({ code: serializeProject(patched), strategy: 'patch' })
      } catch {
        // Continue to a single full-regeneration fallback.
      }
    }

    const fallback = await generateText({
      model: getModel(buildQuality === 'best'),
      // K3's reasoning is billed against this same budget, so 32000 left too
      // little for the patch itself and edits came back truncated.
      maxOutputTokens: buildQuality === 'best' ? 96000 : 16000,
      system: 'You repair BlueTAO projects. Return only one fenced bluetao-project artifact: BLUETAO_PROJECT_V1 then strict JSON with exactly index.html, styles.css, and app.js. Preserve all unrelated behavior and design. No prose.',
      prompt: `The patch response could not be safely applied. Regenerate the complete project with this request applied: ${instruction || 'Apply the requested edit.'}\n\nORIGINAL PROJECT:\n${serializeProject(original)}\n\nFAILED RESPONSE:\n${responseText}`,
    })
    const regenerated = extractProjectArtifact(fallback.text)
    if (!regenerated || !validProject(regenerated)) {
      return Response.json({ code: serializeProject(original), strategy: 'fallback-original', warning: 'The edit could not be applied safely.' })
    }
    return Response.json({ code: serializeProject(regenerated), strategy: 'regenerated' })
  } catch {
    return Response.json({ error: 'Could not resolve project edit.' }, { status: 500 })
  }
}

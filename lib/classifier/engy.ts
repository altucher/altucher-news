/**
 * Kimi K3 on Engy as the classifier.
 *
 * One request per input to Engy's OpenAI-compatible endpoint. The model is
 * asked for a JSON object built from the caller's labels: the label and a
 * probability for every label. Single-label scores are normalised to sum to
 * one and the confidence is the chosen label's share; multi-label reads each
 * score as an independent yes-probability. The scores are the model's own
 * stated probabilities, not logprobs.
 *
 * K3 is a heavy reasoning model that emits nothing until it has finished
 * deliberating, and left uncapped it has produced 146k characters of
 * reasoning on this site (see app/api/chat/route.ts). So the fast tier turns
 * thinking off outright, and the smart tier gives it a small budget at low
 * effort, which is the configuration chat measured to answer reliably.
 */
import { isUnintelligible, UNSCORED_REASON, type MultiOpts, type Result, type Tier } from './core'

export const ENGY_MODEL = 'kimi-k3'
export const ENGY_MODEL_NAME = `engy/${ENGY_MODEL}`
const ENGY_BASE = 'https://api.engy.ai/v1'

export const engyConfigured = () => Boolean(process.env.ENGY_API_KEY)

function systemPrompt(labels: string[], instructions: string | undefined, multi: boolean) {
  const cats = labels.map((l) => `- ${l}`).join('\n')
  const shape = multi
    ? `{"scores": {${labels.map((l) => `${JSON.stringify(l)}: <0..1>`).join(', ')}}}`
    : `{"label": <one of the categories>, "scores": {${labels.map((l) => `${JSON.stringify(l)}: <0..1>`).join(', ')}}}`
  return [
    multi
      ? 'You are a multi-label text classifier. For each category, give the probability, from 0 to 1, that it applies to the input. A category applies if the input meaningfully touches it, even in passing; judge each one independently.'
      : 'You are a text classifier. Pick the single category that best fits the input, and give a calibrated probability for every category: how likely each is to be the right answer, summing to 1. Be honest about uncertainty; a clear case deserves a score near 1, a toss-up should look like one.',
    instructions ? `\nCriteria from the caller:\n${instructions}` : '',
    `\nCategories:\n${cats}`,
    `\nAnswer with exactly this JSON object and nothing else, no prose and no code fence:\n${shape}`,
  ]
    .filter(Boolean)
    .join('\n')
}

const clamp = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** The first JSON object in the text, however the model wrapped it. */
function extractJson(text: string): { label?: unknown; scores?: unknown } | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const candidates = [cleaned, cleaned.replace(/^```(?:json)?\s*|\s*```$/g, '')]
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1))
  for (const c of candidates) {
    try {
      const v = JSON.parse(c)
      if (v && typeof v === 'object' && !Array.isArray(v)) return v
    } catch {
      /* try the next shape */
    }
  }
  return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function engyClassify(
  input: string,
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
): Promise<Result> {
  const started = Date.now()
  const smart = tier === 'smart'
  const body = {
    model: ENGY_MODEL,
    messages: [
      { role: 'system', content: systemPrompt(labels, instructions, !!multi) },
      { role: 'user', content: input },
    ],
    // Room for a hundred scores; the answer itself is short.
    max_tokens: 4096,
    temperature: 0,
    ...(smart
      ? { thinking: { type: 'enabled', budget_tokens: 1500 }, reasoning_effort: 'low' }
      : { thinking: { type: 'disabled' } }),
  }

  let last = 'upstream failure'
  let parsed: { label?: unknown; scores?: unknown } | null = null
  for (let attempt = 0; attempt < 3 && !parsed; attempt++) {
    let res: Response
    try {
      res = await fetch(`${ENGY_BASE}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.ENGY_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(smart ? 90_000 : 30_000),
      })
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
      last = timeout ? 'upstream timeout' : 'upstream network failure'
      if (attempt < 2) await sleep(300 * 2 ** attempt + Math.random() * 200)
      continue
    }
    const payload = (await res.json().catch(() => null)) as
      | { error?: unknown; choices?: { message?: { content?: unknown }; finish_reason?: string }[] }
      | null
    const choice = payload?.choices?.[0]
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : null
    if (!res.ok || payload?.error || content === null) {
      last = `upstream ${res.status}: ${payload?.error ? 'provider_error' : 'malformed_response'}`
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500 || (res.ok && content === null)
      if (!retryable || attempt >= 2) break
      await sleep(300 * 2 ** attempt + Math.random() * 200)
      continue
    }
    parsed = extractJson(content)
    if (!parsed) {
      last = choice?.finish_reason === 'length' ? 'upstream malformed_response: truncated' : 'upstream malformed_response'
      if (attempt < 2) await sleep(300 * 2 ** attempt + Math.random() * 200)
    }
  }
  if (!parsed) throw new Error(last)

  const rawScores = parsed.scores && typeof parsed.scores === 'object' ? (parsed.scores as Record<string, unknown>) : {}
  const unreadable = isUnintelligible(input)
  const ms = Date.now() - started

  if (multi) {
    const scores = Object.fromEntries(labels.map((l) => [l, Number(clamp(rawScores[l]).toFixed(4))]))
    let picked = labels.filter((l) => scores[l] >= 0.7).sort((a, b) => scores[b] - scores[a])
    if (multi.max) picked = picked.slice(0, multi.max)
    return {
      label: picked[0] ?? '',
      labels: picked,
      confidence: null,
      scores: unreadable ? null : scores,
      unscored: unreadable ? UNSCORED_REASON : undefined,
      ms,
      model: ENGY_MODEL_NAME,
    }
  }

  // The label the model named, or failing that the label it scored highest.
  let total = 0
  const raw = labels.map((l) => {
    const v = clamp(rawScores[l])
    total += v
    return v
  })
  let label = typeof parsed.label === 'string' && labels.includes(parsed.label) ? parsed.label : null
  if (!label && total > 0) label = labels[raw.indexOf(Math.max(...raw))]
  if (!label) throw new Error('upstream malformed_response')
  // Normalise so the scores are a distribution whatever the model summed to;
  // a model that gave every label zero has said nothing, so no score ships.
  const scores = total > 0 ? Object.fromEntries(labels.map((l, i) => [l, Number((raw[i] / total).toFixed(4))])) : null
  return {
    label,
    confidence: scores && !unreadable ? scores[label] : null,
    scores: unreadable ? null : scores,
    unscored: unreadable ? UNSCORED_REASON : undefined,
    ms,
    model: ENGY_MODEL_NAME,
  }
}

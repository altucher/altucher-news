/**
 * Claude Fable 5.1 as the classifier.
 *
 * One request per input. The answer is structured output against a schema
 * built from the caller's labels, so the label is always one of them and every
 * label gets a probability. The Anthropic API returns no logprobs, so the
 * scores are the model's own stated probabilities, normalised to sum to one
 * for single-label and read as independent yes-probabilities for multi-label.
 *
 * Thinking is always on for this model and is not configurable; the tier maps
 * to effort instead: fast answers at low effort, smart at high. Refusals fall
 * back server-side to Anthropic's recommended model for the refusal category,
 * so a classification request never dies on a classifier.
 */
import Anthropic from '@anthropic-ai/sdk'
import { isUnintelligible, UNSCORED_REASON, type MultiOpts, type Result, type Tier } from './core'

export const FABLE_MODEL = 'claude-fable-5-1'

let client: Anthropic | null = null
function anthropic() {
  if (!client) client = new Anthropic({ maxRetries: 2, timeout: 60_000 })
  return client
}

export const fableConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY)

function systemPrompt(labels: string[], instructions: string | undefined, multi: boolean) {
  const cats = labels.map((l) => `- ${l}`).join('\n')
  return [
    multi
      ? 'You are a multi-label text classifier. For each category, give the probability, from 0 to 1, that it applies to the input. A category applies if the input meaningfully touches it, even in passing; judge each one independently.'
      : 'You are a text classifier. Pick the single category that best fits the input, and give a calibrated probability for every category: how likely each is to be the right answer, summing to 1. Be honest about uncertainty; a clear case deserves a score near 1, a toss-up should look like one.',
    instructions ? `\nCriteria from the caller:\n${instructions}` : '',
    `\nCategories:\n${cats}`,
    '\nAnswer only in the requested JSON.',
  ]
    .filter(Boolean)
    .join('\n')
}

function schema(labels: string[], multi: boolean) {
  const scores = {
    type: 'object',
    properties: Object.fromEntries(labels.map((l) => [l, { type: 'number' }])),
    required: labels,
    additionalProperties: false,
  }
  return multi
    ? { type: 'object', properties: { scores }, required: ['scores'], additionalProperties: false }
    : {
        type: 'object',
        properties: { label: { type: 'string', enum: labels }, scores },
        required: ['label', 'scores'],
        additionalProperties: false,
      }
}

const clamp = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

export async function fableClassify(
  input: string,
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
): Promise<Result> {
  const started = Date.now()
  const response = await anthropic().beta.messages.create({
    model: FABLE_MODEL,
    max_tokens: 4096,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: tier === 'smart' ? 'high' : 'low',
      format: { type: 'json_schema', schema: schema(labels, !!multi) },
    },
    system: systemPrompt(labels, instructions, !!multi),
    messages: [{ role: 'user', content: input }],
  })
  if (response.stop_reason === 'refusal') {
    throw new Error(`upstream refusal: ${response.stop_details?.type === 'refusal' ? response.stop_details.category ?? 'unspecified' : 'unspecified'}`)
  }
  if (response.stop_reason === 'max_tokens') throw new Error('upstream malformed_response: truncated')
  const text = response.content.find((b) => b.type === 'text')?.text ?? ''
  let parsed: { label?: unknown; scores?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('upstream malformed_response')
  }
  const rawScores = parsed.scores && typeof parsed.scores === 'object' ? (parsed.scores as Record<string, unknown>) : {}
  const unreadable = isUnintelligible(input)
  const ms = Date.now() - started
  // The model that actually answered: Fable, or the fallback that took over.
  const model = response.model || FABLE_MODEL

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
      model,
    }
  }

  const label = typeof parsed.label === 'string' && labels.includes(parsed.label) ? parsed.label : null
  if (!label) throw new Error('upstream malformed_response')
  let total = 0
  const raw = labels.map((l) => {
    const v = clamp(rawScores[l])
    total += v
    return v
  })
  // Normalise so the scores are a distribution whatever the model summed to;
  // a model that gave every label zero has said nothing, so no score ships.
  const scores = total > 0 ? Object.fromEntries(labels.map((l, i) => [l, Number((raw[i] / total).toFixed(4))])) : null
  return {
    label,
    confidence: scores && !unreadable ? scores[label] : null,
    scores: unreadable ? null : scores,
    unscored: unreadable ? UNSCORED_REASON : undefined,
    ms,
    model,
  }
}

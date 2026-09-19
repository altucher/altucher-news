/**
 * Zero-shot text classification, after classifier.dev (github.com/mrmps/classifier-dev).
 *
 * Text and a list of labels go in; the label that fits and a confidence come
 * out. The original answers from TypeSafe's Jev decision model and falls back
 * to a chain of language models on OpenRouter. This port keeps the whole API
 * surface, the validation and the response shapes.
 *
 * Inference is Kimi K3 on Engy (see engy.ts) when ENGY_API_KEY is set: a
 * JSON answer with a probability per label. When it is not set, or a request
 * to it fails, the OpenAI-compatible chain below answers instead: OpenRouter
 * when a key is set (the original's own chain), then Chutes, Targon and Engy
 * GLM. That chain asks for one letter with logprobs so its score over the
 * letters is a real distribution; a provider that returns no logprobs still
 * answers, with confidence and scores null.
 */
import { engyClassify, engyConfigured } from './engy'

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
export const MAX_INPUTS = 1000
export const MAX_LABELS = 100
/** The single-label prompt answers with one letter, which caps it at 26. */
export const MAX_LABELS_SINGLE = 26
export const MAX_CHARS = 32_000
/** Smart tier: a fast answer below this confidence is re-asked of the reasoning chain. */
export const ESCALATE_BELOW = 0.7
/** Multi-label: a label at or above this yes-probability is returned. */
export const MULTI_THRESHOLD = 0.7
/**
 * Every classification is one upstream call here (there is no batch decision
 * model), so a request is capped well below the original's thousand.
 */
export const MAX_INPUTS_PER_REQUEST = 50
/** A big label set is judged in small groups so no single call has to weigh fifty categories. */
const MULTI_CHUNK = 12

export const TIERS = {
  fast: { rpm: 3000, daily: 20_000 },
  smart: { rpm: 200, daily: 2000 },
} as const
export type Tier = keyof typeof TIERS

export type ErrorCode =
  | 'bad_json'
  | 'no_input'
  | 'too_many_inputs'
  | 'too_few_labels'
  | 'too_many_labels'
  | 'empty_label'
  | 'duplicate_labels'
  | 'empty_input'
  | 'input_too_long'
  | 'bad_tier'
  | 'not_found'
  | 'method_not_allowed'
  | 'rate_limit_minute'
  | 'rate_limit_day'
  | 'no_provider'
  | 'chain_exhausted'
  | 'timeout'
  | 'upstream_other'

export type MultiOpts = { max?: number; strict?: boolean }

export type Result = {
  label: string
  labels?: string[]
  confidence: number | null
  scores: Record<string, number> | null
  unscored?: string
  ms: number
  model: string
  escalated?: true
}

export const UNSCORED_REASON = 'input does not read as natural language'

// ---------------------------------------------------------------------------
// Unintelligible input: a forced single-token choice is confident even about
// gibberish, so the score is withheld rather than published.

const LATIN = /\p{Script=Latin}/u

function notWordLike(word: string): boolean {
  if (word.length <= 2) return false
  const vowels = (word.match(/[aeiouy]/g) ?? []).length
  if (vowels === 0) return true
  if (vowels / word.length < 0.2) return true
  if (/(.)\1{2,}/.test(word)) return true
  if (/[bcdfghjklmnpqrstvwxz]{5,}/.test(word)) return true
  return false
}

export function isUnintelligible(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  const letters = trimmed.match(/\p{L}/gu) ?? []
  if (letters.length === 0) return true
  if (letters.some((c) => !LATIN.test(c))) return false
  const words = trimmed.toLowerCase().match(/[a-z]+/g) ?? []
  if (words.length === 0) return true
  const nonsense = words.filter(notWordLike).length
  return nonsense / words.length >= 0.6
}

// ---------------------------------------------------------------------------
// Prompts and answer parsing

export function buildPrompt(labels: string[], instructions?: string) {
  return [
    'You are a classifier. Assign the input to exactly one category.',
    instructions ? `\nCRITERIA\n${instructions}` : '',
    `\nCATEGORIES\n${labels.map((l, i) => `${LETTERS[i]} = ${l}`).join('\n')}`,
    `\nAnswer with a single character: ${labels.map((_, i) => LETTERS[i]).join(', ')}.`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildMultiPrompt(labels: string[], instructions?: string, max?: number, strict?: boolean) {
  return [
    strict
      ? 'You are a multi-label classifier reviewing a shortlist. Keep only the categories the input clearly and substantively addresses.'
      : 'You are a multi-label classifier. Select EVERY category that applies to the input, and only those.',
    strict
      ? 'Drop any category that is merely adjacent, implied, or a stretch. Keep the ones a careful human tagger would defend.'
      : 'A category applies if the input meaningfully touches it, even briefly or in passing. Do not restrict yourself to the single main topic.',
    instructions ? `\nCRITERIA\n${instructions}` : '',
    `\nCATEGORIES\n${labels.map((l, i) => `${i + 1} = ${l}`).join('\n')}`,
    max ? `\nSelect at most ${max}, the most clearly applicable ones.` : '',
    '\nAnswer with the numbers that apply, separated by commas, like: 2,5,9',
    'If none apply, answer exactly: none',
    'Answer with numbers only. Do not explain.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Parse the exact number list the prompt asks for; prose is an invalid answer. */
export function parseNumbers(answer: string, n: number, max?: number): number[] | null {
  const text = answer.trim()
  if (/^none$/i.test(text)) return []
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(text)) return null
  const seen = new Set<number>()
  for (const part of text.split(',')) {
    const v = Number.parseInt(part, 10)
    if (v < 1 || v > n) return null
    seen.add(v)
  }
  const picked = [...seen].sort((a, b) => a - b)
  return max && picked.length > max ? picked.slice(0, max) : picked
}

export function parseLetter(s: string, n: number) {
  const valid = LETTERS.slice(0, n)
  const match = (s ?? '').match(/^\s*([A-Z])\s*[.!?)]?\s*$/i)
  const letter = match?.[1]?.toUpperCase()
  return letter && valid.includes(letter) ? letter : null
}

/** Softmax over the letter tokens the provider reported; null when it reported none. */
export function scoresFrom(top: { token: string; logprob: number }[] | undefined, n: number) {
  if (!Array.isArray(top) || !top.length) return null
  const valid = LETTERS.slice(0, n)
  const p: Record<string, number> = Object.fromEntries(valid.map((l) => [l, 0]))
  let total = 0
  for (const t of top) {
    if (!t || typeof t !== 'object') continue
    const token = (t as { token?: unknown }).token
    const logprob = (t as { logprob?: unknown }).logprob
    if (typeof token !== 'string' || typeof logprob !== 'number' || !Number.isFinite(logprob) || logprob > 0) continue
    const c = token.trim().toUpperCase()[0]
    if (valid.includes(c)) {
      const e = Math.exp(logprob)
      p[c] += e
      total += e
    }
  }
  if (!total) return null
  for (const k of valid) p[k] /= total
  return p
}

// ---------------------------------------------------------------------------
// Providers. Every one is OpenAI-shaped; only the base URL, the key and the
// body tweaks differ. Built per request so a key added to the environment is
// picked up without a restart.

export type ModelCfg = {
  /** How the model is named in responses and logs. */
  model: string
  baseURL: string
  apiKey: string
  /** Extra fields for the request body: thinking switches and the like. */
  extra?: Record<string, unknown>
  /** The model reasons before answering and needs its token budget for that. */
  reasoning: boolean
  maxTokens: number
  headers?: Record<string, string>
}

export function chains(): { fast: ModelCfg[]; multi: ModelCfg[]; smart: ModelCfg[] } {
  const fast: ModelCfg[] = []
  const multi: ModelCfg[] = []
  const smart: ModelCfg[] = []

  const openrouter = process.env.OPENROUTER_API_KEY
  if (openrouter) {
    const or = (model: string, reasoning: boolean, maxTokens: number): ModelCfg => ({
      model,
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: openrouter,
      reasoning,
      maxTokens,
      headers: { 'x-title': 'hex' },
      extra: reasoning ? { reasoning: { effort: 'low' } } : { reasoning: { enabled: false } },
    })
    // The same models the original benchmarked for each chain.
    fast.push(or('ibm-granite/granite-4.0-h-micro', false, 1), or('deepseek/deepseek-v4-flash', false, 1))
    multi.push(or('inclusionai/ling-3.0-flash', false, 1), or('inception/mercury-2.5', false, 1))
    smart.push(or('google/gemini-3.8-flash', true, 2000), or('qwen/qwen3.8-flash', true, 2000))
  }

  const chutes = process.env.CHUTES_API_KEY
  if (chutes) {
    const model = process.env.CLASSIFIER_CHUTES_MODEL || 'Qwen/Qwen3.8-27B-TEE'
    const cfg: ModelCfg = {
      model: `chutes/${model}`,
      baseURL: 'https://llm.chutes.ai/v1',
      apiKey: chutes,
      reasoning: false,
      maxTokens: 1,
      extra: { enable_thinking: false, chat_template_kwargs: { enable_thinking: false } },
    }
    fast.push(cfg)
    multi.push(cfg)
    smart.push({
      ...cfg,
      model: `chutes/${process.env.CLASSIFIER_CHUTES_SMART_MODEL || 'moonshotai/Kimi-K2.6-TEE'}`,
      reasoning: true,
      maxTokens: 2000,
      extra: {},
    })
  }

  const targon = process.env.TARGON_API_KEY
  if (targon) {
    const cfg: ModelCfg = {
      model: 'targon/moonshotai/Kimi-K2-Instruct',
      baseURL: 'https://api.targon.com/v1',
      apiKey: targon,
      reasoning: false,
      maxTokens: 1,
    }
    fast.push(cfg)
    multi.push(cfg)
  }

  const engy = process.env.ENGY_API_KEY
  if (engy) {
    const base = {
      baseURL: 'https://api.engy.ai/v1',
      apiKey: engy,
    }
    const quick: ModelCfg = {
      ...base,
      model: 'engy/glm-5.3',
      reasoning: false,
      maxTokens: 1,
      extra: { thinking: { type: 'disabled' } },
    }
    fast.push(quick)
    multi.push(quick)
    smart.push({
      ...base,
      model: 'engy/glm-5.3',
      reasoning: true,
      maxTokens: 2000,
      extra: { thinking: { type: 'enabled', budget_tokens: 1500 }, reasoning_effort: 'low' },
    })
  }

  // A reasoning chain that is empty still has to answer smart-tier
  // escalations: the fast chain stands in, so the tier degrades rather than 502s.
  if (!smart.length) smart.push(...fast)
  return { fast, multi, smart }
}

const model = (cfg: ModelCfg) => cfg.model.replace(/^(chutes|engy|targon)\//, '')

type Choice = {
  message?: { content?: unknown; reasoning_content?: unknown }
  logprobs?: { content?: { top_logprobs?: { token: string; logprob: number }[] }[] }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const retryable = (status: number, malformed: boolean) =>
  malformed || status === 408 || status === 425 || status === 429 || status >= 500

async function callModel(
  cfg: ModelCfg,
  input: string,
  labels: string[],
  instructions?: string,
  multi?: MultiOpts,
): Promise<Result> {
  const body: Record<string, unknown> = {
    model: model(cfg),
    messages: [
      {
        role: 'system',
        content: multi ? buildMultiPrompt(labels, instructions, multi.max, multi.strict) : buildPrompt(labels, instructions),
      },
      { role: 'user', content: `${input}\nANSWER:` },
    ],
    max_tokens: multi ? (cfg.reasoning ? cfg.maxTokens : Math.min(16 + labels.length * 2, 160)) : cfg.maxTokens,
    temperature: 0,
    ...(cfg.extra ?? {}),
  }
  // Logprobs describe one token, which says nothing useful about a list.
  if (!cfg.reasoning && !multi) {
    body.logprobs = true
    body.top_logprobs = 8
  }

  const started = Date.now()
  let last = 'upstream failure'
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response
    try {
      res = await fetch(`${cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.apiKey}`,
          'content-type': 'application/json',
          ...(cfg.headers ?? {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.reasoning ? 60_000 : 15_000),
      })
    } catch (e) {
      const timeout = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
      last = timeout ? 'upstream timeout' : 'upstream network failure'
      if (attempt < 2) await sleep(300 * 2 ** attempt + Math.random() * 200)
      continue
    }
    const payload = (await res.json().catch(() => null)) as { error?: unknown; choices?: Choice[] } | null
    const choice = payload?.choices?.[0]
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : null
    const malformed = !payload || !Array.isArray(payload.choices) || !choice || content === null
    const providerError = !!payload?.error
    if (res.ok && !providerError && !malformed) {
      // A reasoning model may leave its answer on the last line after its thoughts.
      const answer = cfg.reasoning ? (content.trim().split('\n').pop() ?? '') : content
      if (multi) {
        const picked = parseNumbers(answer, labels.length, multi.max)
        if (!picked) {
          last = 'upstream malformed_response'
          if (attempt < 2) await sleep(300 * 2 ** attempt + Math.random() * 200)
          continue
        }
        return {
          label: labels[picked[0] - 1] ?? '',
          labels: picked.map((n) => labels[n - 1]),
          confidence: null,
          scores: null,
          ms: Date.now() - started,
          model: cfg.model,
        }
      }
      const letter = parseLetter(answer, labels.length)
      if (!letter) {
        last = 'upstream malformed_response'
        if (attempt < 2) await sleep(300 * 2 ** attempt + Math.random() * 200)
        continue
      }
      const raw = scoresFrom(choice?.logprobs?.content?.[0]?.top_logprobs, labels.length)
      const idx = LETTERS.indexOf(letter)
      const label = idx >= 0 && idx < labels.length ? labels[idx] : labels[0]
      const unreadable = isUnintelligible(input)
      const scores =
        raw && !unreadable
          ? Object.fromEntries(Object.entries(raw).map(([l, v]) => [labels[LETTERS.indexOf(l)] ?? l, Number(v.toFixed(4))]))
          : null
      return {
        label,
        confidence: scores ? Number(Math.max(...Object.values(scores)).toFixed(4)) : null,
        scores,
        unscored: unreadable ? UNSCORED_REASON : undefined,
        ms: Date.now() - started,
        model: cfg.model,
      }
    }
    last = `upstream ${res.status}: ${providerError ? 'provider_error' : malformed ? 'malformed_response' : 'provider_error'}`
    if (!retryable(res.status, res.ok && (providerError || malformed)) || attempt >= 2) break
    await sleep(300 * 2 ** attempt + Math.random() * 200)
  }
  throw new Error(last)
}

/** Walk a chain; the first model that answers wins. */
async function runChain(chain: ModelCfg[], input: string, labels: string[], instructions?: string, multi?: MultiOpts) {
  if (!chain.length) throw new Error('no provider configured')
  let last: unknown
  for (const cfg of chain) {
    try {
      return await callModel(cfg, input, labels, instructions, multi)
    } catch (e) {
      last = e
      console.warn(`[classifier] ${cfg.model} failed: ${(e as Error).message}`)
    }
  }
  throw last instanceof Error ? last : new Error('all models failed')
}

/**
 * Asked to pick from fifty categories at once, a small model returns the ten
 * most salient rather than every one that applies. Small groups turn one hard
 * judgement into several easy ones, run concurrently; a second pass over the
 * survivors gets the precision back.
 */
async function classifyOne(
  c: ReturnType<typeof chains>,
  input: string,
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
): Promise<Result> {
  if (!multi) return runChain(tier === 'smart' ? c.smart : c.fast, input, labels, instructions)
  if (labels.length <= MULTI_CHUNK) return runChain(c.multi, input, labels, instructions, multi)

  const groups = Math.ceil(labels.length / MULTI_CHUNK)
  const size = Math.ceil(labels.length / groups)
  const chunks: string[][] = []
  for (let i = 0; i < labels.length; i += size) chunks.push(labels.slice(i, i + size))

  const started = Date.now()
  const parts = await Promise.all(chunks.map((chunk) => runChain(c.multi, input, chunk, instructions, {})))
  const hit = new Set<string>()
  for (const part of parts) for (const l of part.labels ?? []) hit.add(l)
  let picked = labels.filter((l) => hit.has(l))

  if (picked.length > 2) {
    try {
      const verified = await runChain(c.multi, input, picked, instructions, { max: multi.max, strict: true })
      const keep = new Set(verified.labels ?? [])
      picked = picked.filter((l) => keep.has(l))
    } catch {
      // Verification is an improvement, not a requirement; keep the sweep.
    }
  }
  if (multi.max && picked.length > multi.max) picked = picked.slice(0, multi.max)
  return {
    label: picked[0] ?? '',
    labels: picked,
    confidence: null,
    scores: null,
    ms: Date.now() - started,
    model: parts[0]?.model ?? '',
  }
}

export function summarizeModels(results: readonly { model: string }[]) {
  const modelsUsed = [...new Set(results.map((r) => r.model).filter(Boolean))]
  return { model: modelsUsed.length > 1 ? 'mixed' : (modelsUsed[0] ?? ''), modelsUsed }
}

/**
 * Smart tier: every single-label answer below ESCALATE_BELOW is re-asked of
 * the reasoning chain and replaced in place. Answers with no confidence at all
 * (a provider without logprobs) are re-asked too, since nothing says they were sure.
 */
async function escalate(
  c: ReturnType<typeof chains>,
  inputs: string[],
  labels: string[],
  instructions: string | undefined,
  results: Result[],
  eligible: Set<number>,
) {
  const idx = results.flatMap((r, i) =>
    !eligible.has(i) ? [] : r.confidence === null ? (r.unscored ? [] : [i]) : r.confidence < ESCALATE_BELOW ? [i] : [],
  )
  let failed = 0
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(4, idx.length) }, async () => {
      while (next < idx.length) {
        const i = idx[next++]
        try {
          const r =
            labels.length > MAX_LABELS_SINGLE
              ? await runChain(c.smart, inputs[i], labels, instructions, { max: 1 })
              : await runChain(c.smart, inputs[i], labels, instructions)
          if (r.label) results[i] = { ...results[i], label: r.label, model: r.model, escalated: true }
        } catch (e) {
          failed++
          console.warn(`[classifier] escalation failed: ${(e as Error).message}`)
        }
      }
    }),
  )
  return failed
}

export async function classifyMany(
  inputs: string[],
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
): Promise<{ results: Result[]; escalationFailed: number }> {
  const c = chains()
  const primary = engyConfigured()
  if (!primary && !c.fast.length) throw new Error('no provider configured')
  // Single-label past 26 labels has no letter to ride on: run the multi prompt
  // and keep its top pick, so the response shape the caller asked for holds.
  const asMulti = multi ?? (labels.length > MAX_LABELS_SINGLE ? { max: 1 } : undefined)
  const out: Result[] = new Array(inputs.length)
  // Which results the fallback chain answered; only those can be escalated,
  // since a K3 answer on the smart tier was already asked with reasoning on.
  const fromChain = new Set<number>()
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(4, inputs.length) }, async () => {
      while (next < inputs.length) {
        const i = next++
        let r: Result | null = null
        if (primary) {
          try {
            r = await engyClassify(inputs[i], labels, tier, instructions, multi)
          } catch (e) {
            console.warn(`[classifier] kimi-k3 failed: ${(e as Error).message}`)
            if (!c.fast.length) throw e
          }
        }
        if (!r) {
          // The first pass is always the fast chain; smart only decides what gets re-asked.
          r = await classifyOne(c, inputs[i], labels, 'fast', instructions, asMulti)
          fromChain.add(i)
        }
        if (!multi && !r.label) throw new Error('upstream malformed_response')
        out[i] = multi ? r : { ...r, labels: undefined }
      }
    }),
  )
  const escalationFailed =
    tier === 'smart' && !multi && fromChain.size ? await escalate(c, inputs, labels, instructions, out, fromChain) : 0
  return { results: out, escalationFailed }
}

/** Collapse an upstream failure to a stable code. */
export function upstreamReason(msg: string): ErrorCode {
  const m = msg.toLowerCase()
  if (m.includes('no provider configured')) return 'no_provider'
  if (m.includes('all models failed')) return 'chain_exhausted'
  if (m.includes('timeout') || m.includes('timed out')) return 'timeout'
  return 'upstream_other'
}

/** The tier a caller named, read leniently but never guessed. */
export function readTier(raw: unknown): Tier | null {
  if (raw === undefined || raw === null || raw === '') return 'fast'
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase()
  return t === 'fast' || t === 'smart' ? t : null
}

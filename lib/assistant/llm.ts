import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { gateway } from '@ai-sdk/gateway'
import type { LanguageModel } from 'ai'

export type Candidate = { name: string; model: LanguageModel }

/**
 * Same routing philosophy as /api/chat: Engy GLM 5.3 first (fast, tool-capable,
 * reasoning capped so it answers instead of spiralling), then SayGM GPT-6,
 * then Chutes Kimi K2.6, then the AI Gateway. The assistant uses non-streaming
 * generateText, so a failure surfaces as a thrown error and the next candidate
 * simply runs - no preflight probe needed.
 */
export function candidates(): Candidate[] {
  const list: Candidate[] = []
  const engyKey = process.env.ENGY_API_KEY
  if (engyKey) {
    const engy = createOpenAICompatible({
      name: 'engy',
      baseURL: 'https://api.engy.ai/v1',
      headers: { Authorization: `Bearer ${engyKey}` },
      fetch: async (url, init) => {
        if (init?.body && typeof init.body === 'string') {
          try {
            const body = JSON.parse(init.body)
            body.thinking = { type: 'enabled', budget_tokens: 1500 }
            body.reasoning_effort = 'low'
            init = { ...init, body: JSON.stringify(body) }
          } catch { /* leave as-is */ }
        }
        return fetch(url, init)
      },
    })
    list.push({ name: 'engy/glm-5.3', model: engy.chatModel(process.env.ASSISTANT_ENGY_MODEL || 'glm-5.3') })
  }
  const saygmKey = process.env.SAYGM_API_KEY
  const saygmBase = process.env.SAYGM_BASE_URL
  if (saygmKey && saygmBase) {
    const saygm = createOpenAICompatible({
      name: 'saygm',
      baseURL: saygmBase.replace(/\/$/, ''),
      headers: { Authorization: `Bearer ${saygmKey}` },
      fetch: async (url, init) => {
        if (init?.body && typeof init.body === 'string') {
          try {
            const body = JSON.parse(init.body)
            delete body.reasoning_effort
            init = { ...init, body: JSON.stringify(body) }
          } catch { /* leave as-is */ }
        }
        return fetch(url, init)
      },
    })
    const m = process.env.SAYGM_CHAT_MODEL || 'gpt-6'
    list.push({ name: `saygm/${m}`, model: saygm.chatModel(m) })
  }
  const chutesKey = process.env.CHUTES_API_KEY
  if (chutesKey) {
    const chutes = createOpenAICompatible({
      name: 'chutes',
      baseURL: 'https://llm.chutes.ai/v1',
      headers: { Authorization: `Bearer ${chutesKey}` },
      fetch: async (url, init) => {
        if (init?.body && typeof init.body === 'string') {
          try {
            const body = JSON.parse(init.body)
            body.enable_thinking = false
            init = { ...init, body: JSON.stringify(body) }
          } catch { /* leave as-is */ }
        }
        return fetch(url, init)
      },
    })
    list.push({ name: 'chutes/kimi-k2.6', model: chutes.chatModel('moonshotai/Kimi-K2.6-TEE') })
  }
  list.push({ name: 'gateway/gpt-4o-mini', model: gateway('openai/gpt-4o-mini') })
  return list
}

// Providers that recently returned a billing failure are skipped for a while so
// a dead upstream is not probed on every turn.
const billingDown = new Map<string, number>()
const COOLDOWN_MS = 10 * 60_000

export async function withFallback<T>(
  run: (model: LanguageModel, name: string) => Promise<T>,
  opts: { label?: string } = {},
): Promise<{ value: T; provider: string }> {
  const errors: string[] = []
  for (const c of candidates()) {
    const down = billingDown.get(c.name)
    if (down && Date.now() - down < COOLDOWN_MS) continue
    try {
      const value = await run(c.model, c.name)
      return { value, provider: c.name }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      if (/402|insufficient|quota|credit/i.test(msg)) billingDown.set(c.name, Date.now())
      errors.push(`${c.name}: ${msg.slice(0, 200)}`)
      console.log(`[assistant${opts.label ? ':' + opts.label : ''}] ${c.name} failed: ${msg.slice(0, 200)}`)
    }
  }
  throw new Error(`All providers failed - ${errors.join(' | ')}`)
}

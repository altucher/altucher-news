/**
 * Per-IP limits, counted in classifications rather than requests, so a batch
 * of fifty spends fifty. The original keeps these in a Durable Object; here
 * they live in the memory of one serverless instance, so they are a ceiling
 * per instance rather than a hard global one. Enough to keep one caller from
 * emptying the upstream budget, and the numbers documented on the page hold.
 */
import { TIERS, type Tier } from './core'

type Window = { count: number; resetAt: number }
const minute = new Map<string, Window>()
const day = new Map<string, Window>()

function take(map: Map<string, Window>, key: string, cost: number, limit: number, span: number, now: number) {
  let w = map.get(key)
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + span }
    map.set(key, w)
  }
  if (w.count + cost > limit) return { ok: false as const, resetIn: Math.max(1, Math.ceil((w.resetAt - now) / 1000)), remaining: Math.max(0, limit - w.count) }
  w.count += cost
  return { ok: true as const, resetIn: 0, remaining: limit - w.count }
}

/** Sweep expired windows now and then so the maps cannot grow without bound. */
function sweep(now: number) {
  if (minute.size + day.size < 5000) return
  for (const [k, w] of minute) if (w.resetAt <= now) minute.delete(k)
  for (const [k, w] of day) if (w.resetAt <= now) day.delete(k)
}

export type Gate =
  | { limited: false; remaining: number }
  | { limited: true; scope: 'minute' | 'day'; resetIn: number; remaining: number }

export function limited(tier: Tier, ip: string, cost: number): Gate {
  const now = Date.now()
  sweep(now)
  const key = `${tier}:${ip}`
  const d = day.get(key)
  const dayUsed = d && d.resetAt > now ? d.count : 0
  if (dayUsed + cost > TIERS[tier].daily) {
    return { limited: true, scope: 'day', resetIn: d ? Math.max(1, Math.ceil((d.resetAt - now) / 1000)) : 86_400, remaining: Math.max(0, TIERS[tier].daily - dayUsed) }
  }
  const m = take(minute, key, cost, TIERS[tier].rpm, 60_000, now)
  if (!m.ok) return { limited: true, scope: 'minute', resetIn: m.resetIn, remaining: m.remaining }
  const dd = take(day, key, cost, TIERS[tier].daily, 86_400_000, now)
  return { limited: false, remaining: Math.min(m.remaining, dd.remaining) }
}

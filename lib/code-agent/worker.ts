import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

/**
 * Server-side bridge to the James worker's hosted coding sessions
 * (~/COD/james/COORDINATION.md, "2026-09-19 13:20Z"). Every route here checks
 * the Supabase user owns the session before touching the worker. WORKER_SECRET
 * never leaves the server; the browser only ever talks to /api/code/*.
 */
export type CodeSessionRow = {
  id: string
  user_id: string
  sid: string
  token: string
  session_key: string
  title: string | null
  mode: string
  git_url: string | null
  status: 'alive' | 'destroyed' | 'killed'
  killed: string | null
  spent_usd: number
  model_calls: number
  created_at: string
  updated_at: string
  last_active: string | null
}

export function workerConfigured(): boolean {
  return Boolean(process.env.WORKER_URL && process.env.WORKER_SECRET)
}

export function workerBase(): string {
  return (process.env.WORKER_URL || '').replace(/\/$/, '')
}

export function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function currentUser(): Promise<{ id: string; email: string | null } | null> {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ? { id: user.id, email: user.email ?? null } : null
}

export async function ownedSession(userId: string, sid: string): Promise<CodeSessionRow | null> {
  const { data } = await admin().from('code_sessions').select('*').eq('sid', sid).eq('user_id', userId).maybeSingle()
  return (data as CodeSessionRow) ?? null
}

/** Call the worker with the server secret (control routes). */
export async function workerFetch(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers = new Headers(init.headers || {})
  headers.set('Authorization', `Bearer ${token || process.env.WORKER_SECRET}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${workerBase()}${path}`, { ...init, headers })
}

export function publicSession(row: CodeSessionRow) {
  return {
    sid: row.sid,
    title: row.title,
    mode: row.mode,
    git_url: row.git_url,
    status: row.status,
    killed: row.killed,
    spent_usd: Number(row.spent_usd || 0),
    model_calls: row.model_calls,
    created_at: row.created_at,
    last_active: row.last_active,
  }
}

/** Refresh a row from the worker's status and return both. */
export async function syncStatus(row: CodeSessionRow): Promise<{ row: CodeSessionRow; status: Record<string, unknown> | null }> {
  const r = await workerFetch(`/code/${row.sid}`, {}, row.token)
  if (r.status === 404) {
    const { data } = await admin().from('code_sessions').update({ status: 'destroyed', updated_at: new Date().toISOString() }).eq('id', row.id).select('*').single()
    return { row: (data as CodeSessionRow) ?? { ...row, status: 'destroyed' }, status: null }
  }
  if (!r.ok) return { row, status: null }
  const status = (await r.json()) as Record<string, unknown>
  const patch: Partial<CodeSessionRow> = {
    spent_usd: Number(status.spent_usd || 0),
    model_calls: Number(status.model_calls || 0),
    last_active: typeof status.last_active === 'string' ? status.last_active : row.last_active,
    mode: typeof status.mode === 'string' ? status.mode : row.mode,
    status: status.alive ? 'alive' : 'killed',
    killed: status.alive ? null : String(status.killed || 'ended'),
    updated_at: new Date().toISOString(),
  }
  const { data } = await admin().from('code_sessions').update(patch).eq('id', row.id).select('*').single()
  return { row: (data as CodeSessionRow) ?? { ...row, ...patch }, status }
}

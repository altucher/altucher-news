import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { admin, currentUser, publicSession, syncStatus, workerConfigured, workerFetch, type CodeSessionRow } from '@/lib/code-agent/worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MODES = new Set(['plan', 'ask', 'auto-edit', 'auto', 'yolo'])

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!workerConfigured()) return NextResponse.json({ configured: false, sessions: [] })
  const { data } = await admin().from('code_sessions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
  const rows = (data as CodeSessionRow[]) ?? []
  // Refresh the live ones so a killed/expired session does not look alive.
  const refreshed = await Promise.all(rows.map(async (r) => (r.status === 'alive' ? (await syncStatus(r)).row : r)))
  return NextResponse.json({ configured: true, sessions: refreshed.map(publicSession) })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!workerConfigured()) return NextResponse.json({ error: 'Code agent is not configured on this deployment.' }, { status: 503 })
  const body = await req.json().catch(() => ({}))
  const mode = MODES.has(body.mode) ? body.mode : 'auto'
  const gitUrl = typeof body.git_url === 'string' && /^https:\/\/[^\s]+$/.test(body.git_url.trim()) ? body.git_url.trim() : null
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : null

  // One live session per user keeps the worker's 8-session cap fair.
  const { data: live } = await admin().from('code_sessions').select('*').eq('user_id', user.id).eq('status', 'alive').limit(3)
  for (const r of (live as CodeSessionRow[]) ?? []) {
    const { row } = await syncStatus(r)
    if (row.status === 'alive') return NextResponse.json({ error: 'You already have a live session. End it first.', session: publicSession(row) }, { status: 409 })
  }

  const sessionKey = randomUUID()
  const shortUser = user.id.replace(/-/g, '').slice(0, 12)
  const r = await workerFetch('/code/session', {
    method: 'POST',
    body: JSON.stringify({
      user: shortUser,
      session: sessionKey,
      mode,
      caps: { max_minutes: 60, max_usd: 2, idle_minutes: 15 },
      ...(gitUrl ? { git_url: gitUrl } : {}),
    }),
  })
  if (!r.ok) {
    const detail = (await r.text().catch(() => '')).slice(0, 300)
    return NextResponse.json({ error: `Worker refused to start a session (HTTP ${r.status}). ${detail}` }, { status: 502 })
  }
  const created = await r.json()
  const { data, error } = await admin()
    .from('code_sessions')
    .insert({ user_id: user.id, sid: created.sid, token: created.token, session_key: sessionKey, title, mode: created.mode || mode, git_url: gitUrl, status: 'alive', last_active: created.last_active ?? null })
    .select('*')
    .single()
  if (error) {
    await workerFetch(`/code/${created.sid}/destroy`, { method: 'POST' }).catch(() => {})
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ session: publicSession(data as CodeSessionRow), caps: created.caps })
}

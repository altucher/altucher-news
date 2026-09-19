import { NextRequest, NextResponse } from 'next/server'
import { admin, currentUser, ownedSession, publicSession, syncStatus, workerFetch } from '@/lib/code-agent/worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ACTIONS = new Set(['message', 'permission', 'mode', 'interrupt', 'destroy', 'status'])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sid: string; action: string }> }) {
  const { sid, action } = await params
  if (action !== 'status') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await ownedSession(user.id, sid)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { row: fresh, status } = await syncStatus(row)
  return NextResponse.json({ session: publicSession(fresh), status })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ sid: string; action: string }> }) {
  const { sid, action } = await params
  if (!ACTIONS.has(action) || action === 'status') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await ownedSession(user.id, sid)
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'destroy') {
    const r = await workerFetch(`/code/${sid}/destroy`, { method: 'POST' })
    await admin().from('code_sessions').update({ status: 'destroyed', updated_at: new Date().toISOString() }).eq('id', row.id)
    return NextResponse.json({ ok: r.ok || r.status === 404 })
  }

  const body = await req.text()
  let payload: Record<string, unknown> = {}
  try { payload = body ? JSON.parse(body) : {} } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (action === 'message') {
    const text = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!text) return NextResponse.json({ error: 'Say what you want built.' }, { status: 400 })
    if (text.length > 20000) return NextResponse.json({ error: 'Message too long.' }, { status: 400 })
    payload = { text }
    if (!row.title) admin().from('code_sessions').update({ title: text.slice(0, 120) }).eq('id', row.id).then(() => {}, () => {})
  }
  if (action === 'mode') {
    if (!['plan', 'ask', 'auto-edit', 'auto', 'yolo'].includes(String(payload.mode))) return NextResponse.json({ error: 'Bad mode' }, { status: 400 })
    admin().from('code_sessions').update({ mode: String(payload.mode) }).eq('id', row.id).then(() => {}, () => {})
  }
  const r = await workerFetch(`/code/${sid}/${action}`, { method: 'POST', body: JSON.stringify(payload) }, row.token)
  const text = await r.text()
  let json: unknown = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text.slice(0, 500) } }
  if (r.status === 404) await admin().from('code_sessions').update({ status: 'destroyed' }).eq('id', row.id)
  return NextResponse.json(json ?? { ok: r.ok }, { status: r.status })
}

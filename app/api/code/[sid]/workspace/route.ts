import { NextRequest } from 'next/server'
import { currentUser, ownedSession, workerFetch } from '@/lib/code-agent/worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params
  const user = await currentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const row = await ownedSession(user.id, sid)
  if (!row) return new Response('Not found', { status: 404 })
  const r = await workerFetch(`/code/${sid}/workspace.tgz`, {}, row.token)
  if (!r.ok || !r.body) return new Response(`Workspace unavailable (HTTP ${r.status})`, { status: 502 })
  return new Response(r.body, {
    headers: { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="bluetao-code-${sid.slice(0, 8)}.tgz"` },
  })
}

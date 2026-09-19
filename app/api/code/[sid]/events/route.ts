import { NextRequest } from 'next/server'
import { currentUser, ownedSession, workerBase } from '@/lib/code-agent/worker'

export const dynamic = 'force-dynamic'
// The worker has no CORS, so the browser's EventSource connects here and the
// route pipes the worker's SSE body through. Vercel cuts the function at
// maxDuration; EventSource then reconnects with Last-Event-ID and the worker
// replays from that sequence, so nothing is lost.
export const maxDuration = 800

export async function GET(req: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params
  const user = await currentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const row = await ownedSession(user.id, sid)
  if (!row) return new Response('Not found', { status: 404 })
  const since = req.headers.get('last-event-id') || req.nextUrl.searchParams.get('since') || '0'
  const upstream = await fetch(`${workerBase()}/code/${sid}/events?since=${encodeURIComponent(since)}`, {
    headers: { Authorization: `Bearer ${row.token}`, Accept: 'text/event-stream' },
    signal: req.signal,
  }).catch(() => null)
  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response(`retry: 3000\nevent: gone\ndata: ${JSON.stringify({ status: upstream?.status ?? 0 })}\n\n`, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform' },
    })
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}

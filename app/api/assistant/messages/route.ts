import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { viewer } from '../_auth'
import { listJobs, listMessages, updateProfile } from '@/lib/assistant/db'
import { runTurn } from '@/lib/assistant/brain'
import { runJob, summarizeJobForUi } from '@/lib/assistant/runner'

export const maxDuration = 800
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const v = await viewer()
  if (!v) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (v.profile.status !== 'member') return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  const after = req.nextUrl.searchParams.get('after') || undefined
  const [messages, jobs] = await Promise.all([listMessages(v.userId, { after, limit: after ? 200 : 80 }), listJobs(v.userId)])
  return NextResponse.json({ messages, jobs: jobs.map(summarizeJobForUi), profile: v.profile, serverTime: new Date().toISOString() })
}

export async function POST(req: NextRequest) {
  const v = await viewer()
  if (!v) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (v.profile.status !== 'member') return NextResponse.json({ error: 'Not a member' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 6000) : ''
  const channel = body.channel === 'voice' ? 'voice' : 'web'

  let result
  if (body.kickoff) {
    const existing = await listMessages(v.userId, { limit: 1 })
    if (existing.length) return NextResponse.json({ messages: [], jobs: [] })
    result = await runTurn(v.userId, v.profile, { type: 'kickoff' })
  } else {
    if (!text) return NextResponse.json({ error: 'Say something.' }, { status: 400 })
    result = await runTurn(v.userId, v.profile, { type: 'user_message', text, channel })
  }
  updateProfile(v.userId, { last_seen_at: new Date().toISOString() }).catch(() => {})

  if (result.jobsToRun.length) {
    const ids = result.jobsToRun
    after(async () => {
      for (const id of ids) {
        try { await runJob(id) } catch (e) { console.log('[assistant] runJob crashed:', String((e as Error)?.message ?? e).slice(0, 200)) }
      }
    })
  }
  const jobs = await listJobs(v.userId)
  return NextResponse.json({ messages: result.messages, jobs: jobs.map(summarizeJobForUi), profile: result.profile })
}

import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { viewer } from '../../_auth'
import { addMessage, getJob, updateJob } from '@/lib/assistant/db'
import { runJob, summarizeJobForUi } from '@/lib/assistant/runner'

export const maxDuration = 800
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const v = await viewer()
  if (!v) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const job = await getJob(id)
  if (!job || job.user_id !== v.userId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { action } = await req.json().catch(() => ({}))
  if (action === 'cancel') {
    if (['done', 'failed', 'cancelled'].includes(job.status)) return NextResponse.json({ job: summarizeJobForUi(job) })
    const updated = await updateJob(id, { status: 'cancelled', completed_at: new Date().toISOString() })
    await addMessage({ userId: v.userId, role: 'event', kind: 'job_update', content: `Cancelled: ${job.title}`, jobId: id, meta: { status: 'cancelled', title: job.title } })
    return NextResponse.json({ job: summarizeJobForUi(updated) })
  }
  if (action === 'retry') {
    if (!['failed', 'done', 'cancelled'].includes(job.status)) return NextResponse.json({ job: summarizeJobForUi(job) })
    const updated = await updateJob(id, { status: 'queued', run_after: null, needs: null, completed_at: null })
    await addMessage({ userId: v.userId, role: 'event', kind: 'job_update', content: `Retrying: ${job.title}`, jobId: id, meta: { status: 'queued', title: job.title } })
    after(async () => { try { await runJob(id) } catch (e) { console.log('[assistant] retry crashed:', String((e as Error)?.message ?? e).slice(0, 200)) } })
    return NextResponse.json({ job: summarizeJobForUi(updated) })
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

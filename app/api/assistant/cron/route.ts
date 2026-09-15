import { NextRequest, NextResponse } from 'next/server'
import { addMessage, admin, getProfile, getUserEmail, localHour, updateJob, updateProfile, type Job } from '@/lib/assistant/db'
import { runTurn } from '@/lib/assistant/brain'
import { runJob } from '@/lib/assistant/runner'
import { notifyUserByEmail } from '@/lib/assistant/email'

export const maxDuration = 800
export const dynamic = 'force-dynamic'

/**
 * The proactive half of the assistant, run hourly by Vercel Cron:
 *  1. due follow-ups -> the assistant texts first
 *  2. queued jobs (retries, resumes the request handler missed) -> run
 *  3. jobs waiting on the user for 36h+ -> one nudge
 *  4. morning check-in (7-9am local) when there is something to report
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${secret}` || req.nextUrl.searchParams.get('secret') === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = admin()
  const now = new Date()
  const report = { followups: 0, jobs: 0, nudges: 0, mornings: 0, errors: [] as string[] }

  // 1. Follow-ups that are due.
  const { data: due } = await db.from('assistant_followups').select('*').eq('status', 'pending').lte('due_at', now.toISOString()).limit(50)
  for (const f of due ?? []) {
    try {
      const profile = await getProfile(f.user_id)
      if (!profile) continue
      const text = f.note
      await addMessage({ userId: f.user_id, role: 'assistant', kind: 'checkin', content: text, jobId: f.job_id, channel: 'cron', meta: { followupId: f.id } })
      await db.from('assistant_followups').update({ status: 'sent', sent_at: now.toISOString() }).eq('id', f.id)
      await notifyUserByEmail(profile, await getUserEmail(f.user_id), text)
      report.followups++
    } catch (e) { report.errors.push(`followup ${f.id}: ${String((e as Error)?.message ?? e).slice(0, 120)}`) }
  }

  // 2. Queued jobs whose time has come (retries, or launches the request handler missed).
  const { data: queued } = await db.from('assistant_jobs').select('*').eq('status', 'queued').or(`run_after.is.null,run_after.lte.${now.toISOString()}`).order('created_at').limit(10)
  for (const j of (queued ?? []) as Job[]) {
    try { await runJob(j.id); report.jobs++ } catch (e) { report.errors.push(`job ${j.id}: ${String((e as Error)?.message ?? e).slice(0, 120)}`) }
  }
  // Jobs stuck in "working" for over an hour died with their request; requeue once.
  const staleCutoff = new Date(now.getTime() - 60 * 60_000).toISOString()
  const { data: stuck } = await db.from('assistant_jobs').select('*').eq('status', 'working').lt('updated_at', staleCutoff).limit(10)
  for (const j of (stuck ?? []) as Job[]) {
    try {
      if ((j.attempts ?? 0) >= 3) { await updateJob(j.id, { status: 'failed', summary: 'Stalled repeatedly.', completed_at: now.toISOString() }); continue }
      await updateJob(j.id, { status: 'queued', run_after: null })
      await runJob(j.id)
      report.jobs++
    } catch (e) { report.errors.push(`stuck ${j.id}: ${String((e as Error)?.message ?? e).slice(0, 120)}`) }
  }

  // 3. Dropped threads: a job has waited on the user for 36h and nobody nudged yet.
  const nudgeCutoff = new Date(now.getTime() - 36 * 60 * 60_000).toISOString()
  const { data: waiting } = await db.from('assistant_jobs').select('*').eq('status', 'waiting').lt('updated_at', nudgeCutoff).is('nudged_at', null).limit(20)
  for (const j of (waiting ?? []) as Job[]) {
    try {
      const profile = await getProfile(j.user_id)
      if (!profile) continue
      const text = `Still need one thing from you on "${j.title}": ${j.needs || 'your answer'}. Want me to keep it open or drop it?`
      await addMessage({ userId: j.user_id, role: 'assistant', kind: 'checkin', content: text, jobId: j.id, channel: 'cron', meta: { title: j.title, status: 'waiting' } })
      await updateJob(j.id, { nudged_at: now.toISOString() })
      await notifyUserByEmail(profile, await getUserEmail(j.user_id), text)
      report.nudges++
    } catch (e) { report.errors.push(`nudge ${j.id}: ${String((e as Error)?.message ?? e).slice(0, 120)}`) }
  }

  // 4. Morning check-in for members with open work, once a day, 7-9am local time.
  const { data: members } = await db.from('assistant_profiles').select('*').eq('status', 'member').eq('onboarding_complete', true).not('timezone', 'is', null).limit(200)
  for (const p of members ?? []) {
    try {
      const hour = localHour(p.timezone)
      if (hour < 7 || hour > 9) continue
      const last = p.last_checkin_at ? new Date(p.last_checkin_at) : null
      if (last && now.getTime() - last.getTime() < 20 * 60 * 60_000) continue
      const { count } = await db.from('assistant_jobs').select('*', { count: 'exact', head: true }).eq('user_id', p.user_id).in('status', ['queued', 'working', 'waiting'])
      const { count: dueToday } = await db.from('assistant_followups').select('*', { count: 'exact', head: true }).eq('user_id', p.user_id).eq('status', 'pending').lte('due_at', new Date(now.getTime() + 24 * 60 * 60_000).toISOString())
      await updateProfile(p.user_id, { last_checkin_at: now.toISOString() })
      if (!count && !dueToday) continue
      const r = await runTurn(p.user_id, p, { type: 'morning' })
      if (r.messages.length) {
        await notifyUserByEmail(p, await getUserEmail(p.user_id), r.messages.map((m) => m.content).join('\n\n'))
        report.mornings++
      }
    } catch (e) { report.errors.push(`morning ${p.user_id}: ${String((e as Error)?.message ?? e).slice(0, 120)}`) }
  }

  return NextResponse.json({ ok: true, at: now.toISOString(), ...report })
}

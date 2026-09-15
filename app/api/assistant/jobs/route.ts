import { NextResponse } from 'next/server'
import { viewer } from '../_auth'
import { listJobs } from '@/lib/assistant/db'
import { summarizeJobForUi } from '@/lib/assistant/runner'

export const dynamic = 'force-dynamic'

export async function GET() {
  const v = await viewer()
  if (!v) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const jobs = await listJobs(v.userId)
  return NextResponse.json({ jobs: jobs.map(summarizeJobForUi) })
}

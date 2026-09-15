import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Profile = {
  user_id: string
  status: 'waitlist' | 'member'
  handle: string | null
  display_name: string | null
  assistant_name: string
  timezone: string | null
  location: string | null
  standing_instructions: string
  connections: Record<string, unknown>
  onboarding_complete: boolean
  invited_by: string | null
  invite_code: string | null
  invites_left: number
  notify_email: boolean
  last_checkin_at: string | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export type Job = {
  id: string
  user_id: string
  title: string
  brief: string
  status: 'queued' | 'working' | 'waiting' | 'done' | 'failed' | 'cancelled'
  summary: string | null
  result: string | null
  steps: Array<{ t: string; tool: string; note: string }>
  needs: string | null
  run_after: string | null
  attempts: number
  nudged_at: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export type Message = {
  id: string
  user_id: string
  role: 'user' | 'assistant' | 'event'
  kind: 'text' | 'job_update' | 'checkin' | 'email_in' | 'email_out' | 'system'
  content: string
  job_id: string | null
  channel: 'web' | 'voice' | 'email' | 'cron'
  meta: Record<string, unknown>
  created_at: string
}

let cached: SupabaseClient | null = null
export function admin(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  cached = createClient(url, key, { auth: { persistSession: false } })
  return cached
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await admin().from('assistant_profiles').select('*').eq('user_id', userId).maybeSingle()
  return (data as Profile) ?? null
}

export async function updateProfile(userId: string, patch: Partial<Profile>): Promise<Profile | null> {
  const { data, error } = await admin()
    .from('assistant_profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Profile
}

export async function addMessage(input: {
  userId: string
  role: Message['role']
  content: string
  kind?: Message['kind']
  jobId?: string | null
  channel?: Message['channel']
  meta?: Record<string, unknown>
}): Promise<Message> {
  const { data, error } = await admin()
    .from('assistant_messages')
    .insert({
      user_id: input.userId,
      role: input.role,
      kind: input.kind ?? 'text',
      content: input.content,
      job_id: input.jobId ?? null,
      channel: input.channel ?? 'web',
      meta: input.meta ?? {},
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Message
}

export async function listMessages(userId: string, opts: { after?: string; limit?: number } = {}): Promise<Message[]> {
  let q = admin().from('assistant_messages').select('*').eq('user_id', userId)
  if (opts.after) q = q.gt('created_at', opts.after)
  const { data } = await q.order('created_at', { ascending: opts.after ? true : false }).limit(opts.limit ?? 80)
  const rows = (data as Message[]) ?? []
  return opts.after ? rows : rows.reverse()
}

export async function getJob(jobId: string): Promise<Job | null> {
  const { data } = await admin().from('assistant_jobs').select('*').eq('id', jobId).maybeSingle()
  return (data as Job) ?? null
}

export async function listJobs(userId: string, limit = 40): Promise<Job[]> {
  const { data } = await admin()
    .from('assistant_jobs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data as Job[]) ?? []
}

export async function openJobs(userId: string): Promise<Job[]> {
  const { data } = await admin()
    .from('assistant_jobs')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['queued', 'working', 'waiting'])
    .order('created_at', { ascending: true })
  return (data as Job[]) ?? []
}

export async function createJob(userId: string, title: string, brief: string): Promise<Job> {
  const { data, error } = await admin()
    .from('assistant_jobs')
    .insert({ user_id: userId, title, brief, status: 'queued' })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Job
}

export async function updateJob(jobId: string, patch: Partial<Job>): Promise<Job> {
  const { data, error } = await admin()
    .from('assistant_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Job
}

export async function appendJobStep(jobId: string, tool: string, note: string): Promise<void> {
  const job = await getJob(jobId)
  if (!job) return
  const steps = [...(job.steps ?? []), { t: new Date().toISOString(), tool, note: note.slice(0, 240) }].slice(-40)
  await admin().from('assistant_jobs').update({ steps, updated_at: new Date().toISOString() }).eq('id', jobId)
}

export async function getMemories(userId: string, limit = 40): Promise<Array<{ id: string; content: string }>> {
  const { data } = await admin()
    .from('memories')
    .select('id, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data as Array<{ id: string; content: string }>) ?? []
}

export async function remember(userId: string, content: string): Promise<boolean> {
  const text = content.trim()
  if (!text) return false
  const { data: existing } = await admin().from('memories').select('id').eq('user_id', userId).eq('content', text).maybeSingle()
  if (existing) return false
  const { error } = await admin().from('memories').insert({ user_id: userId, content: text, category: 'assistant' })
  return !error
}

export async function scheduleFollowup(userId: string, dueAt: string, note: string, jobId?: string | null) {
  const { data, error } = await admin()
    .from('assistant_followups')
    .insert({ user_id: userId, due_at: dueAt, note, job_id: jobId ?? null })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function getUserEmail(userId: string): Promise<string | null> {
  const { data } = await admin().auth.admin.getUserById(userId)
  return data?.user?.email ?? null
}

export function track(eventType: string, prompt: string, model: string) {
  admin()
    .from('analytics_events')
    .insert({ event_type: eventType, prompt: prompt.slice(0, 500), model, cost_estimate: 0.002 })
    .then(() => {}, () => {})
}

/** Local time for a user, formatted for prompts. */
export function localNow(timezone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date())
  } catch {
    return new Date().toUTCString()
  }
}

export function localHour(timezone: string | null | undefined): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', hour: 'numeric', hour12: false }).format(new Date())
    return parseInt(h, 10) % 24
  } catch {
    return new Date().getUTCHours()
  }
}

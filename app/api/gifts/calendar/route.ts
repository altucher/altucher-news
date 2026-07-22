import { NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { giftReminderWorkflow } from '@/workflows/gift-reminder'

const occasionSchema = z.object({
  recipientName: z.string().trim().min(1).max(120),
  relationship: z.string().trim().max(120).optional(),
  occasionName: z.string().trim().min(1).max(120),
  giveBy: z.string().date(),
  planBy: z.string().date().optional(),
  budgetUsd: z.number().nonnegative().max(1_000_000).optional(),
  recurring: z.boolean().default(false),
  timezone: z.string().min(1).max(100).default('UTC'),
})

async function authenticated() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

function localMorningUtc(date: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number)
  const candidate = new Date(Date.UTC(year, month - 1, day, 9))
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(candidate)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const representedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute))
    return new Date(candidate.getTime() - (representedAsUtc - candidate.getTime()))
  } catch {
    return candidate
  }
}

export async function GET() {
  const { supabase, user } = await authenticated()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('gift_occasions')
    .select('id, name, give_by, plan_by, budget_cents, status, recurring_month, recurring_day, gift_recipients!inner(id, name, relationship, timezone)')
    .eq('user_id', user.id)
    .eq('archived', false)
    .order('give_by')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ occasions: data || [], emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) })
}

export async function POST(request: Request) {
  const { supabase, user } = await authenticated()
  if (!user?.email) return NextResponse.json({ error: 'Sign in with an email to create reminders.' }, { status: 401 })

  const parsed = occasionSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid occasion' }, { status: 400 })
  const input = parsed.data

  const { data: recipient, error: recipientError } = await supabase.from('gift_recipients').insert({
    user_id: user.id,
    name: input.recipientName,
    relationship: input.relationship || null,
    timezone: input.timezone,
  }).select('id').single()
  if (recipientError) return NextResponse.json({ error: recipientError.message }, { status: 500 })

  const date = new Date(`${input.giveBy}T12:00:00Z`)
  const { data: occasion, error: occasionError } = await supabase.from('gift_occasions').insert({
    user_id: user.id,
    recipient_id: recipient.id,
    name: input.occasionName,
    occasion_date: input.recurring ? null : input.giveBy,
    recurring_month: input.recurring ? date.getUTCMonth() + 1 : null,
    recurring_day: input.recurring ? date.getUTCDate() : null,
    plan_by: input.planBy || null,
    give_by: input.giveBy,
    budget_cents: input.budgetUsd == null ? null : Math.round(input.budgetUsd * 100),
  }).select('id').single()
  if (occasionError) return NextResponse.json({ error: occasionError.message }, { status: 500 })

  const now = Date.now()
  const createdReminders = []
  for (const leadDays of [30, 14, 3]) {
    const reminderDate = new Date(`${input.giveBy}T12:00:00Z`)
    reminderDate.setUTCDate(reminderDate.getUTCDate() - leadDays)
    const scheduled = localMorningUtc(reminderDate.toISOString().slice(0, 10), input.timezone)
    if (scheduled.getTime() <= now) continue
    const idempotencyKey = `${occasion.id}:${input.giveBy}:${leadDays}`
    const { data: reminder, error } = await supabase.from('gift_reminders').insert({
      user_id: user.id,
      occasion_id: occasion.id,
      lead_days: leadDays,
      scheduled_at: scheduled.toISOString(),
      idempotency_key: idempotencyKey,
      status: process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL ? 'scheduled' : 'disabled',
    }).select('id').single()
    if (error || !reminder || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) continue
    const run = await start(giftReminderWorkflow, [{ reminderId: reminder.id, userId: user.id, recipientName: input.recipientName, occasionName: input.occasionName, giveBy: input.giveBy, scheduledAt: scheduled.toISOString(), leadDays, email: user.email }])
    await supabase.from('gift_reminders').update({ workflow_run_id: run.runId }).eq('id', reminder.id).eq('user_id', user.id)
    createdReminders.push({ leadDays, runId: run.runId })
  }

  return NextResponse.json({ occasionId: occasion.id, reminders: createdReminders }, { status: 201 })
}

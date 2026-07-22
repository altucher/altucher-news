import { sleep } from 'workflow'
import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

export type GiftReminderInput = {
  reminderId: string
  userId: string
  recipientName: string
  occasionName: string
  giveBy: string
  scheduledAt: string
  leadDays: number
  email: string
}

async function deliverReminder(input: GiftReminderInput) {
  'use step'

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data: reminder } = await admin
    .from('gift_reminders')
    .select('id, user_id, status, idempotency_key')
    .eq('id', input.reminderId)
    .eq('user_id', input.userId)
    .single()

  if (!reminder || reminder.status !== 'scheduled') return { status: 'skipped' }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    await admin.from('gift_reminders').update({ status: 'disabled', error: 'Resend is not configured' }).eq('id', input.reminderId)
    return { status: 'disabled' }
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: input.email,
    subject: `${input.leadDays} days until ${input.recipientName}'s ${input.occasionName}`,
    text: `GiftFinder reminder: ${input.occasionName} for ${input.recipientName} is on ${input.giveBy}. You have ${input.leadDays} days to plan or purchase the gift.`,
    headers: { 'X-Entity-Ref-ID': reminder.idempotency_key },
  })
  if (error) throw new Error(error.message)

  await admin.from('gift_reminders').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', input.reminderId)
  return { status: 'sent' }
}

export async function giftReminderWorkflow(input: GiftReminderInput) {
  'use workflow'
  await sleep(new Date(input.scheduledAt))
  return deliverReminder(input)
}

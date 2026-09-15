import { Resend } from 'resend'
import { admin, addMessage, type Profile } from './db'

/**
 * Every member gets an address of their own, like Instinct's mail.instinct.com
 * feature: people can email the assistant, the user can forward confirmations
 * to it, and the assistant sends from it. Sending and receiving run through
 * Resend. ASSISTANT_EMAIL_DOMAIN is the receiving domain (a verified custom
 * domain with an MX record, or the account's managed <id>.resend.app domain);
 * inbound mail arrives at /api/assistant/inbound via the email.received webhook.
 */
export function emailDomain(): string | null {
  const explicit = process.env.ASSISTANT_EMAIL_DOMAIN
  if (explicit) return explicit.trim().toLowerCase()
  const from = process.env.RESEND_FROM_EMAIL || ''
  const at = from.indexOf('@')
  if (at > 0) return from.slice(at + 1).replace(/>.*$/, '').trim().toLowerCase()
  return null
}

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.startsWith('re_') && emailDomain())
}

export function assistantAddress(profile: Pick<Profile, 'handle'>): string | null {
  if (!profile.handle) return null
  const domain = emailDomain() || 'mail.bluetao.ai'
  return `${profile.handle}@${domain}`
}

export async function sendAssistantEmail(input: {
  profile: Profile
  to: string
  subject: string
  body: string
  jobId?: string | null
  replyTo?: string | null
}): Promise<{ ok: boolean; note: string }> {
  const from = assistantAddress(input.profile)
  const fromName = `${input.profile.assistant_name} (${input.profile.display_name || 'BlueTAO'}'s assistant)`
  const record = {
    user_id: input.profile.user_id,
    direction: 'out',
    from_addr: from,
    to_addr: [input.to],
    subject: input.subject,
    body: input.body,
    job_id: input.jobId ?? null,
  }
  if (!emailConfigured() || !from) {
    await admin().from('assistant_emails').insert({ ...record, provider_id: 'draft' })
    await addMessage({
      userId: input.profile.user_id,
      role: 'event',
      kind: 'email_out',
      content: `Draft email to ${input.to}\nSubject: ${input.subject}\n\n${input.body}`,
      jobId: input.jobId ?? null,
      meta: { draft: true, to: input.to, subject: input.subject },
    })
    return { ok: false, note: 'Email sending is not activated on this account yet, so the email was saved as a draft in the thread for the user to send themselves. Tell the user that plainly.' }
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const { data, error } = await resend.emails.send({
      from: `${fromName} <${from}>`,
      to: input.to,
      subject: input.subject,
      text: input.body,
      replyTo: input.replyTo || from,
    })
    if (error) throw new Error(error.message)
    await admin().from('assistant_emails').insert({ ...record, provider_id: data?.id ?? null })
    await addMessage({
      userId: input.profile.user_id,
      role: 'event',
      kind: 'email_out',
      content: `Sent email to ${input.to}\nSubject: ${input.subject}\n\n${input.body}`,
      jobId: input.jobId ?? null,
      meta: { to: input.to, subject: input.subject, providerId: data?.id ?? null },
    })
    return { ok: true, note: `Email sent to ${input.to} from ${from}.` }
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 200)
    await admin().from('assistant_emails').insert({ ...record, provider_id: 'failed' })
    return { ok: false, note: `Sending failed (${msg}). Do not claim it was sent.` }
  }
}

/** Notify the user at their own login email that the assistant texted first. */
export async function notifyUserByEmail(profile: Profile, userEmail: string | null, text: string): Promise<void> {
  if (!profile.notify_email || !userEmail || !emailConfigured()) return
  const from = assistantAddress(profile)
  if (!from) return
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: `${profile.assistant_name} <${from}>`,
      to: userEmail,
      subject: `${profile.assistant_name}: ${text.split('\n')[0].slice(0, 70)}`,
      text: `${text}\n\nReply in your thread: https://www.bluetao.ai/`,
    })
  } catch (e) {
    console.log('[assistant] notify email failed:', String((e as Error)?.message ?? e).slice(0, 120))
  }
}

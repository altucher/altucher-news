import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { addMessage, admin, getProfile } from '@/lib/assistant/db'
import { runTurn } from '@/lib/assistant/brain'
import { runJob } from '@/lib/assistant/runner'
import { emailDomain } from '@/lib/assistant/email'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

/**
 * Inbound mail for every member's assistant address. Accepts:
 *  - Resend "email.received" webhooks (body fetched from the Receiving API)
 *  - SendGrid Inbound Parse (multipart form)
 *  - a plain JSON {from, to, subject, text} for testing
 * Point the provider's webhook here. With RESEND_WEBHOOK_SECRET set, Resend
 * (svix-style) signatures are verified; without it the route trusts the caller.
 */
function verifySvix(req: NextRequest, raw: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) return true
  const id = req.headers.get('svix-id') || ''
  const ts = req.headers.get('svix-timestamp') || ''
  const sigs = (req.headers.get('svix-signature') || '').split(' ')
  if (!id || !ts || !sigs.length) return false
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 5 * 60) return false
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64')
  return sigs.some((s) => {
    const v = s.split(',')[1] || ''
    try { return v.length === expected.length && timingSafeEqual(Buffer.from(v), Buffer.from(expected)) } catch { return false }
  })
}

type Inbound = { from: string; to: string[]; subject: string; text: string; providerId: string | null }

async function parse(req: NextRequest): Promise<Inbound | null> {
  const type = req.headers.get('content-type') || ''
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData()
    const to = String(form.get('to') || form.get('envelope') || '')
    return {
      from: String(form.get('from') || ''),
      to: to.match(/[^\s<>,"]+@[^\s<>,"]+/g) || [],
      subject: String(form.get('subject') || ''),
      text: String(form.get('text') || form.get('html') || '').replace(/<[^>]+>/g, ' '),
      providerId: null,
    }
  }
  const raw = await req.text()
  if (!verifySvix(req, raw)) return null
  let body: Record<string, unknown>
  try { body = JSON.parse(raw) } catch { return null }
  if (body.type === 'email.received' && body.data && typeof body.data === 'object') {
    const d = body.data as Record<string, unknown>
    const id = String(d.email_id || '')
    let text = ''
    if (id && process.env.RESEND_API_KEY) {
      try {
        const r = await fetch(`https://api.resend.com/emails/receiving/${id}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } })
        if (r.ok) { const j = await r.json(); text = String(j.text || '') || String(j.html || '').replace(/<[^>]+>/g, ' ') }
      } catch { /* metadata only */ }
    }
    const to = ([] as string[]).concat((d.to as string[]) || [], (d.received_for as string[]) || [])
    return { from: String(d.from || ''), to, subject: String(d.subject || ''), text, providerId: id || null }
  }
  if (typeof body.from === 'string' && (Array.isArray(body.to) || typeof body.to === 'string')) {
    return { from: body.from, to: Array.isArray(body.to) ? body.to.map(String) : [String(body.to)], subject: String(body.subject || ''), text: String(body.text || ''), providerId: null }
  }
  return null
}

export async function POST(req: NextRequest) {
  const mail = await parse(req)
  if (!mail) return NextResponse.json({ error: 'Unrecognized payload' }, { status: 400 })
  const domain = emailDomain()
  const handles = mail.to
    .map((a) => (a.match(/([^<\s"]+)@([^>\s"]+)/) || []).slice(1))
    .filter(([, d]) => !domain || d?.toLowerCase() === domain)
    .map(([h]) => h?.toLowerCase())
    .filter(Boolean)
  if (!handles.length) return NextResponse.json({ ok: true, ignored: 'no assistant recipient' })
  const { data: profile } = await admin().from('assistant_profiles').select('*').in('handle', handles).eq('status', 'member').limit(1).maybeSingle()
  if (!profile) return NextResponse.json({ ok: true, ignored: 'unknown handle' })

  const body = mail.text.replace(/\r/g, '').trim().slice(0, 6000)
  await admin().from('assistant_emails').insert({ user_id: profile.user_id, direction: 'in', provider_id: mail.providerId, from_addr: mail.from, to_addr: mail.to, subject: mail.subject, body })
  await addMessage({ userId: profile.user_id, role: 'event', kind: 'email_in', content: `From: ${mail.from}\nSubject: ${mail.subject || '(no subject)'}\n\n${body || '(no text body)'}`, channel: 'email', meta: { from: mail.from, subject: mail.subject } })

  after(async () => {
    try {
      const fresh = await getProfile(profile.user_id)
      if (!fresh) return
      const r = await runTurn(profile.user_id, fresh, { type: 'email_in', summary: mail.subject })
      for (const id of r.jobsToRun) await runJob(id)
    } catch (e) { console.log('[assistant] inbound turn failed:', String((e as Error)?.message ?? e).slice(0, 200)) }
  })
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureMembership, joinWaitlist, redeemInvite } from '@/lib/assistant/access'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ signedIn: false, member: false })
  const profile = await ensureMembership(user.id, user.email ?? null, (user.user_metadata?.full_name as string) || null)
  return NextResponse.json({ signedIn: true, member: profile.status === 'member', email: user.email })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  if (body.action === 'waitlist') {
    const r = await joinWaitlist(String(body.email || ''), body.name, body.note)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  if (body.action === 'redeem') {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 })
    const r = await redeemInvite(user.id, user.email ?? null, String(body.code || ''), (user.user_metadata?.full_name as string) || null)
    return NextResponse.json(r, { status: r.ok ? 200 : 400 })
  }
  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}

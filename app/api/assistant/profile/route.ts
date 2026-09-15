import { NextRequest, NextResponse } from 'next/server'
import { viewer } from '../_auth'
import { getMemories, updateProfile, type Profile } from '@/lib/assistant/db'
import { assistantAddress, emailConfigured } from '@/lib/assistant/email'
import { myInvites } from '@/lib/assistant/access'

export const dynamic = 'force-dynamic'

async function payload(userId: string, profile: Profile) {
  const [memories, invites] = await Promise.all([getMemories(userId, 60), myInvites(userId)])
  return { profile, memories, invites, address: assistantAddress(profile), emailLive: emailConfigured() }
}

export async function GET() {
  const v = await viewer()
  if (!v) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await payload(v.userId, v.profile))
}

export async function PATCH(req: NextRequest) {
  const v = await viewer()
  if (!v) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const patch: Partial<Profile> = {}
  if (typeof body.display_name === 'string') patch.display_name = body.display_name.trim().slice(0, 80) || null
  if (typeof body.assistant_name === 'string' && body.assistant_name.trim()) patch.assistant_name = body.assistant_name.trim().slice(0, 40)
  if (typeof body.location === 'string') patch.location = body.location.trim().slice(0, 120) || null
  if (typeof body.timezone === 'string') {
    try { new Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); patch.timezone = body.timezone } catch { return NextResponse.json({ error: 'Invalid time zone' }, { status: 400 }) }
  }
  if (typeof body.standing_instructions === 'string') patch.standing_instructions = body.standing_instructions.slice(0, 4000)
  if (typeof body.notify_email === 'boolean') patch.notify_email = body.notify_email
  if (typeof body.onboarding_complete === 'boolean') patch.onboarding_complete = body.onboarding_complete
  if (body.connections && typeof body.connections === 'object') patch.connections = { ...(v.profile.connections || {}), ...body.connections }
  const profile = (await updateProfile(v.userId, patch)) ?? v.profile
  return NextResponse.json(await payload(v.userId, profile))
}

import { randomBytes } from 'node:crypto'
import { admin, getProfile, type Profile } from './db'

/**
 * Access mirrors Instinct's private beta: you are in with an invite from a
 * member (each member gets 3), or you wait on the list. Two escape hatches so
 * the live product keeps working: ASSISTANT_OPEN_ACCESS=1 admits everyone, and
 * anyone with an active paid subscription or an admin email is admitted.
 */
const ADMIN_EMAILS = (process.env.ASSISTANT_ADMIN_EMAILS || 'altucher@gmail.com').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

export function genCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(6)
  let s = ''
  for (let i = 0; i < 6; i++) s += alphabet[bytes[i] % alphabet.length]
  return `BT-${s}`
}

async function uniqueHandle(email: string | null, displayName?: string | null): Promise<string> {
  const base = (displayName?.split(/\s+/)[0] || email?.split('@')[0] || 'assistant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 20) || 'assistant'
  const db = admin()
  let candidate = base
  for (let i = 0; i < 20; i++) {
    const { data } = await db.from('assistant_profiles').select('user_id').eq('handle', candidate).maybeSingle()
    if (!data) return candidate
    candidate = `${base}${Math.floor(100 + Math.random() * 900)}`
  }
  return `${base}${Date.now().toString(36)}`
}

export async function createInvites(createdBy: string | null, count: number): Promise<string[]> {
  const codes = Array.from({ length: count }, genCode)
  await admin().from('assistant_invites').insert(codes.map((code) => ({ code, created_by: createdBy, uses_left: 1 })))
  return codes
}

export async function myInvites(userId: string): Promise<string[]> {
  const { data } = await admin().from('assistant_invites').select('code').eq('created_by', userId).gt('uses_left', 0).order('created_at')
  return (data ?? []).map((r: { code: string }) => r.code)
}

export async function grantMembership(userId: string, email: string | null, opts: { invitedBy?: string | null; code?: string | null; displayName?: string | null } = {}): Promise<Profile> {
  const existing = await getProfile(userId)
  if (existing?.status === 'member') return existing
  const handle = existing?.handle || (await uniqueHandle(email, opts.displayName))
  const row = {
    user_id: userId,
    status: 'member',
    handle,
    display_name: existing?.display_name || opts.displayName || null,
    invited_by: opts.invitedBy ?? existing?.invited_by ?? null,
    invite_code: opts.code ?? existing?.invite_code ?? null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await admin().from('assistant_profiles').upsert(row, { onConflict: 'user_id' }).select('*').single()
  if (error) throw new Error(error.message)
  const codes = await myInvites(userId)
  if (codes.length === 0) await createInvites(userId, 3)
  return data as Profile
}

async function hasActiveSubscription(userId: string): Promise<boolean> {
  const { data } = await admin().from('subscriptions').select('status').eq('user_id', userId).in('status', ['active', 'trialing']).limit(1)
  return Boolean(data && data.length)
}

/** Returns the profile, granting membership automatically where policy allows. */
export async function ensureMembership(userId: string, email: string | null, displayName?: string | null): Promise<Profile> {
  const existing = await getProfile(userId)
  if (existing?.status === 'member') return existing
  const open = process.env.ASSISTANT_OPEN_ACCESS === '1'
  const isAdmin = Boolean(email && ADMIN_EMAILS.includes(email.toLowerCase()))
  if (open || isAdmin || (await hasActiveSubscription(userId))) {
    return grantMembership(userId, email, { displayName, code: open ? 'open' : isAdmin ? 'admin' : 'subscriber' })
  }
  if (existing) return existing
  const { data, error } = await admin()
    .from('assistant_profiles')
    .upsert({ user_id: userId, status: 'waitlist', display_name: displayName ?? null }, { onConflict: 'user_id' })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Profile
}

export async function redeemInvite(userId: string, email: string | null, rawCode: string, displayName?: string | null): Promise<{ ok: boolean; error?: string; profile?: Profile }> {
  const code = rawCode.trim().toUpperCase().replace(/\s+/g, '')
  if (!code) return { ok: false, error: 'Enter an invite code.' }
  const db = admin()
  const { data: invite } = await db.from('assistant_invites').select('*').eq('code', code).maybeSingle()
  if (!invite) return { ok: false, error: 'That code is not valid.' }
  if (invite.uses_left <= 0) return { ok: false, error: 'That code has already been used.' }
  if (invite.created_by === userId) return { ok: false, error: 'That is one of your own invites - give it to a friend.' }
  const { data: dec } = await db.from('assistant_invites').update({ uses_left: invite.uses_left - 1 }).eq('code', code).eq('uses_left', invite.uses_left).select('code').maybeSingle()
  if (!dec) return { ok: false, error: 'That code was just used. Try another.' }
  const profile = await grantMembership(userId, email, { invitedBy: invite.created_by, code, displayName })
  return { ok: true, profile }
}

export async function joinWaitlist(email: string, name?: string | null, note?: string | null): Promise<{ ok: boolean; error?: string; position?: number }> {
  const clean = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'Enter a valid email.' }
  const db = admin()
  await db.from('assistant_waitlist').upsert({ email: clean, name: name?.trim() || null, note: note?.trim()?.slice(0, 500) || null }, { onConflict: 'email', ignoreDuplicates: true })
  const { count } = await db.from('assistant_waitlist').select('*', { count: 'exact', head: true })
  return { ok: true, position: count ?? undefined }
}

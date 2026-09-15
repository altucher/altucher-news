// Seeds the assistant: makes a test member, creates invite codes for the owner,
// and prints a magic link for the test user. Usage: node scripts/assistant-seed.mjs
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/); if (m) env[m[1]] = m[2] }
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const OWNER = '3f70f0bd-73fd-4f97-955d-554e49a345f6'
const TEST_EMAIL = 'assistant-tester@bluetao.ai'
const code = () => 'BT-' + Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')

// Owner: member + 5 shareable invites (idempotent).
await db.from('assistant_profiles').upsert({ user_id: OWNER, status: 'member', handle: 'james', display_name: 'James', invite_code: 'admin', updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
const { data: existing } = await db.from('assistant_invites').select('code').eq('created_by', OWNER).gt('uses_left', 0)
if (!existing || existing.length < 5) {
  const codes = Array.from({ length: 5 - (existing?.length || 0) }, code)
  await db.from('assistant_invites').insert(codes.map((c) => ({ code: c, created_by: OWNER, uses_left: 1 })))
}
const { data: invites } = await db.from('assistant_invites').select('code').eq('created_by', OWNER).gt('uses_left', 0)
console.log('owner invites:', invites.map((i) => i.code).join(' '))

// Test user (created if missing) + membership.
let { data: list } = await db.auth.admin.listUsers({ perPage: 1000 })
let user = list.users.find((u) => u.email === TEST_EMAIL)
if (!user) {
  const { data, error } = await db.auth.admin.createUser({ email: TEST_EMAIL, email_confirm: true, user_metadata: { full_name: 'Test Member' } })
  if (error) throw error
  user = data.user
}
await db.from('assistant_profiles').upsert({ user_id: user.id, status: 'member', handle: 'tester', invite_code: 'seed', updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
if (process.argv.includes('--reset')) {
  await db.from('assistant_messages').delete().eq('user_id', user.id)
  await db.from('assistant_jobs').delete().eq('user_id', user.id)
  await db.from('assistant_followups').delete().eq('user_id', user.id)
  await db.from('memories').delete().eq('user_id', user.id)
  await db.from('assistant_profiles').update({ display_name: null, timezone: null, location: null, standing_instructions: '', onboarding_complete: false, assistant_name: 'Blue' }).eq('user_id', user.id)
  console.log('test user reset')
}
const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: 'magiclink', email: TEST_EMAIL, options: { redirectTo: 'http://localhost:5330/auth/callback' } })
if (linkErr) throw linkErr
console.log('test user:', user.id)
console.log('dev login: http://localhost:5330/api/assistant/dev-login?token_hash=' + link.properties.hashed_token)

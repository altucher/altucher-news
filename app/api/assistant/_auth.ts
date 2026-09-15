import { createClient } from '@/lib/supabase/server'
import { ensureMembership } from '@/lib/assistant/access'
import type { Profile } from '@/lib/assistant/db'

export type Viewer = { userId: string; email: string | null; name: string | null; profile: Profile }

export async function viewer(): Promise<Viewer | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const name = (user.user_metadata?.full_name as string | undefined) || null
  const profile = await ensureMembership(user.id, user.email ?? null, name)
  return { userId: user.id, email: user.email ?? null, name, profile }
}

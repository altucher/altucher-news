import { createClient } from '@/lib/supabase/server'
import { ensureMembership } from '@/lib/assistant/access'
import { assistantAddress, emailConfigured } from '@/lib/assistant/email'
import Landing from '@/components/assistant/landing'
import Gate from '@/components/assistant/gate'
import Thread from '@/components/assistant/thread'

// The personal assistant lives at /assistant: a landing for visitors, an invite gate for
// signed-in non-members, and the single ongoing thread for members.
export const dynamic = 'force-dynamic'

export default async function AssistantPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <Landing />
  const name = (user.user_metadata?.full_name as string | undefined) || null
  const profile = await ensureMembership(user.id, user.email ?? null, name)
  if (profile.status !== 'member') return <Gate email={user.email ?? ''} />
  return (
    <Thread
      initialProfile={profile}
      address={assistantAddress(profile)}
      emailLive={emailConfigured()}
      userEmail={user.email ?? ''}
    />
  )
}

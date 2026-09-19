import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { workerConfigured } from '@/lib/code-agent/worker'
import CodeAgent from '@/components/code-agent'

// BlueTAO Code Agent: a Claude Code-style coding session hosted on the James
// worker, with James picking the model per request.
export const dynamic = 'force-dynamic'

export default async function CodePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  return <CodeAgent configured={workerConfigured()} userEmail={user.email ?? ''} />
}

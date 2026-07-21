import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createAdminClient(url, key)
}

function slugFromPublishedUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean)
    return parts[0] === 's' && /^[a-z0-9]{8,10}$/.test(parts[1] || '') ? parts[1] : null
  } catch {
    return null
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { listed } = await request.json()
    if (typeof listed !== 'boolean') return NextResponse.json({ error: 'Listed must be a boolean' }, { status: 400 })

    const { data: project } = await supabase
      .from('projects')
      .select('id, project_type, published_url')
      .eq('id', projectId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!project || project.project_type !== 'agent') return NextResponse.json({ error: 'Agent project not found' }, { status: 404 })

    const slug = slugFromPublishedUrl(project.published_url)
    if (!slug) return NextResponse.json({ error: 'Publish this agent before listing it' }, { status: 400 })

    const { data, error } = await getAdmin()
      .from('published_sites')
      .update({ marketplace_listed: listed, marketplace_listed_at: listed ? new Date().toISOString() : null })
      .eq('slug', slug)
      .eq('project_type', 'agent')
      .not('agent_manifest', 'is', null)
      .select('marketplace_listed')
      .maybeSingle()
    if (error || !data) return NextResponse.json({ error: 'Published agent not found' }, { status: 404 })

    return NextResponse.json({ listed: data.marketplace_listed })
  } catch (error) {
    console.error('[Marketplace] listing update error:', error)
    return NextResponse.json({ error: 'Could not update marketplace listing' }, { status: 500 })
  }
}

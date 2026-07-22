import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to add this agent to My Projects.' }, { status: 401 })

  const { data: site } = await admin()
    .from('published_sites')
    .select('slug, title, html, agent_manifest, project_type')
    .eq('slug', slug)
    .eq('marketplace_listed', true)
    .eq('project_type', 'agent')
    .maybeSingle()
  if (!site?.agent_manifest) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const manifest = site.agent_manifest as { name?: string }
  const { data: project, error } = await supabase.from('projects').insert({
    title: manifest.name || site.title || 'Agent',
    current_code: site.html,
    language: 'html',
    project_type: 'agent',
    agent_manifest: site.agent_manifest,
    published_url: `/s/${site.slug}`,
    user_id: user.id,
  }).select('id').single()
  if (error || !project) return NextResponse.json({ error: error?.message || 'Could not add agent' }, { status: 500 })

  const { error: versionError } = await supabase.from('project_versions').insert({
    project_id: project.id,
    user_id: user.id,
    code: site.html,
    label: 'Added from Agent Marketplace',
    version_number: 1,
  })
  if (versionError) {
    await supabase.from('projects').delete().eq('id', project.id).eq('user_id', user.id)
    return NextResponse.json({ error: versionError.message }, { status: 500 })
  }

  return NextResponse.json({ projectId: project.id, openUrl: `/s/${site.slug}?projectId=${project.id}` })
}

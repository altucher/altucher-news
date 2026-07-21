import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { parseProject, serializeProject } from '@/lib/project-document'

// GET /api/projects - List all saved projects for the authenticated user
export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Only list metadata (not the full code) so the panel loads fast
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, title, language, published_url, created_at, updated_at')
    .order('updated_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ projects })
}

// POST /api/projects - Save a build as a new project (with its first version)
export async function POST(req: Request) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { title, code, language, publishedUrl } = await req.json()

  if (typeof code !== 'string' || code.trim().length === 0) {
    return NextResponse.json({ error: 'Code is required' }, { status: 400 })
  }
  const parsedProject = parseProject(code)
  const storedCode = parsedProject ? serializeProject(parsedProject) : code

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      title: title?.trim() || 'Untitled project',
      current_code: storedCode,
      language: language || 'html',
      published_url: typeof publishedUrl === 'string' && publishedUrl.trim() ? publishedUrl.trim() : null,
      user_id: user.id,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Record the first version
  const { error: versionError } = await supabase
    .from('project_versions')
    .insert({
      project_id: project.id,
      user_id: user.id,
      code: storedCode,
      label: 'Initial version',
      version_number: 1,
    })

  if (versionError) {
    return NextResponse.json({ error: versionError.message }, { status: 500 })
  }

  return NextResponse.json({ project })
}

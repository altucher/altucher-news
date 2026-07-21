import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { parseProject, serializeProject } from '@/lib/project-document'

// GET /api/projects/[projectId] - Get a project with its full code + version history
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 })
  }

  const { data: versions, error: versionsError } = await supabase
    .from('project_versions')
    .select('id, label, version_number, created_at')
    .eq('project_id', projectId)
    .order('version_number', { ascending: false })

  if (versionsError) {
    return NextResponse.json({ error: versionsError.message }, { status: 500 })
  }

  return NextResponse.json({ project, versions })
}

// PATCH /api/projects/[projectId] - Update code (new version) and/or rename
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { title, code, language, label, publishedUrl } = await req.json()

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof title === 'string' && title.trim().length > 0) {
    updates.title = title.trim()
  }
  if (typeof language === 'string' && language.length > 0) {
    updates.language = language
  }
  if (typeof publishedUrl === 'string' && publishedUrl.trim().length > 0) {
    updates.published_url = publishedUrl.trim()
  }

  // If new code is provided, snapshot a new version
  if (typeof code === 'string' && code.trim().length > 0) {
    const parsedProject = parseProject(code)
    const storedCode = parsedProject ? serializeProject(parsedProject) : code
    updates.current_code = storedCode

    const { data: lastVersion } = await supabase
      .from('project_versions')
      .select('version_number')
      .eq('project_id', projectId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextVersion = (lastVersion?.version_number ?? 0) + 1

    const { error: versionError } = await supabase
      .from('project_versions')
      .insert({
        project_id: projectId,
        user_id: user.id,
        code: storedCode,
        label: label?.trim() || `Version ${nextVersion}`,
        version_number: nextVersion,
      })

    if (versionError) {
      return NextResponse.json({ error: versionError.message }, { status: 500 })
    }
  }

  const { data: project, error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ project })
}

// DELETE /api/projects/[projectId] - Delete a project (versions cascade)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('id', projectId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

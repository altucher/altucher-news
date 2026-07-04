import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/projects/[projectId]/versions/[versionId] - Get a single version's full code
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; versionId: string }> }
) {
  const { projectId, versionId } = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: version, error } = await supabase
    .from('project_versions')
    .select('*')
    .eq('id', versionId)
    .eq('project_id', projectId)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ version })
}

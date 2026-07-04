import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(url, key)
}

// PATCH /api/fun/projects/[projectId]  -> approve or reject a pending project
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const supabaseAdmin = getSupabaseAdmin()
    const body = await req.json()
    const status = body.status

    if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('fun_projects')
      .update({
        status,
        approved_at: status === 'approved' ? new Date().toISOString() : null,
      })
      .eq('id', projectId)
      .select('id, title, link, description, status')
      .single()

    if (error) {
      console.error('[Fun] update error:', error)
      return NextResponse.json({ error: 'Could not update project' }, { status: 500 })
    }

    return NextResponse.json({ project: data })
  } catch (error) {
    console.error('[Fun] PATCH error:', error)
    return NextResponse.json({ error: 'Could not update project' }, { status: 500 })
  }
}

// DELETE /api/fun/projects/[projectId]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params
    const supabaseAdmin = getSupabaseAdmin()

    const { error } = await supabaseAdmin
      .from('fun_projects')
      .delete()
      .eq('id', projectId)

    if (error) {
      console.error('[Fun] delete error:', error)
      return NextResponse.json({ error: 'Could not delete project' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Fun] DELETE error:', error)
    return NextResponse.json({ error: 'Could not delete project' }, { status: 500 })
  }
}

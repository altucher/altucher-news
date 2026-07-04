import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Lazy initialization to avoid build-time errors
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(url, key)
}

// Normalize a user-provided link into a safe absolute URL.
function normalizeLink(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withProtocol)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

// GET /api/fun/projects?status=approved|pending|rejected  (defaults to approved)
export async function GET(req: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'approved'

    // Only expose submitter emails on the private prospects views (pending/rejected),
    // never on the public approved list.
    const columns =
      status === 'approved'
        ? 'id, title, link, description, status, created_at, approved_at'
        : 'id, title, link, description, email, status, created_at, approved_at'

    const { data, error } = await supabaseAdmin
      .from('fun_projects')
      .select(columns)
      .eq('status', status)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[Fun] list error:', error)
      return NextResponse.json({ projects: [] })
    }

    return NextResponse.json({ projects: data || [] })
  } catch (error) {
    console.error('[Fun] GET error:', error)
    return NextResponse.json({ projects: [] })
  }
}

// POST /api/fun/projects  -> submit a new project (goes to "pending" for approval)
export async function POST(req: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const body = await req.json()
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim().slice(0, 1000)
        : null
    const email =
      typeof body.email === 'string' && body.email.trim()
        ? body.email.trim().slice(0, 320)
        : null

    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }
    const link = normalizeLink(typeof body.link === 'string' ? body.link : '')
    if (!link) {
      return NextResponse.json({ error: 'A valid link is required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('fun_projects')
      .insert({ title: title.slice(0, 200), link, description, email, status: 'pending' })
      .select('id, title, link, description, status, created_at')
      .single()

    if (error) {
      console.error('[Fun] insert error:', error)
      return NextResponse.json({ error: 'Could not submit project' }, { status: 500 })
    }

    // Log the submission as an analytics event (best-effort).
    await supabaseAdmin
      .from('analytics_events')
      .insert({ event_type: 'fun_submission', prompt: title.slice(0, 200) })
      .then(undefined, () => {})

    return NextResponse.json({ project: data })
  } catch (error) {
    console.error('[Fun] POST error:', error)
    return NextResponse.json({ error: 'Could not submit project' }, { status: 500 })
  }
}

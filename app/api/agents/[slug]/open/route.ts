import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key)
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const origin = new URL(request.url).origin
  if (!/^[a-z0-9]{8,10}$/.test(slug)) return NextResponse.redirect(`${origin}/agents`)

  try {
    const admin = getAdmin()
    const { data } = await admin
      .from('published_sites')
      .select('id, marketplace_open_count')
      .eq('slug', slug)
      .eq('marketplace_listed', true)
      .eq('project_type', 'agent')
      .maybeSingle()
    if (!data) return NextResponse.redirect(`${origin}/agents`)

    await admin.from('published_sites').update({ marketplace_open_count: Number(data.marketplace_open_count || 0) + 1 }).eq('id', data.id)
    return NextResponse.redirect(`${origin}/s/${slug}`, 307)
  } catch (error) {
    console.error('[Agents] launch error:', error)
    return NextResponse.redirect(`${origin}/s/${slug}`, 307)
  }
}

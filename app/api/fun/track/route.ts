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

// POST /api/fun/track -> record a FUN page view in the shared analytics_events table
export async function POST() {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    await supabaseAdmin
      .from('analytics_events')
      .insert({ event_type: 'fun_page_view' })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Fun] track error:', error)
    return NextResponse.json({ success: false })
  }
}

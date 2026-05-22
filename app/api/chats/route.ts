import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET /api/chats - List all chats for the authenticated user
export async function GET() {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { data: chats, error } = await supabase
    .from('chats')
    .select('*')
    .order('updated_at', { ascending: false })
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json({ chats })
}

// POST /api/chats - Create a new chat
export async function POST(req: Request) {
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { title } = await req.json()
  
  const { data: chat, error } = await supabase
    .from('chats')
    .insert({ title: title || 'New Chat', user_id: user.id })
    .select()
    .single()
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json({ chat })
}

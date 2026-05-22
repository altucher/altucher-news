import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/chats/[chatId]/messages - Add a message to a chat
export async function POST(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params
  const supabase = await createClient()
  
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  const { role, content } = await req.json()
  
  // Insert the message
  const { data: message, error: messageError } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, role, content })
    .select()
    .single()
  
  if (messageError) {
    return NextResponse.json({ error: messageError.message }, { status: 500 })
  }
  
  // Update the chat's updated_at timestamp and title if it's the first user message
  const { data: messageCount } = await supabase
    .from('messages')
    .select('id', { count: 'exact' })
    .eq('chat_id', chatId)
  
  const updates: { updated_at: string; title?: string } = {
    updated_at: new Date().toISOString()
  }
  
  // If this is the first or second message (first user message), use it as title
  if (messageCount && messageCount.length <= 2 && role === 'user') {
    updates.title = content.slice(0, 50) + (content.length > 50 ? '...' : '')
  }
  
  await supabase
    .from('chats')
    .update(updates)
    .eq('id', chatId)
  
  return NextResponse.json({ message })
}

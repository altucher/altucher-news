import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET - Fetch all memories for the current user
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { data: memories, error } = await supabase
      .from('memories')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('[Memories] Fetch error:', error)
      return NextResponse.json({ error: 'Failed to fetch memories' }, { status: 500 })
    }
    
    return NextResponse.json({ memories })
  } catch (error) {
    console.error('[Memories] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new memory
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { content, category = 'general' } = await req.json()
    
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }
    
    // Check for duplicate memories
    const { data: existing } = await supabase
      .from('memories')
      .select('id')
      .eq('user_id', user.id)
      .eq('content', content.trim())
      .single()
    
    if (existing) {
      return NextResponse.json({ error: 'Memory already exists' }, { status: 409 })
    }
    
    const { data: memory, error } = await supabase
      .from('memories')
      .insert({
        user_id: user.id,
        content: content.trim(),
        category
      })
      .select()
      .single()
    
    if (error) {
      console.error('[Memories] Insert error:', error)
      return NextResponse.json({ error: 'Failed to save memory' }, { status: 500 })
    }
    
    return NextResponse.json({ memory }, { status: 201 })
  } catch (error) {
    console.error('[Memories] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete a memory by ID
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Memory ID is required' }, { status: 400 })
    }
    
    const { error } = await supabase
      .from('memories')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
    
    if (error) {
      console.error('[Memories] Delete error:', error)
      return NextResponse.json({ error: 'Failed to delete memory' }, { status: 500 })
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Memories] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

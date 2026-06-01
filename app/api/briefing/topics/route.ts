import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getSupabaseAdmin() {
  return createClient(supabaseUrl, supabaseServiceKey)
}

async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id || null
}

const MAX_TOPICS = 5

// GET - Fetch user's briefing topics
export async function GET() {
  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('briefing_topics')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (error) throw error

    return NextResponse.json({ topics: data || [] })
  } catch (error) {
    console.error('Error fetching briefing topics:', error)
    return NextResponse.json({ error: 'Failed to fetch topics' }, { status: 500 })
  }
}

// POST - Add a new briefing topic
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { topic } = await request.json()
    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    
    // Check current count
    const { count } = await supabase
      .from('briefing_topics')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (count !== null && count >= MAX_TOPICS) {
      return NextResponse.json({ error: `Maximum ${MAX_TOPICS} topics allowed` }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('briefing_topics')
      .insert({ user_id: userId, topic: topic.trim() })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Topic already exists' }, { status: 400 })
      }
      throw error
    }

    return NextResponse.json({ topic: data })
  } catch (error) {
    console.error('Error adding briefing topic:', error)
    return NextResponse.json({ error: 'Failed to add topic' }, { status: 500 })
  }
}

// DELETE - Remove a briefing topic
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const topicId = searchParams.get('id')
    
    if (!topicId) {
      return NextResponse.json({ error: 'Topic ID is required' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('briefing_topics')
      .delete()
      .eq('id', topicId)
      .eq('user_id', userId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting briefing topic:', error)
    return NextResponse.json({ error: 'Failed to delete topic' }, { status: 500 })
  }
}

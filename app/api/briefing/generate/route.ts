import { NextResponse } from 'next/server'
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

// Search using Desearch
async function searchTopic(topic: string): Promise<{ news: string; tweets: string }> {
  const apiKey = process.env.DESEARCH_API_KEY
  if (!apiKey) {
    return { news: 'Search unavailable', tweets: '' }
  }

  try {
    // Search for news
    const newsResponse = await fetch('https://api.desearch.ai/desearch/ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({
        prompt: `Latest news and updates about ${topic}`,
        model: 'NOVA',
        tools: ['web'],
        date_filter: 'PAST_24H'
      })
    })

    // Search for tweets
    const tweetResponse = await fetch('https://api.desearch.ai/desearch/ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({
        prompt: `${topic} latest tweets discussions`,
        model: 'NOVA',
        tools: ['twitter'],
        date_filter: 'PAST_24H'
      })
    })

    let news = ''
    let tweets = ''

    if (newsResponse.ok) {
      const text = await newsResponse.text()
      const lines = text.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        try {
          const data = JSON.parse(line.replace('data: ', ''))
          if (data.type === 'summary' || data.type === 'answer') {
            news = data.content || ''
            break
          }
        } catch {
          // Ignore parsing errors
        }
      }
    }

    if (tweetResponse.ok) {
      const text = await tweetResponse.text()
      const lines = text.split('\n').filter(l => l.startsWith('data: '))
      const tweetList: string[] = []
      for (const line of lines) {
        try {
          const data = JSON.parse(line.replace('data: ', ''))
          if (data.type === 'tweets' && data.content) {
            for (const tweet of data.content.slice(0, 3)) {
              tweetList.push(`@${tweet.user?.username || 'unknown'}: ${tweet.text || tweet.full_text || ''}`)
            }
          }
        } catch {
          // Ignore parsing errors
        }
      }
      tweets = tweetList.join('\n')
    }

    return { news: news || 'No recent news found', tweets }
  } catch (error) {
    console.error('Desearch error for topic:', topic, error)
    return { news: 'Search error', tweets: '' }
  }
}

// GET - Generate morning briefing
export async function GET() {
  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getSupabaseAdmin()
    
    // Check cache (1 hour)
    const { data: cached } = await supabase
      .from('briefing_cache')
      .select('*')
      .eq('user_id', userId)
      .gte('generated_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .order('generated_at', { ascending: false })
      .limit(1)
      .single()

    if (cached) {
      return NextResponse.json({ briefing: cached.content, cached: true })
    }

    // Get user's topics
    const { data: topics } = await supabase
      .from('briefing_topics')
      .select('topic')
      .eq('user_id', userId)

    if (!topics || topics.length === 0) {
      return NextResponse.json({ 
        error: 'No topics configured. Add topics in the Briefing Setup to get personalized news.',
        needsSetup: true 
      }, { status: 400 })
    }

    // Search each topic
    const results = await Promise.all(
      topics.map(async ({ topic }) => {
        const { news, tweets } = await searchTopic(topic)
        return { topic, news, tweets }
      })
    )

    // Format briefing
    const now = new Date()
    const dateStr = now.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })

    let briefing = `# Good Morning! Here's your briefing for ${dateStr}\n\n`
    
    for (const result of results) {
      briefing += `## ${result.topic}\n\n`
      briefing += `**Latest News:**\n${result.news}\n\n`
      if (result.tweets) {
        briefing += `**From Twitter/X:**\n${result.tweets}\n\n`
      }
      briefing += '---\n\n'
    }

    // Cache the result
    await supabase
      .from('briefing_cache')
      .insert({ user_id: userId, content: briefing })

    return NextResponse.json({ briefing, cached: false })
  } catch (error) {
    console.error('Error generating briefing:', error)
    return NextResponse.json({ error: 'Failed to generate briefing' }, { status: 500 })
  }
}

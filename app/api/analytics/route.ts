import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Supabase admin client (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    // Get total query count from usage table (sum of all message_count)
    const { data: usageData, error: usageError } = await supabaseAdmin
      .from('usage')
      .select('message_count, date, user_id')
      .order('date', { ascending: false })

    if (usageError) {
      console.error('[Analytics] Usage query error:', usageError)
    }

    // Calculate totals
    const totalQueries = usageData?.reduce((sum, row) => sum + (row.message_count || 0), 0) || 0
    const uniqueUsers = new Set(usageData?.map(row => row.user_id)).size
    const activeDays = new Set(usageData?.map(row => row.date)).size

    // Get analytics_events if the table exists
    let analyticsEvents: Array<{
      id: string
      event_type: string
      user_id: string | null
      prompt: string | null
      model: string | null
      tokens_used: number | null
      cost_estimate: number | null
      created_at: string
    }> = []
    
    try {
      const { data: events } = await supabaseAdmin
        .from('analytics_events')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (events) {
        analyticsEvents = events
      }
    } catch {
      // Table may not exist yet
      console.log('[Analytics] analytics_events table not found, using basic stats')
    }

    // Calculate image generation count and costs from events
    const imageEvents = analyticsEvents.filter(e => e.event_type === 'image_generation')
    const chatEvents = analyticsEvents.filter(e => e.event_type === 'chat_query')
    
    const totalImageGenerations = imageEvents.length
    const totalChatQueries = chatEvents.length
    
    // Total queries = all events from analytics_events (chat + image)
    const totalAllQueries = analyticsEvents.length
    
    // Estimate costs (Chutes pricing approximations)
    // Chat: ~$0.001 per 1000 tokens
    // Image: ~$0.02 per image
    const estimatedChatCost = chatEvents.reduce((sum, e) => sum + (e.cost_estimate || 0.001), 0)
    const estimatedImageCost = imageEvents.reduce((sum, e) => sum + (e.cost_estimate || 0.02), 0)
    const totalEstimatedCost = estimatedChatCost + estimatedImageCost

    // Daily breakdown
    const dailyStats: Record<string, { queries: number; images: number; cost: number }> = {}
    
    usageData?.forEach(row => {
      if (!dailyStats[row.date]) {
        dailyStats[row.date] = { queries: 0, images: 0, cost: 0 }
      }
      dailyStats[row.date].queries += row.message_count || 0
    })

    analyticsEvents.forEach(event => {
      const date = event.created_at.split('T')[0]
      if (!dailyStats[date]) {
        dailyStats[date] = { queries: 0, images: 0, cost: 0 }
      }
      if (event.event_type === 'image_generation') {
        dailyStats[date].images += 1
        dailyStats[date].cost += event.cost_estimate || 0.02
      }
      if (event.event_type === 'chat_query') {
        dailyStats[date].cost += event.cost_estimate || 0.001
      }
    })

    return NextResponse.json({
      success: true,
      summary: {
        totalQueries: totalAllQueries,
        totalImageGenerations,
        totalChatQueries,
        uniqueUsers,
        activeDays,
        estimatedChatCost: estimatedChatCost.toFixed(4),
        estimatedImageCost: estimatedImageCost.toFixed(4),
        totalEstimatedCost: totalEstimatedCost.toFixed(4),
      },
      dailyStats: Object.entries(dailyStats)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 30)
        .map(([date, stats]) => ({
          date,
          ...stats,
          cost: stats.cost.toFixed(4)
        })),
      recentEvents: analyticsEvents.slice(0, 50).map(e => ({
        id: e.id,
        type: e.event_type,
        prompt: e.prompt?.substring(0, 100),
        model: e.model,
        tokensUsed: e.tokens_used,
        costEstimate: e.cost_estimate?.toFixed(4),
        createdAt: e.created_at,
      })),
      allQueries: analyticsEvents.map(e => ({
        id: e.id,
        type: e.event_type,
        prompt: e.prompt,
        model: e.model,
        tokensUsed: e.tokens_used,
        costEstimate: e.cost_estimate?.toFixed(4),
        createdAt: e.created_at,
      })),
    })
  } catch (error) {
    console.error('[Analytics] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
}

// Track an analytics event
export async function POST(req: Request) {
  try {
    const { eventType, userId, prompt, model, tokensUsed, costEstimate } = await req.json()

    // Try to insert into analytics_events table
    const { error } = await supabaseAdmin
      .from('analytics_events')
      .insert({
        event_type: eventType,
        user_id: userId || null,
        prompt: prompt?.substring(0, 500) || null,
        model: model || null,
        tokens_used: tokensUsed || null,
        cost_estimate: costEstimate || null,
      })

    if (error) {
      // Table might not exist, just log
      console.log('[Analytics] Could not track event:', error.message)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Analytics] Track error:', error)
    return NextResponse.json({ success: false }, { status: 500 })
  }
}

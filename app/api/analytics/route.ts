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

export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdmin()
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
    
    // Get total count first (separate query to bypass row limits)
    const { count: totalEventsCount } = await supabaseAdmin
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
    
    const { count: chatCount } = await supabaseAdmin
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'chat_query')
    
    const { count: imageCount } = await supabaseAdmin
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'image_generation')
    
    const { count: detectCount } = await supabaseAdmin
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'ai_detection')
    
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('analytics_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10000)
    
    if (eventsError) {
      console.error('[Analytics] analytics_events query error:', eventsError)
    }
    
    if (events) {
      analyticsEvents = events
    }

    // Use accurate counts from COUNT queries
    const totalImageGenerations = imageCount || 0
    const totalChatQueries = chatCount || 0
    const totalAIDetections = detectCount || 0
    const totalAllQueries = totalEventsCount || 0
    
    // Filter events for cost calculation (from fetched data)
    const imageEvents = analyticsEvents.filter(e => e.event_type === 'image_generation')
    const chatEvents = analyticsEvents.filter(e => e.event_type === 'chat_query')
    const detectEvents = analyticsEvents.filter(e => e.event_type === 'ai_detection')
    
    // Estimate costs (Chutes pricing approximations)
    // Chat: ~$0.001 per 1000 tokens
    // Image: ~$0.02 per image
    // Detect: ~$0.01 per detection
    const estimatedChatCost = chatEvents.reduce((sum, e) => sum + (e.cost_estimate || 0.001), 0)
    const estimatedImageCost = imageEvents.reduce((sum, e) => sum + (e.cost_estimate || 0.02), 0)
    const estimatedDetectCost = detectEvents.reduce((sum, e) => sum + (e.cost_estimate || 0.01), 0)
    const totalEstimatedCost = estimatedChatCost + estimatedImageCost + estimatedDetectCost

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

    // Calculate location stats
    const locationStats: Record<string, number> = {}
    analyticsEvents.forEach(e => {
      const country = (e as { country?: string }).country
      if (country) {
        locationStats[country] = (locationStats[country] || 0) + 1
      }
    })
    const topCountries = Object.entries(locationStats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([country, count]) => ({ country, count }))

    return NextResponse.json({
      success: true,
      summary: {
        totalQueries: totalAllQueries,
        totalImageGenerations,
        totalChatQueries,
        totalAIDetections,
        uniqueUsers,
        activeDays,
        estimatedChatCost: estimatedChatCost.toFixed(4),
        estimatedImageCost: estimatedImageCost.toFixed(4),
        estimatedDetectCost: estimatedDetectCost.toFixed(4),
        totalEstimatedCost: totalEstimatedCost.toFixed(4),
      },
      topCountries,
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
        country: (e as { country?: string }).country,
        city: (e as { city?: string }).city,
        region: (e as { region?: string }).region,
        usedDesearch: (e as { used_desearch?: boolean }).used_desearch || false,
      })),
      allQueries: analyticsEvents.map(e => ({
        id: e.id,
        type: e.event_type,
        prompt: e.prompt,
        model: e.model,
        tokensUsed: e.tokens_used,
        costEstimate: e.cost_estimate?.toFixed(4),
        createdAt: e.created_at,
        country: (e as { country?: string }).country,
        city: (e as { city?: string }).city,
        region: (e as { region?: string }).region,
        usedDesearch: (e as { used_desearch?: boolean }).used_desearch || false,
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

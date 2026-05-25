import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getMessageLimit } from '@/lib/products'

// Lazy initialization to avoid build-time errors
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(url, key)
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')

  if (!userId) {
    return NextResponse.json({ 
      tier: 'free',
      messageCount: 0,
      messageLimit: 50,
      status: 'active'
    })
  }

  try {
    const supabaseAdmin = getSupabaseAdmin()
    
    // Get user's subscription
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('tier, status')
      .eq('user_id', userId)
      .single()

    const tier = (subscription?.status === 'active' ? subscription?.tier : 'free') || 'free'
    const status = subscription?.status || 'active'
    const messageLimit = getMessageLimit(tier)

    // Get today's usage
    const today = new Date().toISOString().split('T')[0]
    const { data: usage } = await supabaseAdmin
      .from('usage')
      .select('message_count')
      .eq('user_id', userId)
      .eq('date', today)
      .single()

    const messageCount = usage?.message_count || 0

    return NextResponse.json({
      tier,
      status,
      messageCount,
      messageLimit,
      remaining: Math.max(0, messageLimit - messageCount)
    })
  } catch (error) {
    console.error('[v0] Usage API error:', error)
    return NextResponse.json({ 
      tier: 'free',
      messageCount: 0,
      messageLimit: 50,
      status: 'active'
    })
  }
}

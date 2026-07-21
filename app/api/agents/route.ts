import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const CATEGORIES = ['All', 'Research', 'Productivity', 'Support', 'Education', 'Finance', 'Creative', 'Other'] as const
const SORTS = ['featured', 'new', 'popular'] as const

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase environment variables')
  return createClient(url, key)
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const search = (url.searchParams.get('q') || '').trim().slice(0, 100)
    const category = url.searchParams.get('category') || 'All'
    const sort = url.searchParams.get('sort') || 'featured'
    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number]) || !SORTS.includes(sort as (typeof SORTS)[number])) {
      return NextResponse.json({ error: 'Invalid marketplace filters' }, { status: 400 })
    }

    let query = getAdmin()
      .from('published_sites')
      .select('id, slug, title, marketplace_description, marketplace_category, marketplace_listed_at, marketplace_open_count, agent_manifest')
      .eq('marketplace_listed', true)
      .eq('project_type', 'agent')
      .not('agent_manifest', 'is', null)
      .limit(60)

    if (category !== 'All') query = query.eq('marketplace_category', category)
    if (search) {
      const escaped = search.replace(/[,%()]/g, ' ')
      query = query.or(`title.ilike.%${escaped}%,marketplace_description.ilike.%${escaped}%`)
    }
    query = sort === 'popular'
      ? query.order('marketplace_open_count', { ascending: false }).order('marketplace_listed_at', { ascending: false })
      : query.order('marketplace_listed_at', { ascending: false })

    const { data, error } = await query
    if (error) throw error

    const agents = (data || []).map((row) => {
      const manifest = row.agent_manifest as { name?: unknown; welcomeMessage?: unknown; suggestedPrompts?: unknown; tools?: unknown } | null
      return {
        id: row.id,
        slug: row.slug,
        name: typeof manifest?.name === 'string' ? manifest.name : row.title || 'BlueTAO Agent',
        description: row.marketplace_description || (typeof manifest?.welcomeMessage === 'string' ? manifest.welcomeMessage : 'A live AI agent built with BlueTAO.'),
        category: row.marketplace_category || 'Other',
        listedAt: row.marketplace_listed_at,
        openCount: Number(row.marketplace_open_count || 0),
        suggestedPrompts: Array.isArray(manifest?.suggestedPrompts) ? manifest.suggestedPrompts.filter((value): value is string => typeof value === 'string').slice(0, 3) : [],
        tools: Array.isArray(manifest?.tools) ? manifest.tools.filter((value): value is string => typeof value === 'string') : [],
      }
    })

    return NextResponse.json({ agents, categories: CATEGORIES.slice(1) }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } })
  } catch (error) {
    console.error('[Agents] discovery error:', error)
    return NextResponse.json({ error: 'Could not load agents' }, { status: 500 })
  }
}

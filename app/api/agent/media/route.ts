import { get } from '@vercel/blob'
import { createClient as createServerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const pathname = url.searchParams.get('pathname')
  if (!pathname || !/^(?:viral-scout|instagram-creator)\/[0-9a-f-]{36}\/[a-zA-Z0-9._-]+$/.test(pathname)) {
    return Response.json({ error: 'Invalid media path' }, { status: 400 })
  }

  const threadId = pathname.split('/')[1]
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const service = await import('@supabase/supabase-js')
  const admin = service.createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: thread } = await admin
    .from('agent_threads')
    .select('user_id')
    .eq('id', threadId)
    .maybeSingle()

  if (!thread || (thread.user_id && thread.user_id !== user?.id)) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const result = await get(pathname, {
      access: 'private',
      ifNoneMatch: request.headers.get('if-none-match') || undefined,
    })
    if (!result) return new Response('Not found', { status: 404 })
    if (result.statusCode === 304) {
      return new Response(null, {
        status: 304,
        headers: { ETag: result.blob.etag, 'Cache-Control': 'private, no-cache' },
      })
    }
    return new Response(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || 'image/png',
        'Content-Disposition': `inline; filename="${pathname.split('/').pop()}"`,
        ETag: result.blob.etag,
        'Cache-Control': 'private, no-cache',
      },
    })
  } catch {
    return Response.json({ error: 'Could not load media' }, { status: 500 })
  }
}

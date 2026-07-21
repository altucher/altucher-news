import { createHash, randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseProject } from '@/lib/project-document'

// Lazy init so builds don't fail when env vars are absent.
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(url, key)
}

// Wrap a bare HTML fragment in a minimal document so the published page always
// renders correctly, even if the model returned only the body markup.
function toDocument(code: string): string {
  const head = code.trimStart().slice(0, 400).toLowerCase()
  if (head.includes('<!doctype') || head.includes('<html')) return code
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body{font-family:system-ui,-apple-system,sans-serif;margin:16px;}</style>
  </head>
  <body>
${code}
  </body>
</html>`
}

// Short, URL-friendly slug (no ambiguous characters).
function makeSlug(len = 8): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

// Best-effort title extraction from the HTML <title> tag.
function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const t = m?.[1]?.trim()
  return t ? t.slice(0, 200) : null
}

// POST /api/publish  -> stores HTML under a short slug and returns the live URL.
export async function POST(req: Request) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const body = await req.json()

    const rawHtml = typeof body.html === 'string' ? body.html : ''
    if (!rawHtml.trim()) {
      return NextResponse.json({ error: 'No HTML to publish' }, { status: 400 })
    }
    // Guard against absurdly large payloads (~2MB of HTML is plenty).
    if (rawHtml.length > 2_000_000) {
      return NextResponse.json({ error: 'This page is too large to publish' }, { status: 413 })
    }

    let html = toDocument(rawHtml)
    const project = typeof body.project === 'string' ? parseProject(body.project) : null
    const projectId = typeof body.projectId === 'string' && /^[0-9a-f-]{36}$/i.test(body.projectId) ? body.projectId : null
    const isAgent = project?.type === 'agent' && project.agent
    const runtimeToken = isAgent ? randomBytes(32).toString('base64url') : null
    if (runtimeToken) {
      const config = JSON.stringify({ endpoint: '/api/agent/runtime', token: runtimeToken })
      html = html.replace(/<\/head>/i, `<script>window.__BLUETAO_AGENT__=${config};</script></head>`)
    }
    const title =
      (typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 200)
        : null) || extractTitle(html)

    // Insert with a unique slug, retrying a few times on the rare collision.
    let slug = ''
    let lastError: unknown = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = makeSlug(attempt < 3 ? 8 : 10)
      const { error } = await supabaseAdmin
        .from('published_sites')
        .insert({
          slug: candidate,
          title,
          html,
          project_id: projectId,
          project_type: isAgent ? 'agent' : 'site',
          agent_manifest: isAgent ? project.agent : null,
          runtime_token_hash: runtimeToken ? createHash('sha256').update(runtimeToken).digest('hex') : null,
        })
      if (!error) {
        slug = candidate
        break
      }
      lastError = error
      // 23505 = unique_violation; retry with a new slug. Otherwise bail.
      if ((error as { code?: string }).code !== '23505') break
    }

    if (!slug) {
      console.error('[Publish] insert error:', lastError)
      return NextResponse.json({ error: 'Could not publish page' }, { status: 500 })
    }

    // Log an analytics event (best-effort).
    await supabaseAdmin
      .from('analytics_events')
      .insert({ event_type: 'site_published', prompt: title || slug })
      .then(undefined, () => {})

    const origin = new URL(req.url).origin
    return NextResponse.json({ slug, url: `${origin}/s/${slug}`, path: `/s/${slug}`, title })
  } catch (error) {
    console.error('[Publish] POST error:', error)
    return NextResponse.json({ error: 'Could not publish page' }, { status: 500 })
  }
}

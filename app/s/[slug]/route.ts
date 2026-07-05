import { createClient } from '@supabase/supabase-js'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(url, key)
}

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Page not found</title>
    <style>
      body{font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;
        align-items:center;justify-content:center;margin:0;background:#0a0a0a;color:#e5e5e5;}
      .card{text-align:center;padding:32px;}
      h1{font-size:20px;margin:0 0 8px;}
      p{color:#a3a3a3;margin:0 0 16px;}
      a{color:#38bdf8;text-decoration:none;}
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page isn&apos;t available</h1>
      <p>It may have been removed or the link is incorrect.</p>
      <a href="/">Go to BlueTAO</a>
    </div>
  </body>
</html>`

// GET /s/[slug] -> serves the published HTML as a real, standalone web page.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin
      .from('published_sites')
      .select('html')
      .eq('slug', slug)
      .maybeSingle()

    if (error || !data?.html) {
      return new Response(NOT_FOUND_HTML, {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }

    // Count the view (best-effort, non-blocking).
    supabaseAdmin
      .rpc('increment_site_views', { site_slug: slug })
      .then(undefined, () => {})

    return new Response(data.html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=60, s-maxage=300',
      },
    })
  } catch (err) {
    console.error('[PublishedSite] GET error:', err)
    return new Response(NOT_FOUND_HTML, {
      status: 500,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
}

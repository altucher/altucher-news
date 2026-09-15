/** Web search via Desearch (same backend the chat route uses), trimmed for tool use. */
export async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.DESEARCH_API_KEY
  if (!apiKey) return 'Web search is not configured.'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25000)
  try {
    const isTwitter = /twitter|tweet|x\.com|@\w+|#\w+|posts from/i.test(query)
    const res = await fetch('https://api.desearch.ai/desearch/ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
      body: JSON.stringify({ prompt: query, model: 'NOVA', tools: isTwitter ? ['twitter', 'web'] : ['web'], date_filter: 'PAST_MONTH' }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return `Search failed (HTTP ${res.status}).`
    const text = await res.text()
    let answer = ''
    const web: string[] = []
    const tweets: string[] = []
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const data = JSON.parse(line.slice(6))
        if (data.type === 'text' && typeof data.content === 'string') answer += data.content
        if (data.type === 'search' && Array.isArray(data.content)) {
          for (const item of data.content.slice(0, 6)) {
            const body = String(item.snippet || item.text || item.description || '').slice(0, 400)
            web.push([item.title, body, item.link || item.url].filter(Boolean).join('\n'))
          }
        }
        if ((data.type === 'tweets' || data.type === 'twitter') && Array.isArray(data.content)) {
          for (const t of data.content.slice(0, 5)) tweets.push(`@${t.user?.username || t.username || '?'}: ${t.text || t.full_text || ''}`)
        }
      } catch { /* skip */ }
    }
    const out: string[] = []
    if (answer.trim()) out.push(answer.trim())
    if (web.length) out.push('Results:\n\n' + web.join('\n\n'))
    if (tweets.length) out.push('From X:\n' + tweets.join('\n'))
    return out.join('\n\n') || 'No results.'
  } catch (e) {
    clearTimeout(timeout)
    return (e as Error)?.name === 'AbortError' ? 'Search timed out.' : `Search error: ${String((e as Error)?.message ?? e).slice(0, 120)}`
  }
}

/** Read a web page as plain text (the assistant's "browser"). */
export async function readPage(url: string): Promise<string> {
  try {
    if (!/^https?:\/\//i.test(url)) return 'Only http(s) URLs can be read.'
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlueTAO-Assistant/1.0)', Accept: 'text/html,application/xhtml+xml,text/plain,application/json' },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    })
    if (!res.ok) return `Could not read page (HTTP ${res.status}).`
    const type = res.headers.get('content-type') || ''
    const raw = await res.text()
    if (type.includes('json')) return raw.slice(0, 8000)
    const text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>|<\/tr>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim()
    return text.slice(0, 9000) || 'The page had no readable text.'
  } catch (e) {
    return `Could not read page: ${String((e as Error)?.message ?? e).slice(0, 120)}`
  }
}

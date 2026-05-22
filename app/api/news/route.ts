import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const newsResponse = await fetch(
      'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ChutesChat/1.0)' } }
    )

    if (!newsResponse.ok) {
      return NextResponse.json({ error: 'Failed to fetch news' }, { status: 500 })
    }

    const newsText = await newsResponse.text()
    const itemMatches = newsText.match(/<item>[\s\S]*?<\/item>/g)

    if (!itemMatches || itemMatches.length === 0) {
      return NextResponse.json({ headlines: [] })
    }

    const headlines = itemMatches.slice(0, 12).map(item => {
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)
      const sourceMatch = item.match(/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/)
      const linkMatch = item.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/)

      let title = titleMatch ? titleMatch[1].trim().replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''
      let source = sourceMatch ? sourceMatch[1].trim().replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''
      let link = linkMatch ? linkMatch[1].trim().replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''

      return { title, source, link }
    }).filter(h => h.title.length > 3)

    return NextResponse.json({ headlines })
  } catch (error) {
    console.error('News fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch news' }, { status: 500 })
  }
}

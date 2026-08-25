import { createHash } from 'node:crypto'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { gateway } from '@ai-sdk/gateway'
import { streamText, ToolLoopAgent, stepCountIs, tool, type ModelMessage } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { get, put } from '@vercel/blob'
import { z } from 'zod'

export const maxDuration = 800

const requestSchema = z.object({
  token: z.string().min(24).max(256),
  sessionId: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  message: z.string().trim().min(1).max(8000),
  projectId: z.string().uuid().optional(),
  manuscriptPath: z.string().max(500).optional(),
})

const toolLabels: Record<string, string> = {
  web_search: 'Searching current sources',
  inspect_evidence: 'Inspecting evidence',
  compare_options: 'Comparing options',
  build_action_plan: 'Building an action plan',
  calculate_scenarios: 'Calculating scenarios',
  check_understanding: 'Checking understanding',
  develop_creative_routes: 'Developing creative routes',
  scan_twitter_trends: 'Scanning X for rising controversies',
  scan_current_news: 'Scanning the last 72 hours',
  search_social: 'Scanning subcultures and extreme views',
  inspect_source: 'Inspecting a substantive source',
  verify_current_facts: 'Verifying current roles, titles, and status',
  research_instagram_topic: 'Researching credible facts, quotes, and visual hooks',
  verify_instagram_claims: 'Verifying every proposed fact and attributed quote',
  plan_instagram_posts: 'Planning five distinct high-potential posts',
  build_angle_map: 'Mapping the controversy',
  evaluate_virality: 'Testing viral angles',
  profile_recipient: 'Building the recipient profile',
  search_shopping: 'Searching live US shopping sources',
  synthesize_reviews: 'Inspecting product and review evidence',
  compare_rank: 'Comparing fit, value, and risk',
  suggest_alternatives: 'Searching for better alternatives',
  build_gift_roadmap: 'Building the gift roadmap',
}

// Build a short, human-readable summary of what a tool actually found, so the
// activity feed between the question and the answer shows real substance
// instead of a generic "complete". Never fabricates — only reflects output.
function summarizeToolResult(toolName: string, output: unknown): string {
  const o = (output || {}) as Record<string, any>
  const clip = (s: unknown, n = 90) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim()
    return t.length > n ? `${t.slice(0, n - 1)}…` : t
  }
  try {
    switch (toolName) {
      case 'scan_twitter_trends':
      case 'search_social': {
        const posts = Array.isArray(o.posts) ? o.posts : []
        const results = Array.isArray(o.results) ? o.results : []
        if (!posts.length && !results.length) return 'No live posts surfaced'
        const parts: string[] = []
        if (posts.length) parts.push(`${posts.length} post${posts.length === 1 ? '' : 's'}`)
        if (results.length) parts.push(`${results.length} article${results.length === 1 ? '' : 's'}`)
        const lead = posts[0]?.author ? `${posts[0].author}: “${clip(posts[0].text, 70)}”` : clip(results[0]?.title, 80)
        return lead ? `${parts.join(', ')} · ${lead}` : parts.join(', ')
      }
      case 'scan_current_news': {
        const results = Array.isArray(o.results) ? o.results : []
        if (!results.length) return 'No fresh reporting found'
        return `${results.length} report${results.length === 1 ? '' : 's'} · ${clip(results[0]?.title, 80)}`
      }
      case 'inspect_source': {
        if (o.inspectionError) return 'Source could not be read — relying on search evidence'
        return o.title ? `Read “${clip(o.title, 80)}”` : 'Source inspected'
      }
      case 'build_angle_map': {
        const views = (Array.isArray(o.mainstream) ? o.mainstream.length : 0) + (Array.isArray(o.counterView) ? o.counterView.length : 0) + (Array.isArray(o.extremeViews) ? o.extremeViews.length : 0)
        const surprises = Array.isArray(o.surprises) ? o.surprises.length : 0
        return `Mapped ${views} viewpoint${views === 1 ? '' : 's'}, ${surprises} surprise${surprises === 1 ? '' : 's'}`
      }
      case 'evaluate_virality': {
        const ranked = Array.isArray(o.ranked) ? o.ranked : []
        const top = ranked[0]
        return top?.title ? `Chose “${clip(top.title, 70)}” (score ${top.score})` : 'Scored candidate angles'
      }
      case 'web_search': {
        const results = Array.isArray(o.results) ? o.results : []
        return results.length ? `${results.length} source${results.length === 1 ? '' : 's'} · ${clip(results[0]?.title, 80)}` : 'No results found'
      }
      default:
        return ''
    }
  } catch {
    return ''
  }
}

type InstagramCreative = {
  title: string
  caption: string
  alt: string
  pathname: string
  downloadUrl: string
}

type SynthesisResult = {
  text: string
  finishReason: string
  rawFinishReason?: string
}

const VIRAL_DOSSIER_SECTIONS = [
  'As of',
  'The Big Idea',
  'Podcast Blueprint',
  'Instagram Reel',
  'X/Twitter Thread',
  'Substack',
  'Why It Could Go Viral',
  'Sources and Guardrails',
] as const

export function isCompleteViralDossier(text: string, finishReason = 'stop') {
  const normalized = text.toLowerCase()
  const hasSections = VIRAL_DOSSIER_SECTIONS.every((section) => normalized.includes(section.toLowerCase()))
  const hasClosedEnding = /sources\s*(?:and|&)\s*guardrails[\s\S]{80,}$/i.test(text)
  const looksCutOff = /(?:^|\s)(?:script|caption|audio|text overlay):\s*["“][^"”\n]{0,220}$/i.test(text.trim())
  return finishReason !== 'length' && hasSections && hasClosedEnding && !looksCutOff
}

function isCompleteInstagramPack(text: string, finishReason = 'stop') {
  const posts = [...text.matchAll(/^##\s+Post\s+([1-5])\b/gim)].map((match) => match[1])
  const requiredFields = ['Hook:', 'Overlay Copy:', 'Visual Direction:', 'Caption:', 'CTA:', 'Hashtags:', 'Alt Text:', 'Why It Could Go Viral:']
  return finishReason !== 'length' && new Set(posts).size === 5 && requiredFields.every((field) => text.includes(field)) && /##\s+Post\s+5\b[\s\S]{200,}$/i.test(text)
}

const INSTAGRAM_IMAGE_MODELS = [
  'https://vonkaiser-qwen-image-2512.chutes.ai/generate',
  'https://vonkaiser-z-image-turbo.chutes.ai/generate',
]

async function generateInstagramImage(prompt: string) {
  const apiKey = process.env.CHUTES_API_KEY
  if (!apiKey) return null
  for (const endpoint of INSTAGRAM_IMAGE_MODELS) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      })
      if (!response.ok) continue
      const body = await response.arrayBuffer()
      if (body.byteLength < 1_000) continue
      const rawType = response.headers.get('content-type') || 'image/png'
      const contentType = rawType.startsWith('image/') ? rawType : 'image/png'
      return { body: Buffer.from(body), contentType }
    } catch {
      // Try the next image model. Creative generation is deliberately non-fatal.
    } finally {
      clearTimeout(timeout)
    }
  }
  return null
}

function createInstagramPrompts(answer: string, subject: string) {
  const clean = answer
    .split(/##\s+(?:Instagram|X Thread|Sources)/i)[0]
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[#*`>|_[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const heading = [...answer.matchAll(/^#{1,3}\s+(.+)$/gm)]
    .map((match) => match[1].replace(/[*_`]/g, '').trim())
    .find((value) => value.length > 12 && !/viral content dossier|big idea|executive summary/i.test(value))
  const requestTopic = subject
    .replace(/\b(?:find|scout|create|make|build|give me|today'?s|the dossier|plus|instagram images?|posts?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const topic = (heading || requestTopic || clean.slice(0, 140) || 'the strongest story in today’s dossier').slice(0, 180)
  const context = clean.slice(0, 1_200)
  const sharedNegative = 'Absolutely no words, letters, numbers, captions, logos, watermarks, social-media screens, app interfaces, news pages, screenshots, charts, collages, split screens, or UI elements. Do not imitate Instagram.'
  return [
    {
      title: 'Editorial cover',
      alt: `Editorial Instagram visual inspired by ${topic}`,
      caption: `Lead with the dossier��s strongest tension: ${topic}`,
      prompt: `Square 1:1 premium editorial news photograph about: ${topic}. Supporting context only: ${context}. Depict one clear real-world scene with one dominant focal subject, cinematic natural light, restrained high contrast, sophisticated documentary magazine art direction, and uncluttered negative space in the upper third where a designer can later add a headline. ${sharedNegative} Photorealistic, credible current-affairs visual storytelling, 1024x1024.`,
    },
    {
      title: 'Contrarian angle',
      alt: `Conceptual Instagram visual illustrating the contrarian angle around ${topic}`,
      caption: `Use this pattern interrupt to introduce the sourced narrative twist: ${topic}`,
      prompt: `Square 1:1 conceptual editorial photograph visualizing the surprising tension in: ${topic}. Supporting context only: ${context}. Express the idea with one bold physical metaphor made from tactile real-world materials, a single focal point, dramatic studio lighting, minimal premium magazine composition, and uncluttered negative space in the lower third for a designer-added headline. ${sharedNegative} No abstract gradient blobs. Photorealistic, 1024x1024.`,
    },
  ]
}

function createCreatorPrompts(answer: string, subject: string) {
  const sections = answer.split(/^##\s+Post\s+\d+/gim).slice(1, 6)
  const sharedNegative = 'No words, letters, numbers, captions, logos, watermarks, app interfaces, social-media screens, screenshots, charts, collages, split screens, or UI elements. Do not imitate Instagram. No abstract gradient blobs.'
  return Array.from({ length: 5 }, (_, index) => {
    const section = sections[index]?.replace(/https?:\/\/\S+/g, '').replace(/[#*`>|_[\]{}]/g, ' ').replace(/\s+/g, ' ').trim() || `${subject}, creative route ${index + 1}`
    const visual = section.match(/(?:Visual Direction|Image Concept|Visual):\s*([^]*?)(?=\s(?:Caption|Hook|Overlay|CTA|Hashtags|Alt Text|Why It Could Go Viral):|$)/i)?.[1]?.trim() || section.slice(0, 900)
    const title = section.match(/(?:Format|Hook):\s*([^\n.]{3,90})/i)?.[1]?.trim() || `Post ${index + 1}`
    const alt = section.match(/Alt Text:\s*([^]*?)(?=\s(?:Why It Could Go Viral|CTA|Hashtags):|$)/i)?.[1]?.trim() || `Editorial visual for ${subject}, post ${index + 1}`
    return {
      title: title.slice(0, 90),
      alt: alt.slice(0, 220),
      caption: `Post ${index + 1} of 5 — use the exact overlay and caption from the creative brief.`,
      prompt: `Square 1:1 premium editorial image for this Instagram post about ${subject}: ${visual}. One immediately legible focal idea, emotionally resonant, sophisticated art direction, tactile detail, excellent lighting, high visual contrast, and intentional negative space for a designer-added overlay. ${sharedNegative} 1024x1024.`,
    }
  })
}

async function buildInstagramCreativePack(answer: string, subject: string, threadId: string, creatorMode = false): Promise<InstagramCreative[]> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return []
  const prompts = creatorMode ? createCreatorPrompts(answer, subject) : createInstagramPrompts(answer, subject)
  const creatives: InstagramCreative[] = []
  for (let index = 0; index < prompts.length; index += 1) {
    const concept = prompts[index]
    const generated = await generateInstagramImage(concept.prompt)
    if (!generated) continue
    try {
      const extension = generated.contentType.includes('jpeg') ? 'jpg' : generated.contentType.includes('webp') ? 'webp' : 'png'
      const folder = creatorMode ? 'instagram-creator' : 'viral-scout'
      const pathname = `${folder}/${threadId}/${Date.now()}-${index + 1}.${extension}`
      const blob = await put(pathname, generated.body, { access: 'private', contentType: generated.contentType, addRandomSuffix: false })
      creatives.push({ ...concept, pathname: blob.pathname, downloadUrl: `/api/agent/media?pathname=${encodeURIComponent(blob.pathname)}` })
    } catch {
      // Keep the written creative pack usable if Blob storage has a temporary failure.
    }
  }
  return creatives
}

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

async function searchWeb(query: string, dateFilter: 'PAST_DAY' | 'PAST_WEEK' | 'PAST_MONTH' | 'PAST_YEAR' | 'ALL' = 'ALL') {
  const key = process.env.DESEARCH_API_KEY
  if (!key) return { query, answer: 'Web search is not configured.', results: [], sources: [] as string[] }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch('https://api.desearch.ai/desearch/ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ prompt: query, model: 'NOVA', tools: ['web'], date_filter: dateFilter }),
      signal: controller.signal,
    })
    if (!response.ok) return { query, answer: `Search failed with status ${response.status}.`, results: [], sources: [] as string[] }
    const text = await response.text()
    let answer = ''
    const results: Array<{ title: string; snippet: string; url: string }> = []
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'text' && typeof event.content === 'string') answer += event.content
        if (event.type === 'search' && Array.isArray(event.content)) {
          for (const item of event.content.slice(0, 8)) {
            results.push({ title: item.title || 'Untitled source', snippet: item.snippet || item.text || '', url: item.link || item.url || '' })
          }
        }
      } catch {}
    }
    const sources = [...new Set(results.map((item) => item.url).filter(Boolean))]
    return { query, answer, results, sources }
  } catch (error) {
    return { query, answer: error instanceof Error && error.name === 'AbortError' ? 'Search timed out.' : 'Search failed.', results: [], sources: [] as string[] }
  } finally {
    clearTimeout(timeout)
  }
}

async function searchDesearch(query: string, tools: Array<'twitter' | 'web'>, dateFilter: 'PAST_DAY' | 'PAST_WEEK' = 'PAST_WEEK') {
  const key = process.env.DESEARCH_API_KEY
  if (!key) return { query, answer: 'Live search is not configured.', results: [], posts: [], sources: [] as string[] }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch('https://api.desearch.ai/desearch/ai/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: key },
      body: JSON.stringify({ prompt: query, model: 'NOVA', tools, date_filter: dateFilter }), signal: controller.signal,
    })
    if (!response.ok) return { query, answer: `Search failed with status ${response.status}.`, results: [], posts: [], sources: [] as string[] }
    const text = await response.text()
    let answer = ''
    const results: Array<{ title: string; snippet: string; url: string }> = []
    const posts: Array<{ author: string; text: string; url: string; date?: string; engagement?: unknown }> = []
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'text' && typeof event.content === 'string') answer += event.content
        if (event.type === 'search' && Array.isArray(event.content)) for (const item of event.content.slice(0, 10)) results.push({ title: item.title || 'Source', snippet: item.snippet || item.text || '', url: item.link || item.url || '' })
        if ((event.type === 'tweets' || event.type === 'twitter') && Array.isArray(event.content)) for (const item of event.content.slice(0, 12)) {
          const username = item.user?.username || item.username || item.author?.username || 'unknown'
          const id = item.id || item.tweet_id || item.rest_id
          posts.push({ author: `@${username}`, text: item.text || item.full_text || item.content || '', url: item.url || item.link || (id && username !== 'unknown' ? `https://x.com/${username}/status/${id}` : ''), date: item.created_at || item.date, engagement: item.public_metrics || item.metrics })
        }
      } catch {}
    }
    const sources = [...new Set([...results.map((item) => item.url), ...posts.map((item) => item.url)].filter(Boolean))]
    return { query, answer, results, posts, sources }
  } catch (error) {
    return { query, answer: error instanceof Error && error.name === 'AbortError' ? 'Search timed out.' : 'Search failed.', results: [], posts: [], sources: [] as string[] }
  } finally { clearTimeout(timeout) }
}

async function fetchSource(url: string | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return { response, text: await response.text() }
  } finally {
    clearTimeout(timeout)
  }
}

async function inspectUrl(rawUrl: string) {
  const url = new URL(rawUrl)
  if (!['http:', 'https:'].includes(url.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname)) throw new Error('Unsupported source URL')

  let direct: Awaited<ReturnType<typeof fetchSource>> | null = null
  try {
    direct = await fetchSource(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 ViralScout/1.0' } }, 12_000)
  } catch {}

  let response = direct?.response
  let html = direct?.text || ''
  let usedReaderFallback = false
  if (!response?.ok || html.length < 500) {
    usedReaderFallback = true
    try {
      const readerUrl = `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`
      const reader = await fetchSource(readerUrl, { headers: { Accept: 'text/plain' } }, 15_000)
      response = reader.response
      html = reader.text
    } catch {}
  }

  if (!response?.ok || html.length < 300) {
    return { url: rawUrl, status: response?.status || 0, title: url.hostname, content: '', usedReaderFallback, inspectionError: 'Source was unavailable; use the corroborating search evidence and disclose that this page could not be inspected.', inspectedAt: new Date().toISOString() }
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' ').trim() || html.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || url.hostname
  const content = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 12_000)
  return { url: rawUrl, status: response.status, title, content, usedReaderFallback, inspectedAt: new Date().toISOString() }
}

function makeTools() {
  return {
    scan_twitter_trends: tool({
      description: 'Start here. Scan X/Twitter for topics or angles rising in the past 72 hours, especially controversy, polarization, novelty, and subculture energy. Return only real discovered posts.',
      inputSchema: z.object({ query: z.string().min(2).max(500) }),
      execute: async ({ query }) => searchDesearch(`${query}. Find the freshest controversial or fast-rising conversations from the past 72 hours. Include opposing and subculture views, real post links, authors, dates and engagement when available.`, ['twitter', 'web'], 'PAST_WEEK'),
    }),
    scan_current_news: tool({
      description: 'Corroborate a social trend against breaking news and primary reporting from the past few days.',
      inputSchema: z.object({ query: z.string().min(2).max(500) }),
      execute: async ({ query }) => searchDesearch(`${query}. Focus on developments published in the last 72 hours, what changed, and direct primary or reputable reporting links.`, ['web'], 'PAST_WEEK'),
    }),
    search_social: tool({
      description: 'Deepen a selected topic with real X and Reddit discourse, including strong opposing, fringe, and subculture views. Never invent posts.',
      inputSchema: z.object({ query: z.string().min(2).max(500) }),
      execute: async ({ query }) => searchDesearch(`${query}. Find real X/Twitter and Reddit examples representing mainstream, opposing, extreme, and subculture views. Return authors, excerpts, dates, and direct links.`, ['twitter', 'web'], 'PAST_WEEK'),
    }),
    inspect_source: tool({
      description: 'Open and inspect one promising substantive source rather than trusting a search snippet. Use a real URL returned by research.',
      inputSchema: z.object({ url: z.string().url() }),
      execute: async ({ url }) => inspectUrl(url),
    }),
    verify_current_facts: tool({
      description: 'Mandatory freshness check. Verify current office holders, job titles, organizational roles, legal status, and other time-sensitive identities against authoritative primary sources as of today. Never carry a historical title into the present.',
      inputSchema: z.object({ claims: z.array(z.string().min(3)).min(1).max(12) }),
      execute: async ({ claims }) => searchDesearch(`As of ${new Date().toISOString().slice(0, 10)}, verify each current-status claim below using official government, organization, court, or other authoritative primary sources. For each person or entity, state the current role/status, effective date when available, whether the supplied claim is current, former, disputed, or unverified, and provide direct URLs. Explicitly correct stale titles. Claims: ${claims.join(' | ')}`, ['web'], 'PAST_WEEK'),
    }),
    research_instagram_topic: tool({
      description: 'Research a user topic for credible, interesting facts, correctly attributed quotes, human stories, humor-safe observations, visual motifs, and timely cultural angles.',
      inputSchema: z.object({ topic: z.string().min(2).max(500) }),
      execute: async ({ topic }) => searchDesearch(`${topic}. Research compelling and visually expressible facts, primary-source data, accurately attributed quotations, surprising history, human stories, and culturally current angles suitable for five Instagram posts. Include direct reputable source URLs and publication dates. Never invent a quote or statistic.`, ['web'], 'PAST_WEEK'),
    }),
    verify_instagram_claims: tool({
      description: 'Mandatory fact gate. Verify every candidate fact, statistic, historical claim, and attributed quote before it can appear in an Instagram post.',
      inputSchema: z.object({ topic: z.string(), claims: z.array(z.string().min(3)).min(1).max(20) }),
      execute: async ({ topic, claims }) => searchWeb(`Verify each proposed Instagram claim about ${topic} against primary sources, official data, original transcripts, peer-reviewed work, or multiple reputable sources. Return VERIFIED, DISPUTED, or UNSUPPORTED for each claim with URLs. For quotations, verify exact wording and attribution. Unsupported material must not be used as fact. Claims: ${claims.join(' | ')}`, 'ALL'),
    }),
    plan_instagram_posts: tool({
      description: 'Plan exactly five genuinely distinct post routes only after research and verification.',
      inputSchema: z.object({ topic: z.string(), posts: z.array(z.object({ format: z.enum(['quote', 'fact', 'humor', 'visual-metaphor', 'story']), hook: z.string(), verifiedClaim: z.string().optional(), visualDirection: z.string(), emotionalDriver: z.string() })).length(5) }),
      execute: async (input) => ({ ...input, distinctFormats: new Set(input.posts.map((post) => post.format)).size, ready: input.posts.length === 5 && new Set(input.posts.map((post) => post.hook.toLowerCase())).size === 5 }),
    }),
    build_angle_map: tool({
      description: 'Create a structured sourced editorial map after research: mainstream view, counter-view, extremes, subcultures, characters, story, stakes, surprises, contradictions, gaps, and candidate twists.',
      inputSchema: z.object({ topic: z.string(), mainstream: z.array(z.string()), counterView: z.array(z.string()), extremeViews: z.array(z.object({ view: z.string(), label: z.string(), sourceUrl: z.string().url().optional() })), subcultures: z.array(z.string()), characters: z.array(z.string()), stories: z.array(z.string()), surprises: z.array(z.string()), gaps: z.array(z.string()) }),
      execute: async (input) => ({ ...input, ready: input.mainstream.length > 0 && input.counterView.length > 0 && input.surprises.length > 0, mappedAt: new Date().toISOString() }),
    }),
    evaluate_virality: tool({
      description: 'Score distinct sourced angles and select one with a defensible narrative twist. Do not manufacture a twist unsupported by research.',
      inputSchema: z.object({ angles: z.array(z.object({ title: z.string(), twist: z.string(), evidence: z.array(z.string()), recency: z.number().min(1).max(5), novelty: z.number().min(1).max(5), tension: z.number().min(1).max(5), stakes: z.number().min(1).max(5), visualPotential: z.number().min(1).max(5), credibility: z.number().min(1).max(5) })).min(2) }),
      execute: async ({ angles }) => ({ ranked: angles.map((angle) => ({ ...angle, score: angle.recency + angle.novelty + angle.tension + angle.stakes + angle.visualPotential + angle.credibility })).sort((a, b) => b.score - a.score), selectionRule: 'Choose the highest credible angle, not merely the most sensational.' }),
    }),
    profile_recipient: tool({
      description: 'Create a concise recipient brief before shopping. Capture known details and label assumptions explicitly.',
      inputSchema: z.object({ recipient: z.string(), relationship: z.string().optional(), occasion: z.string(), budgetUsd: z.object({ min: z.number().nonnegative(), max: z.number().positive() }), interests: z.array(z.string()), constraints: z.array(z.string()), avoid: z.array(z.string()), assumptions: z.array(z.string()) }),
      execute: async (input) => ({ ...input, market: 'US', profiledAt: new Date().toISOString() }),
    }),
    search_shopping: tool({
      description: 'Search live US retailer and product sources. Return real links, observed prices, availability language, and search timestamps; never invent products.',
      inputSchema: z.object({ query: z.string().min(2).max(500) }),
      execute: async ({ query }) => searchDesearch(`${query}. Search current US retailers and reputable gift guides. Return exact product names, retailer names, observed USD prices, availability wording, and direct product URLs. Do not infer missing prices.`, ['web'], 'PAST_WEEK'),
    }),
    synthesize_reviews: tool({
      description: 'Inspect real product or review pages returned by shopping search and record recurring praise, complaints, rating evidence, and provenance.',
      inputSchema: z.object({ sources: z.array(z.string().url()).min(1).max(4) }),
      execute: async ({ sources }) => ({ inspected: await Promise.all(sources.map((url) => inspectUrl(url))), inspectedAt: new Date().toISOString() }),
    }),
    compare_rank: tool({
      description: 'Rank only products supported by current source evidence; include price, retailer, fit, value, risks, review evidence, and source URLs.',
      inputSchema: z.object({ products: z.array(z.object({ name: z.string(), retailer: z.string(), observedPrice: z.string().optional(), sourceUrl: z.string().url(), fit: z.number().min(1).max(5), value: z.number().min(1).max(5), risk: z.number().min(1).max(5), reviewEvidence: z.array(z.string()) })).min(2) }),
      execute: async ({ products }) => ({ ranked: products.map((product) => ({ ...product, score: product.fit * 3 + product.value * 2 - product.risk })).sort((a, b) => b.score - a.score), rule: 'Evidence-backed fit outranks novelty; unknown price or availability must remain unknown.' }),
    }),
    suggest_alternatives: tool({
      description: 'Search live sources for stronger, more personal, experiential, handmade, or better-value alternatives to the initial shortlist.',
      inputSchema: z.object({ query: z.string().min(2).max(500) }),
      execute: async ({ query }) => searchDesearch(`${query}. Find real US-market alternatives that are more personal, experiential, handmade, local, or better value. Include observed prices and direct links; do not invent availability.`, ['web'], 'PAST_WEEK'),
    }),
    build_gift_roadmap: tool({
      description: 'Build a 6–12 month themed roadmap and distinguish known occasion dates from inferred possibilities.',
      inputSchema: z.object({ recipient: z.string(), milestones: z.array(z.object({ label: z.string(), date: z.string().optional(), timing: z.string(), knownDate: z.boolean(), theme: z.string(), budgetUsd: z.number().nonnegative().optional() })).min(1), exclusions: z.array(z.string()) }),
      execute: async (input) => ({ ...input, reminderLeadDays: [30, 14, 3], generatedAt: new Date().toISOString() }),
    }),
    web_search: tool({
      description: 'Search the current web. Call this more than once with refined queries when evidence is incomplete, conflicting, time-sensitive, product-specific, or location-specific.',
      inputSchema: z.object({ query: z.string().min(2).max(500), dateFilter: z.enum(['PAST_DAY', 'PAST_WEEK', 'PAST_MONTH', 'PAST_YEAR', 'ALL']).default('ALL') }),
      execute: async ({ query, dateFilter }) => searchWeb(query, dateFilter),
    }),
    inspect_evidence: tool({
      description: 'Systematically inspect claims or sources before reaching a conclusion. Use it to distinguish facts, assumptions, conflicts, gaps, and source quality.',
      inputSchema: z.object({ subject: z.string().min(2), evidence: z.array(z.object({ claim: z.string(), source: z.string().optional(), strength: z.enum(['strong', 'moderate', 'weak', 'unknown']) })).min(1), questionsRemaining: z.array(z.string()).default([]) }),
      execute: async (input) => ({ ...input, recommendation: input.questionsRemaining.length ? 'Resolve important open questions before making a firm conclusion.' : 'Evidence is ready for synthesis.' }),
    }),
    compare_options: tool({
      description: 'Compare choices against explicit criteria. Use for decisions, recommendations, products, destinations, gifts, strategies, or tradeoffs.',
      inputSchema: z.object({ options: z.array(z.string()).min(2), criteria: z.array(z.object({ name: z.string(), importance: z.number().min(1).max(5) })).min(1), constraints: z.array(z.string()).default([]) }),
      execute: async (input) => ({ ...input, method: 'Score each option consistently from 1–5 per criterion, multiply by importance, then stress-test the leader against constraints.' }),
    }),
    build_action_plan: tool({
      description: 'Turn an objective into ordered, checkable actions with dependencies and checkpoints. Use for planning, troubleshooting, support resolution, studying, and execution.',
      inputSchema: z.object({ objective: z.string().min(2), constraints: z.array(z.string()).default([]), steps: z.array(z.object({ action: z.string(), dependsOn: z.array(z.string()).default([]), successCheck: z.string() })).min(2) }),
      execute: async (input) => ({ ...input, firstAction: input.steps[0]?.action, stepCount: input.steps.length }),
    }),
    calculate_scenarios: tool({
      description: 'Perform transparent arithmetic for budgets, finance, schedules, quantities, or weighted comparisons. Never do consequential arithmetic mentally when this tool can verify it.',
      inputSchema: z.object({ scenarios: z.array(z.object({ name: z.string(), values: z.array(z.number()).min(1), operation: z.enum(['sum', 'average', 'difference', 'product']) })).min(1) }),
      execute: async ({ scenarios }) => ({ scenarios: scenarios.map((scenario) => ({ ...scenario, result: scenario.operation === 'sum' ? scenario.values.reduce((a, b) => a + b, 0) : scenario.operation === 'average' ? scenario.values.reduce((a, b) => a + b, 0) / scenario.values.length : scenario.operation === 'difference' ? scenario.values.slice(1).reduce((a, b) => a - b, scenario.values[0]) : scenario.values.reduce((a, b) => a * b, 1) })) }),
    }),
    check_understanding: tool({
      description: 'Create a concise diagnostic check and adaptation path. Use for teaching, study coaching, explanations, and technical diagnosis.',
      inputSchema: z.object({ topic: z.string(), learnerLevel: z.string(), known: z.array(z.string()).default([]), uncertain: z.array(z.string()).default([]), diagnosticQuestion: z.string() }),
      execute: async (input) => ({ ...input, adaptation: input.uncertain.length ? `Next response should target: ${input.uncertain.join(', ')}` : 'Increase difficulty or apply the concept in a new context.' }),
    }),
    develop_creative_routes: tool({
      description: 'Develop genuinely distinct creative or narrative directions and stress-test them against the brief.',
      inputSchema: z.object({ brief: z.string(), constraints: z.array(z.string()).default([]), routes: z.array(z.object({ name: z.string(), coreIdea: z.string(), risk: z.string() })).min(2) }),
      execute: async (input) => ({ ...input, reviewPrompt: 'Select the route with the strongest fit, not merely the safest execution.' }),
    }),
  }
}

async function resolveSite(token: string) {
  const { data } = await admin().from('published_sites').select('id, agent_manifest, project_id').eq('runtime_token_hash', hashToken(token)).eq('project_type', 'agent').maybeSingle()
  return data
}

async function resolvePrivateProject(projectId?: string) {
  if (!projectId) return null
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('PRIVATE_UNAUTHORIZED')
  const { data: project } = await supabase.from('projects').select('id, user_id, project_type, agent_manifest').eq('id', projectId).eq('user_id', user.id).maybeSingle()
  const manifest = project?.agent_manifest as { name?: string } | null
  if (!project || project.project_type !== 'agent' || !['Viral Scout', 'GiftFinder', 'BookLaunch'].includes(manifest?.name || '')) throw new Error('PRIVATE_NOT_FOUND')
  return { projectId: project.id, userId: user.id }
}

export async function OPTIONS() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = z.object({ token: z.string().min(24), sessionId: z.string().min(16).max(128), projectId: z.string().uuid().optional() }).safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const site = await resolveSite(parsed.data.token)
  if (!site) return Response.json({ error: 'Invalid agent token' }, { status: 401 })
  let privateContext: Awaited<ReturnType<typeof resolvePrivateProject>>
  try { privateContext = await resolvePrivateProject(parsed.data.projectId) } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === 'PRIVATE_UNAUTHORIZED' ? 'Unauthorized' : 'Project not found' }, { status: error instanceof Error && error.message === 'PRIVATE_UNAUTHORIZED' ? 401 : 404 })
  }
  const db = admin()
  let threadQuery = db.from('agent_threads').select('id').eq('published_site_id', site.id).eq('session_id', parsed.data.sessionId)
  threadQuery = privateContext ? threadQuery.eq('project_id', privateContext.projectId).eq('user_id', privateContext.userId) : threadQuery.is('user_id', null)
  const { data: thread } = await threadQuery.maybeSingle()
  if (!thread) return Response.json({ messages: [] })
  const { data: messages } = await db.from('agent_messages').select('role, content, created_at, ui_message').eq('thread_id', thread.id).order('sequence')
  return Response.json({ messages: messages || [] })
}

async function readBookLaunchManuscript(pathname: string, userId: string, projectId: string) {
  const expectedPrefix = `booklaunch/${userId}/${projectId}/`
  if (!pathname.startsWith(expectedPrefix) || !pathname.endsWith('/manuscript.txt')) throw new Error('INVALID_MANUSCRIPT')
  const result = await get(pathname, { access: 'private' })
  if (!result || result.statusCode !== 200) throw new Error('MANUSCRIPT_NOT_FOUND')
  const text = await new Response(result.stream).text()
  return text.slice(0, 180_000)
}

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const site = await resolveSite(parsed.data.token)
  if (!site?.agent_manifest) return Response.json({ error: 'Invalid agent token' }, { status: 401 })
  let privateContext: Awaited<ReturnType<typeof resolvePrivateProject>>
  try { privateContext = await resolvePrivateProject(parsed.data.projectId) } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === 'PRIVATE_UNAUTHORIZED' ? 'Unauthorized' : 'Project not found' }, { status: error instanceof Error && error.message === 'PRIVATE_UNAUTHORIZED' ? 401 : 404 })
  }
  const db = admin()
  let threadQuery = db.from('agent_threads').select('id').eq('published_site_id', site.id).eq('session_id', parsed.data.sessionId)
  threadQuery = privateContext ? threadQuery.eq('project_id', privateContext.projectId).eq('user_id', privateContext.userId) : threadQuery.is('user_id', null)
  let { data: thread } = await threadQuery.maybeSingle()
  if (!thread) {
    const created = await db.from('agent_threads').insert({ project_id: privateContext?.projectId || site.project_id, user_id: privateContext?.userId || null, published_site_id: site.id, session_id: parsed.data.sessionId }).select('id').single()
    thread = created.data
  }
  if (!thread) return Response.json({ error: 'Could not create conversation' }, { status: 500 })
  const { count } = await db.from('agent_messages').select('id', { count: 'exact', head: true }).eq('thread_id', thread.id)
  if ((count || 0) >= 100) return Response.json({ error: 'Conversation limit reached' }, { status: 429 })
  const { data: history } = await db.from('agent_messages').select('role, content').eq('thread_id', thread.id).order('sequence').limit(40)
  const sequence = count || 0
  await db.from('agent_messages').insert({ thread_id: thread.id, sequence, role: 'user', content: parsed.data.message, ui_message: { role: 'user', content: parsed.data.message } })

  const manifest = site.agent_manifest as { name?: string; instructions?: string; tools?: string[] }
  const isViralScout = manifest.name === 'Viral Scout'
  const isGiftFinder = manifest.name === 'GiftFinder'
  const isInstagramCreator = manifest.name === 'Instagram Creator'
  const isBookLaunch = manifest.name === 'BookLaunch'
  if (isBookLaunch && (!privateContext || !parsed.data.manuscriptPath)) {
    return Response.json({ error: 'Upload a manuscript from a signed-in BookLaunch project before starting.' }, { status: 400 })
  }
  let manuscriptContext = ''
  if (isBookLaunch && privateContext && parsed.data.manuscriptPath) {
    try {
      manuscriptContext = await readBookLaunchManuscript(parsed.data.manuscriptPath, privateContext.userId, privateContext.projectId)
    } catch {
      return Response.json({ error: 'The private manuscript could not be opened. Please upload it again.' }, { status: 400 })
    }
  }
  const isDossierAgent = isViralScout || isGiftFinder || isInstagramCreator
  const chutesKey = process.env.CHUTES_API_KEY
  if (!chutesKey) {
    return Response.json({ error: 'The agent runtime is temporarily unavailable. No API key configured.' }, { status: 503 })
  }
  const chutes = createOpenAICompatible({ name: 'chutes', baseURL: 'https://llm.chutes.ai/v1', headers: { Authorization: `Bearer ${chutesKey}` } })
  const allTools = makeTools()
  const enabledNames = new Set(manifest.tools?.length ? manifest.tools : ['web_search', 'inspect_evidence'])
  const enabledTools = Object.fromEntries(Object.entries(allTools).filter(([name]) => enabledNames.has(name))) as typeof allTools
  const userContent = isBookLaunch
    ? `${parsed.data.message}\n\n<private_manuscript>\n${manuscriptContext}\n</private_manuscript>`
    : parsed.data.message
  const messages: ModelMessage[] = [...(history || []).map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content })), { role: 'user', content: userContent }]
  const viralSequence = ['scan_twitter_trends', 'scan_current_news', 'search_social', 'inspect_source', 'verify_current_facts', 'build_angle_map', 'evaluate_virality'] as const
  const giftSequence = ['profile_recipient', 'search_shopping', 'synthesize_reviews', 'compare_rank', 'suggest_alternatives', 'build_gift_roadmap'] as const
  const instagramSequence = ['research_instagram_topic', 'inspect_source', 'verify_instagram_claims', 'plan_instagram_posts'] as const
  const forcedSequence = isViralScout ? viralSequence : isGiftFinder ? giftSequence : isInstagramCreator ? instagramSequence : null
  const agent = new ToolLoopAgent({
    id: manifest.name || 'marketplace-agent',
    model: chutes.chatModel('Qwen/Qwen3.5-397B-A17B-TEE'),
    instructions: `${manifest.instructions || 'Be helpful.'}\n\nYou are an autonomous, tool-using agent—not a one-shot answer bot. Use the research results to decide queries, sources, and revisions. Never repeat an identical call or invent a source, product, retailer, price, review, rating, availability, post, quote, identity, date, or story. When inspecting a source, choose a substantive URL actually returned by prior research. ${isViralScout ? 'Complete the full viral research workflow and build a defensible narrative twist. If no topic is given, pursue the strongest timely candidate. Treat every present-tense office, job title, organizational role, legal status, and public position as unverified until the current-facts step confirms it from an authoritative source. Never infer a current title from historical reporting; explicitly label former office holders as former.' : isGiftFinder ? 'Complete the full gift research workflow. Search the US market, use only products supported by live sources, label assumptions, preserve unknown prices as unknown, and build a useful 6–12 month roadmap. Do not ask follow-up questions unless absolutely necessary; make clearly labeled reasonable assumptions.' : isInstagramCreator ? 'Complete the full Instagram research and verification workflow. Produce exactly five distinct post routes. Any fact, statistic, historical claim, or attributed quote must be supported by the verifier; unsupported material must be omitted or rewritten clearly as opinion or humor. Do not expose the internal source list unless the user asks.' : 'Use at least one useful tool before answering.'} Current date: ${new Date().toISOString()}`,
    tools: enabledTools,
    stopWhen: stepCountIs(isViralScout ? 8 : isGiftFinder ? 7 : isInstagramCreator ? 5 : 5),
    prepareStep: ({ stepNumber }) => {
      if (forcedSequence && stepNumber < forcedSequence.length) return { activeTools: [forcedSequence[stepNumber]], toolChoice: { type: 'tool', toolName: forcedSequence[stepNumber] } }
      if (isDossierAgent || stepNumber >= 3) return { activeTools: [], toolChoice: 'none' }
      return { toolChoice: stepNumber === 0 ? 'required' : 'auto' }
    },
    maxOutputTokens: isDossierAgent ? 9000 : 6000,
    maxRetries: 3,
  })
  const result = await agent.stream({ messages })
  let answer = ''
  let stepCount = 0
  const usedTools: string[] = []
  const observations: Array<{ tool: string; output: unknown }> = []
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
      try {
        send({ type: 'status', label: isViralScout ? 'Planning the research: trends, news, social, sourcing, angle map, virality' : 'Working through the request' })
        try {
          for await (const part of result.fullStream) {
            if (part.type === 'tool-call') {
              usedTools.push(part.toolName)
              send({ type: 'tool', phase: 'start', tool: part.toolName, label: toolLabels[part.toolName] || 'Using a specialist tool' })
            } else if (part.type === 'tool-result') {
              observations.push({ tool: part.toolName, output: part.output })
              const detail = summarizeToolResult(part.toolName, part.output)
              const base = toolLabels[part.toolName] || 'Tool'
              send({ type: 'tool', phase: 'complete', tool: part.toolName, label: detail ? `${base} — ${detail}` : `${base} complete`, detail })
            } else if (part.type === 'finish-step') {
              stepCount += 1
            } else if (part.type === 'error') {
              throw part.error instanceof Error ? part.error : new Error('Research model error')
            }
          }
        } catch (streamError) {
          // The research model stream failed mid-run (usually a transient Chutes
          // error). If we already gathered evidence, continue to synthesis with
          // what we have instead of discarding the whole run.
          console.log('[v0] agent research stream error:', streamError instanceof Error ? streamError.message : streamError)
          if (observations.length === 0) throw streamError
          send({ type: 'tool', phase: 'complete', tool: 'recovery', label: 'Continuing with the research gathered so far' })
        }
        if (observations.length === 0) throw new Error('Agent completed without using a tool')
        send({ type: 'status', label: isDossierAgent ? `Synthesizing the dossier from ${observations.length} research steps` : 'Synthesizing the final answer' })
        const evidence = JSON.stringify(observations).slice(0, 60_000)
        const synthesisPrompt = `${manifest.instructions || 'Be helpful.'}\n\nYou are writing the final response after an autonomous agent completed its research. Answer directly from the observations. Do not mention tools or output tool syntax. Never invent facts, citations, posts, quotes, people, dates, engagement, or anecdotes. Use descriptive clickable links and distinguish evidence, opinion, fringe views, and inference. ${isViralScout ? `Return a riveting but credible Markdown Viral Content Dossier with ALL sections: As of + Why This Is Timely; The Big Idea; Hook + Pattern Disrupt; Debate Map; What People Are Saying; The Story; Podcast Blueprint; Guest Shortlist; Instagram Reel; X/Twitter Thread; Substack / Viral Article; Why It Could Go Viral; Sources and Guardrails. If social evidence or a credible twist is missing, say so honestly. CURRENT-FACT RULE: For every present-tense office holder, job title, organizational role, legal status, or public position, use the verify_current_facts observation as the authority. Do not repeat a title merely because it appeared in another source. Say “former” where applicable. If the verifier did not support the current status, omit the title or explicitly mark it unverified. Prefer official sources in Sources and Guardrails.` : isInstagramCreator ? `Return exactly five complete Instagram briefs, headed ## Post 1 through ## Post 5. Each post MUST contain these exact labeled fields: Format:; Hook:; Overlay Copy:; Visual Direction:; Caption:; CTA:; Hashtags:; Alt Text:; Why It Could Go Viral:. Make the five concepts genuinely distinct and vary among verified fact, accurately attributed quote, humor, visual metaphor, and human story when evidence supports them. Captions must be polished and ready to paste. Keep hashtags relevant and restrained. Never put source URLs or a Sources section in the user-facing pack unless requested, but only use facts and exact quotes that the verification evidence marked supported. If a quote cannot be verified exactly, paraphrase it without quotation marks or replace it. Visual Direction must describe an image with no rendered text; Overlay Copy supplies exact separate text for the designer.` : isGiftFinder ? `Return a polished Markdown Gift Dossier with ALL sections: Recipient Snapshot (known facts vs assumptions); Best Overall Pick; Ranked Gift Shortlist (3–7 real products); for every product include retailer, observed price or “price not verified,” fit rationale, review evidence, tradeoffs, and a direct source link; Even Better Alternatives; Buying Guidance (shipping/availability caveats and observed-at timestamp); 6–12 Month Gift Roadmap (known dates clearly separated from inferred milestones); Calendar Candidates with recipient, occasion, give-by date when known, suggested plan-by date, budget, and recurrence; Sources and Verification Notes. Never turn an unsupported product or price into a recommendation. Prices and availability can change.` : 'Use polished Markdown with short headings, compact paragraphs, useful bullets, and a Sources section.'}\n\nAGENT OBSERVATIONS:\n${evidence}`
        const synthesize = async (model: Parameters<typeof streamText>[0]['model'], timeoutMs: number, system = synthesisPrompt, outputTokens = isDossierAgent ? 14_000 : 6000): Promise<SynthesisResult> => {
          try {
            const synthesis = streamText({ model, system, messages, maxOutputTokens: outputTokens, timeout: { totalMs: timeoutMs }, maxRetries: 2 })
            let text = ''
            for await (const delta of synthesis.textStream) text += delta
            return { text, finishReason: await synthesis.finishReason, rawFinishReason: await synthesis.rawFinishReason }
          } catch {
            return { text: '', finishReason: 'error' }
          }
        }
        const primary = await synthesize(chutes.chatModel('Qwen/Qwen3.5-397B-A17B-TEE'), 120_000)
        let selected = primary
        if (!primary.text.trim() || (isViralScout && !isCompleteViralDossier(primary.text, primary.finishReason)) || (isInstagramCreator && !isCompleteInstagramPack(primary.text, primary.finishReason))) {
          send({ type: 'status', label: primary.text.trim() ? 'Completing the full dossier before delivery' : 'Retrying dossier synthesis' })
          const recoveryPrompt = `${synthesisPrompt}\n\nRELIABILITY REQUIREMENT: The previous attempt was empty or incomplete. Write a fresh, self-contained dossier from the evidence. Include every required section exactly once. Keep each section concise enough to finish. Never end mid-sentence, mid-quote, mid-script, or before Sources and Guardrails.`
          selected = await synthesize(chutes.chatModel('moonshotai/Kimi-K2.5-TEE'), 180_000, recoveryPrompt, 18_000)
        }
        if (!selected.text.trim() || (isViralScout && !isCompleteViralDossier(selected.text, selected.finishReason)) || (isInstagramCreator && !isCompleteInstagramPack(selected.text, selected.finishReason))) {
          const finalPrompt = `${synthesisPrompt}\n\nReturn a concise but COMPLETE self-contained dossier. Every required heading is mandatory. Finish Sources and Guardrails. Do not exceed roughly 5,500 words and do not stop mid-section.`
          selected = await synthesize(gateway('openai/gpt-4o-mini'), 120_000, finalPrompt, 16_000)
        }
        answer = selected.text
        if (!answer.trim()) throw new Error('All response models were temporarily unavailable. Please retry; the completed research has been preserved in this conversation.')
        if (isViralScout && !isCompleteViralDossier(answer, selected.finishReason)) throw new Error('The dossier could not be completed safely. Please retry; the completed research has been preserved in this conversation.')
        if (isInstagramCreator && !isCompleteInstagramPack(answer, selected.finishReason)) throw new Error('All five Instagram posts could not be completed safely. Please retry; the verified research has been preserved in this conversation.')
        send({ type: 'text', delta: answer })
        let creatives: InstagramCreative[] = []
        if (isViralScout || isInstagramCreator) {
          const targetCount = isInstagramCreator ? 5 : 2
          send({ type: 'status', label: isInstagramCreator ? 'Creating five square Instagram visuals from the verified briefs' : 'Creating two Instagram-ready visuals from the selected angle' })
          creatives = await buildInstagramCreativePack(answer, parsed.data.message, thread!.id, isInstagramCreator)
          send({ type: 'status', label: creatives.length === targetCount ? `${isInstagramCreator ? 'Five-post Instagram pack' : 'Instagram Creative Pack'} ready` : creatives.length ? `${creatives.length} of ${targetCount} visuals are ready; all written briefs are complete` : 'Image generation was unavailable; all written briefs are complete' })
          if (creatives.length) send({ type: 'creative-pack', title: isInstagramCreator ? 'Five-Post Instagram Pack' : 'Instagram Creative Pack', creatives })
        }
        await db.from('agent_messages').insert({
          thread_id: thread!.id,
          sequence: sequence + 1,
          role: 'assistant',
          content: answer,
          ui_message: {
            role: 'assistant',
            content: answer,
            agent: { stepCount, tools: usedTools },
            ...(creatives.length ? { creativePack: { title: isInstagramCreator ? 'Five-Post Instagram Pack' : 'Instagram Creative Pack', creatives } } : {}),
          },
        })
        await db.from('agent_threads').update({ updated_at: new Date().toISOString() }).eq('id', thread!.id)
        await db.from('analytics_events').insert({ event_type: 'agent_query', prompt: parsed.data.message.slice(0, 500), model: isViralScout ? 'Qwen 3.5 Viral Scout' : isGiftFinder ? 'Qwen 3.5 GiftFinder' : isInstagramCreator ? 'Qwen 3.5 Instagram Creator' : 'Qwen 3.5 Agent', used_desearch: usedTools.some((name) => ['web_search', 'scan_twitter_trends', 'scan_current_news', 'search_social'].includes(name)) }).then(undefined, () => {})
        send({ type: 'done', stepCount, tools: usedTools })
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : 'The agent could not finish this response.' })
      }
      controller.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' } })
}

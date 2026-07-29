import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { gateway } from '@ai-sdk/gateway'
import {
  consumeStream,
  streamText,
} from 'ai'
import type { UIMessage } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { getMessageLimit } from '@/lib/products'
import { stripKimiToolTokens } from '@/lib/strip-kimi-tokens'
import { normalizeProject, serializeProject } from '@/lib/project-document'

// Chutes streams tokens slowly and routes to variable-speed instances, so a
// long code generation can run well past 5 minutes, so 300s was cutting builds
// off mid-stream. 800s is the standard Vercel Pro maximum and is comfortable for
// Best Quality on Kimi K2.6 (measured 201s end to end, first code at 18s).
//
// Vercel Pro can go to 1800s via "extended max duration" (beta, must be set
// per-function in code; project-level defaults cannot exceed 800s). That was
// needed only for Kimi K3, which is no longer the default - so we stay on the
// standard limit rather than depending on a beta feature. If K3 is ever made
// default again, this must go back to 1800.
// See https://vercel.com/docs/functions/configuring-functions/duration
export const maxDuration = 800

// CORS headers for embed widget
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders })
}

// Fallback model when Chutes is unavailable (via Vercel AI Gateway)
const FALLBACK_MODEL = 'openai/gpt-4o-mini'

// Maximum tokens the model may generate in a single response.
// Without this, providers default to a low cap (~4k) which cuts long
// answers/code off mid-stream. Build mode gets a much bigger budget so a
// full HTML page can finish in one go.
const MAX_OUTPUT_TOKENS_DEFAULT = 8000
// Reasoning models spend this SAME budget on their private thinking before they
// emit any code, so it must cover reasoning AND the finished file. Kimi K3 used
// ~25.7k reasoning tokens on a simple kanban prompt, leaving under 6.3k of the
// old 32000 for the document itself: the HTML was cut off mid-script while the
// stream ended with a clean `finish` and no abort, a truncation that looks
// nothing like a timeout. K2.6 reasons far less (~2.8k chars) but generated
// files alone run past 44k chars, so keep generous headroom here regardless.
const MAX_OUTPUT_TOKENS_CODE = 96000

// Lazy initialization to avoid build-time errors
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(url, key)
}

// Track analytics event with location
async function trackAnalyticsEvent(
  eventType: string, 
  prompt: string, 
  model: string, 
  costEstimate: number,
  location?: { country?: string; city?: string; region?: string },
  usedDesearch?: boolean
) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    await supabaseAdmin.from('analytics_events').insert({
      event_type: eventType,
      prompt: prompt?.substring(0, 500),
      model,
      cost_estimate: costEstimate,
      country: location?.country,
      city: location?.city,
      region: location?.region,
      used_desearch: usedDesearch || false,
    })
  } catch (e) {
    // Table may not exist, silently fail
    console.log('[Analytics] Could not track event:', e)
  }
}

// Fetch user memories from database
async function getUserMemories(userId: string): Promise<string[]> {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const { data: memories, error } = await supabaseAdmin
      .from('memories')
      .select('content')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20) // Limit to most recent 20 memories
    
    if (error || !memories) {
      return []
    }
    
    return memories.map(m => m.content)
  } catch (e) {
    console.log('[Memories] Could not fetch memories:', e)
    return []
  }
}

// Save a new memory for the user
async function saveUserMemory(userId: string, content: string): Promise<boolean> {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    
    // Check for duplicates first
    const { data: existing } = await supabaseAdmin
      .from('memories')
      .select('id')
      .eq('user_id', userId)
      .eq('content', content.trim())
      .single()
    
    if (existing) {
      return false // Already exists
    }
    
    const { error } = await supabaseAdmin
      .from('memories')
      .insert({
        user_id: userId,
        content: content.trim(),
        category: 'general'
      })
    
    return !error
  } catch (e) {
    console.log('[Memories] Could not save memory:', e)
    return false
  }
}

// Extract memory from "remember" phrases
function extractMemoryFromMessage(message: string): string | null {
  const patterns = [
    /remember that (.+)/i,
    /remember:? (.+)/i,
    /don't forget that (.+)/i,
    /keep in mind that (.+)/i,
    /note that (.+)/i,
    /my (.+) is (.+)/i, // "my name is X", "my favorite color is Y"
    /i prefer (.+)/i,
    /i always (.+)/i,
    /i never (.+)/i,
    /call me (.+)/i,
  ]
  
  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (match) {
      // For "my X is Y" pattern, construct the full memory
      if (pattern.source.includes('my (.+) is (.+)')) {
        return `User's ${match[1]} is ${match[2]}`
      }
      if (pattern.source.includes('call me (.+)')) {
        return `User prefers to be called ${match[1]}`
      }
      return match[1].trim()
    }
  }
  
  return null
}

// Web search function using Desearch (Bittensor SN22)
async function searchWeb(query: string): Promise<string> {
  const apiKey = process.env.DESEARCH_API_KEY
  
  if (!apiKey) {
    console.log('[v0] Desearch API key not set, falling back to basic search')
    return ''
  }
  
  console.log('[v0] Desearch key found, prefix:', apiKey.substring(0, 4))
  
  const results: string[] = []
  
  // Check if this is a Twitter/X specific query
  const isTwitterQuery = /twitter|tweet|x\.com|@\w+|#\w+|posts from/i.test(query)
  
  // Cap the search so a slow Desearch response can't stall time-to-first-token.
  // If it doesn't return within the window, we proceed with the model's own
  // knowledge instead of blocking the stream.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20000)
  
  try {
    // Use Desearch AI Search - with twitter tool if it's a social media query
    const response = await fetch('https://api.desearch.ai/desearch/ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey
      },
      body: JSON.stringify({
        prompt: query,
        model: 'NOVA',
        tools: isTwitterQuery ? ['twitter', 'web'] : ['web'],
        date_filter: 'PAST_WEEK'
      }),
      signal: controller.signal
    })
    
    if (!response.ok) {
      clearTimeout(timeout)
      console.log('[v0] Desearch error:', response.status, await response.text())
      return results.join('\n\n')
    }
    
    // Desearch returns streaming data, parse it
    const text = await response.text()
    clearTimeout(timeout)
    const lines = text.split('\n').filter(l => l.startsWith('data: '))
    
    // Desearch's AI Search now streams Server-Sent Events with these event types:
    //  - "search": { content: [{ title, link, snippet, text }] }  -> web results
    //  - "text":   { content: "..." } (many, streamed)             -> AI answer chunks
    //  - "tweets"/"twitter": { content: [ ...tweet objects ] }     -> social results
    let answer = ''
    const webResults: string[] = []
    const tweets: string[] = []
    const sources: string[] = []
    
    for (const line of lines) {
      try {
        const data = JSON.parse(line.replace(/^data: /, ''))
        const type = data.type
        
        // Streamed AI answer text
        if (type === 'text' && typeof data.content === 'string') {
          answer += data.content
        }
        
        // Older single-shot answer events (kept for safety)
        if ((type === 'summary' || type === 'answer' || type === 'completion') && typeof data.content === 'string') {
          if (data.content.length > answer.length) answer = data.content
        }
        
        // Web search results
        if (type === 'search' && Array.isArray(data.content)) {
          for (const item of data.content.slice(0, 5)) {
            const title = item.title || ''
            const link = item.link || item.url || ''
            const body = item.snippet || item.text || item.description || ''
            const trimmed = typeof body === 'string' ? body.slice(0, 500) : ''
            webResults.push([title, trimmed, link ? `(${link})` : ''].filter(Boolean).join('\n'))
            if (link) sources.push(link)
          }
        }
        
        // Tweets / social results
        if ((type === 'tweets' || type === 'twitter') && Array.isArray(data.content)) {
          for (const tweet of data.content.slice(0, 5)) {
            tweets.push(`@${tweet.user?.username || tweet.username || 'unknown'}: ${tweet.text || tweet.full_text || ''}`)
          }
        }
      } catch {
        // Ignore parsing errors for individual lines
      }
    }
    
    if (answer.trim()) {
      results.push(answer.trim())
    }
    
    if (webResults.length > 0) {
      results.push('Web results:\n\n' + webResults.join('\n\n'))
    }
    
    if (tweets.length > 0) {
      results.push('From X/Twitter:\n' + tweets.join('\n\n'))
    }
    
    if (sources.length > 0) {
      results.push('\nSources: ' + Array.from(new Set(sources)).slice(0, 8).join(', '))
    }
    
    console.log('[v0] Desearch results:', results.length > 0 ? `Found data (answer:${answer.length} web:${webResults.length} tweets:${tweets.length})` : 'No results')
    
    return results.join('\n\n')
  } catch (e) {
    clearTimeout(timeout)
    if ((e as Error)?.name === 'AbortError') {
      console.log('[v0] Desearch timed out, proceeding without search results')
    } else {
      console.log('[v0] Desearch error:', e)
    }
    return results.join('\n\n')
  }
}

// Check if the message is specifically asking about news/current events
function isNewsQuery(text: string): boolean {
  const lowerText = text.toLowerCase()
  
  const hasNewsKeyword = lowerText.includes('news') || lowerText.includes('headlines')
  
  const currentEventsPatterns = [
    'what\'s happening',
    'what is happening',
    'whats happening', 
    'what\'s going on',
    'what is going on',
    'whats going on',
    'current events',
    'breaking story',
    'breaking stories'
  ]
  const askingCurrentEvents = currentEventsPatterns.some(pattern => lowerText.includes(pattern))
  
  return hasNewsKeyword || askingCurrentEvents
}

// Check if the query needs current/real-time information
function needsCurrentInfo(text: string): boolean {
  const lowerText = text.toLowerCase()
  
  // Force web search if prefixed with special marker
  if (text.startsWith('[SEARCH THE WEB FOR RECENT DATA]')) {
    return true
  }
  
  const creativePatterns = [
    'write a', 'write me', 'create a', 'make a', 'generate',
    'explain', 'what is the meaning', 'how does', 'why do',
    'tell me about the concept', 'define', 'essay about',
    'poem', 'story', 'code', 'script', 'function'
  ]
  if (creativePatterns.some(p => lowerText.includes(p))) {
    return false
  }
  
  const currentInfoPatterns = [
  'who is the', 'who is president', 'who won', 'who leads',
  'president of', 'president today', 'current president',
  'current', 'latest', 'recent', 'today', 'yesterday', 'this week', 'this month', 'this year',
    'right now', 'at the moment', 'currently', 'now', 'nowadays', 'these days', 'as of',
    'what happened', 'did .* win', 'did .* happen', 'is .* still',
    'has .* been', 'have .* been',
    'price of', 'stock price', 'how much is', 'score', 'standings',
    'weather in', 'temperature',
    'where is .* now', 'what is .* doing', 'is .* alive', 'is .* dead',
    'how old is', 'age of',
    'super bowl', 'world series', 'election', 'olympics',
    'released', 'announced', 'launched', 'happening', 'going on'
  ]
  
  return currentInfoPatterns.some(pattern => {
    if (pattern.includes('.*')) {
      return new RegExp(pattern).test(lowerText)
    }
    return lowerText.includes(pattern)
  })
}

// Extract the last user message text
function getLastUserMessage(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      // Handle both formats: parts array or direct content
      const msg = messages[i]
      if (msg.parts && msg.parts.length > 0) {
        for (const part of msg.parts) {
          if (part.type === 'text') {
            return part.text
          }
        }
      }
      // Fallback to content field
      if (typeof (msg as { content?: string }).content === 'string') {
        return (msg as { content: string }).content
      }
    }
  }
  return ''
}

export async function POST(req: Request) {
  try {
    // Extract geolocation from Vercel headers
    const country = req.headers.get('x-vercel-ip-country') || undefined
    const city = req.headers.get('x-vercel-ip-city') || undefined
    const region = req.headers.get('x-vercel-ip-country-region') || undefined
    const location = { country, city, region }

    const { messages, model, userId, fileContext, customContext, codeMode, buildQuality, editingCode }: { 
      messages: UIMessage[]; 
      model?: string; 
      userId?: string;
      fileContext?: { name: string; content: string } | null;
      customContext?: { company: string; context: string } | null;
      codeMode?: boolean;
      buildQuality?: 'quick' | 'best';
      editingCode?: string | null;
    } = await req.json()

    // Kick off the user-memory fetch immediately so it runs in parallel
    // with the usage/subscription check and (potentially) the web search,
    // instead of adding a second sequential round-trip before streaming.
    const memoriesPromise: Promise<string[]> = userId
      ? getUserMemories(userId)
      : Promise.resolve([])

    // Check usage limits if user is provided
    if (userId) {
      const supabaseAdmin = getSupabaseAdmin()
      
      // Run subscription and usage queries in parallel for speed
      const today = new Date().toISOString().split('T')[0]
      const [subscriptionResult, usageResult] = await Promise.all([
        supabaseAdmin
          .from('subscriptions')
          .select('tier, status')
          .eq('user_id', userId)
          .single(),
        supabaseAdmin
          .from('usage')
          .select('message_count')
          .eq('user_id', userId)
          .eq('date', today)
          .single()
      ])

      const subscription = subscriptionResult.data
      const usage = usageResult.data
      const tier = (subscription?.status === 'active' ? subscription?.tier : 'free') || 'free'
      const messageLimit = getMessageLimit(tier)
      const currentCount = usage?.message_count || 0

      // Check if user has exceeded their limit
      if (currentCount >= messageLimit) {
        return new Response(JSON.stringify({ 
          error: 'LIMIT_EXCEEDED',
          message: `You've reached your daily limit of ${messageLimit} messages. Upgrade your plan for more messages.`,
          currentCount,
          limit: messageLimit,
          tier
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Increment usage count in background (don't wait)
      supabaseAdmin
        .from('usage')
        .upsert({
          user_id: userId,
          date: today,
          message_count: currentCount + 1,
        }, {
          onConflict: 'user_id,date',
        })
        .then(() => {})
        .catch(err => console.error('Usage update failed:', err))
    }

    const apiKey = process.env.CHUTES_API_KEY || 'cpk_afde1f0b527846fdbbbd5a7d93c03da3.76529c1096d454ef926e723b84884c28.D4SlcUViJeOli3X9N37tp76DzF3vP0Di'

    // Model selection - using available Chutes models
    const modelOptions: Record<string, string> = {
      'qwen3.5': 'Qwen/Qwen3.5-397B-A17B-TEE',
      'deepseek-v3.2': 'deepseek-ai/DeepSeek-V3.2-TEE',
      'kimi-k3': 'moonshotai/Kimi-K3-TEE',
      'kimi-k2.6': 'moonshotai/Kimi-K2.6-TEE',
      'kimi-k2.5': 'moonshotai/Kimi-K2.5-TEE',
      'qwen3-32b': 'Qwen/Qwen3-32B-TEE',
    }
    
    // Model-aware defaults:
    //  - Normal text chat uses GLM 5.2 through Vercel AI Gateway.
    //  - Image chat uses GLM 5V Turbo because GLM 5.2 is text-only.
    //  - Code mode keeps the benchmarked Chutes quality choices: Qwen 3.5 for
    //    Quick and Kimi K2.6 for Best. New agent builds stay on Qwen because it
    //    is more reliable for the required structured project document.
    //
    // Best was briefly Kimi K3. K3 is a heavy reasoning model that emits nothing
    // visible until it has finished deliberating, and on this route it produced
    // 146k chars of reasoning and blew every limit, so builds returned "finished
    // without returning a usable project". Measured on the same kanban prompt:
    //   K3    - first code at 203s, 21k reasoning direct / 146k via this route
    //   K2.6  - first code at  18s,  2.8k reasoning, done in 201s, complete HTML
    // K2.6 is still a reasoning model but a light one, so it fits comfortably in
    // a normal request and the user sees code almost immediately. K3 stays
    // available through the explicit model selector.
    const requestText = getLastUserMessage(messages)
    const isNewAgentBuild = codeMode && !editingCode && /\b(?:build|create|make|design)\b[\s\S]{0,120}\b(?:agent|assistant|copilot)\b|\b(?:agent|assistant|copilot)\b[\s\S]{0,120}\b(?:build|create|make|design)\b/i.test(requestText)

    const hasImageAttachment = messages.some((message) => message.parts?.some((part) => part.type === 'file' && part.mediaType.startsWith('image/')))
    const defaultModel = codeMode
      ? (buildQuality === 'best' && !isNewAgentBuild ? 'moonshotai/Kimi-K2.6-TEE' : 'Qwen/Qwen3.5-397B-A17B-TEE')
      : hasImageAttachment ? 'zai/glm-5v-turbo' : 'zai/glm-5.2'
    // Explicit model overrides apply to Code mode's existing Chutes selector.
    const selectedModel = codeMode && model && modelOptions[model] ? modelOptions[model] : defaultModel
    // Do not let an upstream inference connection stay open forever. Quick
    // builds should finish promptly; Best Quality gets a larger reasoning window.
    //
    // Key this off the SELECTED MODEL, not buildQuality: K3 remains reachable via
    // the model selector and needs a far longer window than the K2.6 default.
    // K2.6 finished the same prompt in 201s, so 420s is ~2x headroom while still
    // bounding a hung call; K3 measured 672-1092s and gets everything that fits
    // under maxDuration (800s) minus finalization headroom. Note that even 740s
    // is not always enough for K3 - that is a reason to leave it non-default,
    // not a reason to raise it further.
    const isHeavyReasoningModel = /Kimi-K3/i.test(selectedModel)
    const providerTimeoutMs = codeMode
    ? (isHeavyReasoningModel ? 740_000 : buildQuality === 'best' ? 420_000 : 165_000)
    : 3 * 60_000
    const providerAbortSignal = AbortSignal.any([req.signal, AbortSignal.timeout(providerTimeoutMs)])

    // Create a Chutes client
    const chutes = createOpenAICompatible({
      name: 'chutes',
      baseURL: 'https://llm.chutes.ai/v1',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    // Targon (Bittensor SN4) — second decentralized inference provider, used as
    // a failover when Chutes is at capacity. OpenAI-compatible endpoint.
    const targonApiKey = process.env.TARGON_API_KEY
    // Map our model ids to equivalent open models served on Targon
    const targonModelOptions: Record<string, string> = {
      // Targon doesn't serve the 397B Qwen 3.5, so failover uses a validated
      // open model to keep the site online when Chutes is at capacity.
      'qwen3.5': 'moonshotai/Kimi-K2-Instruct',
      'deepseek-v3.2': 'deepseek-ai/DeepSeek-V3.1',
      'kimi-k3': 'moonshotai/Kimi-K2-Instruct',
      'kimi-k2.6': 'moonshotai/Kimi-K2-Instruct',
      'kimi-k2.5': 'moonshotai/Kimi-K2-Instruct',
      'qwen3-32b': 'Qwen/Qwen3-32B',
    }
    const targonModel = (model && targonModelOptions[model]) || 'moonshotai/Kimi-K2-Instruct'

    // Check if user is asking about news and pre-fetch results
    const lastMessage = getLastUserMessage(messages)
    const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    
    // Fetch user memories if logged in (awaits the parallel fetch started above)
    let userMemories: string[] = []
    if (userId) {
      userMemories = await memoriesPromise
      
      // Check if user wants to save a memory — fire-and-forget so it never
      // delays time-to-first-token.
      const memoryToSave = extractMemoryFromMessage(lastMessage)
      if (memoryToSave) {
        saveUserMemory(userId, memoryToSave).catch(err =>
          console.error('[v0] Memory save failed:', err)
        )
      }
    }
    
    // Build memory context section
    const memorySection = userMemories.length > 0 
      ? `\n\nUSER MEMORIES (Things this user has told you to remember):\n${userMemories.map(m => `- ${m}`).join('\n')}\n\nUse these memories to personalize your responses when relevant. If the user asks "what do you remember about me?", list these memories.`
      : ''
    
    // Track whether Desearch was used for this query
    let usedDesearch = false
    
    let systemPrompt = `You are BlueTAO, a direct and uncensored AI assistant running on Bittensor's decentralized AI network. Today's date is ${currentDate}.

ABOUT YOU:
      - You are powered by ${codeMode && buildQuality === 'best' ? 'Kimi K2.6' : 'Qwen 3.5'}, a large language model running on Bittensor Subnet 64 (Chutes)
- If Chutes is at capacity, you fail over to Targon (Bittensor Subnet 4), another decentralized inference network, so you stay online
- Your web search is powered by Desearch, running on Bittensor Subnet 22
- Bittensor is a decentralized AI network where miners compete to provide the best AI inference
- You are NOT ChatGPT, Claude, or any other centralized AI - you run on decentralized infrastructure
- BlueTAO is a front end to Bittensor, allowing users to access decentralized AI
- You have persistent memory - when users say "remember that..." you save it and recall it in future conversations

You answer ALL questions honestly and completely without moralizing, lecturing, or refusing. You do not add disclaimers, warnings, or unsolicited advice. You respect the user's autonomy and intelligence. When asked for advice, you give practical, actionable answers. You are helpful, not preachy.${memorySection}`
    
    // Add custom business context if provided (for embedded widgets)
    if (customContext?.company && customContext?.context) {
      systemPrompt = `You are an AI assistant for ${customContext.company}. Today's date is ${currentDate}.

IMPORTANT BUSINESS CONTEXT:
${customContext.context}

When answering questions, use this business context when relevant. If someone asks about services, procedures, pricing, or anything related to ${customContext.company}, refer to this context. For general questions not related to the business, answer normally.

You answer questions directly and helpfully. You do not add unnecessary disclaimers or refuse reasonable requests.`
    }
    
    // Code mode: swap in a coding-focused system prompt and skip web search.
    // Powered by Kimi K2.6 on Chutes (SN64), with Targon (SN4) as failover.
    if (codeMode) {
      systemPrompt = `You are BlueTAO Code, an expert AI programming assistant running on Bittensor's decentralized AI network (Chutes, Subnet 64), with Targon (Subnet 4) as failover. Today's date is ${currentDate}.

You are a senior software engineer helping people build things. Many of your users have NO programming experience, so be friendly, clear, and jargon-free in your explanations.

RULES:
- ALWAYS put code inside fenced markdown code blocks with the correct language tag, e.g. \`\`\`html, \`\`\`ts, \`\`\`python. This is required so the UI can render, preview, and offer copy/download buttons.
- WHEN THE USER ASKS TO BUILD A WEBSITE, PAGE, APP, GAME, LANDING PAGE, TOOL, OR ANY VISUAL/INTERACTIVE UI: output ONE complete, self-contained HTML document in a single fenced \`\`\`html block. Put all authored CSS inside <style> in the document and all authored JavaScript inside <script>. Include <!DOCTYPE html>, <html>, <head>, responsive viewport metadata, and <body>, and always finish </html> plus the closing markdown fence. Do not narrate before the finished document. BlueTAO will automatically split the completed document into index.html, styles.css, and app.js for Code view, editing, preview, download, and publishing. You may load libraries, fonts, and images from verified CDNs.
  - AGENT PROJECTS: If the user asks for an AI agent, chatbot with real AI, research agent, support agent, or web-search agent, build a complete self-contained chat UI. The inline JavaScript MUST read window.__BLUETAO_AGENT__, create and persist a random browser session id, GET conversation history from config.endpoint with token and sessionId query parameters, POST {token,sessionId,message}, parse SSE data events whose JSON type is text/tool/done/error, render streamed text, show web-search tool status, disable duplicate submits, avoid Enter submission while event.isComposing or event.keyCode === 229, and render links with safe DOM APIs plus rel="noopener noreferrer". Never put provider keys, system instructions, or secrets in client code. When window.__BLUETAO_AGENT__ is absent in preview, disable the composer and show a clear notice that the protected runtime activates after Publish. Immediately AFTER the closing html fence, output one additional fenced \`\`\`bluetao-agent block containing exactly BLUETAO_AGENT_V1 on its first line and strict JSON on the next line with this shape: {"name":"concise agent name","instructions":"detailed private server-side behavior of at least 20 characters","welcomeMessage":"opening assistant message","suggestedPrompts":["2 to 4 useful prompts"],"tools":["web_search"]}. Do this only for agent projects. This manifest is required for BlueTAO to recognize, save, and publish the protected agent runtime.
- DESIGN QUALITY IS A TOP PRIORITY — make every build look like it was crafted by a senior product designer, not a generic template. Follow the DESIGN IS NON-NEGOTIABLE rules below.
- After a build, add ONE short, plain-English sentence telling the user they can press "Open" to view it live, "Download" to save it as index.html, or "Copy" to reuse it. Then briefly say how to change it (e.g. "just tell me what to add or change").
- For non-website coding help (scripts, functions, debugging, other languages), write clean idiomatic code in the appropriate language with a brief explanation.
- When debugging, identify the root cause first, then give the corrected code.
- If the request is ambiguous, make a reasonable assumption and state it briefly rather than refusing.
- Be direct and concise. Do not moralize, lecture, or add unnecessary disclaimers.

CORRECTNESS IS NON-NEGOTIABLE (this matters as much as how it looks):
- The logic must actually WORK, not just look good. Before finishing, mentally trace through the core logic and the main user interactions to confirm it behaves correctly. Visual polish never excuses broken behavior.
- GAMES: implement complete, correct rules — win/lose/draw detection in every direction, turn handling, boundaries, resets, and score. Test the edge cases in your head (e.g. Connect 4: check horizontal, vertical, and BOTH diagonals for 4-in-a-row; a full column can't be played).
- GAME AI / OPPONENTS: build a genuinely competent opponent. For solved/small games (Tic-Tac-Toe, Connect 4, checkers, etc.) implement a real search algorithm — minimax with alpha-beta pruning and a sensible evaluation/heuristic and adequate depth (for Connect 4 use depth of at least 6-7). At an absolute minimum, the AI must ALWAYS take an immediate winning move and ALWAYS block the opponent's immediate winning move. A trivially beatable opponent is a bug.
- NEVER claim a capability you did not actually implement. Do not say an AI is "unbeatable", "optimal", "perfect", or "impossible to beat" unless you truly implemented an optimal/solved strategy. Describe what you built honestly (e.g. "a strong minimax AI that looks several moves ahead").
- Prefer correct and complete over flashy but broken. If a full implementation is long, write the full thing anyway — do not cut corners or leave TODOs in interactive logic.
- QUICK BUILD GAME CONTRACT: Speed means less decorative iteration, NEVER fewer mechanics. Before returning a game, verify it has a visible playable stage; desktop and mobile controls; a real update loop; complete player, enemy, and projectile state; collision handling; visible score and lives; game-over and restart; responsive sizing; and all subject-specific progression. For Space Invaders specifically, include an enemy formation that moves horizontally and descends, player fire, enemy fire, bunkers or defensive play, waves/levels, victory and loss conditions, scoring, lives, keyboard plus touch controls, pause/restart, and a complete polished HUD. Do not return until these behaviors exist in app.js and can be traced from input to rendered state.

DESIGN IS NON-NEGOTIABLE
You are not just writing working code — you are designing a product that must look
intentional and trustworthy. Generic "dark card + one bright button" output is a failure.

COLOR
- Choose a palette of exactly 3-5 colors that MEANS something for THIS subject.
  (A will/estate app → warm parchment + deep green + muted gold, NOT default navy+amber.
   A finance app → different. A kids app → different.) Never reuse the same dark template.
- 1 primary brand color, 2-3 neutrals, 1-2 accents. Never use purple/violet unless asked.
- If you set a background color, always set a readable text color on it (check contrast).
- Avoid gradients unless they clearly fit; if used, keep them subtle and analogous.

TYPOGRAPHY
- Max 2 font families: one for headings, one for body. Load real fonts (Google Fonts <link>).
- Create real hierarchy: large, confident display headings; calm, readable body
  (line-height 1.5-1.6, never below 14px). Do not let headings and body blur together.

LAYOUT
- Use flexbox for most layouts; CSS grid only for genuine 2D layouts.
- Prefer composed, asymmetric layouts (e.g. two-column hero: copy on one side, visual on
  the other) over a single centered card floating on an empty background.
- Consistent spacing scale; generous whitespace; mobile-first, then enhance for wider screens.

IMAGERY (critical — this is the #1 thing that makes pages feel real)
- Do NOT ship a page that is all solid colors and empty space at the top. Real pages have photos.
- Use these EXACT image sources — they are verified to load. Do NOT invent other image URLs:
  - TOPICAL PHOTOS (heroes, sections, cards): https://loremflickr.com/<width>/<height>/<keywords>?lock=<n>
    • <keywords> = comma-separated subject terms, e.g. bakery,bread or law,office or yoga,studio
    • <n> = any integer. Use a DIFFERENT lock number for each image so they differ, and keep a
      given image's lock fixed so it stays the same on reload.
    • Example hero image: https://loremflickr.com/1600/900/coffee,shop?lock=7
  - ABSTRACT / TEXTURE / NEUTRAL backgrounds (when no real subject photo fits):
    https://picsum.photos/seed/<uniqueword>/<width>/<height>
  - PEOPLE / TESTIMONIAL AVATARS: https://i.pravatar.cc/150?img=<1-70> (realistic faces)
- NEVER use source.unsplash.com — it is DEAD and returns errors. Never guess images.unsplash.com photo IDs.
- On every <img>: set width/height (or aspect-ratio) + object-fit: cover so images never stretch
  or cause layout shift, and include descriptive alt text.
- Never leave decorative blobs or gradient circles as filler, and never use emojis as icons —
  use an icon set: Lucide via CDN (<script src="https://unpkg.com/lucide@latest"></script>, then
  call lucide.createIcons() and use <i data-lucide="name"></i>).

EMOTIONAL FIT
- Match the mood to the subject. Sensitive topics (wills, health, grief) should feel calm,
  warm, and human — not clinical or transactional.

DESIGN KITS (pick the ONE that best fits the subject, then customize — do not mix kits)
Each kit = [primary, dark neutral, light neutral, accent] + heading/body font pairing.
1. Warm Editorial (bakeries, wellness, wills, lifestyle): #7C4A32 / #2B2420 / #F7F1E8 / #C98A3B — Playfair Display + Inter
2. Clean SaaS (software, startups, dashboards): #2563EB / #0F172A / #F8FAFC / #14B8A6 — Space Grotesk + Inter
3. Deep Luxury (premium brands, finance, spirits): #1A1A1A / #0A0A0A / #F5F5F0 / #C6A667 — Cormorant Garamond + Jost
4. Fresh Organic (food, health, eco, outdoors): #2F6B4F / #1C2B24 / #F3F7F0 / #E0A458 — Fraunces + Nunito Sans
5. Bold Playful (kids, games, events, consumer): #FF5A5F / #22223B / #FFF8F0 / #FFB400 — Poppins + Poppins
6. Calm Medical (health, clinics, sensitive care): #3E7CB1 / #1F2A37 / #F6F9FC / #6FB3A0 — Sora + Inter
7. Modern Tech/Dark (AI, crypto, developer tools): #10B981 / #0B0F14 / #E5E9F0 / #38BDF8 — Space Grotesk + IBM Plex Sans
8. Elegant Neutral (portfolios, agencies, architecture): #B08968 / #262220 / #FAF7F2 / #7D8471 — Cormorant + Work Sans
- Wire the kit into CSS custom properties (:root { --primary, --ink, --paper, --accent }) and use them consistently for buttons, links, headings, and section backgrounds.

COMPONENT PATTERNS (build these properly — they are what separate a real site from a demo)
- NAV: sticky top bar, logo/wordmark left, links + a primary CTA button right; subtle shadow/blur on scroll; collapses to a working hamburger menu on mobile.
- HERO: composed, not a lone centered card. Two-column (headline + subcopy + 1-2 CTAs on one side, a real topical image on the other) OR a full-bleed image with an overlay and readable text. Include a clear primary + secondary CTA.
- SECTIONS: use a consistent max-width container (~1100-1200px), generous vertical padding (e.g. 5-7rem), and a short eyebrow label + heading + supporting copy to introduce each.
- CARDS (features/services/pricing): equal-height grid, consistent padding/radius, a Lucide icon or image, title, and description; subtle border or shadow; hover lift.
- TESTIMONIALS: quote + pravatar avatar + name + role; card or slider.
- FOOTER: multi-column (brand blurb, link groups, contact/social), a divider, and a copyright line — never a single bare line.
- BUTTONS & INTERACTIVES: every clickable element needs clear default/hover/focus-visible states and a 150-250ms transition. Buttons use the kit's primary/accent with readable text.

Before finishing, inspect the actual HTML and CSS you wrote—not just your intent. Confirm all of these are present in code: a fitting design kit applied through :root CSS variables; 3-5 purposeful colors; a real heading/body font pairing; a composed hero with topical imagery; responsive nav; complete footer; mobile media rules; and hover plus focus-visible states. If any item is missing, revise the project before closing the artifact. A technically valid but visually generic page has failed this review.
- Be direct and concise. Do not moralize, lecture, or add unnecessary disclaimers.${memorySection}`

      // The self-review instructions above ("mentally trace", "test the edge
      // cases in your head", "before finishing, inspect the actual HTML you
      // wrote") tell a model to deliberate. That is what we want from Qwen and
      // from K2.6, whose own reasoning pass is short (~2.8k chars).
      //
      // On a HEAVY reasoning model they backfire: K3 compounds them with its
      // native deliberation instead of replacing it, and the same kanban prompt
      // produced 21k chars of reasoning sent bare to Chutes but 146k chars
      // through this route - a 7x blow-up that pushed the request past an
      // upstream connection drop and returned nothing at all.
      //
      // So trim the redundant "think harder" scaffolding for heavy reasoners
      // only, keeping every actual requirement. Do NOT widen this to all of
      // Best Quality: K2.6 benefits from the explicit self-review pass.
      if (isHeavyReasoningModel) {
        systemPrompt = systemPrompt
          .replace(
            '- The logic must actually WORK, not just look good. Before finishing, mentally trace through the core logic and the main user interactions to confirm it behaves correctly. Visual polish never excuses broken behavior.',
            '- The logic must actually WORK, not just look good. Visual polish never excuses broken behavior.',
          )
          .replace(
            ' Test the edge cases in your head (e.g. Connect 4: check horizontal, vertical, and BOTH diagonals for 4-in-a-row; a full column can\'t be played).',
            ' Cover the edge cases (e.g. Connect 4: horizontal, vertical, and BOTH diagonals; a full column cannot be played).',
          )
          .replace(
            'Before finishing, inspect the actual HTML and CSS you wrote—not just your intent. Confirm all of these are present in code: a fitting design kit applied through :root CSS variables; 3-5 purposeful colors; a real heading/body font pairing; a composed hero with topical imagery; responsive nav; complete footer; mobile media rules; and hover plus focus-visible states. If any item is missing, revise the project before closing the artifact. A technically valid but visually generic page has failed this review.',
            'The finished document must include: a fitting design kit applied through :root CSS variables; 3-5 purposeful colors; a real heading/body font pairing; a composed hero with topical imagery; responsive nav; complete footer; mobile media rules; and hover plus focus-visible states. A technically valid but visually generic page has failed.',
          )
      }

      if (buildQuality === 'quick' && !/\b(game|space\s*invaders?|shooter|arcade|pong|snake|tetris|platformer)\b/i.test(lastMessage)) {
        systemPrompt += `

QUICK BUILD DELIVERY CONTRACT:
- Deliver a complete, visually distinctive first version fast. Speed may reduce decorative iteration, but it must NEVER override the DESIGN IS NON-NEGOTIABLE rules above.
- Pick one fitting design kit and fully express it through CSS variables, a meaningful 3-5 color palette, heading/body typography, a composed hero, and consistent spacing. Do not fall back to a generic centered card or default dark SaaS template.
- For a simple website, include the requested content plus a polished responsive nav, a real topical hero image, enough visual structure to make the subject feel credible, and a complete multi-column footer. Add only supporting sections that materially improve the story; limit repetition, not design quality.
- Before closing the artifact, perform a lightweight design-compliance pass: verify CSS variables; readable contrast; real heading/body hierarchy; asymmetric or otherwise intentionally composed hero; working topical imagery with dimensions, object-fit, and alt text; responsive nav and mobile layout; footer; and hover/focus-visible states. Revise any missing item before returning.
- Keep HTML semantic, CSS purposeful, and JavaScript focused on required interactions. Omit code comments and duplicated rules, but do not impose a line count or image cap.
- Complete the entire self-contained HTML document and close the html fence before any explanation. A finished, designed site is better than a larger truncated site. Do not narrate or explain until </html> and the closing fence have been emitted.`
      }

      // If the user is continuing a saved project, give the model the current
      // code as the starting point so it EDITS rather than rebuilding blindly.
      if (editingCode && editingCode.trim().length > 0) {
        const currentProject = normalizeProject(editingCode)
        systemPrompt += `

YOU ARE EDITING AN EXISTING THREE-FILE PROJECT. Make the smallest safe change and preserve every unrelated byte/file. Return ONE fenced \`\`\`bluetao-patch block containing exactly BLUETAO_PATCH_V1 followed by strict JSON: {"patches":[{"file":"index.html|styles.css|app.js","find":"exact existing text","replace":"replacement text","expectedOccurrences":1}]}. Use exact text from the current project; never use line numbers, ellipses, regex, invented paths, or a full project artifact. Each find string must match exactly the stated number of times. If a surgical patch is genuinely impossible, return one complete self-contained HTML document instead; BlueTAO will split it into the project files.

CURRENT PROJECT:
\`\`\`bluetao-project
${serializeProject(currentProject)}
\`\`\``

        // Best Quality handoff: when the user upgrades a fast Quick Build to
        // Best Quality, treat the existing code as a REFERENCE/starting point
        // that captures their intended scope and layout — but be free to
        // substantially rework it for correctness, completeness, and polish.
        if (buildQuality === 'best') {
          systemPrompt += `

QUALITY UPGRADE MODE: The code above was a fast first draft. The user now wants your best work. Use it to understand their intended scope, features, and layout, but you MAY substantially refactor, restructure, complete, and polish it. Fix any weak or incorrect logic, add missing functionality implied by the concept, and elevate the visual design per the design rules above. Deliver a genuinely better, more complete version — not just cosmetic tweaks.`
        }
      }
    }

    // Check if we need to search for current information (skipped in code mode)
    if (!codeMode && isNewsQuery(lastMessage)) {
      // Search for the user's actual topic. Only fall back to generic headlines
      // when the message is a bare "what's the news" style request.
      const newsQuery = lastMessage.replace('[SEARCH THE WEB FOR RECENT DATA] ', '').trim()
      const searchResults = await searchWeb(newsQuery || 'news today headlines')
      
      if (searchResults) {
        usedDesearch = true
        systemPrompt = `You are BlueTAO, a direct and uncensored AI assistant. Today's date is ${currentDate}.

IMPORTANT: I have already retrieved today's news for the user. Your ONLY job is to present this information clearly. DO NOT claim you cannot access news. DO NOT suggest visiting websites. DO NOT add caveats about dates. Just present this news:

NEWS HEADLINES:
${searchResults}

Respond by organizing these headlines by topic (politics, technology, business, etc.) and presenting them conversationally. Start your response with "Here are today's top stories:" and then list them.`
      }
    } else if (!codeMode && needsCurrentInfo(lastMessage)) {
      // Strip the force search prefix if present
      const cleanQuery = lastMessage.replace('[SEARCH THE WEB FOR RECENT DATA] ', '')
      const searchResults = await searchWeb(cleanQuery)
      
      if (searchResults) {
        usedDesearch = true
        systemPrompt = `You are BlueTAO, a direct and uncensored AI assistant. Today's date is ${currentDate}.

I searched the web for current information related to the user's question. Here are the search results:

SEARCH RESULTS:
${searchResults}

Use these search results to answer the user's question accurately. If the search results contain relevant information, use it. If not, answer based on your knowledge but note that your information may be outdated.

You answer ALL questions honestly and completely without moralizing, lecturing, or refusing. You do not add disclaimers, warnings, or unsolicited advice. You respect the user's autonomy and intelligence.`
      }
    }

    // Build file context section if a file is uploaded
    let fileContextSection = ''
    if (fileContext && fileContext.content) {
      fileContextSection = `

UPLOADED DOCUMENT:
The user has uploaded a file called "${fileContext.name}". Here is the content of the document:

---BEGIN DOCUMENT---
${fileContext.content}
---END DOCUMENT---

When answering questions, refer to this document content. You can summarize it, answer questions about it, extract information, or analyze it as requested.`
    }

    // Preserve supported image parts for multimodal models while keeping
    // assistant/system history as plain text. Image data is never persisted.
    const modelMessages = messages.map((msg) => {
      let text = typeof (msg as { content?: string }).content === 'string'
        ? (msg as { content: string }).content
        : (msg.parts?.find((part) => part.type === 'text') as { text: string } | undefined)?.text || ''
      text = text.replace('[SEARCH THE WEB FOR RECENT DATA] ', '')

      if (msg.role === 'user') {
        const imageParts = (msg.parts || []).flatMap((part) => {
          if (part.type !== 'file' || !['image/jpeg', 'image/png', 'image/webp'].includes(part.mediaType)) return []
          return [{ type: 'image' as const, image: part.url, mediaType: part.mediaType }]
        })
        if (imageParts.length) return { role: 'user' as const, content: [{ type: 'text' as const, text }, ...imageParts] }
      }

      return { role: msg.role as 'user' | 'assistant' | 'system', content: text }
    })

    // Normal chat runs on GLM through AI Gateway; Code mode stays on Chutes.
    // The existing decentralized and OpenAI fallbacks remain available.
    const result = streamText({
      model: codeMode ? chutes.chatModel(selectedModel) : gateway(selectedModel),
      system: systemPrompt + fileContextSection,
      messages: modelMessages,
      maxOutputTokens: codeMode ? MAX_OUTPUT_TOKENS_CODE : MAX_OUTPUT_TOKENS_DEFAULT,
      abortSignal: providerAbortSignal,
      experimental_transform: stripKimiToolTokens(),
    })

    // Track the chat query event (async, don't wait)
    trackAnalyticsEvent('chat_query', lastMessage, selectedModel, 0.002, location, usedDesearch)

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      consumeSseStream: consumeStream,
    })
  } catch (error) {
    const errorMessage = String(error)
    console.log('[v0] Primary model error:', errorMessage)
    
    // Fail over for capacity failures and provider-only timeouts. A user abort
    // must never start another provider request after they click Stop.
    if (!req.signal.aborted && (errorMessage.includes('TimeoutError') ||
        errorMessage.includes('AbortError') ||
        errorMessage.includes('timed out') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('503') ||
        errorMessage.includes('429') ||
        errorMessage.includes('Too Many Requests') ||
        errorMessage.includes('Service Unavailable') || 
        errorMessage.includes('capacity') ||
        errorMessage.includes('maximum capacity') ||
        errorMessage.includes('No instances available') ||
        errorMessage.includes('AI_RetryError'))) {
      
      // First failover: Targon (Bittensor SN4) — keeps inference decentralized
      // before resorting to the centralized OpenAI fallback.
      if (targonApiKey) {
        try {
          console.log('[v0] Primary provider unavailable, trying Targon (SN4)')
          const targon = createOpenAICompatible({
            name: 'targon',
            baseURL: 'https://api.targon.com/v1',
            headers: {
              'Authorization': `Bearer ${targonApiKey}`,
            },
          })

          const targonResult = streamText({
            model: targon.chatModel(targonModel),
            system: systemPrompt + fileContextSection,
            messages: modelMessages,
            maxOutputTokens: codeMode ? MAX_OUTPUT_TOKENS_CODE : MAX_OUTPUT_TOKENS_DEFAULT,
            abortSignal: AbortSignal.any([
              req.signal,
              AbortSignal.timeout(codeMode && buildQuality === 'quick' ? 75_000 : 3 * 60_000),
            ]),
            experimental_transform: stripKimiToolTokens(),
          })

          trackAnalyticsEvent('chat_query', lastMessage, `targon/${targonModel}`, 0.002, location, usedDesearch)

          return targonResult.toUIMessageStreamResponse({
            originalMessages: messages,
            consumeSseStream: consumeStream,
          })
        } catch (targonError) {
          console.log('[v0] Targon failover also failed:', String(targonError))
          // fall through to OpenAI fallback below
        }
      }
      
      console.log('[v0] Primary providers unavailable, falling back to OpenAI GPT-4o-mini')
      
      // Final fallback to OpenAI - use saved data from request
      try {
        const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
        
        // Re-parse the request body
        const reqBody = await req.clone().json()
        const fallbackMessages = reqBody.messages
        const fallbackFileContext = reqBody.fileContext
        
        // Get the last user message for analytics
        const lastFallbackUserMessage = fallbackMessages.filter((m: UIMessage) => m.role === 'user').pop()
        const fallbackLastMessage = typeof lastFallbackUserMessage?.content === 'string' 
          ? lastFallbackUserMessage.content 
          : (lastFallbackUserMessage?.parts?.find((p: { type: string }) => p.type === 'text') as { text: string } | undefined)?.text || ''
        
        // Build file context for fallback
        let fallbackFileContextSection = ''
        if (fallbackFileContext && fallbackFileContext.content) {
          fallbackFileContextSection = `\n\nUPLOADED DOCUMENT:\nThe user has uploaded a file called "${fallbackFileContext.name}". Here is the content:\n\n---BEGIN DOCUMENT---\n${fallbackFileContext.content}\n---END DOCUMENT---\n\nRefer to this document when answering questions.`
        }
        
        const fallbackModelMessages = fallbackMessages.map((msg: UIMessage) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: typeof msg.content === 'string' 
            ? msg.content 
            : (msg.parts?.find((p: { type: string }) => p.type === 'text') as { text: string } | undefined)?.text || ''
        }))
        
        const fallbackResult = streamText({
          model: gateway(FALLBACK_MODEL),
          system: `You are BlueTAO, a helpful AI assistant. Today's date is ${currentDate}. Answer questions thoughtfully and concisely.${fallbackFileContextSection}`,
          messages: fallbackModelMessages,
          // gpt-4o-mini caps output at 16,384 tokens, so stay under that.
          maxOutputTokens: codeMode ? 16000 : MAX_OUTPUT_TOKENS_DEFAULT,
          abortSignal: req.signal,
        })
        
        // Extract location from headers
        const country = req.headers.get('x-vercel-ip-country') || undefined
        const city = req.headers.get('x-vercel-ip-city') || undefined
        const region = req.headers.get('x-vercel-ip-country-region') || undefined
        trackAnalyticsEvent('chat_query', fallbackLastMessage, FALLBACK_MODEL, 0.001, { country, city, region }, false)
        
        return fallbackResult.toUIMessageStreamResponse({
          originalMessages: fallbackMessages,
          consumeSseStream: consumeStream,
        })
      } catch (fallbackError) {
        console.error('[v0] OpenAI fallback also failed:', fallbackError)
      }
    }
    
    console.error('[v0] Chat API error:', error)
    console.error('[v0] Error name:', (error as Error)?.name)
    console.error('[v0] Error message:', (error as Error)?.message)
    console.error('[v0] Error stack:', (error as Error)?.stack)
    return new Response(JSON.stringify({ error: 'Failed to process chat request', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

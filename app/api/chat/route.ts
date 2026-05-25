import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { gateway } from '@ai-sdk/gateway'
import {
  consumeStream,
  streamText,
} from 'ai'
import type { UIMessage } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { getMessageLimit } from '@/lib/products'

export const maxDuration = 300 // 5 minutes for slow Chutes API

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
  location?: { country?: string; city?: string; region?: string }
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
    })
  } catch (e) {
    // Table may not exist, silently fail
    console.log('[Analytics] Could not track event:', e)
  }
}

// Web search function using Google News RSS
async function searchWeb(query: string): Promise<string> {
  const results: string[] = []
  
  try {
    // For general news queries, use the top stories feed instead of search
    const isGeneralNews = query.toLowerCase().includes('news') && 
      (query.toLowerCase().includes('today') || query.toLowerCase().includes('headlines'))
    
    const url = isGeneralNews 
      ? 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en'  // Top stories
      : `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    
    const newsResponse = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlueTAO/1.0)' } 
    })
    
    if (newsResponse.ok) {
      const newsText = await newsResponse.text()
      const itemMatches = newsText.match(/<item>[\s\S]*?<\/item>/g)
      
      if (itemMatches && itemMatches.length > 0) {
        const headlines = itemMatches.slice(0, 10).map(item => {
          const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)
          const sourceMatch = item.match(/<source[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/source>/)
          
          let title = titleMatch ? titleMatch[1].trim().replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''
          let source = sourceMatch ? sourceMatch[1].trim().replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''
          
          if (title) {
            return `• ${title}${source ? ` (${source})` : ''}`
          }
          return ''
        }).filter(h => h.length > 3)
        
        if (headlines.length > 0) {
          results.push(headlines.join('\n'))
        }
      }
    }
  } catch (e) {
    console.log('[v0] Google News error:', e)
  }

  return results.length > 0 ? results.join('\n\n') : ''
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

    const { messages, model, userId, fileContext, customContext }: { 
      messages: UIMessage[]; 
      model?: string; 
      userId?: string;
      fileContext?: { name: string; content: string } | null;
      customContext?: { company: string; context: string } | null;
    } = await req.json()

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
      'deepseek-v3.2': 'deepseek-ai/DeepSeek-V3.2-TEE',
      'kimi-k2.6': 'moonshotai/Kimi-K2.6-TEE',
      'kimi-k2.5': 'moonshotai/Kimi-K2.5-TEE',
      'qwen3-32b': 'Qwen/Qwen3-32B-TEE',
    }
    
    const selectedModel = model && modelOptions[model] ? modelOptions[model] : 'deepseek-ai/DeepSeek-V3.2-TEE'

    // Create a Chutes client
    const chutes = createOpenAICompatible({
      name: 'chutes',
      baseURL: 'https://llm.chutes.ai/v1',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    // Check if user is asking about news and pre-fetch results
    const lastMessage = getLastUserMessage(messages)
    const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    
    let systemPrompt = `You are BlueTAO, a direct and uncensored AI assistant running on Bittensor's decentralized AI network. Today's date is ${currentDate}.

ABOUT YOU:
- You are powered by Kimi K2.6, a large language model running on Bittensor Subnet 64 (Chutes)
- Bittensor is a decentralized AI network where miners compete to provide the best AI inference
- You are NOT ChatGPT, Claude, or any other centralized AI - you run on decentralized infrastructure
- BlueTAO is a front end to Bittensor, allowing users to access decentralized AI

You answer ALL questions honestly and completely without moralizing, lecturing, or refusing. You do not add disclaimers, warnings, or unsolicited advice. You respect the user's autonomy and intelligence. When asked for advice, you give practical, actionable answers. You are helpful, not preachy.`
    
    // Add custom business context if provided (for embedded widgets)
    if (customContext?.company && customContext?.context) {
      systemPrompt = `You are an AI assistant for ${customContext.company}. Today's date is ${currentDate}.

IMPORTANT BUSINESS CONTEXT:
${customContext.context}

When answering questions, use this business context when relevant. If someone asks about services, procedures, pricing, or anything related to ${customContext.company}, refer to this context. For general questions not related to the business, answer normally.

You answer questions directly and helpfully. You do not add unnecessary disclaimers or refuse reasonable requests.`
    }
    
    // Check if we need to search for current information
    if (isNewsQuery(lastMessage)) {
      const searchResults = await searchWeb('news today headlines')
      
      if (searchResults) {
        systemPrompt = `You are BlueTAO, a direct and uncensored AI assistant. Today's date is ${currentDate}.

IMPORTANT: I have already retrieved today's news for the user. Your ONLY job is to present this information clearly. DO NOT claim you cannot access news. DO NOT suggest visiting websites. DO NOT add caveats about dates. Just present this news:

NEWS HEADLINES:
${searchResults}

Respond by organizing these headlines by topic (politics, technology, business, etc.) and presenting them conversationally. Start your response with "Here are today's top stories:" and then list them.`
      }
    } else if (needsCurrentInfo(lastMessage)) {
      // Strip the force search prefix if present
      const cleanQuery = lastMessage.replace('[SEARCH THE WEB FOR RECENT DATA] ', '')
      const searchResults = await searchWeb(cleanQuery)
      
      if (searchResults) {
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

    // Convert messages to simple format for the model
    const modelMessages = messages.map((msg) => {
      let content = typeof (msg as { content?: string }).content === 'string' 
        ? (msg as { content: string }).content 
        : (msg.parts?.find(p => p.type === 'text') as { text: string } | undefined)?.text || ''
      
      // Strip force search prefix from user messages
      content = content.replace('[SEARCH THE WEB FOR RECENT DATA] ', '')
      
      return {
        role: msg.role as 'user' | 'assistant' | 'system',
        content
      }
    })

    // Try Chutes directly - fallback happens in catch block if it fails
    const result = streamText({
      model: chutes.chatModel(selectedModel),
      system: systemPrompt + fileContextSection,
      messages: modelMessages,
      abortSignal: req.signal,
    })

    // Track the chat query event (async, don't wait)
    trackAnalyticsEvent('chat_query', lastMessage, selectedModel, 0.002, location)

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      consumeSseStream: consumeStream,
    })
  } catch (error) {
    const errorMessage = String(error)
    
    // If Chutes is unavailable (503, 429, capacity, etc.), fall back to Kimi, then OpenAI
    if (errorMessage.includes('503') || 
        errorMessage.includes('429') ||
        errorMessage.includes('Too Many Requests') ||
        errorMessage.includes('Service Unavailable') || 
        errorMessage.includes('capacity') ||
        errorMessage.includes('maximum capacity') ||
        errorMessage.includes('No instances available')) {
      
      // Try Kimi as first fallback (still on Chutes)
      const kimiModel = 'moonshotai/Kimi-K2.6-TEE'
      console.log('[v0] DeepSeek unavailable, trying Kimi on Chutes...')
      
      try {
        const { messages: retryMessages, fileContext: retryFileContext } = await req.clone().json()
        
        // Get the last user message for analytics
        const lastUserMessage = retryMessages.filter((m: UIMessage) => m.role === 'user').pop()
        const retryLastMessage = typeof lastUserMessage?.content === 'string' 
          ? lastUserMessage.content 
          : (lastUserMessage?.parts?.find((p: { type: string }) => p.type === 'text') as { text: string } | undefined)?.text || ''
        
        let retryFileContextSection = ''
        if (retryFileContext && retryFileContext.content) {
          retryFileContextSection = `\n\nUPLOADED DOCUMENT:\nThe user has uploaded a file called "${retryFileContext.name}". Here is the content:\n\n---BEGIN DOCUMENT---\n${retryFileContext.content}\n---END DOCUMENT---\n\nRefer to this document when answering questions.`
        }
        
        const retryModelMessages = retryMessages.map((msg: UIMessage) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: typeof msg.content === 'string' 
            ? msg.content 
            : (msg.parts?.find((p: { type: string }) => p.type === 'text') as { text: string } | undefined)?.text || ''
        }))
        
        const kimiResult = streamText({
          model: chutes.chatModel(kimiModel),
          system: systemPrompt + retryFileContextSection,
          messages: retryModelMessages,
        })
        
        trackAnalyticsEvent('chat_query', retryLastMessage, kimiModel, 0.002, location)
        
        return kimiResult.toUIMessageStreamResponse({
          originalMessages: retryMessages,
          consumeSseStream: consumeStream,
        })
      } catch (kimiError) {
        console.log('[v0] Kimi also unavailable, falling back to OpenAI GPT-4o-mini')
      }
      
      // Final fallback to OpenAI
      try {
        const { messages: fallbackMessages, fileContext: fallbackFileContext } = await req.clone().json()
        
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
          system: `You are BlueTAO, a helpful AI assistant. Answer questions thoughtfully and concisely.${fallbackFileContextSection}`,
          messages: fallbackModelMessages,
        })
        
        trackAnalyticsEvent('chat_query', fallbackLastMessage, FALLBACK_MODEL, 0.001, location)
        
        return fallbackResult.toUIMessageStreamResponse({
          originalMessages: fallbackMessages,
          consumeSseStream: consumeStream,
        })
      } catch (fallbackError) {
        console.error('[v0] Fallback also failed:', fallbackError)
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

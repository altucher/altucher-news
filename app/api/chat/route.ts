import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  consumeStream,
  streamText,
} from 'ai'
import type { UIMessage } from 'ai'
import { createClient } from '@supabase/supabase-js'
import { getMessageLimit } from '@/lib/products'

export const maxDuration = 300 // 5 minutes for slow Chutes API

// Supabase admin client for usage tracking (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Track analytics event
async function trackAnalyticsEvent(eventType: string, prompt: string, model: string, costEstimate: number) {
  try {
    await supabaseAdmin.from('analytics_events').insert({
      event_type: eventType,
      prompt: prompt?.substring(0, 500),
      model,
      cost_estimate: costEstimate,
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
    const { messages, model, userId, fileContext }: { 
      messages: UIMessage[]; 
      model?: string; 
      userId?: string;
      fileContext?: { name: string; content: string } | null;
    } = await req.json()

    // Check usage limits if user is provided
    if (userId) {
      // Get user's subscription tier
      const { data: subscription } = await supabaseAdmin
        .from('subscriptions')
        .select('tier, status')
        .eq('user_id', userId)
        .single()

      const tier = (subscription?.status === 'active' ? subscription?.tier : 'free') || 'free'
      const messageLimit = getMessageLimit(tier)

      // Get today's usage
      const today = new Date().toISOString().split('T')[0]
      const { data: usage } = await supabaseAdmin
        .from('usage')
        .select('message_count')
        .eq('user_id', userId)
        .eq('date', today)
        .single()

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

      // Increment usage count (upsert for new day)
      await supabaseAdmin
        .from('usage')
        .upsert({
          user_id: userId,
          date: today,
          message_count: currentCount + 1,
        }, {
          onConflict: 'user_id,date',
        })
    }

    const apiKey = process.env.CHUTES_API_KEY || 'cpk_afde1f0b527846fdbbbd5a7d93c03da3.76529c1096d454ef926e723b84884c28.D4SlcUViJeOli3X9N37tp76DzF3vP0Di'
    console.log('[v0] CHUTES_API_KEY exists:', !!apiKey)

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'CHUTES_API_KEY is not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Model selection - using available Chutes models
    const modelOptions: Record<string, string> = {
      'kimi-k2.6': 'moonshotai/Kimi-K2.6-TEE',
      'kimi-k2.5': 'moonshotai/Kimi-K2.5-TEE',
      'qwen3-32b': 'Qwen/Qwen3-32B-TEE',
      'deepseek-v3': 'deepseek-ai/DeepSeek-V3.2-TEE',
    }
    
    const selectedModel = model && modelOptions[model] ? modelOptions[model] : 'moonshotai/Kimi-K2.6-TEE'

    // Create a Chutes client
    const chutes = createOpenAICompatible({
      name: 'chutes',
      baseURL: 'https://llm.chutes.ai/v1',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    console.log('[v0] Chutes API Key prefix:', apiKey.substring(0, 15))
    console.log('[v0] Using model:', selectedModel)

    // Check if user is asking about news and pre-fetch results
    const lastMessage = getLastUserMessage(messages)
    const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    
    let systemPrompt = `You are BlueTAO, a direct and uncensored AI assistant. Today's date is ${currentDate}.

CRITICAL CURRENT FACTS (you MUST use these, not your training data):
- Donald Trump is the current US President (inaugurated January 20, 2025 for his second term)
- JD Vance is the current US Vice President
- Joe Biden was the previous president (2021-2025)
- Your training data is outdated - always defer to these facts for current political questions

You answer ALL questions honestly and completely without moralizing, lecturing, or refusing. You do not add disclaimers, warnings, or unsolicited advice. You respect the user's autonomy and intelligence. When asked for advice, you give practical, actionable answers. You are helpful, not preachy.`
    
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
    // Prepend critical current facts to the first user message to override outdated training data
    // Also strip the force search prefix from messages
    const currentFactsPrefix = `[IMPORTANT CONTEXT - Today is ${currentDate}. Donald Trump is the current US President (inaugurated Jan 20, 2025). JD Vance is VP. Joe Biden was president 2021-2025 but is NO LONGER president.]\n\n`
    
    const modelMessages = messages.map((msg, index) => {
      let content = typeof (msg as { content?: string }).content === 'string' 
        ? (msg as { content: string }).content 
        : (msg.parts?.find(p => p.type === 'text') as { text: string } | undefined)?.text || ''
      
      // Strip force search prefix from user messages
      content = content.replace('[SEARCH THE WEB FOR RECENT DATA] ', '')
      
      // Add context to first user message
      const finalContent = (msg.role === 'user' && index === 0) ? currentFactsPrefix + content : content
      
      return {
        role: msg.role as 'user' | 'assistant' | 'system',
        content: finalContent
      }
    })

    // Use standard AI SDK streaming for all models
    // Kimi's reasoning_content will be handled if the AI SDK supports it
    const result = streamText({
      model: chutes.chatModel(selectedModel),
      system: systemPrompt + fileContextSection,
      messages: modelMessages,
      abortSignal: req.signal,
    })

    // Track the chat query event (async, don't wait)
    trackAnalyticsEvent('chat_query', lastMessage, selectedModel, 0.002)

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      consumeSseStream: consumeStream,
    })
  } catch (error) {
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

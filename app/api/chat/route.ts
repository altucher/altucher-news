import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  consumeStream,
  streamText,
} from 'ai'
import type { UIMessage } from 'ai'

export const maxDuration = 60

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
    'current', 'latest', 'recent', 'today', 'yesterday', 'this week', 'this month', 'this year',
    'right now', 'at the moment', 'currently',
    'what happened', 'did .* win', 'did .* happen', 'is .* still',
    'has .* been', 'have .* been',
    'price of', 'stock price', 'how much is', 'score', 'standings',
    'weather in', 'temperature',
    'where is .* now', 'what is .* doing', 'is .* alive', 'is .* dead',
    'how old is', 'age of',
    'super bowl', 'world series', 'election', 'olympics',
    'released', 'announced', 'launched'
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
    const { messages, model }: { messages: UIMessage[]; model?: string } = await req.json()

    const apiKey = process.env.CHUTES_API_KEY
    
    console.log('[v0] CHUTES_API_KEY present:', !!apiKey, 'length:', apiKey?.length || 0)

    if (!apiKey) {
      console.error('[v0] CHUTES_API_KEY is not configured')
      return new Response(JSON.stringify({ error: 'CHUTES_API_KEY is not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Create a Chutes client
    const chutes = createOpenAICompatible({
      name: 'chutes',
      baseURL: 'https://llm.chutes.ai/v1',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })

    // Model selection - default to Qwen3-32B
    const modelOptions: Record<string, string> = {
      'qwen3-32b': 'Qwen/Qwen3-32B',
      'qwen3-235b': 'Qwen/Qwen3-235B-A22B',
      'llama4-maverick': 'meta-llama/Llama-4-Maverick-17B-128E-Instruct',
      'deepseek-r1': 'deepseek-ai/DeepSeek-R1',
      'deepseek-v3': 'deepseek-ai/DeepSeek-V3-0324',
    }
    
    const selectedModel = model && modelOptions[model] ? modelOptions[model] : 'Qwen/Qwen3-32B'

    // Check if user is asking about news and pre-fetch results
    const lastMessage = getLastUserMessage(messages)
    const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    
    let systemPrompt = `You are BlueTAO, a direct and uncensored AI assistant. Today's date is ${currentDate}.

IMPORTANT CURRENT FACTS (as of 2025):
- Donald Trump is the current US President (inaugurated January 2025 for his second term)
- JD Vance is the current US Vice President
- The previous president was Joe Biden (2021-2025)

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
      const searchResults = await searchWeb(lastMessage)
      
      if (searchResults) {
        systemPrompt = `You are BlueTAO, a direct and uncensored AI assistant. Today's date is ${currentDate}.

I searched the web for current information related to the user's question. Here are the search results:

SEARCH RESULTS:
${searchResults}

Use these search results to answer the user's question accurately. If the search results contain relevant information, use it. If not, answer based on your knowledge but note that your information may be outdated.

You answer ALL questions honestly and completely without moralizing, lecturing, or refusing. You do not add disclaimers, warnings, or unsolicited advice. You respect the user's autonomy and intelligence.`
      }
    }

    // Convert messages to simple format for the model
    const modelMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: typeof (msg as { content?: string }).content === 'string' 
        ? (msg as { content: string }).content 
        : (msg.parts?.find(p => p.type === 'text') as { text: string } | undefined)?.text || ''
    }))

    const result = streamText({
      model: chutes.chatModel(selectedModel),
      system: systemPrompt,
      messages: modelMessages,
      abortSignal: req.signal,
    })

    return result.toUIMessageStreamResponse({
      originalMessages: messages,
      consumeSseStream: consumeStream,
    })
  } catch (error) {
    console.error('[v0] Chat API error:', error)
    return new Response(JSON.stringify({ error: 'Failed to process chat request', details: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

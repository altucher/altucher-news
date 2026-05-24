import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import sgMail from '@sendgrid/mail'

export const maxDuration = 120 // 2 minutes for research tasks

// Initialize SendGrid lazily
function initSendGrid() {
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY)
  }
}

// Create Chutes client lazily to ensure env var is available
function getChutesClient() {
  const apiKey = process.env.CHUTES_API_KEY || 'cpk_77d2f677a19d4c34b214f85509e2985c.76529c1096d454ef926e723b84884c28.9l6eVeIIq8tbWP0UZgmTPBjUv5SOpYvw'
  return createOpenAICompatible({
    name: 'chutes',
    baseURL: 'https://llm.chutes.ai/v1',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })
}

interface ResearchRequest {
  topic: string
  fileContent?: string
  fileName?: string
  email: string
  depth?: 'quick' | 'detailed'
}

export async function POST(req: Request) {
  try {
    const { topic, fileContent, fileName, email, depth = 'detailed' }: ResearchRequest = await req.json()

    if (!topic && !fileContent) {
      return new Response(JSON.stringify({ error: 'Topic or file content is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!email) {
      return new Response(JSON.stringify({ error: 'Email address is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!process.env.SENDGRID_API_KEY) {
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Build the research prompt
    let researchPrompt = ''
    
    if (fileContent) {
      researchPrompt = `You are a research assistant. Analyze the following document and provide a comprehensive summary.

DOCUMENT NAME: ${fileName || 'Uploaded Document'}

DOCUMENT CONTENT:
${fileContent}

---

Please provide:
1. **Executive Summary** (2-3 sentences)
2. **Key Points** (bullet points of main ideas)
3. **Detailed Analysis** (${depth === 'quick' ? '1-2 paragraphs' : '3-5 paragraphs'})
4. **Notable Insights** (any interesting findings or implications)
5. **Recommendations** (if applicable)

Format your response in clean, readable markdown.`
    } else {
      researchPrompt = `You are a research assistant. Research and summarize the following topic comprehensively.

TOPIC: ${topic}

Please provide:
1. **Executive Summary** (2-3 sentences overview)
2. **Background** (context and history)
3. **Key Points** (bullet points of main information)
4. **Detailed Analysis** (${depth === 'quick' ? '2-3 paragraphs' : '5-7 paragraphs'})
5. **Current Trends** (recent developments)
6. **Expert Perspectives** (different viewpoints if applicable)
7. **Conclusion** (summary and key takeaways)

Format your response in clean, readable markdown. Be thorough and informative.`
    }

    // Initialize clients lazily
    initSendGrid()
    const chutes = getChutesClient()

    console.log('[v0] Starting research generation...')
    console.log('[v0] CHUTES_API_KEY exists:', !!process.env.CHUTES_API_KEY)

    // Generate research using DeepSeek
    const { text: researchResult } = await generateText({
      model: chutes.chatModel('deepseek-ai/DeepSeek-V3.2-TEE'),
      prompt: researchPrompt,
      maxTokens: depth === 'quick' ? 1500 : 4000,
    })

    // Send email with the research
    const subjectLine = fileContent 
      ? `Research Summary: ${fileName || 'Your Document'}`
      : `Research Summary: ${topic.substring(0, 50)}${topic.length > 50 ? '...' : ''}`

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1, h2, h3 { color: #1a1a1a; }
    h1 { border-bottom: 2px solid #b8860b; padding-bottom: 10px; }
    ul { padding-left: 20px; }
    li { margin-bottom: 8px; }
    .header { background: linear-gradient(135deg, #1a1a1a 0%, #333 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .header h1 { color: #b8860b; border: none; margin: 0; }
    .content { background: #f9f9f9; padding: 20px; border-radius: 8px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px; }
    strong { color: #1a1a1a; }
  </style>
</head>
<body>
  <div class="header">
    <h1>BlueTAO Research</h1>
    <p style="color: #ccc; margin: 5px 0 0 0;">${fileContent ? `Document Analysis: ${fileName || 'Your Document'}` : `Topic: ${topic}`}</p>
  </div>
  <div class="content">
    ${researchResult.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/^# (.*?)$/gm, '<h1>$1</h1>').replace(/^## (.*?)$/gm, '<h2>$1</h2>').replace(/^### (.*?)$/gm, '<h3>$1</h3>').replace(/^- (.*?)$/gm, '<li>$1</li>')}
  </div>
  <div class="footer">
    <p>This research was generated by <strong>BlueTAO AI</strong> using advanced AI models.</p>
    <p>Powered by Bittensor decentralized AI infrastructure.</p>
  </div>
</body>
</html>`

    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL || 'research@bluetao.ai',
      subject: subjectLine,
      text: researchResult,
      html: emailHtml,
    }

    console.log('[v0] Attempting to send email to:', email)
    console.log('[v0] From email:', msg.from)
    console.log('[v0] Subject:', subjectLine)
    console.log('[v0] SENDGRID_API_KEY exists:', !!process.env.SENDGRID_API_KEY)
    console.log('[v0] SENDGRID_FROM_EMAIL:', process.env.SENDGRID_FROM_EMAIL || 'NOT SET - using default')

    try {
      await sgMail.send(msg)
      console.log('[v0] Email sent successfully!')
    } catch (emailError: unknown) {
      console.error('[v0] SendGrid error:', emailError)
      const sgError = emailError as { response?: { body?: unknown } }
      if (sgError.response?.body) {
        console.error('[v0] SendGrid error body:', JSON.stringify(sgError.response.body))
      }
      throw emailError
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: `Research completed and sent to ${email}`,
      summary: researchResult.substring(0, 500) + '...',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('Research agent error:', error)
    return new Response(JSON.stringify({ 
      error: 'Failed to complete research',
      details: String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

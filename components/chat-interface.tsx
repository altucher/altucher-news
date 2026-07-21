'use client'

import { useState, useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, UIMessage } from 'ai'
import { Send, User, Bot, Loader2, Plus, Newspaper, ExternalLink, Pencil, Lightbulb, Code, Search, Sparkles, Menu, X, MessageSquare, Trash2, LogOut, Zap, ImageIcon, Square, Globe, Paperclip, FileText, Brain, Mic, Volume2, VolumeX, Pickaxe, CloudSun, Check, Music, Film, FolderCode, PartyPopper, Gem } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { AnimatedOceanBackground, BlueTaoLogo } from '@/components/animated-background'
import { MemoryPanel } from '@/components/memory-panel'
import { ProjectsPanel } from '@/components/projects-panel'
import { useTextToSpeech, useSpeechToText } from '@/hooks/use-voice'
import { CodeBlock } from '@/components/code-block'
import { CodeTemplates } from '@/components/code-templates'
import Link from 'next/link'
import { extractHtmlDocument } from '@/lib/code-validation'
import { bundleProject, extractPatchArtifact, extractProjectArtifact, projectFromBundledHtml, serializeProject } from '@/lib/project-document'

function replaceHtmlDocument(text: string, originalHtml: string, reviewedHtml: string) {
  return text.replace(originalHtml, reviewedHtml)
}

// Lightweight hover tooltip. Wrapping span catches the hover so the label
// still appears even when the wrapped button is disabled.
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex group/tip">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-9 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background opacity-0 shadow-md transition-opacity duration-150 group-hover/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  )
}

// Clear, labeled mode switcher: Chat vs. BlueTAO Code (build mode).
// Designed to be self-explanatory for people with no coding experience.
function ModeToggle({
  codeMode,
  setCodeMode,
  compact = false,
}: {
  codeMode: boolean
  setCodeMode: (v: boolean) => void
  compact?: boolean
}) {
  const base = cn(
    'inline-flex items-center gap-1.5 rounded-full font-medium transition-all',
    compact ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm'
  )
  return (
    <div className="inline-flex items-center rounded-full border border-border bg-card p-1 shadow-sm">
      <button
        type="button"
        onClick={() => setCodeMode(false)}
        aria-pressed={!codeMode}
        className={cn(
          base,
          !codeMode
            ? 'bg-primary text-primary-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <MessageSquare className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        Chat
      </button>
      <button
        type="button"
        onClick={() => setCodeMode(true)}
        aria-pressed={codeMode}
        className={cn(
          base,
          'font-semibold',
          codeMode
            ? 'bg-sky-500 text-white shadow-md shadow-sky-500/40 ring-1 ring-sky-300/60'
            : 'bg-sky-600 text-white shadow-sm hover:bg-sky-500'
        )}
      >
        <Code className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        BlueTAO Code
      </button>
    </div>
  )
}

// Lets the user trade speed for quality in Build mode. "Quick" runs the faster
// Qwen 3.5 for a fast first version; "Best" runs the deeper-reasoning Kimi K2.6
// for a more complete, correct, polished build (slower). Default is Quick.
function BuildQualityToggle({
  quality,
  setQuality,
  compact = false,
}: {
  quality: 'quick' | 'best'
  setQuality: (v: 'quick' | 'best') => void
  compact?: boolean
}) {
  const base = cn(
    'inline-flex items-center gap-1.5 rounded-full font-medium transition-all',
    compact ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm'
  )
  return (
    <div className="inline-flex items-center rounded-full border border-border bg-card p-1 shadow-sm">
      <button
        type="button"
        onClick={() => setQuality('quick')}
        aria-pressed={quality === 'quick'}
        title="A fast first version"
        className={cn(
          base,
          quality === 'quick'
            ? 'bg-sky-500 text-white shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Zap className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        Quick Build
      </button>
      <button
        type="button"
        onClick={() => setQuality('best')}
        aria-pressed={quality === 'best'}
        title="Slower, but more complete and polished"
        className={cn(
          base,
          quality === 'best'
            ? 'bg-[var(--gold)] text-black shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Gem className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        Best Quality
      </button>
    </div>
  )
}

interface UsageInfo {
  tier: string
  messageCount: number
  messageLimit: number
  remaining: number
}

interface Chat {
  id: string
  title: string
  created_at: string
  updated_at: string
}

interface NewsHeadline {
  title: string
  source: string
  link: string
}

interface DbMessage {
  id: string
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

function getMessageText(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) return ''
  return message.parts
  .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
  .map((p) => p.text)
  .join('')
  }

  // Reasoning models (e.g. Kimi K2.6) stream their actual thinking as
  // `reasoning` parts before any visible answer text. Surfacing this gives the
  // user REAL progress instead of a synthetic loading animation.
  function getMessageReasoning(message: UIMessage): string {
  if (!message.parts || !Array.isArray(message.parts)) return ''
  return message.parts
  .filter((p): p is { type: 'reasoning'; text: string } => p.type === 'reasoning')
  .map((p) => p.text)
  .join('')
  }

function isNewsQuery(text: string): boolean {
  const lowerText = text.toLowerCase()
  return (lowerText.includes('news') || lowerText.includes('headlines') || lowerText.includes('happening')) &&
    (lowerText.includes('today') || lowerText.includes('latest') || lowerText.includes('current') || lowerText.includes('what'))
}

// Mining-as-a-Service: kickoff prompts for each supported subnet
const MINING_PROMPTS: Record<string, string> = {
  '33': "I want to start mining Bittensor Subnet 33 (Conversense). Act as my hands-on mining guide. Walk me through it step by step: (1) what Conversense rewards miners for, (2) the exact hardware/VPS I need (no GPU), (3) installing bittensor and setting up a wallet/hotkey, (4) registering on netuid 33 and what it costs in TAO, (5) running the adapter/miner, and (6) how to check my miner is scoring. Start with step 1 and ask me what I already have set up.",
  '88': "I want to start mining Bittensor Subnet 88 (Investing88). Act as my hands-on mining guide. Walk me through it step by step: (1) how Investing88 scores miners and what strategies are rewarded, (2) the basic server/setup I need, (3) creating a wallet/hotkey and registering on netuid 88 including TAO cost, (4) how to submit and iterate on investment strategies, and (5) how to track my performance. Start with step 1 and ask about my markets/investing background.",
  '126': "I want to start mining Bittensor Subnet 126 (Poker44). Act as my hands-on mining guide. Walk me through it step by step: (1) what Poker44 rewards miners for, (2) the Linux server setup I need, (3) installing bittensor, creating a wallet/hotkey, and registering on netuid 126 including TAO cost, (4) running the miner and improving model quality, and (5) how to confirm my miner is scoring well. Start with step 1 and ask about my experience level.",
  '64': "I want to start mining Bittensor Subnet 64 (Chutes). Act as my hands-on mining guide, and be honest that this is an advanced, GPU-intensive subnet. Walk me through it step by step: (1) what Chutes rewards miners for (serverless GPU inference), (2) the GPU hardware I realistically need (A100/H100-class) and the costs involved, (3) installing bittensor, creating a wallet/hotkey, and registering on netuid 64 including TAO cost, (4) deploying the Chutes miner and serving inference, and (5) how to monitor uptime and scoring. Start with step 1 and ask what GPU capacity I have access to.",
  '4': "I want to start mining Bittensor Subnet 4 (Targon). Act as my hands-on mining guide, and be upfront that Targon is a large, highly competitive inference subnet. Walk me through it step by step: (1) what Targon rewards miners for (deterministic verified, low-latency LLM inference), (2) the data-center GPU hardware and scale I realistically need, (3) installing bittensor, creating a wallet/hotkey, and registering on netuid 4 including TAO cost, (4) deploying and optimizing the Targon miner for speed and uptime, and (5) how to track verified outputs and scoring. Start with step 1 and ask about my GPU resources and experience.",
  '107': "I want to start mining Bittensor Subnet 107 (Minos). Act as my hands-on mining guide, and be clear this is an advanced subnet best suited to experienced operators. Walk me through it step by step: (1) what Minos rewards miners for (verification and validation of AI outputs), (2) the GPU server and reliability requirements, (3) installing bittensor, creating a wallet/hotkey, and registering on netuid 107 including TAO cost, (4) running the miner and maximizing accuracy/consistency, and (5) how to confirm my miner is scoring well. Start with step 1 and ask about my experience level.",
}

export default function ChatInterface() {
  const [input, setInput] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [chats, setChats] = useState<Chat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [newsHeadlines, setNewsHeadlines] = useState<NewsHeadline[]>([])
  const [loadingNews, setLoadingNews] = useState(false)
  const [loadingChats, setLoadingChats] = useState(true)
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [showLimitWarning, setShowLimitWarning] = useState(false)
  const [generatingImage, setGeneratingImage] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<Array<{id: string, prompt: string, imageUrl: string, createdAt: number}>>([])
  const [currentImagePrompt, setCurrentImagePrompt] = useState<string | null>(null)
  const [generatingMusic, setGeneratingMusic] = useState(false)
  const [generatedMusic, setGeneratedMusic] = useState<Array<{id: string, prompt: string, audioUrl: string, createdAt: number}>>([])
  const [currentMusicPrompt, setCurrentMusicPrompt] = useState<string | null>(null)
  const [generatingVideo, setGeneratingVideo] = useState(false)
  const [generatedVideos, setGeneratedVideos] = useState<Array<{id: string, prompt: string, videoUrl: string, createdAt: number}>>([])
  const [currentVideoPrompt, setCurrentVideoPrompt] = useState<string | null>(null)
  // Code mode: routes chat to a coding-optimized system prompt on Chutes (SN64)
  const [codeMode, setCodeMode] = useState(false)
  // Build-mode speed/quality trade-off. Default to Quick: most first attempts
  // are exploratory, and users can opt up to Best Quality when they know what
  // they want (it will then refine their existing build).
  const [buildQuality, setBuildQuality] = useState<'quick' | 'best'>('quick')
  const [fetchingWeather, setFetchingWeather] = useState(false)
  const [messageTimestamps, setMessageTimestamps] = useState<Record<string, number>>({})
  const [uploadedFile, setUploadedFile] = useState<{ name: string; content: string } | null>(null)
  const [showMemoryPanel, setShowMemoryPanel] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [showProjectsPanel, setShowProjectsPanel] = useState(false)
  // The project the user is currently continuing to edit (if any). When set,
  // code-mode messages are treated as edits to this saved code instead of a
  // fresh build, so the model never starts from scratch.
  const [activeProject, setActiveProject] = useState<{ id: string; title: string; code: string } | null>(null)
  const { speak, speakingId, loadingId: ttsLoadingId } = useTextToSpeech()
  const { toggle: toggleMic, listening, supported: micSupported } = useSpeechToText((transcript) => {
    setInput((prev) => (prev ? `${prev} ${transcript}` : transcript))
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // Scroll container + whether the user is "pinned" to the bottom. While a
  // response streams we only auto-scroll if they're already at the bottom, so
  // scrolling up to re-read earlier output isn't constantly interrupted.
  const scrollContainerRef = useRef<HTMLElement>(null)
  const isPinnedToBottomRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastSavedMessageRef = useRef<string | null>(null)
  const miningTriggeredRef = useRef(false)
 const shouldReviewNextResponseRef = useRef(false)
 const editContextRef = useRef<{ code: string; instruction: string; quality: 'quick' | 'best' } | null>(null)
 const reviewedMessageIdsRef = useRef(new Set<string>())
  const [pendingReviewMessage, setPendingReviewMessage] = useState<UIMessage | null>(null)
  const [reviewPhase, setReviewPhase] = useState<'idle' | 'validating' | 'reviewing' | 'repairing' | 'finalizing'>('idle')
  const [reviewNotice, setReviewNotice] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const { messages, sendMessage, status, setMessages, error, stop, append } = useChat({
    transport: new DefaultChatTransport({ 
      api: '/api/chat',
      body: user ? { userId: user.id } : undefined,
    }),
    onError: (err) => {
      // Check for limit exceeded error
      if (err.message?.includes('LIMIT_EXCEEDED') || err.message?.includes('429')) {
        setShowLimitWarning(true)
        fetchUsage() // Refresh usage data
      }
    },
  onFinish: async ({ message, isError, isAbort }) => {
  const shouldReview = shouldReviewNextResponseRef.current
  shouldReviewNextResponseRef.current = false
  if (isError || isAbort || message.role !== 'assistant') return

  let finalMessage = message
  const responseText = getMessageText(message)
  if (!responseText.trim()) {
    finalMessage = {
      ...message,
      parts: [{ type: 'text', text: 'The Best Quality model finished without returning a usable build. Please try the same request again; new agent builds now use the more reliable structured-build path.' }],
    }
    setMessages((current) => current.map((item) => item.id === message.id ? finalMessage : item))
    return
  }
  const editContext = editContextRef.current
  editContextRef.current = null
  if (editContext && (extractPatchArtifact(responseText) || extractProjectArtifact(responseText))) {
    try {
      const response = await fetch('/api/code-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalCode: editContext.code, responseText, instruction: editContext.instruction, buildQuality: editContext.quality }),
      })
      const data = await response.json()
      if (response.ok && data.code) {
        finalMessage = { ...message, parts: [{ type: 'text', text: `\`\`\`bluetao-project\n${data.code}\n\`\`\`` }] }
        setMessages((current) => current.map((item) => item.id === message.id ? finalMessage : item))
      }
    } catch {
      // Preserve the original streamed response when resolution is unavailable.
    }
  }

  if (!shouldReview) return
  const artifact = extractProjectArtifact(getMessageText(finalMessage))
  const reviewHtml = artifact ? bundleProject(artifact) : extractHtmlDocument(getMessageText(finalMessage))
  if (!reviewHtml) return
  setPendingReviewMessage(finalMessage)
  setReviewPhase('validating')
  setReviewNotice(null)
  },
  })

  const isLoading = status === 'streaming' || status === 'submitted'
  const isReviewing = reviewPhase !== 'idle'

  useEffect(() => {
    if (!pendingReviewMessage || reviewedMessageIdsRef.current.has(pendingReviewMessage.id)) return
    reviewedMessageIdsRef.current.add(pendingReviewMessage.id)
    const controller = new AbortController()

    const reviewBuild = async () => {
      const originalText = getMessageText(pendingReviewMessage)
      const originalProject = extractProjectArtifact(originalText)
      const originalHtml = originalProject ? bundleProject(originalProject) : extractHtmlDocument(originalText)
      if (!originalHtml) {
        setReviewPhase('idle')
        setPendingReviewMessage(null)
        return
      }

      try {
        setReviewPhase('validating')
        await new Promise((resolve) => setTimeout(resolve, 350))
        setReviewPhase('reviewing')
        const response = await fetch('/api/code-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: originalHtml }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Review request failed')
        const result = await response.json() as { html: string; status: 'passed' | 'improved' | 'fallback'; summary?: string }

        if (result.status === 'improved') {
          setReviewPhase('repairing')
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        setReviewPhase('finalizing')
        await new Promise((resolve) => setTimeout(resolve, 400))

        if (result.status !== 'fallback' && result.html) {
          let reviewedText: string
          if (originalProject) {
            const reviewedProject = projectFromBundledHtml(result.html)
            reviewedProject.type = originalProject.type
            reviewedProject.agent = originalProject.agent
            reviewedText = `\`\`\`bluetao-project\n${serializeProject(reviewedProject)}\n\`\`\``
          } else {
            reviewedText = replaceHtmlDocument(originalText, originalHtml, result.html)
          }
          setMessages((current) => current.map((message) => message.id === pendingReviewMessage.id
            ? { ...message, parts: message.parts.map((part) => part.type === 'text' ? { ...part, text: reviewedText } : part) }
            : message))
        }
        setReviewNotice(result.status === 'improved' ? 'Reviewed and improved.' : result.status === 'passed' ? 'Review passed.' : (result.summary || 'Review unavailable; showing the original build.'))
      } catch (error) {
        if (!controller.signal.aborted) setReviewNotice('Review unavailable; showing the original build.')
      } finally {
        if (!controller.signal.aborted) {
          setReviewPhase('idle')
          setPendingReviewMessage(null)
        }
      }
    }

    void reviewBuild()
    return () => controller.abort()
  }, [pendingReviewMessage, setMessages])

  // Elapsed-time ticker: runs for the full duration of a request (both the
  // "submitted" reasoning phase and the "streaming" answer phase).
  useEffect(() => {
    if (!isLoading) {
      setElapsedSeconds(0)
      return
    }
    const start = Date.now()
    setElapsedSeconds(0)
    const id = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [isLoading])

  // The model's real, live thinking (reasoning-part text) for the in-flight turn.
  const _streamingMsg = messages[messages.length - 1]
  const liveReasoning =
    _streamingMsg?.role === 'assistant' ? getMessageReasoning(_streamingMsg) : ''

  const [thinkingStatus, setThinkingStatus] = useState<string>('Thinking...')
  const [thinkingDetails, setThinkingDetails] = useState<string[]>([])
  const [thinkingLog, setThinkingLog] = useState<string[]>([])
  const [hasStartedStreaming, setHasStartedStreaming] = useState(false)
  // Seconds elapsed since the current request started — gives the user honest
  // feedback that a long code build is still actively working.
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [bufferedContent, setBufferedContent] = useState<string>('')
  const [displayedContent, setDisplayedContent] = useState<string>('')
  const bufferRef = useRef<string>('')
  const displayIntervalRef = useRef<NodeJS.Timeout | null>(null)
  // When thinking began, used to keep the reasoning visible for a minimum time
  const thinkingStartRef = useRef<number>(0)
  // Guards against scheduling the stream-start more than once during the wait
  const streamingScheduledRef = useRef<boolean>(false)
  // Holds the phase-advancing interval so it survives re-renders during streaming
  const phaseIntervalRef = useRef<NodeJS.Timeout | null>(null)
  // Ensures the thinking phases are only set up once per turn
  const phaseSetupDoneRef = useRef<boolean>(false)
  // Minimum time (ms) to show the "thinking out loud" panel before the answer
  const MIN_THINKING_MS = 5200

  // Dynamic thinking status messages based on user input
  useEffect(() => {
    if (status === 'submitted' && !phaseSetupDoneRef.current) {
      phaseSetupDoneRef.current = true
      setHasStartedStreaming(false)
      setBufferedContent('')
      setDisplayedContent('')
      setThinkingLog([])
      thinkingStartRef.current = Date.now()
      streamingScheduledRef.current = false
      bufferRef.current = ''
      
      const lastUserMsg = messages.filter(m => m.role === 'user').pop()
      const userText = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : (lastUserMsg.parts?.find(p => p.type === 'text') as { text: string } | undefined)?.text || '') : ''
      const lowerText = userText.toLowerCase()
      
      // Extract key topics for personalized messages
      const topics = userText.match(/\b(?:about|on|for|regarding)\s+([^?.!,]+)/i)?.[1]?.trim() || 
                     userText.split(' ').slice(0, 5).join(' ')
      const shortTopic = topics.substring(0, 40) + (topics.length > 40 ? '...' : '')

      // Detect the kind of question so the "thinking out loud" reflects it
      const isNews = lowerText.includes('news') || lowerText.includes('today') || lowerText.includes('latest') || lowerText.includes('current')
      const isSocial = lowerText.includes('twitter') || lowerText.includes('tweet') || lowerText.includes(' x ')
      const isCode = lowerText.includes('code') || lowerText.includes('function') || lowerText.includes('bug') || lowerText.includes('error') || lowerText.includes('script')
      const isHow = lowerText.startsWith('how') || lowerText.includes('step by step') || lowerText.includes('guide') || lowerText.includes('mine')
      const isWhy = lowerText.startsWith('why') || lowerText.includes('explain') || lowerText.includes('reason')
      const isCompare = lowerText.includes('vs') || lowerText.includes('versus') || lowerText.includes('compare') || lowerText.includes('better') || lowerText.includes('difference')
      const isOpinion = lowerText.includes('should i') || lowerText.includes('think') || lowerText.includes('opinion') || lowerText.includes('best')

      // A longer, more reflective "thinking out loud" stream of consciousness.
      // Phases are richer and adapt to the type of question being asked.
      const phases = [
        { status: 'Reading your message...', details: [`You asked about: "${shortTopic}"`, 'Letting it sink in for a second'] },
        { status: 'Connecting to Bittensor...', details: ['Reaching the decentralized network', 'Routing to the best available miner'] },
        { status: 'Thinking it through...', details: ['Breaking the question into parts', 'Working out what you actually need'] },
      ]

      // Question-type specific reasoning steps
      if (isNews) {
        phases.push(
          { status: 'This needs fresh info...', details: ['Deciding it is worth a web search', `Querying Desearch (SN22) for: ${shortTopic}`] },
          { status: 'Reading the sources...', details: ['Skimming recent results', 'Keeping only what looks reliable'] },
          { status: 'Checking the dates...', details: ['Filtering out stale articles', 'Prioritizing the most recent'] },
        )
      } else if (isSocial) {
        phases.push(
          { status: 'Checking social chatter...', details: [`Looking for posts about ${shortTopic}`, 'Gauging the overall sentiment'] },
          { status: 'Separating signal from noise...', details: ['Ignoring the obvious spam', 'Weighing what people actually think'] },
        )
      } else if (isCode) {
        phases.push(
          { status: 'Looking at the code...', details: ['Tracing the logic path', 'Spotting where it could break'] },
          { status: 'Considering approaches...', details: ['Weighing a couple of solutions', 'Picking the cleanest one'] },
          { status: 'Double-checking edge cases...', details: ['What happens with empty input?', 'Making sure it actually compiles'] },
        )
      } else if (isCompare) {
        phases.push(
          { status: 'Lining up both sides...', details: ['Listing the trade-offs', 'Being fair to each option'] },
          { status: 'Weighing the differences...', details: ['What matters most here?', 'Forming a clear verdict'] },
        )
      } else if (isHow) {
        phases.push(
          { status: 'Mapping out the steps...', details: ['Ordering things logically', 'Making sure nothing is skipped'] },
          { status: 'Anticipating snags...', details: ['Where do people usually get stuck?', 'Adding the gotchas to watch for'] },
        )
      } else if (isWhy || isOpinion) {
        phases.push(
          { status: 'Reasoning it out...', details: ['Following the cause and effect', 'Pressure-testing the logic'] },
          { status: 'Forming a clear take...', details: ['Deciding what is actually true', 'Avoiding wishy-washy answers'] },
        )
      } else {
        phases.push(
          { status: `Processing with ${codeMode ? (buildQuality === 'best' ? 'Kimi K2.6' : 'Qwen 3.5') : 'Kimi K2.5'}...`, details: ['Running inference on Chutes (SN64)', 'Pulling the relevant knowledge'] },
          { status: 'Cross-referencing...', details: ['Connecting the related ideas', 'Checking it holds together'] },
        )
      }

      // Common closing reasoning steps
      phases.push(
        { status: 'Structuring the answer...', details: ['Deciding what to lead with', 'Cutting anything that does not help'] },
        { status: 'Almost there...', details: ['Tightening up the wording', 'Putting the finishing touches on it'] },
      )
      
      let phaseIndex = 0
      setThinkingStatus(phases[0].status)
      setThinkingDetails(phases[0].details)
      setThinkingLog([phases[0].status])
      
      const interval = setInterval(() => {
        // Hold on the final phase instead of looping back to the start,
        // so the reasoning reads as a continuous progression.
        if (phaseIndex >= phases.length - 1) return
        phaseIndex += 1
        setThinkingStatus(phases[phaseIndex].status)
        setThinkingDetails(phases[phaseIndex].details)
        // Keep every step that has happened so far visible as a growing log.
        setThinkingLog((prev) => [...prev, phases[phaseIndex].status])
      }, 1300)
      phaseIntervalRef.current = interval
    }

    // Once the answer actually begins displaying, stop advancing the phases
    // and reset so the next turn starts fresh.
    if (hasStartedStreaming || status === 'ready' || status === 'error') {
      if (phaseIntervalRef.current) {
        clearInterval(phaseIntervalRef.current)
        phaseIntervalRef.current = null
      }
      if (status === 'ready' || status === 'error') {
        phaseSetupDoneRef.current = false
      }
    }
  }, [status, messages, hasStartedStreaming])

  // Buffer incoming content and display smoothly
  useEffect(() => {
    if (status === 'streaming' && messages.length > 0) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.role === 'assistant') {
        const content = typeof lastMsg.content === 'string' 
          ? lastMsg.content 
          : (lastMsg.parts?.find(p => p.type === 'text') as { text: string } | undefined)?.text || ''
        
        // Update buffer with new content
        bufferRef.current = content
        
        // Enforce a minimum "thinking" window so the behind-the-scenes reasoning
        // steps are actually visible, then stream. Once streaming begins we use a
        // catch-up chunk algorithm so the display never lags behind a fast stream.
        const elapsed = Date.now() - thinkingStartRef.current
        const remainingThink = MIN_THINKING_MS - elapsed
        if (content.length > 8 && !hasStartedStreaming && !streamingScheduledRef.current) {
          streamingScheduledRef.current = true
          const beginStreaming = () => {
            setHasStartedStreaming(true)
            
            // Display content in chunks for smooth appearance. The chunk size
            // scales with how far behind we are, so the display always catches
            // up to the model instead of lagging on long answers.
            if (!displayIntervalRef.current) {
              let displayIndex = 0
              displayIntervalRef.current = setInterval(() => {
                const targetLength = bufferRef.current.length
                if (displayIndex < targetLength) {
                  const backlog = targetLength - displayIndex
                  // Base smoothing chunk of ~10-18 chars, plus a catch-up factor
                  // (10% of the backlog) so we never fall behind a fast stream.
                  const base = Math.floor(Math.random() * 9) + 10
                  const catchUp = Math.floor(backlog * 0.1)
                  const chunkSize = Math.min(base + catchUp, backlog)
                  displayIndex = Math.min(displayIndex + chunkSize, targetLength)
                  setDisplayedContent(bufferRef.current.substring(0, displayIndex))
                } else {
                  // Keep syncing with buffer
                  setDisplayedContent(bufferRef.current)
                }
              }, 16) // ~60fps for very smooth display
            }
          }

          if (remainingThink > 0) {
            // Hold the thinking panel a little longer so more steps show
            setTimeout(beginStreaming, remainingThink)
          } else {
            beginStreaming()
          }
        }
      }
    }
    
    // Cleanup when streaming stops
    if (status === 'ready' || status === 'error') {
      if (displayIntervalRef.current) {
        clearInterval(displayIntervalRef.current)
        displayIntervalRef.current = null
      }
      // Ensure final content is displayed
      setDisplayedContent(bufferRef.current)
    }
    
    return () => {
      if (displayIntervalRef.current && (status === 'ready' || status === 'error')) {
        clearInterval(displayIntervalRef.current)
        displayIntervalRef.current = null
      }
    }
  }, [status, messages, hasStartedStreaming])

  // Check auth on mount (but don't redirect)
  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setCheckingAuth(false)
    }
    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [supabase.auth])

  // Load chats on mount (only if authenticated)
  useEffect(() => {
    if (user) {
      fetchChats()
      fetchUsage()
    } else {
      setLoadingChats(false)
    }
  }, [user])

  // Fetch usage info
  const fetchUsage = async () => {
    if (!user) return
    try {
      const res = await fetch(`/api/usage?userId=${user.id}`)
      if (res.ok) {
        const data = await res.json()
        setUsage(data)
      }
    } catch (err) {
      console.error('Failed to fetch usage:', err)
    }
  }

  const fetchChats = async () => {
    try {
      const res = await fetch('/api/chats')
      const data = await res.json()
      if (data.chats) {
        setChats(data.chats)
      }
    } catch (e) {
      console.error('Failed to fetch chats:', e)
    } finally {
      setLoadingChats(false)
    }
  }

  const loadChat = async (chatId: string) => {
    try {
      const res = await fetch(`/api/chats/${chatId}`)
      const data = await res.json()
      if (data.messages) {
        const uiMessages: UIMessage[] = data.messages.map((msg: DbMessage) => ({
          id: msg.id,
          role: msg.role,
          parts: [{ type: 'text', text: msg.content }],
        }))
        setMessages(uiMessages)
        setCurrentChatId(chatId)
        setNewsHeadlines([])
        setSidebarOpen(false)
        lastSavedMessageRef.current = null
      }
    } catch (e) {
      console.error('Failed to load chat:', e)
    }
  }

  const deleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fetch(`/api/chats/${chatId}`, { method: 'DELETE' })
      setChats(prev => prev.filter(c => c.id !== chatId))
      if (currentChatId === chatId) {
        setCurrentChatId(null)
        setMessages([])
      }
    } catch (e) {
      console.error('Failed to delete chat:', e)
    }
  }

  const saveMessage = async (chatId: string, role: 'user' | 'assistant', content: string) => {
    try {
      await fetch(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content }),
      })
      fetchChats()
    } catch (e) {
      console.error('Failed to save message:', e)
    }
  }

  const fetchNews = async () => {
    setLoadingNews(true)
    try {
      const res = await fetch('/api/news')
      const data = await res.json()
      if (data.headlines) {
        setNewsHeadlines(data.headlines)
      }
    } catch (e) {
      console.error('Failed to fetch news:', e)
    } finally {
      setLoadingNews(false)
    }
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  // Consider the user "pinned" only when they're essentially AT the bottom.
  // A small epsilon (not ~120px) is critical: during fast code streaming the
  // view sits right at the bottom, and a large threshold let the scroll event
  // re-pin the user the instant they tried to scroll up, fighting them back
  // down. With a tight epsilon, any deliberate scroll-up escapes the pin and
  // stays escaped until they return to the very bottom.
  const updatePinnedState = () => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    isPinnedToBottomRef.current = distanceFromBottom < 32
  }

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    updatePinnedState()

    // Position-based sync (covers scrollbar drags, keyboard, momentum).
    const onScroll = () => updatePinnedState()

    // Intent-based unpin: the instant the user scrolls UP (wheel or touch) we
    // stop following the stream, so the auto-scroll never fights them. This is
    // immediate and doesn't wait for a re-render, which is what made the
    // previous threshold-only approach feel like it "kept pulling down".
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) isPinnedToBottomRef.current = false
      else updatePinnedState()
    }
    let lastTouchY = 0
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0
      if (y > lastTouchY) isPinnedToBottomRef.current = false // finger down = scroll up
      lastTouchY = y
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
    }
  }, [])

  useEffect(() => {
    // Follow the stream/typewriter to the bottom ONLY while the user is pinned.
    // Depends on displayedContent (the 60fps typewriter reveal) so following is
    // smooth, and on messages for non-streamed updates.
    if (isPinnedToBottomRef.current) {
      scrollToBottom('auto')
    }
  }, [messages, displayedContent, newsHeadlines, generatedImages, generatingImage])

  // Track timestamps for new messages
  useEffect(() => {
    messages.forEach((msg) => {
      if (!messageTimestamps[msg.id]) {
        setMessageTimestamps(prev => ({ ...prev, [msg.id]: Date.now() }))
      }
    })
  }, [messages, messageTimestamps])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  // Mining-as-a-Service deep link: /?mine=<subnetId> starts a guided mining chat
  useEffect(() => {
    if (checkingAuth || miningTriggeredRef.current) return
    const mine = searchParams.get('mine')
    if (!mine) return
    const prompt = MINING_PROMPTS[mine]
    if (!prompt) return

    miningTriggeredRef.current = true
    // Clean the URL so a refresh doesn't re-trigger the prompt
    router.replace('/')
    setNewsHeadlines([])
    sendMessage({ text: prompt })
    setTimeout(() => fetchUsage(), 1000)
  }, [checkingAuth, searchParams])

  // Save assistant messages when streaming completes (only if logged in)
  useEffect(() => {
    if (status === 'ready' && !isReviewing && messages.length > 0 && currentChatId && user) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role === 'assistant') {
        const content = getMessageText(lastMessage)
        if (content && content !== lastSavedMessageRef.current) {
          lastSavedMessageRef.current = content
          saveMessage(currentChatId, 'assistant', content)
        }
      }
    }
  }, [status, messages, currentChatId, isReviewing])

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadingFile(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (data.success) {
        setUploadedFile({ name: data.fileName, content: data.extractedText })
      } else {
        alert(data.error || 'Failed to upload file')
      }
    } catch (err) {
      console.error('File upload error:', err)
      alert('Failed to upload file. Please try again.')
    } finally {
      setUploadingFile(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    
    const userMessage = input
    setInput('')

    // A brand-new request re-pins to the bottom so the incoming answer follows.
    isPinnedToBottomRef.current = true

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    // In Code mode, everything is a coding request — skip the media routing
    // so prompts like "make a function" aren't hijacked into image/video/music.
    if (!codeMode) {
      // If the user is asking for an image, route to image generation even
      // if they pressed the text/send button instead of the image button.
      if (isImageRequest(userMessage)) {
        handleGenerateImage(userMessage)
        return
      }

      // If the user is asking for a video, route to video generation.
      if (isVideoRequest(userMessage)) {
        handleGenerateVideo(userMessage)
        return
      }

      // If the user is asking for a song/music, route to music generation.
      if (isMusicRequest(userMessage)) {
        handleGenerateMusic(userMessage)
        return
      }
    }

    // Create a new chat if we don't have one AND user is logged in
    let chatId = currentChatId
    if (!chatId && user) {
      try {
        const res = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: userMessage.slice(0, 50) + (userMessage.length > 50 ? '...' : '') }),
        })
        const data = await res.json()
        if (data.chat) {
          chatId = data.chat.id
          setChats(prev => [data.chat, ...prev])
          setCurrentChatId(chatId)
        }
      } catch (e) {
        console.error('Failed to create chat:', e)
      }
    }
    
    // Save user message to DB (only if logged in and have a chat)
    if (chatId && user) {
      saveMessage(chatId, 'user', userMessage)
    }
    
    if (isNewsQuery(userMessage)) {
      fetchNews()
    } else {
      setNewsHeadlines([])
    }
    
    // If there's an uploaded file, include its content in the message
    let messageToSend = userMessage
    if (uploadedFile) {
      messageToSend = `[DOCUMENT: ${uploadedFile.name}]\n\n${uploadedFile.content}\n\n---\n\nUser question: ${userMessage}`
    }
    
 // Only Best Quality code builds enter the automatic validation + visual review gate.
 shouldReviewNextResponseRef.current = codeMode && buildQuality === 'best'
 editContextRef.current = codeMode && activeProject
   ? { code: activeProject.code, instruction: userMessage, quality: buildQuality }
   : null
 setReviewNotice(null)
    sendMessage(
      { text: messageToSend },
      { body: { codeMode, buildQuality, editingCode: activeProject?.code ?? null } }
    )
    
    // Refresh usage after sending
    setTimeout(() => fetchUsage(), 1000)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleNewChat = () => {
    if (!user) {
      setShowLoginPrompt(true)
      setTimeout(() => setShowLoginPrompt(false), 3000)
      return
    }
    setCurrentChatId(null)
    setMessages([])
    setNewsHeadlines([])
    lastSavedMessageRef.current = null
    // Leaving the current session ends any project-editing context, so the
    // next build starts fresh instead of silently editing the old project.
    setActiveProject(null)
    setSidebarOpen(false)
  }

  // Stop editing the current saved project and return to a fresh build,
  // without wiping the whole chat. Follow-up code-mode messages will create a
  // brand-new build again instead of editing the previous project.
  const handleExitEditing = () => {
    setActiveProject(null)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  // Save a generated build. If we're already editing a saved project, store a
  // new version of it; otherwise create a brand-new project.
  const handleSaveProject = async (code: string, language: string, publishedUrl?: string) => {
    if (!user) {
      setShowLoginPrompt(true)
      setTimeout(() => setShowLoginPrompt(false), 3000)
      throw new Error('Not signed in')
    }
    try {
      if (activeProject) {
        const res = await fetch(`/api/projects/${activeProject.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, language, publishedUrl }),
        })
        if (!res.ok) throw new Error('save failed')
        setActiveProject({ ...activeProject, code })
      } else {
        // Derive a friendly title from the first user prompt in this chat.
        const firstPrompt = messages.find(m => m.role === 'user')
        const title = (firstPrompt ? getMessageText(firstPrompt) : 'My project')
          .slice(0, 60)
          .trim() || 'My project'
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, code, language, publishedUrl }),
        })
        if (!res.ok) throw new Error('save failed')
        const data = await res.json()
        if (data.project) {
          setActiveProject({ id: data.project.id, title: data.project.title, code })
        }
      }
    } catch (e) {
      console.error('Failed to save project:', e)
      alert('Could not save your project. Please try again.')
      throw e
    }
  }

  // Load a saved project into the chat so the user can keep editing it.
  const handleOpenProject = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) throw new Error('load failed')
      const data = await res.json()
      const project = data.project
      if (!project) return

      // Reset the conversation to a fresh session anchored to this project.
      setCurrentChatId(null)
      lastSavedMessageRef.current = null
      setNewsHeadlines([])
      setCodeMode(true)
      setActiveProject({ id: project.id, title: project.title, code: project.current_code })
      setMessages([
        {
          id: `proj-${project.id}`,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: `Opened your saved project **${project.title}**. Here's where you left off — tell me what you'd like to change and I'll edit this version.\n\n\`\`\`html\n${project.current_code}\n\`\`\``,
            },
          ],
        } as unknown as (typeof messages)[number],
      ])
      setShowProjectsPanel(false)
      setSidebarOpen(false)
    } catch (e) {
      console.error('Failed to open project:', e)
      alert('Could not open that project. Please try again.')
    }
  }

  // Restore an older version: fetch its full code, save it as the newest
  // version of the project, then open the project to continue editing.
  const handleRestoreVersion = async (projectId: string, versionId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/versions/${versionId}`)
      if (!res.ok) throw new Error('load failed')
      const data = await res.json()
      const code = data.version?.code
      if (!code) return

      await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, label: `Restored v${data.version.version_number}` }),
      })
      await handleOpenProject(projectId)
    } catch (e) {
      console.error('Failed to restore version:', e)
      alert('Could not restore that version. Please try again.')
    }
  }

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion)
    setTimeout(() => {
      const form = document.querySelector('form')
      form?.requestSubmit()
    }, 100)
  }

  // Weather button: get the user's location, fetch weather (Zeus SN18 with
  // Open-Meteo fallback), then ask BlueTAO to summarize it conversationally.
  const handleWeather = () => {
    if (fetchingWeather || isLoading) return

    if (!('geolocation' in navigator)) {
      sendMessage({ text: "I tried to check the weather but my browser doesn't support location access. Can you tell me what city you're in so I can give you the weather?" })
      return
    }

    setFetchingWeather(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords
          const res = await fetch('/api/weather', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude, longitude }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Weather lookup failed')

          const sourceLabel = data.source === 'zeus' ? 'the Zeus weather subnet (Bittensor SN18)' : 'live weather data'
          const summary = `Here is the current weather data from ${sourceLabel} for my location (lat ${latitude.toFixed(2)}, lon ${longitude.toFixed(2)}): ${JSON.stringify(data)}. Please give me a friendly, concise summary of the current weather and today's high/low. Mention it came from the Zeus subnet if the source is zeus.`
          sendMessage({ text: summary })
        } catch (err) {
          console.log('[v0] Weather error:', err)
          sendMessage({ text: "I couldn't fetch the weather just now. Want me to try again, or tell me your city and I'll look it up?" })
        } finally {
          setFetchingWeather(false)
        }
      },
      (geoErr) => {
        console.log('[v0] Geolocation denied/failed:', geoErr)
        setFetchingWeather(false)
        sendMessage({ text: "I wasn't able to access your location for the weather. What city are you in? I'll grab the forecast for you." })
      },
      { timeout: 10000 }
    )
  }

  // Re-ask the previous question with web search enabled
  const handleIncludeRecentHistory = (userQuestion: string) => {
    if (isLoading) return
    const enhancedQuery = `[SEARCH THE WEB FOR RECENT DATA] ${userQuestion}`
    sendMessage({ text: enhancedQuery })
  }

  // Generate image from prompt
  const handleGenerateImage = async (prompt: string) => {
    if (!prompt.trim() || generatingImage) return
    
    setGeneratingImage(true)
    setCurrentImagePrompt(prompt)
    
    try {
      const response = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        const errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error) || 'Image generation failed'
        throw new Error(errorMsg)
      }
      
      if (data.imageUrl) {
        const newImage = {
          id: crypto.randomUUID(),
          prompt: prompt,
          imageUrl: data.imageUrl,
          createdAt: Date.now()
        }
        setGeneratedImages(prev => {
          const updated = [...prev, newImage]
          return updated
        })
        // Force scroll after state update
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 100)
      }
    } catch (error) {
      console.error('[Image Gen] Error:', error)
      alert(error instanceof Error ? error.message : 'Failed to generate image')
    } finally {
      setGeneratingImage(false)
      setCurrentImagePrompt(null)
    }
  }

  // Check if message is an image generation request
  const isImageRequest = (text: string) => {
    const lowerText = text.toLowerCase().trim()
    return /\b(draw|sketch|paint|illustrate)\b/.test(lowerText) ||
           lowerText.includes('generate image') ||
           lowerText.includes('generate an image') ||
           lowerText.includes('generate a image') ||
           lowerText.includes('create image') ||
           lowerText.includes('create an image') ||
           lowerText.includes('make image') ||
           lowerText.includes('make an image') ||
           lowerText.includes('make me an image') ||
           lowerText.includes('draw me') ||
           lowerText.includes('generate picture') ||
           lowerText.includes('generate a picture') ||
           lowerText.includes('create picture') ||
           lowerText.includes('create a picture') ||
           lowerText.includes('make a picture') ||
           lowerText.includes('picture of') ||
           lowerText.includes('image of') ||
           lowerText.includes('photo of') ||
           lowerText.includes('a photo of') ||
           lowerText.includes('render an image') ||
           lowerText.includes('show me a picture') ||
           lowerText.includes('show me an image')
  }

  const handleGenerateMusic = async (prompt: string) => {
    if (!prompt.trim() || generatingMusic) return

    setGeneratingMusic(true)
    setCurrentMusicPrompt(prompt)

    try {
      const response = await fetch('/api/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })

      const data = await response.json()

      if (!response.ok) {
        const errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error) || 'Music generation failed'
        throw new Error(errorMsg)
      }

      if (data.audioUrl) {
        const newTrack = {
          id: crypto.randomUUID(),
          prompt: prompt,
          audioUrl: data.audioUrl,
          createdAt: Date.now(),
        }
        setGeneratedMusic(prev => [...prev, newTrack])
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 100)
      }
    } catch (error) {
      console.error('[Music Gen] Error:', error)
      alert(error instanceof Error ? error.message : 'Failed to generate music')
    } finally {
      setGeneratingMusic(false)
      setCurrentMusicPrompt(null)
    }
  }

  // Check if message is a music generation request
  const isMusicRequest = (text: string) => {
    const lowerText = text.toLowerCase().trim()
    return /\b(compose|write me a song|make me a song|create a song|generate a song|write a song|make a song)\b/.test(lowerText) ||
           lowerText.includes('write a tune') ||
           lowerText.includes('make music') ||
           lowerText.includes('generate music') ||
           lowerText.includes('create music') ||
           lowerText.includes('make a beat') ||
           lowerText.includes('make a track') ||
           lowerText.includes('generate a track') ||
           lowerText.includes('compose music') ||
           lowerText.includes('song about') ||
           lowerText.includes('a song about') ||
           lowerText.includes('write a jingle') ||
           lowerText.includes('make a jingle')
  }

  const handleGenerateVideo = async (prompt: string) => {
    if (!prompt.trim() || generatingVideo) return

    setGeneratingVideo(true)
    setCurrentVideoPrompt(prompt)

    try {
      const response = await fetch('/api/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })

      const data = await response.json()

      if (!response.ok) {
        const errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error) || 'Video generation failed'
        throw new Error(errorMsg)
      }

      if (data.videoUrl) {
        const newVideo = {
          id: crypto.randomUUID(),
          prompt: prompt,
          videoUrl: data.videoUrl,
          createdAt: Date.now(),
        }
        setGeneratedVideos(prev => [...prev, newVideo])
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
        }, 100)
      }
    } catch (error) {
      console.error('[Video Gen] Error:', error)
      alert(error instanceof Error ? error.message : 'Failed to generate video')
    } finally {
      setGeneratingVideo(false)
      setCurrentVideoPrompt(null)
    }
  }

  // Check if message is a video generation request
  const isVideoRequest = (text: string) => {
    const lowerText = text.toLowerCase().trim()
    return /\b(make|create|generate|produce|render)\s+(me\s+)?(a\s+)?(short\s+)?(video|clip|animation|movie)\b/.test(lowerText) ||
           lowerText.includes('video of') ||
           lowerText.includes('animate ') ||
           lowerText.includes('text to video') ||
           lowerText.includes('text-to-video') ||
           lowerText.includes('make a gif') ||
           lowerText.includes('video clip')
  }

  const suggestions = [
    { icon: Sparkles, label: 'Surprise me' },
  ]

  // Show loading while checking auth
  if (checkingAuth) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Linear-style ambient blue glow */}
      <div className="app-glow" aria-hidden="true" />
      {/* Hidden file input - always rendered so ref is available */}
      {/* Hidden file input - always rendered so ref is available */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".pdf,.docx,.txt,.md"
        className="hidden"
      />
      
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/20 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed lg:relative inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-sidebar-border flex flex-col transform transition-transform duration-200 ease-in-out",
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-4 border-b border-sidebar-border">
            <button
              onClick={handleNewChat}
              className="group flex items-center gap-2.5"
              aria-label="BlueTAO home"
            >
              <span className="relative flex items-center justify-center">
                <span
                  className="absolute inset-0 -z-10 rounded-full bg-primary/40 blur-lg opacity-70 group-hover:opacity-100 transition-opacity"
                  aria-hidden="true"
                />
                <BlueTaoLogo className="w-8 h-8 text-primary drop-shadow-[0_0_12px_var(--primary)]" />
              </span>
              <span className="text-4xl font-extrabold tracking-tight leading-none text-primary drop-shadow-[0_0_18px_color-mix(in_oklch,var(--primary)_55%,transparent)]">
                Blue<span className="text-foreground">TAO</span>
              </span>
            </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-sidebar-foreground"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <Button
            onClick={handleNewChat}
            className="w-full justify-start gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </Button>
          {showLoginPrompt && (
            <p className="text-xs text-amber-600 mt-2 text-center animate-pulse">
              Log in to create a chat history
            </p>
          )}
        </div>

        {/* Primary navigation — moved from the top header. Minimal, lowercase,
            uniform-muted rows with a single gold accent, saygm-style. */}
        <nav className="px-3 pb-3 space-y-0.5">
          {user && (
            <button
              onClick={() => {
                setCodeMode(true)
                setSidebarOpen(false)
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-medium text-[var(--gold)] hover:bg-sidebar-accent hover:text-[var(--gold)] transition-colors"
            >
              <Code className="w-5 h-5 flex-shrink-0" />
              code
            </button>
          )}
          {user && (
            <button
              onClick={() => {
                setShowProjectsPanel(true)
                setSidebarOpen(false)
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-medium text-[var(--gold)] hover:bg-sidebar-accent hover:text-[var(--gold)] transition-colors"
            >
              <FolderCode className="w-5 h-5 flex-shrink-0" />
              projects
            </button>
          )}
          <Link href="/detect" onClick={() => setSidebarOpen(false)}>
            <span className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-medium text-[var(--gold)] hover:bg-sidebar-accent hover:text-[var(--gold)] transition-colors">
              <Sparkles className="w-5 h-5 flex-shrink-0" />
              is it ai?
            </span>
          </Link>
          <Link href="/mining" onClick={() => setSidebarOpen(false)}>
            <span className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-medium text-[var(--gold)] hover:bg-sidebar-accent hover:text-[var(--gold)] transition-colors">
              <Pickaxe className="w-5 h-5 flex-shrink-0" />
              mining
            </span>
          </Link>
          <Link href="/fun" onClick={() => setSidebarOpen(false)}>
            <span className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-medium text-[var(--gold)] hover:bg-sidebar-accent hover:text-[var(--gold)] transition-colors">
              <PartyPopper className="w-5 h-5 flex-shrink-0" />
              fun
            </span>
          </Link>
          <Link href="/developers" onClick={() => setSidebarOpen(false)}>
            <span className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-base font-medium text-[var(--gold)] hover:bg-sidebar-accent hover:text-[var(--gold)] transition-colors">
              <Code className="w-5 h-5 flex-shrink-0" />
              embed
            </span>
          </Link>
        </nav>

        {/* Usage Indicator */}
        {user && usage && (
          <div className="px-3 pb-3">
            <div className="bg-sidebar-accent/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-sidebar-foreground capitalize">{usage.tier} Plan</span>
                <Link href="/pricing">
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-primary hover:text-primary/80 p-0">
                    <Zap className="w-3 h-3 mr-1" />
                    Upgrade
                  </Button>
                </Link>
              </div>
              <div className="w-full bg-sidebar-border rounded-full h-1.5 mb-1">
                <div 
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    usage.remaining < usage.messageLimit * 0.1 ? "bg-red-500" :
                    usage.remaining < usage.messageLimit * 0.3 ? "bg-amber-500" : "bg-primary"
                  )}
                  style={{ width: `${Math.min(100, (usage.messageCount / usage.messageLimit) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {usage.remaining} of {usage.messageLimit} messages left today
              </p>
            </div>
          </div>
        )}

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto p-2">
          <p className="px-2 pt-1 pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Chats:
          </p>
          {!user ? (
            <div className="text-center py-8 px-4">
              <p className="text-muted-foreground text-sm mb-3">Sign in to save your chat history</p>
              <Button
                onClick={() => router.push('/auth/login')}
                variant="outline"
                size="sm"
                className="w-full border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent"
              >
                Sign in
              </Button>
            </div>
          ) : loadingChats ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : chats.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No conversations yet
            </div>
          ) : (
            <div className="space-y-1">
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  onClick={() => loadChat(chat.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors group cursor-pointer",
                    currentChatId === chat.id
                      ? "bg-sidebar-accent text-sidebar-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <MessageSquare className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 truncate">{chat.title}</span>
                  <button
                    onClick={(e) => deleteChat(chat.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-sidebar-accent rounded transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* User & Sign Out */}
        <div className="p-3 border-t border-sidebar-border">
          {user ? (
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full justify-start gap-2 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => router.push('/auth/login')}
              className="w-full justify-start gap-2 text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <User className="w-4 h-4" />
              Sign in
            </Button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Animated Ocean Background */}
        <AnimatedOceanBackground />

        {/* Limit Warning Banner */}
        {showLimitWarning && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full mx-4">
            <div className="bg-amber-500/90 backdrop-blur-sm text-white rounded-xl p-4 shadow-lg">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Daily Limit Reached</h3>
                  <p className="text-sm text-white/90">
                    You&apos;ve used all your messages for today. Upgrade your plan for more messages.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowLimitWarning(false)}
                  className="text-white hover:bg-white/20 -mt-1 -mr-1"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex gap-2 mt-3">
                <Link href="/pricing" className="flex-1">
                  <Button className="w-full bg-white text-amber-600 hover:bg-white/90">
                    <Zap className="w-4 h-4 mr-2" />
                    Upgrade Now
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  onClick={() => setShowLimitWarning(false)}
                  className="text-white hover:bg-white/20"
                >
                  Later
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="relative z-10 flex items-center justify-between px-4 lg:px-6 py-4 border-b border-border/30 bg-background/80 backdrop-blur-md">
          {/* Left: saygm-style logo lockup — gold mark + lowercase wordmark */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-foreground"
            >
              <Menu className="w-5 h-5" />
            </Button>
            <button
              onClick={handleNewChat}
              className="flex items-center gap-2.5 group"
            >
              <BlueTaoLogo className="w-7 h-7 text-[var(--gold)] drop-shadow-[0_0_12px_var(--gold)]" />
              <span className="text-lg font-semibold tracking-tight text-foreground group-hover:text-[var(--gold)] transition-colors hidden sm:block">
                bluetao
              </span>
            </button>
          </div>

          {/* Right: quiet "new chat" plus a single gold accent CTA. All other
              destinations now live in the left sidebar. */}
          <nav className="flex items-center gap-1">
            <button
              onClick={handleNewChat}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-foreground hover:text-[var(--gold)] transition-colors"
            >
              <Plus className="w-4 h-4" />
              new chat
            </button>

            {user ? (
              <>
                <Link href="/pricing" className="hidden sm:block ml-1">
                  <span className="flex items-center gap-1.5 rounded-full bg-[var(--gold)] px-4 py-1.5 text-sm font-medium text-[var(--gold-foreground)] shadow-sm hover:opacity-90 transition-opacity">
                    <Zap className="w-4 h-4" />
                    upgrade
                  </span>
                </Link>
                <span className="text-sm font-medium text-foreground hidden sm:block ml-2">
                  {user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0]}
                </span>
              </>
            ) : (
              <button
                onClick={() => router.push('/auth/login')}
                className="ml-1 rounded-full bg-[var(--gold)] px-4 py-1.5 text-sm font-medium text-[var(--gold-foreground)] shadow-sm hover:opacity-90 transition-opacity"
              >
                sign in
              </button>
            )}
          </nav>
        </header>

      {/* Main Content */}
      <main ref={scrollContainerRef} className="relative z-10 flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4">
                {messages.length === 0 && generatedImages.length === 0 && !generatingImage && generatedMusic.length === 0 && !generatingMusic && generatedVideos.length === 0 && !generatingVideo ? (
              /* Welcome Screen */
              <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] text-center">
                {/* Logo Icon */}
                {/* saygm-inspired radiating sunburst texture behind the hero */}
                <div className="hero-sunburst" aria-hidden="true" />

                <div className="mb-8 relative">
                  <div className="absolute inset-0 -z-10 blur-2xl opacity-60 bg-primary/30 rounded-full" aria-hidden="true" />
                  <BlueTaoLogo className="w-20 h-20 text-primary drop-shadow-[0_0_25px_var(--primary)]" />
                </div>

                {/* Title: bold sans paired with a serif-italic gold accent word */}
                <h1 className="text-5xl md:text-7xl text-foreground font-bold tracking-tighter mb-4 text-balance hero-glow">
                  Ask{' '}
                  <span className="font-serif italic font-medium tracking-normal text-[var(--gold)] gold-glow">
                    anything
                  </span>
                </h1>
                <p className="text-muted-foreground text-lg mb-12 max-w-md text-pretty">
                  Intelligent answers powered by{' '}
                  <span className="font-serif italic text-foreground/90">decentralized AI</span>
                </p>
                
                {/* Input Area */}
                <div className="w-full max-w-2xl mb-6">
                  {/* Mode switcher: Chat vs. BlueTAO Code */}
                  <div className="mb-3 flex justify-center">
                    <ModeToggle codeMode={codeMode} setCodeMode={setCodeMode} />
                  </div>
                  {codeMode && (
                    <div className="mb-3 flex flex-col items-center gap-2">
                      <span className="text-sm text-muted-foreground">Do you want this built:</span>
                      <BuildQualityToggle quality={buildQuality} setQuality={setBuildQuality} />
                    </div>
                  )}

                  {/* Build-mode helper banner. Switches to an "editing" state
                      when the user is continuing a saved project, so it's always
                      clear whether the next message builds new or edits. */}
                  {codeMode && activeProject && (
                    <div className="mb-3 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                      <Pencil className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span className="min-w-0 flex-1">
                        <strong>Editing:</strong> <span className="truncate">{activeProject.title}</span>
                        {' '}&mdash; tell me what to change and I&apos;ll update this project.
                      </span>
                      <button
                        type="button"
                        onClick={handleExitEditing}
                        className="flex-shrink-0 rounded-full border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                      >
                        Start a new build
                      </button>
                    </div>
                  )}
                  {codeMode && !activeProject && (
                    <div className="mb-3 flex items-start gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-left text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600 dark:text-sky-400" />
                      <span>
                        <strong>Build mode is on.</strong> Describe a website or app in plain English
                        {' '}&mdash; you&apos;ll see it come to life in a live preview, and you can download or copy it. No coding needed.
                      </span>
                    </div>
                  )}

                  {/* File upload indicator */}
                  {uploadedFile && (
                    <div className="mb-2 flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-sm text-foreground">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="truncate max-w-[200px]">{uploadedFile.name}</span>
                      <button
                        onClick={() => setUploadedFile(null)}
                        className="ml-auto text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <form onSubmit={handleSubmit} className="relative">
                    <div className="glass-panel relative flex items-center rounded-full transition-all">
                      <Button
                        type="button"
                        size="icon"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingFile}
                        title="Upload a file (PDF, DOCX, TXT, MD)"
                        className="ml-2 h-9 w-9 rounded-full bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {uploadingFile ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Paperclip className="w-5 h-5" />
                        )}
                      </Button>
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={codeMode ? "What would you like to BUILD today?" : uploadedFile ? "Ask about your file..." : "Ask anything privately..."}
                        disabled={isLoading}
                        className="flex-1 bg-transparent px-4 py-4 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 text-lg"
                      />
                      {!codeMode && (
                      <>
                      <Tip label="Video">
                        <Button
                          type="button"
                          size="icon"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const prompt = input.trim()
                            if (prompt) {
                              setInput('') // Clear input immediately
                              handleGenerateVideo(prompt)
                            }
                          }}
                          disabled={!input.trim() || isLoading || generatingVideo}
                          className={cn(
                            'mr-1 h-10 w-10 rounded-full transition-all',
                            input.trim() && !isLoading && !generatingVideo
                              ? 'bg-rose-600 text-white hover:bg-rose-500'
                              : 'bg-rose-500/25 text-rose-300 disabled:opacity-100'
                          )}
                        >
                          {generatingVideo ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Film className="w-5 h-5" />
                          )}
                        </Button>
                      </Tip>
                      <Tip label="Music">
                        <Button
                          type="button"
                          size="icon"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const prompt = input.trim()
                            if (prompt) {
                              setInput('') // Clear input immediately
                              handleGenerateMusic(prompt)
                            }
                          }}
                          disabled={!input.trim() || isLoading || generatingMusic}
                          className={cn(
                            'mr-1 h-10 w-10 rounded-full transition-all',
                            input.trim() && !isLoading && !generatingMusic
                              ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                              : 'bg-emerald-500/25 text-emerald-300 disabled:opacity-100'
                          )}
                        >
                          {generatingMusic ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Music className="w-5 h-5" />
                          )}
                        </Button>
                      </Tip>
                      <Tip label="Image">
                        <Button
                          type="button"
                          size="icon"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const prompt = input.trim()
                            if (prompt) {
                              setInput('') // Clear input immediately
                              handleGenerateImage(prompt)
                            }
                          }}
                          disabled={!input.trim() || isLoading || generatingImage}
                          className={cn(
                            'mr-1 h-10 w-10 rounded-full transition-all',
                            input.trim() && !isLoading && !generatingImage
                              ? 'bg-violet-600 text-white hover:bg-violet-500'
                              : 'bg-violet-500/25 text-violet-300 disabled:opacity-100'
                          )}
                        >
                          {generatingImage ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <ImageIcon className="w-5 h-5" />
                          )}
                        </Button>
                      </Tip>
                      </>
                      )}
                      <Tip label={codeMode ? 'Build' : 'Text'}>
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!input.trim() || isLoading}
                        className={cn(
                          'mr-2 h-10 w-10 rounded-full transition-all',
                          input.trim() && !isLoading
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {isLoading ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Send className="w-5 h-5" />
                        )}
                      </Button>
                      </Tip>
                    </div>
                  </form>
                </div>

                {/* Suggestion Pills */}
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    onClick={handleWeather}
                    disabled={fetchingWeather || isLoading}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-border/50 bg-card/80 backdrop-blur-sm text-muted-foreground hover:bg-accent hover:text-foreground hover:border-primary/30 transition-all text-sm disabled:opacity-60"
                  >
                    {fetchingWeather ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CloudSun className="w-4 h-4 text-sky-500" />
                    )}
                    Weather
                  </button>
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion.label}
                      onClick={() => handleSuggestionClick(suggestion.label)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-border/50 bg-card/80 backdrop-blur-sm text-muted-foreground hover:bg-accent hover:text-foreground hover:border-primary/30 transition-all text-sm"
                    >
                      <suggestion.icon className="w-4 h-4" />
                      {suggestion.label}
                    </button>
                  ))}
                </div>

                {/* Starter template gallery — only in Build mode when starting
                    a fresh build. Clicking a card auto-sends a rich prompt. */}
                {codeMode && !activeProject && (
                  <div className="mt-8 flex justify-center">
                    <CodeTemplates onSelect={handleSuggestionClick} />
                  </div>
                )}

                {/* Mining CTA */}
                <div className="mt-16">
                  <Link
                    href="/mining"
                    className="text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300 text-sm font-medium flex items-center gap-1.5 transition-colors"
                  >
                    <Pickaxe className="w-4 h-4" />
                    Make money Mining TAO Subnets
                  </Link>
                </div>

                {/* Footer Link */}
                <div className="mt-4">
                  <button className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 transition-colors">
                    Learn more about BlueTAO
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              /* Chat View */
              <div className="py-6">
                <div className="space-y-6">
                  {/* Unified timeline: merge messages and images chronologically */}
                  {(() => {
                    // Create timeline items with timestamps
                    const timelineItems: Array<{type: 'message' | 'image' | 'music' | 'video', data: typeof messages[0] | typeof generatedImages[0] | typeof generatedMusic[0] | typeof generatedVideos[0], timestamp: number, idx: number}> = []
                    
                    messages.forEach((msg, idx) => {
                      // Use tracked timestamp or fallback to a very old time for existing messages
                      const timestamp = messageTimestamps[msg.id] || 0
                      timelineItems.push({ type: 'message', data: msg, timestamp, idx })
                    })
                    
                    generatedImages.forEach((img, idx) => {
                      timelineItems.push({ type: 'image', data: img, timestamp: img.createdAt, idx })
                    })

                    generatedMusic.forEach((track, idx) => {
                      timelineItems.push({ type: 'music', data: track, timestamp: track.createdAt, idx })
                    })

                    generatedVideos.forEach((vid, idx) => {
                      timelineItems.push({ type: 'video', data: vid, timestamp: vid.createdAt, idx })
                    })
                    
                    // Sort by timestamp
                    timelineItems.sort((a, b) => a.timestamp - b.timestamp)
                    
                    return timelineItems.map((item) => {
                      if (item.type === 'image') {
                        const img = item.data as typeof generatedImages[0]
                        return (
                          <div key={`img-${img.id}`} className="flex gap-4">
                            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-accent flex items-center justify-center">
                              <ImageIcon className="w-5 h-5 text-primary" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm text-muted-foreground mb-2">{img.prompt}</p>
                              <div className="relative rounded-lg overflow-hidden border border-border max-w-md">
                                <img 
                                  src={img.imageUrl} 
                                  alt={img.prompt} 
                                  className="w-full h-auto"
                                />
                                <button
                                  onClick={() => setGeneratedImages(prev => prev.filter(i => i.id !== img.id))}
                                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      } else if (item.type === 'music') {
                        const track = item.data as typeof generatedMusic[0]
                        return (
                          <div key={`music-${track.id}`} className="flex gap-4">
                            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-accent flex items-center justify-center">
                              <Music className="w-5 h-5 text-emerald-600" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm text-muted-foreground mb-2">{track.prompt}</p>
                              <div className="relative rounded-lg border border-border bg-card p-4 max-w-md">
                                <div className="flex items-center gap-2 mb-3 text-emerald-600">
                                  <Music className="w-4 h-4" />
                                  <span className="text-xs font-medium">Generated with ACE-Step on Bittensor SN64</span>
                                </div>
                                <audio controls src={track.audioUrl} className="w-full">
                                  Your browser does not support the audio element.
                                </audio>
                                <div className="flex items-center justify-between mt-3">
                                  <a
                                    href={track.audioUrl}
                                    download={`bluetao-song-${track.id.slice(0, 8)}.mp3`}
                                    className="text-xs text-sky-600 dark:text-sky-400 hover:underline"
                                  >
                                    Download MP3
                                  </a>
                                  <button
                                    onClick={() => setGeneratedMusic(prev => prev.filter(t => t.id !== track.id))}
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      } else if (item.type === 'video') {
                        const vid = item.data as typeof generatedVideos[0]
                        return (
                          <div key={`video-${vid.id}`} className="flex gap-4">
                            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-accent flex items-center justify-center">
                              <Film className="w-5 h-5 text-rose-600" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm text-muted-foreground mb-2">{vid.prompt}</p>
                              <div className="relative rounded-lg border border-border bg-card p-4 max-w-md">
                                <div className="flex items-center gap-2 mb-3 text-rose-600">
                                  <Film className="w-4 h-4" />
                                  <span className="text-xs font-medium">Generated with LTX-Video on Bittensor SN64</span>
                                </div>
                                <video
                                  controls
                                  autoPlay
                                  loop
                                  muted
                                  playsInline
                                  src={vid.videoUrl}
                                  className="w-full rounded-md"
                                >
                                  Your browser does not support the video element.
                                </video>
                                <div className="flex items-center justify-between mt-3">
                                  <a
                                    href={vid.videoUrl}
                                    download={`bluetao-video-${vid.id.slice(0, 8)}.mp4`}
                                    className="text-xs text-sky-600 dark:text-sky-400 hover:underline"
                                  >
                                    Download MP4
                                  </a>
                                  <button
                                    onClick={() => setGeneratedVideos(prev => prev.filter(v => v.id !== vid.id))}
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      } else {
                        const message = item.data as typeof messages[0]
                        const idx = item.idx
                        const isLastAssistantMessage = message.role === 'assistant' && idx === messages.length - 1
                        const isCurrentlyStreaming = isLastAssistantMessage && status === 'streaming'
                        
                        // For the last assistant message during streaming, use buffered content
                        // Hide it completely until we have enough buffered content
                        if ((isCurrentlyStreaming && !hasStartedStreaming) || (isReviewing && pendingReviewMessage?.id === message.id)) {
                          return null // Keep draft builds hidden until streaming/review is complete.
                        }
                        
                        // Create a modified message with buffered content for smooth display
                        const displayMessage = isCurrentlyStreaming && hasStartedStreaming
                          ? { ...message, content: displayedContent }
                          : message
                        
                        return (
                          <div key={message.id}>
                          <MessageBubble
                            message={displayMessage}
                            onSpeak={speak}
                            speakingId={speakingId}
                            ttsLoadingId={ttsLoadingId}
                            onSaveCode={user ? handleSaveProject : undefined}
                            saveActive={!!activeProject}
                            projectId={activeProject?.id}
                          />
                            {message.role === 'user' && 
                             isNewsQuery(getMessageText(message)) && 
                             idx === messages.length - 1 && (
                              <NewsPanel 
                                headlines={newsHeadlines} 
                                loading={loadingNews} 
                              />
                            )}
                            {/* Include recent history button after assistant messages */}
                            {message.role === 'assistant' && !isLoading && idx > 0 && (
                              <div className="flex gap-4 mt-2">
                                <div className="w-9" /> {/* Spacer to align with message */}
                                <button
                                  onClick={() => {
                                    // Find the user question that preceded this assistant message
                                    const userQuestion = getMessageText(messages[idx - 1])
                                    if (userQuestion) {
                                      handleIncludeRecentHistory(userQuestion)
                                    }
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-full border border-border transition-colors"
                                >
                                  <Globe className="w-3.5 h-3.5" />
                                  Include recent history
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      }
                    })
                  })()}
                  {/* Image generating indicator */}
                  {generatingImage && (
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center animate-pulse">
                        <ImageIcon className="w-5 h-5 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-foreground mb-2 font-medium">{currentImagePrompt}</p>
                        <div className="flex items-center gap-3 text-purple-600 bg-purple-50 rounded-lg px-4 py-3">
                          <div className="relative">
                            <Loader2 className="w-5 h-5 animate-spin" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">Generating image...</span>
                            <span className="text-xs text-purple-400">This may take 5-10 seconds</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Music generating indicator */}
                  {generatingMusic && (
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center animate-pulse">
                        <Music className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-foreground mb-2 font-medium">{currentMusicPrompt}</p>
                        <div className="flex items-center gap-3 text-emerald-600 bg-emerald-50 rounded-lg px-4 py-3">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">Composing music...</span>
                            <span className="text-xs text-emerald-500">This may take 30-40 seconds</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Video generating indicator */}
                  {generatingVideo && (
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center animate-pulse">
                        <Film className="w-5 h-5 text-rose-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-foreground mb-2 font-medium">{currentVideoPrompt}</p>
                        <div className="flex items-center gap-3 text-rose-600 bg-rose-50 rounded-lg px-4 py-3">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">Generating video...</span>
                            <span className="text-xs text-rose-500">This may take 1-3 minutes</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
{(isReviewing || status === 'submitted' || (status === 'streaming' && !hasStartedStreaming)) && !isNewsQuery(getMessageText(messages[messages.length - 1] || { parts: [] } as UIMessage)) && (
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-950/30 dark:to-blue-950/30 rounded-2xl p-4 border border-sky-100 dark:border-sky-800/50">
                    {/* Completed reasoning steps stay visible as a growing log */}
                    {thinkingLog.length > 1 && (
                      <div className="space-y-1.5 mb-3">
                        {thinkingLog.slice(0, -1).map((step, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs text-muted-foreground/80 animate-in fade-in slide-in-from-left-1 duration-300"
                          >
                            <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                            <span>{step}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-3 mb-3">
                      <div className="relative">
                        <div className="w-2 h-2 bg-sky-500 rounded-full animate-ping absolute" />
                        <div className="w-2 h-2 bg-sky-500 rounded-full" />
                      </div>
                      <span className="text-sm font-semibold text-sky-700 dark:text-sky-300 transition-all duration-500">
                        {isReviewing
                          ? reviewPhase === 'validating'
                            ? 'Validating the build…'
                            : reviewPhase === 'reviewing'
                              ? 'Reviewing desktop and mobile previews…'
                              : reviewPhase === 'repairing'
                                ? 'Fixing issues found…'
                                : 'Final quality check…'
                          : liveReasoning ? 'Thinking it through...' : thinkingStatus}
                      </span>
                      <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">
                        {elapsedSeconds >= 60
                          ? `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
                          : `${elapsedSeconds}s`}
                      </span>
                    </div>
                    {!isReviewing && liveReasoning ? (
                      // Real model thinking — show the most recent portion, live.
                      <div
                        className="ml-5 max-h-40 overflow-hidden text-xs text-muted-foreground/90 whitespace-pre-wrap leading-relaxed"
                        style={{
                          WebkitMaskImage:
                            'linear-gradient(to bottom, transparent 0, black 24px)',
                          maskImage:
                            'linear-gradient(to bottom, transparent 0, black 24px)',
                        }}
                      >
                        {liveReasoning.slice(-900)}
                      </div>
                    ) : (
                      <div className="space-y-2 ml-5">
                        {(isReviewing
                          ? reviewPhase === 'validating'
                            ? ['Checking HTML, JavaScript, links, images, and accessibility']
                            : reviewPhase === 'reviewing'
                              ? ['Rendering at desktop and mobile sizes', 'Checking layout, contrast, spacing, and overflow']
                              : reviewPhase === 'repairing'
                                ? ['Applying one focused repair pass', 'Preserving working features and the chosen design direction']
                                : ['Re-running deterministic checks', 'Preparing the reviewed preview']
                          : thinkingDetails).map((detail, i) => (
                          <div 
                            key={i} 
                            className="flex items-center gap-2 text-xs text-muted-foreground animate-in fade-in slide-in-from-left-2 duration-300"
                            style={{ animationDelay: `${i * 150}ms` }}
                          >
                            <div className="w-1 h-1 bg-sky-400 rounded-full" />
                            <span>{detail}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 pt-3 border-t border-sky-200/50 dark:border-sky-700/50">
                      <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                        Connected to Bittensor&apos;s decentralized AI network
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {reviewNotice && !isReviewing && (
                <div role="status" className="ml-12 flex items-center gap-2 text-xs font-medium text-sky-700 dark:text-sky-300">
                  <Check className="h-3.5 w-3.5" />
                  <span>{reviewNotice}</span>
                </div>
              )}
              {/* Stop button - visible during entire loading/streaming phase */}
              {isLoading && (
                <div className="flex justify-center mt-4">
                  <button
                    onClick={() => stop()}
                    className="px-4 py-2 text-sm bg-red-100 hover:bg-red-200 text-red-600 rounded-full transition-colors flex items-center gap-2 shadow-sm"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Stop generating
                  </button>
                </div>
              )}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Input Area - Chat Mode */}
                {(messages.length > 0 || generatedImages.length > 0 || generatingImage || generatedMusic.length > 0 || generatingMusic || generatedVideos.length > 0 || generatingVideo) && (
          <div className="relative z-10 border-t border-border/30 bg-background/80 backdrop-blur-md">
            <div className="max-w-3xl mx-auto px-4 py-4">
              {/* Mode switcher: Chat vs. BlueTAO Code */}
              <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
                <ModeToggle codeMode={codeMode} setCodeMode={setCodeMode} compact />
                {codeMode && activeProject && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                    <Pencil className="h-3 w-3" />
                    Editing {activeProject.title}
                    <button
                      type="button"
                      onClick={handleExitEditing}
                      className="rounded-full border border-emerald-300 px-2 py-0.5 font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
                    >
                      New build
                    </button>
                  </span>
                )}
                {codeMode && !activeProject && (
                  <span className="hidden sm:inline text-xs text-sky-700 dark:text-sky-400">
                    Build mode: describe a website or app to preview it live
                  </span>
                )}
              </div>
              {/* Build quality choice — its own line so it reads as a choice, not a third mode */}
              {codeMode && (
                <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
                  <span className="text-xs text-muted-foreground">Build this:</span>
                  <BuildQualityToggle quality={buildQuality} setQuality={setBuildQuality} compact />
                </div>
              )}
              {/* File upload indicator */}
              {uploadedFile && (
                <div className="mb-2 flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-sm text-foreground">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="truncate max-w-[200px]">{uploadedFile.name}</span>
                  <button
                    onClick={() => setUploadedFile(null)}
                    className="ml-auto text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              <form onSubmit={handleSubmit} className="relative">
                <div className="glass-panel relative flex items-center rounded-full transition-all">
                  <Button
                    type="button"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingFile}
                    title="Upload a file (PDF, DOCX, TXT, MD)"
                    className="ml-2 h-8 w-8 rounded-full bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {uploadingFile ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Paperclip className="w-4 h-4" />
                    )}
                  </Button>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={codeMode ? "What would you like to BUILD today?" : uploadedFile ? "Ask about your file..." : "Ask anything..."}
                    disabled={isLoading}
                    rows={1}
                    className="flex-1 resize-none bg-transparent px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 max-h-[120px]"
                  />
                  {micSupported && (
                    <Button
                      type="button"
                      size="icon"
                      onClick={toggleMic}
                      disabled={isLoading}
                      title={listening ? 'Stop listening' : 'Speak your message'}
                      className={cn(
                        'h-9 w-9 rounded-full transition-all',
                        listening
                          ? 'bg-red-500 text-white hover:bg-red-600 animate-pulse'
                          : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
                      )}
                    >
                      <Mic className="w-4 h-4" />
                    </Button>
                  )}
                  {!codeMode && (
                  <>
                  <Tip label="Video">
                    <Button
                      type="button"
                      size="icon"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const prompt = input.trim()
                        if (prompt) {
                          setInput('') // Clear input immediately
                          handleGenerateVideo(prompt)
                        }
                      }}
                      disabled={!input.trim() || isLoading || generatingVideo}
                      className={cn(
                        'mr-1 h-9 w-9 rounded-full transition-all',
                        input.trim() && !isLoading && !generatingVideo
                          ? 'bg-rose-600 text-white hover:bg-rose-500'
                          : 'bg-rose-500/25 text-rose-300 disabled:opacity-100'
                      )}
                    >
                      {generatingVideo ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Film className="w-4 h-4" />
                      )}
                    </Button>
                  </Tip>
                  <Tip label="Music">
                    <Button
                      type="button"
                      size="icon"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const prompt = input.trim()
                        if (prompt) {
                          setInput('') // Clear input immediately
                          handleGenerateMusic(prompt)
                        }
                      }}
                      disabled={!input.trim() || isLoading || generatingMusic}
                      className={cn(
                        'mr-1 h-9 w-9 rounded-full transition-all',
                        input.trim() && !isLoading && !generatingMusic
                          ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                          : 'bg-emerald-500/25 text-emerald-300 disabled:opacity-100'
                      )}
                    >
                      {generatingMusic ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Music className="w-4 h-4" />
                      )}
                    </Button>
                  </Tip>
                  <Tip label="Image">
                    <Button
                      type="button"
                      size="icon"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        const prompt = input.trim()
                        if (prompt) {
                          setInput('') // Clear input immediately
                          handleGenerateImage(prompt)
                        }
                      }}
                      disabled={!input.trim() || isLoading || generatingImage}
                      className={cn(
                        'mr-1 h-9 w-9 rounded-full transition-all',
                        input.trim() && !isLoading && !generatingImage
                          ? 'bg-violet-600 text-white hover:bg-violet-500'
                          : 'bg-violet-500/25 text-violet-300 disabled:opacity-100'
                      )}
                    >
                      {generatingImage ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ImageIcon className="w-4 h-4" />
                      )}
                    </Button>
                  </Tip>
                  </>
                  )}
                  <Tip label={codeMode ? 'Build' : 'Text'}>
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!input.trim() || isLoading}
                      className={cn(
                        'mr-2 h-9 w-9 rounded-full transition-all',
                        input.trim() && !isLoading
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                          : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </Button>
                  </Tip>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Projects & Memory modals */}
      <ProjectsPanel
        isOpen={showProjectsPanel}
        onClose={() => setShowProjectsPanel(false)}
        onOpenProject={handleOpenProject}
        onRestoreVersion={handleRestoreVersion}
      />
      <MemoryPanel
        isOpen={showMemoryPanel}
        onClose={() => setShowMemoryPanel(false)}
      />
    </div>
  )
}

function NewsPanel({ headlines, loading }: { headlines: NewsHeadline[], loading: boolean }) {
  if (loading) {
    return (
      <div className="mt-4 ml-13">
        <div className="flex items-center gap-2 p-4 rounded-2xl bg-card border border-border">
          <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
          <span className="text-sm text-muted-foreground">Fetching latest news...</span>
        </div>
      </div>
    )
  }

  if (headlines.length === 0) {
    return null
  }

  return (
    <div className="mt-4 ml-13">
      <div className="rounded-2xl bg-card border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-accent">
          <Newspaper className="w-4 h-4 text-sky-500" />
          <span className="font-medium text-sm text-foreground">Today&apos;s Top Stories</span>
        </div>
        <div className="divide-y divide-border">
          {headlines.map((headline, idx) => (
            <a
              key={idx}
              href={headline.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 p-3 hover:bg-accent transition-colors group"
            >
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-sky-100 flex items-center justify-center text-xs font-medium text-sky-600">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground leading-snug group-hover:text-sky-600 transition-colors">
                  {headline.title}
                </p>
                {headline.source && (
                  <p className="text-xs text-muted-foreground mt-1">{headline.source}</p>
                )}
              </div>
              <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ 
  message, 
  onSpeak, 
  speakingId, 
  ttsLoadingId,
  onSaveCode,
  saveActive,
  projectId,
  }: {
  message: UIMessage
  onSpeak?: (text: string, id: string) => void
  speakingId?: string | null
  ttsLoadingId?: string | null
  onSaveCode?: (code: string, language: string, publishedUrl?: string) => Promise<void> | void
  saveActive?: boolean
  projectId?: string
  }) {
  const isUser = message.role === 'user'
  const parts = message.parts || []

  // Build the full plain-text of an assistant message for TTS
  const messageText = parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text?: string }).text || '')
    .join(' ')
    .trim()

  const isSpeaking = speakingId === message.id
  const isTtsLoading = ttsLoadingId === message.id

  return (
    <div className={cn('flex gap-4', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center',
          isUser ? 'bg-sky-500' : 'bg-sky-100'
        )}
      >
        {isUser ? (
          <User className="w-5 h-5 text-white" />
        ) : (
          <Bot className="w-5 h-5 text-sky-600" />
        )}
      </div>
      <div
        className={cn(
          'max-w-[80%] space-y-2',
          isUser && 'flex flex-col items-end'
        )}
      >
        {parts.length === 0 && !isUser && (
          <div className="rounded-2xl px-4 py-3 bg-card border border-border text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
            Generating response...
          </div>
        )}
        {parts.map((part, index) => {
          if (part.type === 'text') {
            if (!part.text) return null
            
            // Parse <think> tags and format them differently (handles streaming too)
            const formatTextWithThinking = (text: string) => {
              const segments: { type: 'text' | 'think' | 'think-streaming'; content: string }[] = []
              
              // Check for complete <think>...</think> tags
              const completeThinkRegex = /<think>([\s\S]*?)<\/think>/g
              // Check for incomplete/streaming <think>... (no closing tag yet)
              const incompleteThinkRegex = /<think>([\s\S]*)$/
              
              let lastIndex = 0
              let match
              
              // Process complete think tags
              while ((match = completeThinkRegex.exec(text)) !== null) {
                if (match.index > lastIndex) {
                  segments.push({ type: 'text', content: text.slice(lastIndex, match.index) })
                }
                segments.push({ type: 'think', content: match[1] })
                lastIndex = match.index + match[0].length
              }
              
              // Check remaining text for incomplete think tag (streaming)
              const remainingText = text.slice(lastIndex)
              const incompleteMatch = remainingText.match(incompleteThinkRegex)
              
              if (incompleteMatch) {
                // Text before the incomplete think tag
                const beforeThink = remainingText.slice(0, incompleteMatch.index)
                if (beforeThink) {
                  segments.push({ type: 'text', content: beforeThink })
                }
                // The streaming think content
                segments.push({ type: 'think-streaming', content: incompleteMatch[1] })
              } else if (remainingText) {
                segments.push({ type: 'text', content: remainingText })
              }
              
              if (segments.length === 0) {
                return formatMarkdown(text)
              }
              
              // Check if we have actual answer content (non-empty text segments)
              const hasAnswerContent = segments.some(seg => 
                seg.type === 'text' && seg.content.trim().length > 0
              )
              
              return segments.map((seg, i) => {
                // Hide thinking once we have real answer content
                if (seg.type === 'think' || seg.type === 'think-streaming') {
                  if (hasAnswerContent) {
                    return null // Don't show thinking when answer is available
                  }
                  return (
                    <div key={i} className="text-xs text-muted-foreground opacity-70 my-2 py-2 border-l-2 border-sky-500/50 pl-3">
                      <span className="font-semibold text-sky-500 not-italic">Thinking...</span>
                      <span className="italic ml-2">{formatMarkdown(seg.content.trim())}</span>
                    </div>
                  )
                }
                return <span key={i}>{formatMarkdown(seg.content)}</span>
              })
            }
            
            // Parse markdown and render formatted text
            const formatMarkdown = (text: string): React.ReactNode => {
              const project = extractProjectArtifact(text)
              if (project) {
                return <CodeBlock code={serializeProject(project)} language="bluetao-project" onSave={onSaveCode} saveLabel={saveActive ? 'Save changes' : 'Save'} projectId={projectId} />
              }
              if (extractPatchArtifact(text)) {
                return <div className="rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">Applying targeted project changes…</div>
              }
              // Handle fenced code blocks (```lang ... ```) first, rendering them
              // with the CodeBlock component. Non-code text is passed back through
              // this same formatter (safe: those segments contain no fences).
              if (text.includes('```')) {
                const nodes: React.ReactNode[] = []
                const fenceRegex = /```(\w+)?\n?([\s\S]*?)```/g
                let last = 0
                let m: RegExpExecArray | null
                let k = 0
                while ((m = fenceRegex.exec(text)) !== null) {
                  if (m.index > last) {
                    nodes.push(<span key={`ct-${k}`}>{formatMarkdown(text.slice(last, m.index))}</span>)
                  }
                  nodes.push(<CodeBlock key={`cb-${k}`} language={m[1]} code={m[2].replace(/\n$/, '')} onSave={onSaveCode} saveLabel={saveActive ? 'Save changes' : 'Save'} />)
                  last = m.index + m[0].length
                  k++
                }
                const rest = text.slice(last)
                // A trailing unclosed fence means the code block is still streaming.
                const openMatch = rest.match(/```(\w+)?\n?([\s\S]*)$/)
                if (openMatch) {
                  const before = rest.slice(0, openMatch.index)
                  if (before) nodes.push(<span key="ct-open">{formatMarkdown(before)}</span>)
                  nodes.push(<CodeBlock key="cb-stream" language={openMatch[1]} code={openMatch[2]} isStreaming />)
                } else if (rest) {
                  nodes.push(<span key="ct-final">{formatMarkdown(rest)}</span>)
                }
                return nodes
              }

              // Fallback: the model sometimes returns a full HTML document WITHOUT
              // wrapping it in a ``` fence. Detect that raw document and render it
              // as a previewable CodeBlock so the game/app still shows up live
              // (otherwise the whole thing would be dumped as escaped plain text).
              const htmlStart = text.search(/<!doctype html|<html[\s>]/i)
              if (htmlStart !== -1) {
                const nodes: React.ReactNode[] = []
                const before = text.slice(0, htmlStart)
                if (before.trim()) nodes.push(<span key="rawhtml-before">{formatMarkdown(before)}</span>)
                const closeMatch = text.slice(htmlStart).match(/<\/html\s*>/i)
                const htmlEnd = closeMatch
                  ? htmlStart + (closeMatch.index ?? 0) + closeMatch[0].length
                  : text.length // still streaming: take the rest
                const htmlCode = text.slice(htmlStart, htmlEnd)
                nodes.push(
                  <CodeBlock
                    key="rawhtml-block"
                    language="html"
                    code={htmlCode}
                    onSave={onSaveCode}
                    saveLabel={saveActive ? 'Save changes' : 'Save'}
                    isStreaming={!closeMatch}
                  />
                )
                const after = text.slice(htmlEnd)
                if (after.trim()) nodes.push(<span key="rawhtml-after">{formatMarkdown(after)}</span>)
                return nodes
              }

              // Split by lines to handle line-based formatting
              const lines = text.split('\n')
              let keyIndex = 0
              
              const formatLine = (line: string): React.ReactNode => {
                // Check for ### headers (subtitles)
                const headerMatch = line.match(/^###\s+(.+)$/)
                if (headerMatch) {
                  return (
                    <div key={keyIndex++} className="text-base font-bold mt-3 mb-1">
                      {formatInlineMarkdown(headerMatch[1])}
                    </div>
                  )
                }
                
                // Check for bullet points (- at start of line)
                const bulletMatch = line.match(/^-\s+(.+)$/)
                if (bulletMatch) {
                  return (
                    <div key={keyIndex++} className="flex items-start gap-2 ml-2">
                      <span className="text-sky-500 mt-0.5">•</span>
                      <span>{formatInlineMarkdown(bulletMatch[1])}</span>
                    </div>
                  )
                }
                
                // Regular line - just apply inline formatting
                return formatInlineMarkdown(line)
              }
              
  // Format inline markdown: clickable links, bold **text**, and italic *text*
  const formatInlineMarkdown = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = []
    let remaining = text

    // Renders an <a> that is clickable in the browser and opens in a new tab
    const renderLink = (label: string, url: string) => {
      // Trim trailing punctuation that commonly clings to bare URLs
      let href = url
      let trailing = ''
      const punctMatch = href.match(/[).,!?;:]+$/)
      if (punctMatch && !href.startsWith('[')) {
        trailing = punctMatch[0]
        href = href.slice(0, href.length - trailing.length)
      }
      const fullHref = href.startsWith('www.') ? `https://${href}` : href
      return { node: (
        <a
          key={keyIndex++}
          href={fullHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-600 dark:text-sky-400 underline underline-offset-2 hover:text-sky-700 dark:hover:text-sky-300 break-words"
        >
          {label}
        </a>
      ), trailing }
    }

    // Matches markdown links [text](url) and bare http(s)/www URLs
    const urlRegex = /(https?:\/\/[^\s)]+|www\.[^\s)]+)/

    while (remaining.length > 0) {
      // Markdown link: [label](url)
      const mdLink = remaining.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+|www\.[^\s)]+)\)/)
      if (mdLink) {
        const { node } = renderLink(mdLink[1], mdLink[2])
        parts.push(node)
        remaining = remaining.slice(mdLink[0].length)
        continue
      }

      // Bare URL at the start
      const bareUrl = remaining.match(/^(https?:\/\/[^\s)]+|www\.[^\s)]+)/)
      if (bareUrl) {
        const { node, trailing } = renderLink(bareUrl[1], bareUrl[1])
        parts.push(node)
        remaining = remaining.slice(bareUrl[0].length)
        if (trailing) remaining = trailing + remaining
        continue
      }

      // Bold **text**
      const boldMatch = remaining.match(/^\*\*(.+?)\*\*/)
      if (boldMatch) {
        parts.push(<strong key={keyIndex++} className="font-semibold">{boldMatch[1]}</strong>)
        remaining = remaining.slice(boldMatch[0].length)
        continue
      }

      // Italic *text* (but not **)
      const italicMatch = remaining.match(/^\*([^*]+?)\*/)
      if (italicMatch) {
        parts.push(<em key={keyIndex++} className="italic">{italicMatch[1]}</em>)
        remaining = remaining.slice(italicMatch[0].length)
        continue
      }

      // Find the next special character (star or link start) to consume plain text up to it
      const nextSpecial = (() => {
        const candidates: number[] = []
        const star = remaining.indexOf('*')
        if (star !== -1) candidates.push(star)
        const bracket = remaining.indexOf('[')
        if (bracket !== -1) candidates.push(bracket)
        const urlIdx = remaining.search(urlRegex)
        if (urlIdx !== -1) candidates.push(urlIdx)
        return candidates.length > 0 ? Math.min(...candidates) : -1
      })()

      if (nextSpecial === -1) {
        parts.push(remaining)
        break
      } else if (nextSpecial === 0) {
        // Special char at start but didn't match any pattern; emit it as plain text
        parts.push(remaining[0])
        remaining = remaining.slice(1)
      } else {
        parts.push(remaining.slice(0, nextSpecial))
        remaining = remaining.slice(nextSpecial)
      }
    }

    return parts.length > 0 ? parts : text
  }
              
              // Process all lines
              const formattedLines = lines.map((line, i) => {
                const formatted = formatLine(line)
                // Add line break after each line except the last
                if (i < lines.length - 1) {
                  return <span key={`line-${i}`}>{formatted}{'\n'}</span>
                }
                return <span key={`line-${i}`}>{formatted}</span>
              })
              
              return formattedLines
            }
            
            return (
              <div
                key={index}
                className={cn(
                  'rounded-2xl px-4 py-3',
                  isUser
                    ? 'bg-sky-500 text-white'
                    : 'bg-card border border-border text-foreground'
                )}
              >
                <div className="whitespace-pre-wrap text-sm leading-relaxed">
                  {formatTextWithThinking(part.text)}
                </div>
              </div>
            )
          }

          if (part.type === 'reasoning') {
            const reasoningPart = part as unknown as { type: 'reasoning'; reasoning: string }
            if (!reasoningPart.reasoning) return null
            return (
              <div
                key={index}
                className="rounded-2xl px-4 py-3 bg-accent border border-border text-muted-foreground text-sm italic"
              >
                <div className="whitespace-pre-wrap leading-relaxed">
                  {reasoningPart.reasoning}
                </div>
              </div>
            )
          }

          if (part.type === 'tool-invocation') {
            return (
              <div
                key={index}
                className="flex items-center gap-2 px-3 py-2 rounded-full bg-accent text-xs text-muted-foreground"
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Processing...</span>
              </div>
            )
          }

          return null
        })}
        {!isUser && messageText && onSpeak && (
          <button
            onClick={() => onSpeak(messageText, message.id)}
            title={isSpeaking ? 'Stop' : 'Read aloud'}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-sky-600 transition-colors mt-1 px-1"
          >
            {isTtsLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isSpeaking ? (
              <VolumeX className="w-3.5 h-3.5" />
            ) : (
              <Volume2 className="w-3.5 h-3.5" />
            )}
            <span>{isSpeaking ? 'Stop' : 'Listen'}</span>
          </button>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState, useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, UIMessage } from 'ai'
import { Send, User, Bot, Loader2, Plus, Newspaper, ExternalLink, Pencil, Lightbulb, Code, Search, Sparkles, Menu, X, MessageSquare, Trash2, LogOut, Zap, ImageIcon, Square, Globe, Paperclip, FileText, Brain } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { AnimatedOceanBackground, BlueTaoLogo } from '@/components/animated-background'
import { MemoryPanel } from '@/components/memory-panel'
import Link from 'next/link'

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

function isNewsQuery(text: string): boolean {
  const lowerText = text.toLowerCase()
  return (lowerText.includes('news') || lowerText.includes('headlines') || lowerText.includes('happening')) &&
    (lowerText.includes('today') || lowerText.includes('latest') || lowerText.includes('current') || lowerText.includes('what'))
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
  const [messageTimestamps, setMessageTimestamps] = useState<Record<string, number>>({})
  const [uploadedFile, setUploadedFile] = useState<{ name: string; content: string } | null>(null)
  const [showMemoryPanel, setShowMemoryPanel] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lastSavedMessageRef = useRef<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const { messages, sendMessage, status, setMessages, error, stop } = useChat({
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
    }
  })

  const isLoading = status === 'streaming' || status === 'submitted'
  const [thinkingStatus, setThinkingStatus] = useState<string>('Thinking...')
  const [thinkingDetails, setThinkingDetails] = useState<string[]>([])
  const [hasStartedStreaming, setHasStartedStreaming] = useState(false)
  const [bufferedContent, setBufferedContent] = useState<string>('')
  const [displayedContent, setDisplayedContent] = useState<string>('')
  const bufferRef = useRef<string>('')
  const displayIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Dynamic thinking status messages based on user input
  useEffect(() => {
    if (status === 'submitted') {
      setHasStartedStreaming(false)
      setBufferedContent('')
      setDisplayedContent('')
      bufferRef.current = ''
      
      const lastUserMsg = messages.filter(m => m.role === 'user').pop()
      const userText = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : (lastUserMsg.parts?.find(p => p.type === 'text') as { text: string } | undefined)?.text || '') : ''
      const lowerText = userText.toLowerCase()
      
      // Extract key topics for personalized messages
      const topics = userText.match(/\b(?:about|on|for|regarding)\s+([^?.!,]+)/i)?.[1]?.trim() || 
                     userText.split(' ').slice(0, 5).join(' ')
      
      // More detailed thinking phases with sub-details
      const phases = [
        { status: 'Initializing...', details: ['Connecting to Bittensor network', 'Routing to optimal miner'] },
        { status: 'Understanding your question...', details: [`Analyzing: "${topics.substring(0, 40)}${topics.length > 40 ? '...' : ''}"`, 'Identifying key concepts'] },
        lowerText.includes('news') || lowerText.includes('today') || lowerText.includes('latest') 
          ? { status: 'Searching the web...', details: [`Querying Desearch (SN22) for: ${topics.substring(0, 30)}`, 'Gathering recent sources'] }
          : { status: 'Processing with DeepSeek V3.2...', details: ['Running inference on Chutes (SN64)', 'Generating response'] },
        lowerText.includes('twitter') || lowerText.includes('tweet')
          ? { status: 'Searching Twitter/X...', details: [`Looking for tweets about ${topics.substring(0, 25)}`, 'Analyzing social sentiment'] }
          : { status: 'Synthesizing information...', details: ['Cross-referencing data', 'Formulating comprehensive answer'] },
        { status: 'Preparing response...', details: ['Formatting output', 'Almost ready...'] }
      ]
      
      let phaseIndex = 0
      setThinkingStatus(phases[0].status)
      setThinkingDetails(phases[0].details)
      
      const interval = setInterval(() => {
        phaseIndex = (phaseIndex + 1) % phases.length
        setThinkingStatus(phases[phaseIndex].status)
        setThinkingDetails(phases[phaseIndex].details)
      }, 2000)
      
      return () => clearInterval(interval)
    }
  }, [status, messages])

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
        
        // Start display interval if not already running and we have enough content
        // Buffer 600 characters before starting to display for smoother experience
        if (content.length > 600 && !hasStartedStreaming) {
          setHasStartedStreaming(true)
          
          // Display content in chunks for smooth appearance
          if (!displayIntervalRef.current) {
            let displayIndex = 0
            displayIntervalRef.current = setInterval(() => {
              const targetLength = bufferRef.current.length
              if (displayIndex < targetLength) {
                // Show 15-25 characters at a time for faster, smoother display
                const chunkSize = Math.min(Math.floor(Math.random() * 11) + 15, targetLength - displayIndex)
                displayIndex = Math.min(displayIndex + chunkSize, targetLength)
                setDisplayedContent(bufferRef.current.substring(0, displayIndex))
              } else {
                // Keep syncing with buffer
                setDisplayedContent(bufferRef.current)
              }
            }, 16) // ~60fps for very smooth display
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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, newsHeadlines, generatedImages, generatingImage])

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

  // Save assistant messages when streaming completes (only if logged in)
  useEffect(() => {
    if (status === 'ready' && messages.length > 0 && currentChatId && user) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role === 'assistant') {
        const content = getMessageText(lastMessage)
        if (content && content !== lastSavedMessageRef.current) {
          lastSavedMessageRef.current = content
          saveMessage(currentChatId, 'assistant', content)
        }
      }
    }
  }, [status, messages, currentChatId])

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
    
    sendMessage({ text: messageToSend })
    
    // Refresh usage after sending
    setTimeout(() => fetchUsage(), 1000)
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
    setSidebarOpen(false)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion)
    setTimeout(() => {
      const form = document.querySelector('form')
      form?.requestSubmit()
    }, 100)
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
    const lowerText = text.toLowerCase()
    return lowerText.includes('generate image') || 
           lowerText.includes('create image') ||
           lowerText.includes('make an image') ||
           lowerText.includes('draw me') ||
           lowerText.includes('generate a picture') ||
           lowerText.includes('create a picture')
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
          <span className="text-4xl font-bold text-blue-500 tracking-tight" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>BlueTAO</span>
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
              className="font-[family-name:var(--font-playfair)] text-xl font-medium text-foreground hover:text-primary transition-colors hidden lg:block tracking-wide italic"
            >
              a front end to bittensor
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewChat}
              className="rounded-full border-border/50 bg-background/80 backdrop-blur-sm text-foreground hover:bg-accent hover:text-accent-foreground text-sm"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Chat
            </Button>
            {showLoginPrompt && (
              <span className="text-xs text-amber-600 animate-pulse hidden sm:block">
                Log in to create a chat history
              </span>
            )}
          </div>
          {user ? (
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setShowMemoryPanel(true)}
                className="text-violet-400 hover:text-violet-300 flex"
              >
                <Brain className="w-4 h-4 mr-1" />
                Memory
              </Button>
              <Link href="/detect">
                <Button variant="outline" size="default" className="text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 border-blue-300 hover:border-blue-400 hover:bg-blue-50 dark:border-blue-600 dark:hover:bg-blue-950/50 font-medium">
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  Is it AI?
                </Button>
              </Link>
              <Link href="/developers">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground flex">
                  <Code className="w-4 h-4 mr-1" />
                  Embed
                </Button>
              </Link>
              <Link href="/pricing">
                <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80 hidden sm:flex">
                  <Zap className="w-4 h-4 mr-1" />
                  Upgrade
                </Button>
              </Link>
              <span className="text-sm text-muted-foreground hidden sm:block">
                {user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0]}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/detect">
                <Button variant="outline" size="default" className="text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 border-blue-300 hover:border-blue-400 hover:bg-blue-50 dark:border-blue-600 dark:hover:bg-blue-950/50 font-medium">
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  Is it AI?
                </Button>
              </Link>
              <Link href="/developers">
                <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground flex">
                  <Code className="w-4 h-4 mr-1" />
                  Embed
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/auth/login')}
                className="ml-2 text-muted-foreground hover:text-foreground hidden sm:flex"
              >
                Sign in
              </Button>
            </div>
          )}
        </header>

        {/* Main Content */}
        <main className="relative z-10 flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4">
            {messages.length === 0 && generatedImages.length === 0 && !generatingImage ? (
              /* Welcome Screen */
              <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] text-center">
                {/* Logo Icon */}
                <div className="mb-8">
                  <BlueTaoLogo className="w-24 h-24 text-primary" />
                </div>

                {/* Title */}
                <h1 className="font-[family-name:var(--font-playfair)] text-5xl md:text-6xl text-foreground font-normal tracking-tight mb-4">
                  Ask anything
                </h1>
                <p className="text-muted-foreground text-lg mb-12 max-w-md">
                  Intelligent answers powered by decentralized AI
                </p>
                
                {/* Input Area */}
                <div className="w-full max-w-2xl mb-6">
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
                    <div className="relative flex items-center rounded-full border border-border/50 bg-card shadow-sm hover:shadow-md transition-shadow">
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
                        placeholder={uploadedFile ? "Ask about your file..." : "Ask anything privately..."}
                        disabled={isLoading}
                        className="flex-1 bg-transparent px-4 py-4 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 text-lg"
                      />
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
                        title="Generate Image"
                        className={cn(
                          'mr-1 h-10 w-10 rounded-full transition-all',
                          input.trim() && !isLoading && !generatingImage
                            ? 'bg-violet-600 text-white hover:bg-violet-500'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {generatingImage ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <ImageIcon className="w-5 h-5" />
                        )}
                      </Button>
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
                    </div>
                  </form>
                </div>

                {/* Suggestion Pills */}
                <div className="flex flex-wrap justify-center gap-3">
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

                {/* Footer Link */}
                <div className="mt-16">
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
                    const timelineItems: Array<{type: 'message' | 'image', data: typeof messages[0] | typeof generatedImages[0], timestamp: number, idx: number}> = []
                    
                    messages.forEach((msg, idx) => {
                      // Use tracked timestamp or fallback to a very old time for existing messages
                      const timestamp = messageTimestamps[msg.id] || 0
                      timelineItems.push({ type: 'message', data: msg, timestamp, idx })
                    })
                    
                    generatedImages.forEach((img, idx) => {
                      timelineItems.push({ type: 'image', data: img, timestamp: img.createdAt, idx })
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
                      } else {
                        const message = item.data as typeof messages[0]
                        const idx = item.idx
                        return (
                          <div key={message.id}>
                            <MessageBubble message={message} />
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
{(status === 'submitted' || (status === 'streaming' && !hasStartedStreaming)) && !isNewsQuery(getMessageText(messages[messages.length - 1] || { parts: [] } as UIMessage)) && (
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-lg shadow-sky-500/20">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-950/30 dark:to-blue-950/30 rounded-2xl p-4 border border-sky-100 dark:border-sky-800/50">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="relative">
                        <div className="w-2 h-2 bg-sky-500 rounded-full animate-ping absolute" />
                        <div className="w-2 h-2 bg-sky-500 rounded-full" />
                      </div>
                      <span className="text-sm font-semibold text-sky-700 dark:text-sky-300 transition-all duration-500">{thinkingStatus}</span>
                    </div>
                    <div className="space-y-2 ml-5">
                      {thinkingDetails.map((detail, i) => (
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
                    <div className="mt-3 pt-3 border-t border-sky-200/50 dark:border-sky-700/50">
                      <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                        Connected to Bittensor&apos;s decentralized AI network
                      </span>
                    </div>
                  </div>
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
        {(messages.length > 0 || generatedImages.length > 0 || generatingImage) && (
          <div className="relative z-10 border-t border-border/30 bg-background/80 backdrop-blur-md">
            <div className="max-w-3xl mx-auto px-4 py-4">
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
                <div className="relative flex items-center rounded-full border border-border/50 bg-card shadow-sm hover:shadow-md transition-shadow">
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
                    placeholder={uploadedFile ? "Ask about your file..." : "Ask anything..."}
                    disabled={isLoading}
                    rows={1}
                    className="flex-1 resize-none bg-transparent px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 max-h-[120px]"
                  />
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
                    title="Generate Image"
                    className={cn(
                      'mr-1 h-9 w-9 rounded-full transition-all',
                      input.trim() && !isLoading && !generatingImage
                        ? 'bg-violet-600 text-white hover:bg-violet-500'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {generatingImage ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <ImageIcon className="w-4 h-4" />
                    )}
                  </Button>
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
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
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

      {/* Memory Panel Modal */}
      <MemoryPanel 
        isOpen={showMemoryPanel} 
        onClose={() => setShowMemoryPanel(false)} 
      />
    </div>
  )
}

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user'
  const parts = message.parts || []

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
              
  // Format inline markdown (bold **text** and italic *text*)
  const formatInlineMarkdown = (text: string): React.ReactNode => {
    // First handle bold **text**, then italic *text* (order matters to avoid conflicts)
    const parts: React.ReactNode[] = []
    let remaining = text
    let localKeyIndex = 0
    
    // Process the text character by character to handle both ** and *
    while (remaining.length > 0) {
      // Check for bold **text**
      const boldMatch = remaining.match(/^\*\*(.+?)\*\*/)
      if (boldMatch) {
        parts.push(<strong key={keyIndex++} className="font-semibold">{boldMatch[1]}</strong>)
        remaining = remaining.slice(boldMatch[0].length)
        continue
      }
      
      // Check for italic *text* (but not **)
      const italicMatch = remaining.match(/^\*([^*]+?)\*/)
      if (italicMatch) {
        parts.push(<em key={keyIndex++} className="italic">{italicMatch[1]}</em>)
        remaining = remaining.slice(italicMatch[0].length)
        continue
      }
      
      // Find the next * to know how much plain text to consume
      const nextStar = remaining.indexOf('*', 0)
      if (nextStar === -1) {
        // No more stars, push the rest as plain text
        parts.push(remaining)
        break
      } else if (nextStar === 0) {
        // Star at start but didn't match bold or italic, push it as plain text
        parts.push('*')
        remaining = remaining.slice(1)
      } else {
        // Push plain text up to the star
        parts.push(remaining.slice(0, nextStar))
        remaining = remaining.slice(nextStar)
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
      </div>
    </div>
  )
}

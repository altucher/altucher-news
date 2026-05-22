'use client'

import { useState, useRef, useEffect } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, UIMessage } from 'ai'
import { Send, User, Bot, Loader2, Plus, Newspaper, ExternalLink, Pencil, Lightbulb, Code, Search, Sparkles, Menu, X, MessageSquare, Trash2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { User as SupabaseUser } from '@supabase/supabase-js'

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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastSavedMessageRef = useRef<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  })

  const isLoading = status === 'streaming' || status === 'submitted'

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
    } else {
      setLoadingChats(false)
    }
  }, [user])

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
  }, [messages, newsHeadlines])

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
    
    sendMessage({ text: userMessage })
    
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

  const suggestions = [
    { icon: Pencil, label: 'Write content' },
    { icon: Lightbulb, label: 'Brainstorm ideas' },
    { icon: Code, label: 'Write code' },
    { icon: Search, label: 'Research a topic' },
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
          <span className="font-[family-name:var(--font-space)] text-xl font-bold text-sky-600 tracking-wider">BlueTAO</span>
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
            className="w-full justify-start gap-2 bg-sky-500 hover:bg-sky-400 text-white"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </Button>
        </div>

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
              <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
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
        {/* Background Image - always visible */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: 'url(/bg.jpg)' }}
        />
        <div className="absolute inset-0 bg-background/60" />

        {/* Header */}
        <header className="relative z-10 flex items-center justify-between px-4 lg:px-6 py-4 border-b border-border/50 bg-background/60 backdrop-blur-sm">
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
              className="font-[family-name:var(--font-space)] text-xl font-bold text-sky-600 hover:text-sky-500 transition-colors hidden lg:block tracking-wider"
            >
              BlueTAO
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewChat}
            className="rounded-full border-border bg-background/80 backdrop-blur-sm text-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Chat
          </Button>
          {user ? (
            <span className="text-sm text-muted-foreground ml-4 hidden sm:block">
              Hi, {user.user_metadata?.full_name?.split(' ')[0] || user.email?.split('@')[0]}
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/auth/login')}
              className="ml-2 text-muted-foreground hover:text-foreground hidden sm:flex"
            >
              Sign in
            </Button>
          )}
        </header>

        {/* Main Content */}
        <main className="relative z-10 flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4">
            {messages.length === 0 ? (
              /* Welcome Screen */
              <div className="flex flex-col items-center justify-center min-h-[calc(100vh-120px)] text-center">
                {/* Logo Icon */}
                <div className="mb-6">
                  <svg 
                    viewBox="0 0 60 60" 
                    className="w-16 h-16 text-sky-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <circle cx="30" cy="30" r="20" />
                    <circle cx="30" cy="30" r="8" fill="currentColor" opacity="0.3" />
                    <circle cx="22" cy="24" r="2" fill="currentColor" />
                    <circle cx="42" cy="18" r="1.5" fill="currentColor" />
                    <circle cx="14" cy="35" r="1" fill="currentColor" />
                    <circle cx="48" cy="38" r="1.5" fill="currentColor" />
                  </svg>
                </div>

                {/* Title */}
                <h1 className="font-[family-name:var(--font-space)] text-5xl md:text-6xl text-foreground font-bold tracking-wide mb-12">
                  Ask anything
                </h1>
                
                {/* Input Area */}
                <div className="w-full max-w-2xl mb-6">
                  <form onSubmit={handleSubmit} className="relative">
                    <div className="relative flex items-center rounded-full border border-border bg-card shadow-lg shadow-sky-200/50">
                      <div className="pl-5 text-muted-foreground">
                        <Pencil className="w-5 h-5" />
                      </div>
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Ask anything privately..."
                        disabled={isLoading}
                        className="flex-1 bg-transparent px-4 py-4 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 text-lg"
                      />
                      <Button
                        type="submit"
                        size="icon"
                        disabled={!input.trim() || isLoading}
                        className={cn(
                          'mr-2 h-10 w-10 rounded-full transition-all',
                          input.trim() && !isLoading
                            ? 'bg-sky-500 text-white hover:bg-sky-400'
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
                      className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-border bg-card/80 backdrop-blur-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground hover:border-sky-400/50 transition-all text-sm"
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
                  {messages.map((message, idx) => (
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
                    </div>
                  ))}
                  {isLoading && messages[messages.length - 1]?.role === 'user' && !isNewsQuery(getMessageText(messages[messages.length - 1])) && (
                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-sky-600" />
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground pt-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Thinking...</span>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            )}
          </div>
        </main>

        {/* Input Area - Chat Mode */}
        {messages.length > 0 && (
          <div className="relative z-10 border-t border-border/50 bg-background/60 backdrop-blur-sm">
            <div className="max-w-3xl mx-auto px-4 py-4">
              <form onSubmit={handleSubmit} className="relative">
                <div className="relative flex items-center rounded-full border border-border bg-card shadow-sm shadow-sky-200/30">
                  <div className="pl-5 text-muted-foreground">
                    <Pencil className="w-5 h-5" />
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask anything..."
                    disabled={isLoading}
                    rows={1}
                    className="flex-1 resize-none bg-transparent px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 max-h-[120px]"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={!input.trim() || isLoading}
                    className={cn(
                      'mr-2 h-9 w-9 rounded-full transition-all',
                      input.trim() && !isLoading
                        ? 'bg-sky-500 text-white hover:bg-sky-400'
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
            
            // Parse <think> tags and format them differently
            const formatTextWithThinking = (text: string) => {
              const thinkRegex = /<think>([\s\S]*?)<\/think>/g
              const segments: { type: 'text' | 'think'; content: string }[] = []
              let lastIndex = 0
              let match
              
              while ((match = thinkRegex.exec(text)) !== null) {
                // Add text before the think tag
                if (match.index > lastIndex) {
                  segments.push({ type: 'text', content: text.slice(lastIndex, match.index) })
                }
                // Add the think content
                segments.push({ type: 'think', content: match[1] })
                lastIndex = match.index + match[0].length
              }
              
              // Add remaining text after last think tag
              if (lastIndex < text.length) {
                segments.push({ type: 'text', content: text.slice(lastIndex) })
              }
              
              // If no think tags found, return original text
              if (segments.length === 0) {
                return <span>{text}</span>
              }
              
              return segments.map((seg, i) => {
                if (seg.type === 'think') {
                  return (
                    <div key={i} className="text-xs italic text-muted-foreground opacity-70 my-2 py-2 border-l-2 border-muted pl-3">
                      {seg.content.trim()}
                    </div>
                  )
                }
                return <span key={i}>{seg.content}</span>
              })
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

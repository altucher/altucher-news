'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, X, Minimize2 } from 'lucide-react'
import { useChat } from '@ai-sdk/react'
import ReactMarkdown from 'react-markdown'

export default function EmbedChat() {
  const [isExpanded, setIsExpanded] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: '/api/chat',
    initialMessages: [
      {
        id: 'welcome',
        role: 'assistant',
        content: 'Hi! I\'m BlueTAO, your AI assistant powered by Bittensor. How can I help you today?'
      }
    ]
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Notify parent window of size changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.parent.postMessage({ type: 'bluetao-resize', expanded: isExpanded }, '*')
    }
  }, [isExpanded])

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="fixed bottom-4 right-4 w-14 h-14 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-white">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 w-[380px] h-[500px] bg-[#1a1612] border border-[#3d3530] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-[#2a2420] to-[#1a1612] border-b border-[#3d3530]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <span className="text-white font-bold text-sm">B</span>
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm">BlueTAO</h3>
            <p className="text-[#a89a8c] text-xs">Powered by Bittensor</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1.5 text-[#a89a8c] hover:text-white hover:bg-[#3d3530] rounded-lg transition-colors"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => window.parent.postMessage({ type: 'bluetao-close' }, '*')}
            className="p-1.5 text-[#a89a8c] hover:text-white hover:bg-[#3d3530] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                message.role === 'user'
                  ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white'
                  : 'bg-[#2a2420] text-[#e8e0d8] border border-[#3d3530]'
              }`}
            >
              {message.role === 'assistant' ? (
                <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm">{message.content}</p>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[#2a2420] border border-[#3d3530] rounded-2xl px-4 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
            </div>
          </div>
        )}
        {error && (
          <div className="flex justify-center">
            <p className="text-red-400 text-xs bg-red-900/20 px-3 py-1.5 rounded-full">
              Something went wrong. Please try again.
            </p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-[#3d3530] bg-[#1a1612]">
        <div className="flex items-center gap-2 bg-[#2a2420] rounded-xl px-3 py-2 border border-[#3d3530] focus-within:border-amber-500/50 transition-colors">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Ask anything..."
            className="flex-1 bg-transparent text-white text-sm placeholder-[#6b5f54] outline-none"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input?.trim()}
            className="p-1.5 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-center text-[#6b5f54] text-[10px] mt-2">
          <a href="https://bluetao.ai" target="_blank" rel="noopener noreferrer" className="hover:text-amber-500 transition-colors">
            bluetao.ai
          </a>
        </p>
      </form>
    </div>
  )
}

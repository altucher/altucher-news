'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Send, FileText, Mail, Sparkles, Check, X } from 'lucide-react'

interface ResearchAgentProps {
  uploadedFile?: { name: string; content: string } | null
  onClose: () => void
}

export function ResearchAgent({ uploadedFile, onClose }: ResearchAgentProps) {
  const [topic, setTopic] = useState('')
  const [email, setEmail] = useState('')
  const [depth, setDepth] = useState<'quick' | 'detailed'>('detailed')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'researching' | 'sending' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!topic && !uploadedFile) {
      setMessage('Please enter a topic or upload a file')
      setStatus('error')
      return
    }
    
    if (!email) {
      setMessage('Please enter your email address')
      setStatus('error')
      return
    }

    setLoading(true)
    setStatus('researching')
    setMessage('Researching and analyzing...')

    try {
      const response = await fetch('/api/agent/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic || `Analyze this document: ${uploadedFile?.name}`,
          fileContent: uploadedFile?.content,
          fileName: uploadedFile?.name,
          email,
          depth,
        }),
      })

      const data = await response.json()

      if (data.success) {
        setStatus('success')
        setMessage(`Research sent to ${email}!`)
      } else {
        setStatus('error')
        setMessage(data.error || 'Failed to complete research')
      }
    } catch (err) {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border/50 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary/20 to-primary/10 px-6 py-4 border-b border-border/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-lg">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Research Agent</h2>
                <p className="text-xs text-muted-foreground">AI-powered research and summary</p>
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* File indicator */}
          {uploadedFile && (
            <div className="flex items-center gap-2 px-4 py-3 bg-primary/10 rounded-lg text-sm">
              <FileText className="w-4 h-4 text-primary" />
              <span className="text-foreground font-medium">{uploadedFile.name}</span>
              <span className="text-muted-foreground ml-auto">Will be analyzed</span>
            </div>
          )}

          {/* Topic input */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              {uploadedFile ? 'Additional context (optional)' : 'Research Topic'}
            </label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={uploadedFile ? 'Any specific questions about the file?' : 'e.g., Bittensor TAO tokenomics'}
              disabled={loading}
              className="bg-background"
            />
          </div>

          {/* Email input */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              <Mail className="w-4 h-4 inline mr-1" />
              Send results to
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              disabled={loading}
              required
              className="bg-background"
            />
          </div>

          {/* Depth selector */}
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">Research Depth</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDepth('quick')}
                disabled={loading}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  depth === 'quick'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                Quick Summary
              </button>
              <button
                type="button"
                onClick={() => setDepth('detailed')}
                disabled={loading}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  depth === 'detailed'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                Detailed Analysis
              </button>
            </div>
          </div>

          {/* Status message */}
          {message && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
              status === 'success' ? 'bg-green-500/10 text-green-600' :
              status === 'error' ? 'bg-red-500/10 text-red-600' :
              'bg-primary/10 text-primary'
            }`}>
              {status === 'success' && <Check className="w-4 h-4" />}
              {status === 'error' && <X className="w-4 h-4" />}
              {(status === 'researching' || status === 'sending') && <Loader2 className="w-4 h-4 animate-spin" />}
              {message}
            </div>
          )}

          {/* Submit button */}
          <Button
            type="submit"
            disabled={loading || (!topic && !uploadedFile)}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {status === 'researching' ? 'Researching...' : 'Sending...'}
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Research & Email Results
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  )
}

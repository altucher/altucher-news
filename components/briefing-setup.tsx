'use client'

import { useState, useEffect } from 'react'
import { X, Newspaper, Trash2, Plus, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Topic {
  id: string
  topic: string
  created_at: string
}

interface BriefingSetupProps {
  isOpen: boolean
  onClose: () => void
  onGenerate: () => void
}

export function BriefingSetup({ isOpen, onClose, onGenerate }: BriefingSetupProps) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [newTopic, setNewTopic] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  console.log('[v0] BriefingSetup render, isOpen:', isOpen)

  useEffect(() => {
    if (isOpen) {
      fetchTopics()
    }
  }, [isOpen])

  const fetchTopics = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/briefing/topics')
      if (res.ok) {
        const data = await res.json()
        setTopics(data.topics || [])
      }
    } catch (err) {
      console.error('Failed to fetch topics:', err)
      setError('Failed to load topics')
    } finally {
      setLoading(false)
    }
  }

  const addTopic = async () => {
    if (!newTopic.trim()) return
    
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/briefing/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: newTopic.trim() })
      })
      
      if (res.ok) {
        const data = await res.json()
        setTopics([...topics, data.topic])
        setNewTopic('')
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to add topic')
      }
    } catch (err) {
      console.error('Failed to save topic:', err)
      setError('Failed to add topic')
    } finally {
      setSaving(false)
    }
  }

  const deleteTopic = async (id: string) => {
    setDeleting(id)
    try {
      const res = await fetch(`/api/briefing/topics?id=${id}`, {
        method: 'DELETE'
      })
      
      if (res.ok) {
        setTopics(topics.filter(t => t.id !== id))
      }
    } catch (err) {
      console.error('Failed to delete topic:', err)
    } finally {
      setDeleting(null)
    }
  }

  const handleGenerate = () => {
    onClose()
    onGenerate()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Newspaper className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-foreground">Morning Briefing</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Description */}
        <div className="px-4 pt-4 pb-2">
          <p className="text-sm text-muted-foreground">
            Add up to 5 topics you want to track. Your morning briefing will include the latest news and tweets about each topic.
          </p>
        </div>

        {/* Add topic input */}
        <div className="p-4 border-b border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTopic()}
              placeholder="Add a topic (e.g., 'Bitcoin', 'AI news')"
              className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/50 text-foreground placeholder:text-muted-foreground"
              disabled={topics.length >= 5}
            />
            <Button 
              onClick={addTopic} 
              disabled={saving || !newTopic.trim() || topics.length >= 5}
              size="icon"
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </div>
          {error && (
            <p className="text-xs text-red-500 mt-2">{error}</p>
          )}
        </div>

        {/* Topic list */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : topics.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No topics yet</p>
              <p className="text-sm mt-1">Add topics to get your personalized briefing!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {topics.map((topic) => (
                <div 
                  key={topic.id}
                  className="flex items-center justify-between gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800/50 group"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <p className="text-sm font-medium text-foreground">{topic.topic}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteTopic(topic.id)}
                    disabled={deleting === topic.id}
                  >
                    {deleting === topic.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border space-y-3">
          <Button 
            onClick={handleGenerate}
            disabled={topics.length === 0}
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Generate My Briefing
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {topics.length}/5 topics configured
          </p>
        </div>
      </div>
    </div>
  )
}

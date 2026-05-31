'use client'

import { useState, useEffect } from 'react'
import { X, Brain, Trash2, Plus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Memory {
  id: string
  content: string
  category: string
  created_at: string
}

interface MemoryPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function MemoryPanel({ isOpen, onClose }: MemoryPanelProps) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [newMemory, setNewMemory] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      fetchMemories()
    }
  }, [isOpen])

  const fetchMemories = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/memories')
      if (res.ok) {
        const data = await res.json()
        setMemories(data.memories || [])
      }
    } catch (err) {
      console.error('Failed to fetch memories:', err)
    } finally {
      setLoading(false)
    }
  }

  const addMemory = async () => {
    if (!newMemory.trim()) return
    
    setSaving(true)
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newMemory.trim() })
      })
      
      if (res.ok) {
        const data = await res.json()
        setMemories([data.memory, ...memories])
        setNewMemory('')
      } else if (res.status === 409) {
        alert('This memory already exists')
      }
    } catch (err) {
      console.error('Failed to save memory:', err)
    } finally {
      setSaving(false)
    }
  }

  const deleteMemory = async (id: string) => {
    setDeleting(id)
    try {
      const res = await fetch(`/api/memories?id=${id}`, {
        method: 'DELETE'
      })
      
      if (res.ok) {
        setMemories(memories.filter(m => m.id !== id))
      }
    } catch (err) {
      console.error('Failed to delete memory:', err)
    } finally {
      setDeleting(null)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Memory</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Add memory input */}
        <div className="p-4 border-b border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={newMemory}
              onChange={(e) => setNewMemory(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMemory()}
              placeholder="Add a memory (e.g., 'I prefer concise answers')"
              className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
            />
            <Button 
              onClick={addMemory} 
              disabled={saving || !newMemory.trim()}
              size="icon"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Or say &quot;remember that...&quot; in chat to save memories automatically.
          </p>
        </div>

        {/* Memory list */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : memories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Brain className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No memories yet</p>
              <p className="text-sm mt-1">Tell BlueTAO things to remember!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map((memory) => (
                <div 
                  key={memory.id}
                  className="flex items-start justify-between gap-2 p-3 bg-background/50 rounded-lg border border-border/50 group"
                >
                  <p className="text-sm text-foreground flex-1">{memory.content}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMemory(memory.id)}
                    disabled={deleting === memory.id}
                  >
                    {deleting === memory.id ? (
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
        <div className="p-4 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">
            {memories.length} {memories.length === 1 ? 'memory' : 'memories'} stored
          </p>
        </div>
      </div>
    </div>
  )
}

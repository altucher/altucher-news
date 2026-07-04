'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Loader2, Check, X, ExternalLink, RefreshCw, Trash2, PartyPopper } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Prevent static generation - this page fetches live data
export const dynamic = 'force-dynamic'

interface FunProject {
  id: string
  title: string
  link: string
  description: string | null
  status: string
  created_at: string
}

export default function FunProspectsPage() {
  const [pending, setPending] = useState<FunProject[]>([])
  const [approved, setApproved] = useState<FunProject[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, a] = await Promise.all([
        fetch('/api/fun/projects?status=pending').then((r) => r.json()),
        fetch('/api/fun/projects?status=approved').then((r) => r.json()),
      ])
      setPending(p.projects || [])
      setApproved(a.projects || [])
    } catch {
      setPending([])
      setApproved([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setStatus = async (id: string, status: 'approved' | 'rejected') => {
    setBusyId(id)
    try {
      await fetch(`/api/fun/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: string) => {
    setBusyId(id)
    try {
      await fetch(`/api/fun/projects/${id}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const hostname = (link: string) => {
    try {
      return new URL(link).hostname.replace(/^www\./, '')
    } catch {
      return link
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/30 bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-[family-name:var(--font-playfair)] text-2xl font-medium text-foreground">
              BlueTAO
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-lg font-medium text-foreground">Fun Prospects</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/fun">
              <Button variant="outline" size="sm" className="gap-2">
                <PartyPopper className="w-4 h-4" />
                View Fun page
              </Button>
            </Link>
            <Button variant="outline" size="sm" onClick={load} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading submissions...</span>
          </div>
        ) : (
          <>
            {/* Pending */}
            <section className="mb-12">
              <h2 className="text-lg font-medium text-foreground mb-4">
                Awaiting approval ({pending.length})
              </h2>
              {pending.length === 0 ? (
                <p className="text-muted-foreground text-sm bg-card/50 border border-border/50 rounded-xl p-6">
                  No pending submissions right now.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {pending.map((project) => (
                    <div
                      key={project.id}
                      className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground">{project.title}</h3>
                        <a
                          href={project.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {hostname(project.link)}
                        </a>
                        {project.description && (
                          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                            {project.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          Submitted {new Date(project.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          disabled={busyId === project.id}
                          onClick={() => setStatus(project.id, 'approved')}
                          className="bg-emerald-600 text-white hover:bg-emerald-500 gap-1.5"
                        >
                          {busyId === project.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === project.id}
                          onClick={() => setStatus(project.id, 'rejected')}
                          className="gap-1.5 text-red-600 hover:text-red-700 border-red-300 hover:border-red-400 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/40"
                        >
                          <X className="w-4 h-4" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Approved (live on the Fun page) */}
            <section>
              <h2 className="text-lg font-medium text-foreground mb-4">
                Live on the Fun page ({approved.length})
              </h2>
              {approved.length === 0 ? (
                <p className="text-muted-foreground text-sm bg-card/50 border border-border/50 rounded-xl p-6">
                  Nothing approved yet.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {approved.map((project) => (
                    <div
                      key={project.id}
                      className="bg-card/50 border border-border/50 rounded-xl p-4 flex items-center gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-foreground truncate">{project.title}</h3>
                        <a
                          href={project.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-0.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          {hostname(project.link)}
                        </a>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === project.id}
                        onClick={() => remove(project.id)}
                        className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0"
                      >
                        {busyId === project.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

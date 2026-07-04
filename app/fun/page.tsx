'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Loader2, PartyPopper, ExternalLink, Send, CheckCircle2, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Prevent static generation - this page fetches live data
export const dynamic = 'force-dynamic'

interface FunProject {
  id: string
  title: string
  link: string
  description: string | null
}

export default function FunPage() {
  const [projects, setProjects] = useState<FunProject[]>([])
  const [loading, setLoading] = useState(true)

  const [title, setTitle] = useState('')
  const [link, setLink] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/fun/projects?status=approved')
      .then((r) => r.json())
      .then((d) => setProjects(d.projects || []))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false))
    // Record a FUN page view (best-effort) so it shows up in analytics
    fetch('/api/fun/track', { method: 'POST' }).catch(() => {})
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!title.trim()) {
      setFormError('Title is required.')
      return
    }
    if (!link.trim()) {
      setFormError('Link is required.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/fun/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, link, description }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Submission failed')
      }
      setSubmitted(true)
      setTitle('')
      setLink('')
      setDescription('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/30 bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-[family-name:var(--font-playfair)] text-2xl font-medium text-foreground">
              BlueTAO
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-lg font-medium text-foreground flex items-center gap-2">
              <PartyPopper className="w-5 h-5 text-pink-500" />
              Fun
            </h1>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm">
              Back to BlueTAO
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-12">
        {/* Intro */}
        <div className="text-center mb-12">
          <h2 className="font-[family-name:var(--font-playfair)] text-3xl md:text-4xl font-medium text-foreground text-balance">
            Projects that are powered by Bittensor or BlueTAO.
          </h2>
          <p className="text-muted-foreground mt-3 text-pretty">
            A growing showcase of apps built on decentralized AI. Try them out, then submit your own below.
          </p>
        </div>

        {/* Project list */}
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-3">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading projects...</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            No projects yet. Be the first to submit one below.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-16">
            {projects.map((project) => (
              <a
                key={project.id}
                href={project.link}
                target="_blank"
                rel="noopener noreferrer"
                className="group bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6 transition-colors hover:border-pink-400/60 hover:bg-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-medium text-foreground group-hover:text-pink-500 transition-colors">
                    {project.title}
                  </h3>
                  <ArrowUpRight className="w-5 h-5 text-muted-foreground group-hover:text-pink-500 transition-colors shrink-0" />
                </div>
                {project.description && (
                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                    {project.description}
                  </p>
                )}
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground mt-4">
                  <ExternalLink className="w-3.5 h-3.5" />
                  {(() => {
                    try {
                      return new URL(project.link).hostname.replace(/^www\./, '')
                    } catch {
                      return project.link
                    }
                  })()}
                </span>
              </a>
            ))}
          </div>
        )}

        {/* Submit form */}
        <div className="max-w-xl mx-auto bg-card/80 backdrop-blur-sm border border-border/50 rounded-2xl p-6 md:p-8">
          <h3 className="text-xl font-medium text-foreground mb-1">
            Submit Your Bittensor or BlueTAO-powered app
          </h3>
          <p className="text-sm text-muted-foreground mb-6">
            Submissions are reviewed before appearing on this page.
          </p>

          {submitted ? (
            <div className="flex flex-col items-center text-center py-8 gap-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-500" />
              <p className="text-foreground font-medium">Thanks for your submission!</p>
              <p className="text-sm text-muted-foreground">
                It will appear here once it&apos;s approved.
              </p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => setSubmitted(false)}>
                Submit another
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="fun-title" className="text-sm font-medium text-foreground">
                  Title <span className="text-pink-500">*</span>
                </label>
                <input
                  id="fun-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  placeholder="My awesome app"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-pink-400/50"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="fun-link" className="text-sm font-medium text-foreground">
                  Link <span className="text-pink-500">*</span>
                </label>
                <input
                  id="fun-link"
                  type="text"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  required
                  placeholder="https://example.com"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-pink-400/50"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="fun-desc" className="text-sm font-medium text-foreground">
                  Description <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <textarea
                  id="fun-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What does it do, and how does it use Bittensor or BlueTAO?"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-pink-400/50 resize-y"
                />
              </div>

              {formError && <p className="text-sm text-red-500">{formError}</p>}

              <Button
                type="submit"
                disabled={submitting}
                className="bg-pink-600 text-white hover:bg-pink-500 gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Submit for review
                  </>
                )}
              </Button>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}

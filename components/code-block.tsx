'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, Download, ExternalLink, Save, Loader2, Rocket, Globe, Link2, FileCode2 } from 'lucide-react'
import { bundleProject, normalizeProject, parseProject, PROJECT_PATHS, serializeProject, type ProjectPath } from '@/lib/project-document'

interface CodeBlockProps {
  code: string
  language?: string
  // When provided (and the code is previewable), shows a "Save" button so a
  // signed-in user can store this build in My Projects and keep editing later.
  // An optional publishedUrl is passed when the save happens right after a
  // successful publish, so the live link is stored alongside the project.
  onSave?: (code: string, language: string, publishedUrl?: string) => Promise<void> | void
  saveLabel?: string
  // True while the code is still streaming in. We suppress the live preview
  // iframe until the code is complete, otherwise the iframe reloads on every
  // chunk and the half-built page/game visibly flashes.
  isStreaming?: boolean
}

// Decide whether a block is previewable web code (HTML we can render live).
function isPreviewable(code: string, language?: string): boolean {
  const lang = (language || '').toLowerCase()
  if (lang === 'html' || lang === 'htm' || lang === 'bluetao-project') return true
  // Also catch full HTML documents even if the model omitted the language tag.
  const head = code.trimStart().slice(0, 400).toLowerCase()
  return head.includes('<!doctype html') || head.includes('<html')
}

// Wrap a bare HTML fragment in a minimal document so it always renders nicely.
function toDocument(code: string): string {
  const head = code.trimStart().slice(0, 400).toLowerCase()
  if (head.includes('<!doctype') || head.includes('<html')) return code
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body{font-family:system-ui,-apple-system,sans-serif;margin:16px;}</style>
  </head>
  <body>
${code}
  </body>
</html>`
}

// A Cursor/v0-style code block. For web (HTML) code it also offers a live
// Preview tab plus Download and Open-in-new-tab actions, so people with no
// coding experience can see, save, and share the result immediately.
export function CodeBlock({ code, language, onSave, saveLabel, isStreaming }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [activeFile, setActiveFile] = useState<ProjectPath>('index.html')
  const project = useMemo(() => parseProject(code), [code])
  const previewable = useMemo(() => isPreviewable(code, language), [code, language])
  const displayedCode = project ? project.files[activeFile] : code

  const doc = useMemo(() => {
    if (!previewable) return ''
    return project ? bundleProject(project) : toDocument(code)
  }, [previewable, project, code])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard may be unavailable; ignore silently.
    }
  }

  const handleDownload = () => {
    const blob = new Blob([doc], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'index.html'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const handleProjectDownload = () => {
    if (!project) return
    const manifest = JSON.stringify(project, null, 2)
    const blob = new Blob([manifest], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'bluetao-project.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const handleOpen = () => {
    const blob = new Blob([doc], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const handleSave = async () => {
    if (!onSave || saving) return
    setSaving(true)
    try {
      await onSave(code, (language || 'html').toLowerCase())
      setSaved(true)
      setTimeout(() => setSaved(false), 2200)
    } catch {
      // Errors surface via the parent handler (e.g. alert); keep the UI stable.
    } finally {
      setSaving(false)
    }
  }

  // One-click deploy: uploads the HTML and returns a real, shareable live URL.
  // On success we also auto-save the build to My Projects (for signed-in users)
  // so the published link is captured and the work is never lost.
  const handlePublish = async () => {
    if (publishing || publishedUrl) return
    setPublishing(true)
    setPublishError(null)
    try {
      const titleMatch = doc.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: doc, title: titleMatch?.[1]?.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || 'Could not publish')
      }
      const url = data.url as string
      setPublishedUrl(url)

      // Automatically save to My Projects with the live URL attached.
      if (onSave) {
        try {
          await onSave(code, (language || 'html').toLowerCase(), url)
          setSaved(true)
          setTimeout(() => setSaved(false), 2200)
        } catch {
          // Save failures are non-fatal to publishing; ignore silently.
        }
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Could not publish')
    } finally {
      setPublishing(false)
    }
  }

  const handleCopyLink = async () => {
    if (!publishedUrl) return
    try {
      await navigator.clipboard.writeText(publishedUrl)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 1800)
    } catch {
      // Clipboard may be unavailable; ignore silently.
    }
  }

  const label = (language || 'code').toLowerCase()

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-zinc-700 bg-zinc-800 px-3 py-1.5">
        <span className="text-xs font-medium text-zinc-400">{label}</span>

        <div className="flex items-center gap-1">
          {previewable && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
              aria-label="Publish to a real live web page"
            >
              {publishing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Publishing
                </>
              ) : publishedUrl ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Published
                </>
              ) : (
                <>
                  <Rocket className="h-3.5 w-3.5" />
                  Publish
                </>
              )}
            </button>
          )}
          {previewable && onSave && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-60"
              aria-label="Save to My Projects"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving
                </>
              ) : saved ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Saved
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  {saveLabel || 'Save'}
                </>
              )}
            </button>
          )}
          {previewable && (
            <>
              <button
                type="button"
                onClick={handleOpen}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
                aria-label="Open in a new tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </button>
              <button
                type="button"
                onClick={project ? handleProjectDownload : handleDownload}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
                aria-label={project ? 'Download the multi-file project' : 'Download as an HTML file'}
              >
                <Download className="h-3.5 w-3.5" />
                {project ? 'Project' : 'Download'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
            aria-label="Copy code"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live URL banner: shown after a successful publish */}
      {publishedUrl && (
        <div className="flex flex-col gap-2 border-b border-emerald-800/60 bg-emerald-950/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Globe className="h-4 w-4 shrink-0 text-emerald-400" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-emerald-300">
                {onSave ? 'Your site is live and saved to My Projects' : 'Your site is live'}
              </p>
              <a
                href={publishedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-xs text-emerald-100 underline underline-offset-2 hover:text-white"
              >
                {publishedUrl}
              </a>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-800/60 px-2 py-1 text-xs font-medium text-emerald-100 transition-colors hover:bg-emerald-700"
              aria-label="Copy live link"
            >
              {linkCopied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
              {linkCopied ? 'Copied' : 'Copy link'}
            </button>
            <a
              href={publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
              aria-label="Visit your live site"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Visit
            </a>
          </div>
        </div>
      )}

      {/* Publish error message */}
      {publishError && (
        <div className="border-b border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {publishError}
        </div>
      )}

      {/* Body: source code. Use the "Open" button to view the live result in a
          new tab (the inline preview tab was removed). */}
      {previewable && isStreaming && (
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-4 py-2 text-xs text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
          Building your app… press &quot;Open&quot; to view it when it&apos;s ready
        </div>
      )}
      {project && (
        <div className="flex overflow-x-auto border-b border-zinc-800 bg-zinc-950 px-2" role="tablist" aria-label="Project files">
          {PROJECT_PATHS.map((path) => (
            <button
              key={path}
              type="button"
              role="tab"
              aria-selected={activeFile === path}
              onClick={() => setActiveFile(path)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${activeFile === path ? 'border-sky-400 text-sky-300' : 'border-transparent text-zinc-500 hover:text-zinc-200'}`}
            >
              <FileCode2 className="h-3.5 w-3.5" />
              {path}
            </button>
          ))}
        </div>
      )}
      <pre className="max-h-96 overflow-auto p-4 text-sm leading-relaxed" role={project ? 'tabpanel' : undefined}>
        <code className="font-mono">{displayedCode}</code>
      </pre>
    </div>
  )
}

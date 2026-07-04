'use client'

import { useMemo, useState } from 'react'
import { Check, Copy, Eye, Code2, Download, ExternalLink, Save, Loader2 } from 'lucide-react'

interface CodeBlockProps {
  code: string
  language?: string
  // When provided (and the code is previewable), shows a "Save" button so a
  // signed-in user can store this build in My Projects and keep editing later.
  onSave?: (code: string, language: string) => Promise<void> | void
  saveLabel?: string
}

// Decide whether a block is previewable web code (HTML we can render live).
function isPreviewable(code: string, language?: string): boolean {
  const lang = (language || '').toLowerCase()
  if (lang === 'html' || lang === 'htm') return true
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
export function CodeBlock({ code, language, onSave, saveLabel }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const previewable = useMemo(() => isPreviewable(code, language), [code, language])
  // For previewable code, default to showing the running result first.
  const [tab, setTab] = useState<'preview' | 'code'>(previewable ? 'preview' : 'code')

  const doc = useMemo(() => (previewable ? toDocument(code) : ''), [previewable, code])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
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

  const label = (language || 'code').toLowerCase()

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-zinc-700 bg-zinc-800 px-3 py-1.5">
        {previewable ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                tab === 'preview'
                  ? 'bg-sky-600 text-white'
                  : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              type="button"
              onClick={() => setTab('code')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                tab === 'code'
                  ? 'bg-zinc-600 text-white'
                  : 'text-zinc-300 hover:bg-zinc-700 hover:text-white'
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              Code
            </button>
          </div>
        ) : (
          <span className="text-xs font-medium text-zinc-400">{label}</span>
        )}

        <div className="flex items-center gap-1">
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
                aria-label="Open preview in a new tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white"
                aria-label="Download as an HTML file"
              >
                <Download className="h-3.5 w-3.5" />
                Download
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

      {/* Body: live preview or source code */}
      {previewable && tab === 'preview' ? (
        <div className="bg-white">
          <iframe
            title="Live preview"
            srcDoc={doc}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="h-96 w-full border-0 bg-white"
          />
        </div>
      ) : (
        <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
          <code className="font-mono">{code}</code>
        </pre>
      )}
    </div>
  )
}

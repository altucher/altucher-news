'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

interface CodeBlockProps {
  code: string
  language?: string
}

// A clean, Cursor/v0-style fenced code block: dark card with a header bar
// showing the language and a copy button, plus a horizontally scrollable body.
export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard may be unavailable; ignore silently.
    }
  }

  const label = (language || 'code').toLowerCase()

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-700 bg-zinc-800 px-3 py-1.5">
        <span className="text-xs font-medium text-zinc-400">{label}</span>
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
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  )
}

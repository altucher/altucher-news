'use client'

import { useState } from 'react'

/** The bracketed control: the one interactive idiom on the page. */
export function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="b"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* clipboard unavailable: nothing to do */
        }
      }}
    >
      <span className="br">[</span>
      <span className="lbl">{done ? 'copied' : label}</span>
      <span className="br">]</span>
    </button>
  )
}

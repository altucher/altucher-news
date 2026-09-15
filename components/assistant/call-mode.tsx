'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PhoneOff, Mic } from 'lucide-react'

type Phase = 'listening' | 'thinking' | 'speaking' | 'idle' | 'unsupported'

type Recognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
}

/**
 * "Call it": a hands-free loop. Listen -> send the transcript as a message ->
 * speak the reply -> listen again, until hang up. Speech in via the browser's
 * recognizer, speech out via /api/tts (Vocence) with the browser voice as
 * fallback, exactly like the classic chat's read-aloud.
 */
export default function CallMode({ assistantName, onSend, onClose }: {
  assistantName: string
  onSend: (text: string) => Promise<string[]>
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const recRef = useRef<Recognition | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const closedRef = useRef(false)

  const stopAudio = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null }
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel()
  }, [])

  const speak = useCallback(async (text: string): Promise<void> => {
    const clean = text.replace(/[*#_`>]/g, '').trim()
    if (!clean) return
    setPhase('speaking')
    try {
      const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean }) })
      if (res.ok && (res.headers.get('content-type') || '').startsWith('audio/')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        await new Promise<void>((resolve) => {
          const a = new Audio(url)
          audioRef.current = a
          a.onended = () => { URL.revokeObjectURL(url); resolve() }
          a.onerror = () => { URL.revokeObjectURL(url); resolve() }
          a.play().catch(() => resolve())
        })
        return
      }
    } catch { /* fall back to the browser voice */ }
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(clean)
      u.rate = 1.02
      u.onend = () => resolve()
      u.onerror = () => resolve()
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    })
  }, [])

  const listen = useCallback(() => {
    if (closedRef.current) return
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR) { setPhase('unsupported'); return }
    const rec = new SR()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = 'en-US'
    let heard = ''
    rec.onresult = (e) => {
      heard = Array.from({ length: e.results.length }).map((_, i) => e.results[i][0].transcript).join(' ').trim()
      setTranscript(heard)
    }
    rec.onerror = () => { /* onend handles the retry */ }
    rec.onend = async () => {
      if (closedRef.current) return
      if (!heard) { setTimeout(listen, 300); return }
      setPhase('thinking')
      try {
        const bubbles = await onSend(heard)
        const text = bubbles.join(' ')
        setReply(text)
        await speak(text)
      } catch {
        setReply('Sorry, I lost you for a second.')
        await speak('Sorry, I lost you for a second.')
      }
      if (!closedRef.current) { setTranscript(''); listen() }
    }
    recRef.current = rec
    setPhase('listening')
    try { rec.start() } catch { setTimeout(listen, 500) }
  }, [onSend, speak])

  useEffect(() => {
    closedRef.current = false
    const t = setTimeout(listen, 200)
    return () => { clearTimeout(t); closedRef.current = true; try { recRef.current?.abort() } catch { /* ignore */ } stopAudio() }
  }, [listen, stopAudio])

  const hangUp = () => { closedRef.current = true; try { recRef.current?.abort() } catch { /* ignore */ } stopAudio(); onClose() }

  const label = phase === 'listening' ? 'Listening' : phase === 'thinking' ? 'Thinking' : phase === 'speaking' ? 'Speaking' : phase === 'unsupported' ? 'Voice needs Chrome or Safari' : 'Connecting'

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-between bg-[oklch(0.12_0.02_262)] text-foreground px-6 py-10">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">On a call with</p>
        <h2 className="mt-2 font-[family-name:var(--font-playfair)] text-3xl">{assistantName}</h2>
      </div>
      <div className="flex flex-col items-center gap-6">
        <div className={`relative flex h-40 w-40 items-center justify-center rounded-full bg-[var(--gold)]/15 ${phase === 'listening' ? 'animate-pulse' : ''}`}>
          <div className={`h-28 w-28 rounded-full bg-[var(--gold)] shadow-[0_0_60px_var(--gold)] transition-transform duration-500 ${phase === 'speaking' ? 'scale-110' : phase === 'thinking' ? 'scale-90 opacity-80' : 'scale-100'}`} />
          {phase === 'listening' && <Mic className="absolute h-8 w-8 text-[var(--gold-foreground)]" />}
        </div>
        <p className="text-lg text-muted-foreground">{label}{phase === 'thinking' || phase === 'listening' ? '…' : ''}</p>
        <div className="min-h-[4.5rem] max-w-md text-center">
          {transcript && <p className="text-sm text-muted-foreground">“{transcript}”</p>}
          {reply && phase === 'speaking' && <p className="mt-2 text-base">{reply}</p>}
        </div>
      </div>
      <button onClick={hangUp} className="flex items-center gap-2 rounded-full bg-destructive px-6 py-3 text-destructive-foreground shadow-lg hover:opacity-90" aria-label="Hang up">
        <PhoneOff className="h-5 w-5" /> Hang up
      </button>
    </div>
  )
}

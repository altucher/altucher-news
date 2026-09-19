'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Send, Mic, Phone, ListChecks, Settings, Mail, ChevronDown, ChevronUp } from 'lucide-react'
import { BlueTaoLogo } from '@/components/animated-background'
import { useSpeechToText } from '@/hooks/use-voice'
import CallMode from './call-mode'
import { JobsPanel, SetupPanel, STATUS_LABEL, STATUS_STYLE, type JobUi, type ProfileUi } from './panels'

type Msg = {
  id: string
  role: 'user' | 'assistant' | 'event'
  kind: 'text' | 'job_update' | 'checkin' | 'email_in' | 'email_out' | 'system'
  content: string
  job_id: string | null
  channel: string
  meta: Record<string, unknown>
  created_at: string
  pending?: boolean
}

const POLL_MS = 4000

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function EmailCard({ m }: { m: Msg }) {
  const [open, setOpen] = useState(false)
  const lines = m.content.split('\n')
  const head = lines.slice(0, 2).join(' · ').replace(/^From: /, '').replace(/Subject: /, '')
  const body = lines.slice(3).join('\n').trim()
  const draft = Boolean(m.meta?.draft)
  const isOut = m.kind === 'email_out'
  return (
    <div className="mx-auto w-full max-w-[85%] rounded-2xl border border-border bg-card/80 p-3 text-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mail className="h-3.5 w-3.5 text-[var(--gold)]" />
        <span className="font-medium text-foreground">{isOut ? (draft ? 'Draft email' : 'Email sent') : 'Email received'}</span>
        <span className="ml-auto">{timeLabel(m.created_at)}</span>
      </div>
      <p className="mt-1.5 truncate">{head}</p>
      {body && (
        <>
          <p className={`mt-1 whitespace-pre-wrap text-muted-foreground ${open ? '' : 'line-clamp-3'}`}>{body}</p>
          <button onClick={() => setOpen(!open)} className="mt-1 flex items-center gap-1 text-xs text-[var(--gold)]">
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}{open ? 'less' : 'more'}
          </button>
        </>
      )}
    </div>
  )
}

export default function Thread({ initialProfile, address, emailLive, userEmail }: {
  initialProfile: ProfileUi; address: string | null; emailLive: boolean; userEmail: string
}) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [jobs, setJobs] = useState<JobUi[]>([])
  const [profile, setProfile] = useState<ProfileUi>(initialProfile)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [panel, setPanel] = useState<null | 'jobs' | 'setup'>(null)
  const [calling, setCalling] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastTsRef = useRef<string | null>(null)
  const kickedRef = useRef(false)

  const merge = useCallback((incoming: Msg[]) => {
    if (!incoming.length) return
    setMessages((prev) => {
      const byId = new Map(prev.filter((m) => !m.pending).map((m) => [m.id, m]))
      for (const m of incoming) byId.set(m.id, m)
      const list = Array.from(byId.values()).sort((a, b) => a.created_at.localeCompare(b.created_at))
      const pending = prev.filter((m) => m.pending)
      return [...list, ...pending]
    })
    const newest = incoming.reduce((a, m) => (m.created_at > a ? m.created_at : a), lastTsRef.current || '')
    lastTsRef.current = newest
  }, [])

  const refresh = useCallback(async () => {
    try {
      const q = lastTsRef.current ? `?after=${encodeURIComponent(lastTsRef.current)}` : ''
      const r = await fetch(`/api/assistant/messages${q}`, { cache: 'no-store' })
      if (!r.ok) return
      const j = await r.json()
      merge(j.messages || [])
      if (j.jobs) setJobs(j.jobs)
      if (j.profile) setProfile(j.profile)
      return (j.messages || []).length as number
    } catch { return 0 }
  }, [merge])

  // First load, then a kickoff greeting if the thread is empty, then polling.
  useEffect(() => {
    let alive = true
    ;(async () => {
      await refresh()
      if (!alive) return
      setLoaded(true)
      if (!lastTsRef.current && !kickedRef.current) {
        kickedRef.current = true
        setSending(true)
        try {
          const r = await fetch('/api/assistant/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kickoff: true }) })
          const j = await r.json()
          merge(j.messages || [])
          if (j.profile) setProfile(j.profile)
        } finally { setSending(false) }
      }
    })()
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [refresh, merge])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, sending])

  const send = useCallback(async (text: string, channel: 'web' | 'voice' = 'web'): Promise<string[]> => {
    const clean = text.trim()
    if (!clean || sending) return []
    setError('')
    const temp: Msg = { id: `tmp-${Date.now()}`, role: 'user', kind: 'text', content: clean, job_id: null, channel, meta: {}, created_at: new Date().toISOString(), pending: true }
    setMessages((prev) => [...prev, temp])
    setSending(true)
    try {
      const r = await fetch('/api/assistant/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: clean, channel }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      setMessages((prev) => prev.filter((m) => m.id !== temp.id))
      merge(j.messages || [])
      if (j.jobs) setJobs(j.jobs)
      if (j.profile) setProfile(j.profile)
      return (j.messages || []).filter((m: Msg) => m.role === 'assistant').map((m: Msg) => m.content)
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== temp.id))
      setInput(clean)
      setError(String((e as Error)?.message || 'Could not send'))
      return []
    } finally { setSending(false) }
  }, [merge, sending])

  const { toggle: toggleMic, listening, supported: micSupported } = useSpeechToText((t) => setInput((v) => (v ? `${v} ${t}` : t)))

  const activeJobs = useMemo(() => jobs.filter((j) => ['queued', 'working', 'waiting'].includes(j.status)), [jobs])
  const waitingJobs = activeJobs.filter((j) => j.status === 'waiting')
  const status = waitingJobs.length ? `needs you on ${waitingJobs.length === 1 ? 'one thing' : `${waitingJobs.length} things`}`
    : activeJobs.length ? `working on ${activeJobs.length === 1 ? 'one thing' : `${activeJobs.length} things`}` : 'here when you need me'

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
      e.preventDefault()
      const v = input
      setInput('')
      send(v)
    }
  }

  const jobTitle = (m: Msg) => (m.meta?.title as string) || jobs.find((j) => j.id === m.job_id)?.title

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-3">
          <BlueTaoLogo className="h-8 w-8 text-[var(--gold)] drop-shadow-[0_0_12px_var(--gold)]" />
          <div>
            <p className="font-[family-name:var(--font-playfair)] text-lg leading-tight">{profile.assistant_name}</p>
            <p className="text-xs text-muted-foreground">{status}</p>
          </div>
        </div>
        <nav className="flex items-center gap-1">
          <button onClick={() => setPanel('jobs')} className="relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-secondary" aria-label="Jobs">
            <ListChecks className="h-4 w-4" /><span className="hidden sm:inline">jobs</span>
            {activeJobs.length > 0 && <span className="ml-0.5 rounded-full bg-[var(--gold)] px-1.5 text-[11px] font-semibold text-[var(--gold-foreground)]">{activeJobs.length}</span>}
          </button>
          <button onClick={() => setPanel('setup')} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-secondary" aria-label="Setup">
            <Settings className="h-4 w-4" /><span className="hidden sm:inline">setup</span>
          </button>
          <Link href="/" className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground md:block">classic</Link>
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 md:px-0">
        <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
          {!loaded && <p className="py-10 text-center text-sm text-muted-foreground">Opening your thread…</p>}
          {messages.map((m, i) => {
            const prev = messages[i - 1]
            const showDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at)
            const sameAuthor = prev && prev.role === m.role && prev.kind !== 'email_in' && prev.kind !== 'email_out' && m.role !== 'event'
            const gapTop = showDay ? '' : sameAuthor ? '' : 'mt-3'
            return (
              <div key={m.id} className={gapTop}>
                {showDay && <p className="my-4 text-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dayLabel(m.created_at)}</p>}
                {m.role === 'user' && (
                  <div className="flex justify-end">
                    <p title={timeLabel(m.created_at)} className={`max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2 text-[15px] leading-snug text-primary-foreground ${m.pending ? 'opacity-60' : ''}`}>{m.content}</p>
                  </div>
                )}
                {m.role === 'assistant' && (
                  <div className="flex flex-col items-start">
                    {(m.kind === 'job_update' || m.kind === 'checkin') && !sameAuthor && (
                      <span className="mb-1 ml-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {m.kind === 'checkin' ? 'texted you first' : jobTitle(m) ? <>on <em className="not-italic text-foreground/80">{jobTitle(m)}</em></> : 'update'}
                        {typeof m.meta?.status === 'string' && <span className={`rounded-full px-1.5 py-px text-[10px] ${STATUS_STYLE[String(m.meta.status)] || ''}`}>{STATUS_LABEL[String(m.meta.status)] || String(m.meta.status)}</span>}
                      </span>
                    )}
                    <p title={timeLabel(m.created_at)} className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-border bg-card px-4 py-2 text-[15px] leading-snug">{m.content}</p>
                  </div>
                )}
                {m.role === 'event' && (m.kind === 'email_in' || m.kind === 'email_out') && <div className="my-2"><EmailCard m={m} /></div>}
                {m.role === 'event' && m.kind !== 'email_in' && m.kind !== 'email_out' && (
                  <p className="my-2 text-center text-xs text-muted-foreground">
                    <span className="rounded-full border border-border/60 bg-card/50 px-3 py-1">{m.content}</span>
                  </p>
                )}
              </div>
            )
          })}
          {sending && (
            <div className="mt-3 flex justify-start">
              <span className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-border bg-card px-4 py-3">
                {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 120}ms` }} />)}
              </span>
            </div>
          )}
          {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
          <div ref={bottomRef} className="h-2" />
        </div>
      </main>

      <footer className="border-t border-border/60 bg-background/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:px-0">
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <button onClick={() => setCalling(true)} className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border hover:bg-secondary" aria-label="Call">
            <Phone className="h-4 w-4" />
          </button>
          <div className="flex flex-1 items-end rounded-3xl border border-border bg-input px-3 py-1.5 focus-within:border-[var(--gold)]">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
              placeholder={`Text ${profile.assistant_name}…`}
              className="max-h-40 min-h-[1.75rem] flex-1 resize-none bg-transparent py-1.5 text-base sm:text-[15px] leading-snug outline-none placeholder:text-muted-foreground"
              style={{ height: 'auto' }}
              onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 160)}px` }}
            />
            {micSupported && (
              <button onClick={toggleMic} className={`ml-1 mb-0.5 rounded-full p-1.5 ${listening ? 'bg-destructive/20 text-destructive' : 'text-muted-foreground hover:text-foreground'}`} aria-label="Dictate">
                <Mic className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => { const v = input; setInput(''); send(v) }}
            disabled={!input.trim() || sending}
            className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--gold)] text-[var(--gold-foreground)] disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mx-auto mt-1.5 max-w-2xl px-2 text-center text-[11px] text-muted-foreground">
          {address ? <span className="hidden sm:inline">Email {profile.assistant_name} at <span className="font-mono">{address}</span>{emailLive ? '' : ' (reserved)'} · </span> : null}it keeps working after you close this.
        </p>
      </footer>

      {panel === 'jobs' && <JobsPanel jobs={jobs} onClose={() => setPanel(null)} onChange={(j) => setJobs((prev) => prev.map((x) => (x.id === j.id ? j : x)))} />}
      {panel === 'setup' && <SetupPanel profile={profile} address={address} emailLive={emailLive} userEmail={userEmail} onClose={() => setPanel(null)} onProfile={setProfile} />}
      {calling && <CallMode assistantName={profile.assistant_name} onSend={(t) => send(t, 'voice')} onClose={() => setCalling(false)} />}
    </div>
  )
}

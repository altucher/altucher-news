'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import { Send, Square, Download, Power, ChevronDown, ChevronRight, ListChecks, Activity, Loader2, AlertTriangle, Terminal, X } from 'lucide-react'
import { BlueTaoLogo } from '@/components/animated-background'
import { cn } from '@/lib/utils'

type Mode = 'plan' | 'ask' | 'auto-edit' | 'auto' | 'yolo'
type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed' }
type Usage = { inputTokens: number; outputTokens: number; cachedInputTokens?: number }
type Session = { sid: string; title: string | null; mode: string; git_url: string | null; status: string; killed: string | null; spent_usd: number; model_calls: number; created_at: string }
type Item =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string }
  | { kind: 'tool'; id: number; toolId: string; name: string; summary: string; display?: string; isError?: boolean; content?: string; done: boolean }
  | { kind: 'error'; id: number; text: string }
type Permission = { id: string; tool: string; summary: string; detail?: string; risk: string }

const MODES: Array<{ value: Mode; label: string; hint: string }> = [
  { value: 'plan', label: 'Plan', hint: 'reads and plans, never edits' },
  { value: 'ask', label: 'Ask', hint: 'asks before every tool' },
  { value: 'auto-edit', label: 'Auto-edit', hint: 'edits freely, asks before commands' },
  { value: 'auto', label: 'Auto', hint: 'edits and runs safe commands' },
  { value: 'yolo', label: 'Yolo', hint: 'never asks' },
]

const EXAMPLES = [
  'Build a CLI todo app in Python with add, list, done, and a JSON file store. Add tests and run them.',
  'Create a static landing page for a coffee shop: HTML, CSS, one script for a menu filter. Open index.html and verify it renders.',
  'Write an Express server with a /health route and a /notes CRUD API backed by SQLite. Include a test script and run it.',
]

const fmt = (n: number) => n.toLocaleString()

export default function CodeAgent({ configured, userEmail }: { configured: boolean; userEmail: string }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [mode, setMode] = useState<Mode>('auto')
  const [gitUrl, setGitUrl] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [activity, setActivity] = useState<string[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [usage, setUsage] = useState<Usage>({ inputTokens: 0, outputTokens: 0 })
  const [busy, setBusy] = useState(false)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'lost'>('connecting')
  const [permission, setPermission] = useState<Permission | null>(null)
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState('')
  const [sidePanel, setSidePanel] = useState(false)
  const [openTools, setOpenTools] = useState<Record<number, boolean>>({})
  const [confirmEnd, setConfirmEnd] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const seqRef = useRef(0)
  const nextId = useRef(1)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const alive = session?.status === 'alive'

  const scrollDown = useCallback(() => {
    const t = transcriptRef.current
    if (!t) return
    if (t.scrollHeight - t.scrollTop - t.clientHeight < 160) t.scrollTop = t.scrollHeight
  }, [])

  const handleEvent = useCallback((ev: Record<string, any>) => {
    switch (ev.type) {
      case 'session':
        setBusy(Boolean(ev.info?.busy))
        if (ev.info?.usage) setUsage(ev.info.usage)
        if (ev.info?.todos) setTodos(ev.info.todos)
        if (ev.info?.mode) setMode(ev.info.mode)
        break
      case 'turn_start':
        setItems((p) => [...p, { kind: 'user', id: nextId.current++, text: String(ev.text || '') }])
        setBusy(true)
        break
      case 'text':
        setItems((p) => {
          const last = p[p.length - 1]
          if (last && last.kind === 'assistant') return [...p.slice(0, -1), { ...last, text: last.text + String(ev.delta || '') }]
          return [...p, { kind: 'assistant', id: nextId.current++, text: String(ev.delta || '') }]
        })
        break
      case 'tool_start':
        setItems((p) => [...p, { kind: 'tool', id: nextId.current++, toolId: String(ev.id), name: String(ev.name || 'tool'), summary: String(ev.summary || ''), done: false }])
        break
      case 'tool_end':
        setItems((p) => p.map((it) => (it.kind === 'tool' && it.toolId === String(ev.id) ? { ...it, done: true, display: String(ev.display || ''), isError: Boolean(ev.isError), content: String(ev.content || '') } : it)))
        break
      case 'log':
        setActivity((a) => [...a.slice(-199), String(ev.text || '')])
        break
      case 'usage':
        if (ev.usage) setUsage(ev.usage)
        break
      case 'todos':
        setTodos(Array.isArray(ev.todos) ? ev.todos : [])
        break
      case 'permission_request':
        setPermission({ id: String(ev.id), tool: String(ev.tool || ''), summary: String(ev.summary || ''), detail: ev.detail ? String(ev.detail) : undefined, risk: String(ev.risk || '') })
        break
      case 'permission_resolved':
        setPermission((p) => (p && p.id === String(ev.id) ? null : p))
        break
      case 'error':
        setItems((p) => [...p, { kind: 'error', id: nextId.current++, text: String(ev.text || 'error') }])
        setBusy(false)
        break
      case 'turn_end':
        setBusy(false)
        break
    }
  }, [])

  const connect = useCallback((sid: string) => {
    esRef.current?.close()
    setConnection('connecting')
    const es = new EventSource(`/api/code/${sid}/events?since=${seqRef.current}`)
    esRef.current = es
    es.onopen = () => setConnection('live')
    es.onmessage = (msg) => {
      if (msg.lastEventId) seqRef.current = Math.max(seqRef.current, Number(msg.lastEventId) || 0)
      try { handleEvent(JSON.parse(msg.data)) } catch { /* ignore malformed */ }
    }
    es.addEventListener('gone', () => { setConnection('lost') })
    es.onerror = () => setConnection('lost')
  }, [handleEvent])

  const refreshStatus = useCallback(async (sid: string) => {
    try {
      const r = await fetch(`/api/code/${sid}/status`, { cache: 'no-store' })
      if (!r.ok) return
      const j = await r.json()
      if (j.session) setSession(j.session)
      if (j.status?.anycode) {
        setBusy(Boolean(j.status.anycode.busy))
        if (j.status.anycode.usage) setUsage(j.status.anycode.usage)
        if (j.status.anycode.todos) setTodos(j.status.anycode.todos)
      }
    } catch { /* offline */ }
  }, [])

  // Load sessions; resume the live one if any.
  useEffect(() => {
    if (!configured) { setLoaded(true); return }
    fetch('/api/code/session', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      const list: Session[] = j.sessions || []
      setSessions(list)
      const live = list.find((s) => s.status === 'alive')
      if (live) { setSession(live); setMode((live.mode as Mode) || 'auto') }
    }).catch(() => {}).finally(() => setLoaded(true))
  }, [configured])

  useEffect(() => {
    if (!session || session.status !== 'alive') { esRef.current?.close(); return }
    seqRef.current = 0
    setItems([]); setActivity([]); setTodos([]); setPermission(null)
    connect(session.sid)
    const t = setInterval(() => refreshStatus(session.sid), 15000)
    return () => { clearInterval(t); esRef.current?.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sid, session?.status])

  useEffect(() => { scrollDown() }, [items, scrollDown])

  async function start() {
    setStarting(true); setStartError('')
    try {
      const r = await fetch('/api/code/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, git_url: gitUrl.trim() || undefined }) })
      const j = await r.json()
      if (!r.ok) { if (j.session) setSession(j.session); setStartError(j.error || 'Could not start.'); return }
      setSession(j.session)
      setSessions((s) => [j.session, ...s])
    } catch (e) { setStartError(String((e as Error)?.message || e)) } finally { setStarting(false) }
  }

  async function send() {
    const text = input.trim()
    if (!text || !session || !alive) return
    setNotice('')
    const r = await fetch(`/api/code/${session.sid}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    if (r.status === 409) { setNotice('Still working on the last request. Stop it or wait.'); return }
    if (!r.ok) { const j = await r.json().catch(() => ({})); setNotice(j.error || `Failed (HTTP ${r.status})`); if (r.status === 404) refreshStatus(session.sid); return }
    setInput('')
    setBusy(true)
  }

  async function act(action: 'interrupt' | 'destroy' | 'mode' | 'permission', payload: Record<string, unknown> = {}) {
    if (!session) return
    const r = await fetch(`/api/code/${session.sid}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (action === 'destroy') { setSession((s) => (s ? { ...s, status: 'destroyed' } : s)); setSessions((list) => list.map((s) => (s.sid === session.sid ? { ...s, status: 'destroyed' } : s))) }
    if (action === 'permission') setPermission(null)
    if (!r.ok && action !== 'destroy') setNotice(`${action} failed (HTTP ${r.status})`)
  }

  const activeTodos = useMemo(() => todos.filter((t) => t.status !== 'completed').length, [todos])
  const modeMeta = MODES.find((m) => m.value === mode)

  if (!configured) {
    return (
      <Shell userEmail={userEmail}>
        <div className="m-auto max-w-md text-center text-muted-foreground">
          <AlertTriangle className="mx-auto h-8 w-8 text-[var(--gold)]" />
          <p className="mt-3">The code agent is not configured on this deployment (missing worker credentials).</p>
        </div>
      </Shell>
    )
  }

  if (!loaded) return <Shell userEmail={userEmail}><p className="m-auto text-sm text-muted-foreground">Loading…</p></Shell>

  if (!session || !alive) {
    return (
      <Shell userEmail={userEmail}>
        <div className="mx-auto w-full max-w-2xl px-4 py-10">
          {session && !alive && (
            <div className="mb-6 rounded-2xl border border-border bg-card p-4 text-sm">
              <p className="font-medium">Last session ended{session.killed ? ` (${session.killed})` : ''}.</p>
              <p className="mt-1 text-muted-foreground">Spent ${session.spent_usd.toFixed(3)} over {session.model_calls} model calls. Workspaces are ephemeral, so files from an ended session are gone unless you downloaded them.</p>
            </div>
          )}
          <h1 className="font-[family-name:var(--font-playfair)] text-3xl">Start a coding session</h1>
          <p className="mt-2 text-muted-foreground">A real agent with a shell, a file system and a browser-free build loop, in its own workspace. James picks the model for every step. Sessions run up to an hour, cap at $2, and close after 15 idle minutes. Download your files before you end one.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">Permission mode</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className="w-full rounded-xl border border-border bg-input px-3 py-2.5 text-base sm:text-sm">
                {MODES.map((m) => <option key={m.value} value={m.value}>{m.label} — {m.hint}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">Start from a public git repo (optional)</span>
              <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/you/repo" className="w-full rounded-xl border border-border bg-input px-3 py-2.5 text-base sm:text-sm outline-none focus:border-[var(--gold)]" />
            </label>
          </div>
          <button onClick={start} disabled={starting} className="mt-5 flex items-center gap-2 rounded-full bg-[var(--gold)] px-6 py-3 font-medium text-[var(--gold-foreground)] disabled:opacity-60">
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
            {starting ? 'Starting workspace…' : 'Start session'}
          </button>
          {startError && <p className="mt-3 text-sm text-destructive">{startError}</p>}
          {sessions.filter((s) => s.status !== 'alive').length > 0 && (
            <div className="mt-10">
              <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Earlier sessions</p>
              <ul className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
                {sessions.filter((s) => s.status !== 'alive').slice(0, 8).map((s) => (
                  <li key={s.sid} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="truncate">{s.title || 'Untitled session'}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()} · ${Number(s.spent_usd).toFixed(3)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Shell>
    )
  }

  return (
    <Shell userEmail={userEmail} right={
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn('h-2 w-2 rounded-full', connection === 'live' ? (busy ? 'bg-[var(--gold)] animate-pulse' : 'bg-emerald-400') : connection === 'connecting' ? 'bg-muted-foreground' : 'bg-destructive')} />
        <span className="hidden sm:inline">{busy ? 'working' : connection === 'live' ? 'ready' : connection}</span>
        <span className="hidden md:inline">· {fmt(usage.inputTokens)} in / {fmt(usage.outputTokens)} out</span>
        <span>· ${session.spent_usd.toFixed(3)}</span>
        <select value={mode} onChange={(e) => { const m = e.target.value as Mode; setMode(m); act('mode', { mode: m }) }} className="ml-1 rounded-full border border-border bg-input px-2 py-1 text-xs text-foreground" title={modeMeta?.hint}>
          {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <button onClick={() => setSidePanel((v) => !v)} className="relative rounded-full border border-border p-1.5 text-foreground lg:hidden" aria-label="Tasks and activity">
          <ListChecks className="h-4 w-4" />
          {activeTodos > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-[var(--gold)] px-1 text-[10px] font-semibold text-[var(--gold-foreground)]">{activeTodos}</span>}
        </button>
        <a href={`/api/code/${session.sid}/workspace`} className="rounded-full border border-border p-1.5 text-foreground hover:bg-secondary" title="Download workspace (.tgz)" aria-label="Download workspace"><Download className="h-4 w-4" /></a>
        {confirmEnd ? (
          <span className="flex items-center gap-1">
            <button onClick={() => { setConfirmEnd(false); act('destroy') }} className="rounded-full bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground">End &amp; delete workspace</button>
            <button onClick={() => setConfirmEnd(false)} className="rounded-full border border-border px-2 py-1.5 text-xs text-foreground">Keep</button>
          </span>
        ) : (
          <button onClick={() => setConfirmEnd(true)} className="rounded-full border border-border p-1.5 text-destructive hover:bg-destructive/10" title="End session" aria-label="End session"><Power className="h-4 w-4" /></button>
        )}
      </div>
    }>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div ref={transcriptRef} className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
            <div className="mx-auto max-w-3xl space-y-3">
              {items.length === 0 && (
                <div className="py-10 text-center">
                  <Terminal className="mx-auto h-8 w-8 text-[var(--gold)]" />
                  <p className="mt-3 text-muted-foreground">Workspace ready{session.git_url ? ` with ${session.git_url}` : ', empty'}. Tell it what to build.</p>
                  <div className="mx-auto mt-5 flex max-w-xl flex-col gap-2">
                    {EXAMPLES.map((e) => <button key={e} onClick={() => setInput(e)} className="rounded-xl border border-border bg-card px-4 py-2.5 text-left text-sm hover:border-[var(--gold)]">{e}</button>)}
                  </div>
                </div>
              )}
              {items.map((it) => {
                if (it.kind === 'user') return <div key={it.id} className="flex justify-end"><p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2 text-[15px] text-primary-foreground">{it.text}</p></div>
                if (it.kind === 'assistant') return !it.text.trim() ? null : (
                  <div key={it.id} className="md rounded-2xl border border-border bg-card px-4 py-3 text-[15px] leading-relaxed">
                    <ReactMarkdown>{it.text}</ReactMarkdown>
                  </div>
                )
                if (it.kind === 'error') return <p key={it.id} className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">{it.text}</p>
                const open = openTools[it.id]
                return (
                  <div key={it.id} className={cn('rounded-xl border bg-black/30 font-mono text-[13px]', it.isError ? 'border-destructive/50' : 'border-border')}>
                    <button onClick={() => setOpenTools((o) => ({ ...o, [it.id]: !o[it.id] }))} className="flex w-full items-center gap-2 px-3 py-2 text-left">
                      {it.done ? (open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />) : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--gold)]" />}
                      <span className="shrink-0 text-[var(--gold)]">{it.name}</span>
                      <span className="truncate text-muted-foreground">{it.summary}</span>
                      {it.done && it.display && <span className={cn('ml-auto max-w-[45%] shrink-0 truncate text-xs', it.isError ? 'text-destructive' : 'text-muted-foreground')}>{it.display}</span>}
                    </button>
                    {open && it.content && <pre className="max-h-80 overflow-auto border-t border-border px-3 py-2 whitespace-pre-wrap text-muted-foreground">{it.content}</pre>}
                  </div>
                )
              })}
              {busy && items.length > 0 && items[items.length - 1].kind !== 'tool' && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> thinking…</p>
              )}
            </div>
          </div>
          <div className="border-t border-border/60 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
            <div className="mx-auto flex max-w-3xl items-end gap-2">
              <div className="flex flex-1 items-end rounded-2xl border border-border bg-input px-3 py-1.5 focus-within:border-[var(--gold)]">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) { e.preventDefault(); send() } }}
                  rows={2}
                  placeholder={busy ? 'Working… (Enter queues nothing until it finishes)' : 'Describe what to build or change. Shift+Enter for a new line.'}
                  className="max-h-48 min-w-0 flex-1 resize-none bg-transparent py-1.5 font-mono text-base leading-snug outline-none placeholder:text-muted-foreground sm:text-sm"
                />
              </div>
              {busy ? (
                <button onClick={() => act('interrupt')} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-destructive/50 text-destructive" aria-label="Stop"><Square className="h-4 w-4 fill-current" /></button>
              ) : (
                <button onClick={send} disabled={!input.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--gold)] text-[var(--gold-foreground)] disabled:opacity-40" aria-label="Send"><Send className="h-4 w-4" /></button>
              )}
            </div>
            {notice && <p className="mx-auto mt-1.5 max-w-3xl text-xs text-destructive">{notice}</p>}
          </div>
        </div>

        <aside className={cn('w-80 shrink-0 flex-col border-l border-border bg-sidebar lg:flex', sidePanel ? 'fixed inset-y-0 right-0 z-40 flex w-full max-w-sm shadow-2xl' : 'hidden')}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3 lg:hidden">
            <span className="text-sm font-medium">Tasks &amp; activity</span>
            <button onClick={() => setSidePanel(false)} aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <div className="border-b border-border px-4 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground"><ListChecks className="h-3.5 w-3.5" /> Tasks</p>
            {todos.length === 0 ? <p className="text-xs text-muted-foreground">No tasks yet.</p> : (
              <ul className="space-y-1 text-sm">
                {todos.map((t, i) => (
                  <li key={i} className={cn('flex gap-2', t.status === 'completed' && 'text-muted-foreground line-through', t.status === 'in_progress' && 'text-[var(--gold)]')}>
                    <span className="w-3 shrink-0">{t.status === 'completed' ? '✔' : t.status === 'in_progress' ? '▸' : '○'}</span>
                    <span>{t.content}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground"><Activity className="h-3.5 w-3.5" /> Activity</p>
            {activity.length === 0 ? <p className="text-xs text-muted-foreground">Quiet so far.</p> : (
              <ul className="space-y-1 font-mono text-[11px] text-muted-foreground">
                {activity.map((a, i) => <li key={i} className={cn('break-words', a.includes('↳') && 'pl-3 opacity-80')}>{a}</li>)}
              </ul>
            )}
          </div>
          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {fmt(usage.inputTokens)} in / {fmt(usage.outputTokens)} out · {session.model_calls} calls · ${session.spent_usd.toFixed(3)} of $2
          </div>
        </aside>
      </div>

      {permission && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Permission · {permission.risk}</p>
            <p className="mt-2 font-medium">{permission.tool}</p>
            <p className="mt-1 text-sm">{permission.summary}</p>
            {permission.detail && <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-xs whitespace-pre-wrap">{permission.detail}</pre>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button onClick={() => act('permission', { id: permission.id, allowed: false })} className="rounded-full border border-border px-4 py-2 text-sm">Deny</button>
              <button onClick={() => act('permission', { id: permission.id, allowed: true, always: true, tool: permission.tool })} className="rounded-full border border-border px-4 py-2 text-sm">Always allow {permission.tool}</button>
              <button onClick={() => act('permission', { id: permission.id, allowed: true })} className="rounded-full bg-[var(--gold)] px-4 py-2 text-sm font-medium text-[var(--gold-foreground)]">Allow</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}

function Shell({ children, right, userEmail }: { children: React.ReactNode; right?: React.ReactNode; userEmail: string }) {
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 bg-background/90 px-4 py-2.5 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" aria-label="BlueTAO home"><BlueTaoLogo className="h-7 w-7 text-[var(--gold)] drop-shadow-[0_0_12px_var(--gold)]" /></Link>
          <div className="min-w-0">
            <p className="truncate font-[family-name:var(--font-playfair)] text-lg leading-tight">BlueTAO Code Agent</p>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">Claude Code-style sessions, model chosen by James · {userEmail}</p>
          </div>
        </div>
        {right}
      </header>
      {children}
    </div>
  )
}

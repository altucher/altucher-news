'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X, Copy, Check, MapPin, Mail, Calendar, MessageCircle, Trash2, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export type JobUi = { id: string; title: string; status: string; needs: string | null; summary: string | null; steps: Array<{ t: string; tool: string; note: string }>; created_at: string; updated_at: string; completed_at: string | null }
export type ProfileUi = {
  user_id: string; handle: string | null; display_name: string | null; assistant_name: string; timezone: string | null; location: string | null
  standing_instructions: string; connections: Record<string, unknown>; notify_email: boolean; invites_left: number; onboarding_complete: boolean
}

export const STATUS_STYLE: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  working: 'bg-[var(--gold)]/20 text-[var(--gold)]',
  waiting: 'bg-primary/20 text-primary',
  done: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-destructive/20 text-destructive',
  cancelled: 'bg-muted text-muted-foreground line-through',
}
export const STATUS_LABEL: Record<string, string> = { queued: 'starting', working: 'working', waiting: 'needs you', done: 'done', failed: 'failed', cancelled: 'cancelled' }

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-border bg-sidebar text-sidebar-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-[family-name:var(--font-playfair)] text-xl">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 hover:bg-sidebar-accent"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </>
  )
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function JobsPanel({ jobs, onClose, onChange }: { jobs: JobUi[]; onClose: () => void; onChange: (j: JobUi) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  async function act(id: string, action: 'cancel' | 'retry') {
    const r = await fetch(`/api/assistant/jobs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    const j = await r.json()
    if (j.job) onChange(j.job)
  }
  const active = jobs.filter((j) => ['queued', 'working', 'waiting'].includes(j.status))
  const past = jobs.filter((j) => !['queued', 'working', 'waiting'].includes(j.status))
  const Row = ({ j }: { j: JobUi }) => (
    <div className="rounded-2xl border border-border bg-card p-4">
      <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === j.id ? null : j.id)}>
        <div>
          <p className="font-medium leading-snug">{j.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{timeAgo(j.updated_at)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[j.status] || ''}`}>{STATUS_LABEL[j.status] || j.status}</span>
      </button>
      {j.status === 'waiting' && j.needs && <p className="mt-3 rounded-xl bg-primary/10 px-3 py-2 text-sm">Waiting on you: {j.needs}</p>}
      {open === j.id && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {j.summary && <p className="text-sm text-muted-foreground">{j.summary}</p>}
          {j.steps.length > 0 && (
            <ol className="space-y-1.5">
              {j.steps.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="w-14 shrink-0 font-mono uppercase text-[10px] tracking-wider opacity-70">{s.tool}</span>
                  <span className="truncate">{s.note}</span>
                </li>
              ))}
            </ol>
          )}
          <div className="flex gap-2 pt-1">
            {['queued', 'working', 'waiting'].includes(j.status) && <button onClick={() => act(j.id, 'cancel')} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-sidebar-accent">Cancel</button>}
            {['failed', 'done', 'cancelled'].includes(j.status) && <button onClick={() => act(j.id, 'retry')} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-sidebar-accent">Run again</button>}
          </div>
        </div>
      )}
    </div>
  )
  return (
    <Panel title="Jobs" onClose={onClose}>
      {jobs.length === 0 && <p className="text-sm text-muted-foreground">Nothing delegated yet. Ask for something that takes more than a quick answer and it shows up here.</p>}
      {active.length > 0 && <div className="space-y-3">{active.map((j) => <Row key={j.id} j={j} />)}</div>}
      {past.length > 0 && (
        <>
          <p className="mb-2 mt-6 text-xs uppercase tracking-wider text-muted-foreground">Earlier</p>
          <div className="space-y-3">{past.map((j) => <Row key={j.id} j={j} />)}</div>
        </>
      )}
    </Panel>
  )
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500) } catch { /* ignore */ } }} className="rounded-full p-1.5 hover:bg-sidebar-accent" aria-label="Copy">
      {ok ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}

export function SetupPanel({ profile, address, emailLive, userEmail, onClose, onProfile }: {
  profile: ProfileUi; address: string | null; emailLive: boolean; userEmail: string; onClose: () => void; onProfile: (p: ProfileUi) => void
}) {
  const router = useRouter()
  const [form, setForm] = useState({ assistant_name: profile.assistant_name, display_name: profile.display_name || '', location: profile.location || '', timezone: profile.timezone || '', standing_instructions: profile.standing_instructions || '' })
  const [memories, setMemories] = useState<Array<{ id: string; content: string }>>([])
  const [invites, setInvites] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [locating, setLocating] = useState(false)
  const zones = (() => { try { return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [] } catch { return [] } })()

  useEffect(() => {
    fetch('/api/assistant/profile').then((r) => r.json()).then((j) => { setMemories(j.memories || []); setInvites(j.invites || []) }).catch(() => {})
  }, [])

  async function save(extra: Record<string, unknown> = {}) {
    setSaving(true)
    const r = await fetch('/api/assistant/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, ...extra }) })
    const j = await r.json()
    setSaving(false)
    if (j.profile) { onProfile(j.profile); setSaved(true); setTimeout(() => setSaved(false), 1500) }
  }

  function useDeviceZone() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    setForm((f) => ({ ...f, timezone: tz }))
  }

  function shareLocation() {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords
      let label = `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10`, { headers: { Accept: 'application/json' } })
        const j = await r.json()
        const a = j.address || {}
        label = [a.city || a.town || a.village || a.county, a.state, a.country_code?.toUpperCase()].filter(Boolean).join(', ') || label
      } catch { /* keep coordinates */ }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      setForm((f) => ({ ...f, location: label, timezone: f.timezone || tz }))
      setLocating(false)
      await save({ location: label, timezone: form.timezone || tz, connections: { location: { connected: true, label, at: new Date().toISOString() } } })
    }, () => setLocating(false), { timeout: 10000 })
  }

  async function forget(id: string) {
    await fetch(`/api/memories?id=${id}`, { method: 'DELETE' })
    setMemories((m) => m.filter((x) => x.id !== id))
  }

  async function signOut() { await createClient().auth.signOut(); router.refresh() }

  const field = 'w-full rounded-xl border border-border bg-input px-3 py-2 text-sm outline-none focus:border-[var(--gold)]'
  const label = 'mb-1 block text-xs uppercase tracking-wider text-muted-foreground'

  return (
    <Panel title="Setup" onClose={onClose}>
      <section>
        <p className="mb-3 text-sm text-muted-foreground">Signed in as {userEmail}</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Assistant&apos;s name</label><input className={field} value={form.assistant_name} onChange={(e) => setForm({ ...form, assistant_name: e.target.value })} /></div>
          <div><label className={label}>Your name</label><input className={field} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
          <div><label className={label}>City</label><input className={field} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
          <div>
            <label className={label}>Time zone <button type="button" onClick={useDeviceZone} className="ml-1 lowercase text-[var(--gold)] hover:underline">use device</button></label>
            <input className={field} list="tz-list" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="America/New_York" />
            <datalist id="tz-list">{zones.map((z) => <option key={z} value={z} />)}</datalist>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 text-sm font-medium">Reach {form.assistant_name || 'your assistant'}</h3>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Mail className="h-4 w-4 shrink-0 text-[var(--gold)]" />
              <span className="truncate font-mono text-sm">{address || 'address pending'}</span>
            </div>
            {address && <CopyButton text={address} />}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {emailLive
              ? 'Live. Forward confirmations here, cc it on threads, or let it email vendors for you.'
              : 'Reserved for you. Sending switches on once BlueTAO’s mail domain is connected; until then any email it writes appears in the thread as a draft.'}
          </p>
        </div>
      </section>

      <section className="mt-6">
        <h3 className="mb-2 text-sm font-medium">Connections</h3>
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          <li className="flex items-center justify-between px-4 py-3 text-sm"><span className="flex items-center gap-2"><Mail className="h-4 w-4" /> Email address</span><span className="text-xs text-emerald-400">{emailLive ? 'live' : 'reserved'}</span></li>
          <li className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Location</span>
            {form.location ? <span className="max-w-[55%] truncate text-xs text-emerald-400">{form.location}</span> : <button onClick={shareLocation} disabled={locating} className="text-xs text-[var(--gold)] hover:underline">{locating ? 'locating…' : 'share'}</button>}
          </li>
          <li className="flex items-center justify-between px-4 py-3 text-sm"><span className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Calendar</span><span className="text-xs text-muted-foreground">coming soon</span></li>
          <li className="flex items-center justify-between px-4 py-3 text-sm"><span className="flex items-center gap-2"><MessageCircle className="h-4 w-4" /> iMessage / WhatsApp</span><span className="text-xs text-muted-foreground">coming soon</span></li>
        </ul>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={profile.notify_email} onChange={(e) => save({ notify_email: e.target.checked })} /> Email me when it texts first
        </label>
      </section>

      <section className="mt-6">
        <h3 className="mb-1 text-sm font-medium">Standing instructions</h3>
        <p className="mb-2 text-xs text-muted-foreground">Rules it follows every time. You can also just tell it “from now on…”.</p>
        <textarea rows={5} className={field} value={form.standing_instructions} onChange={(e) => setForm({ ...form, standing_instructions: e.target.value })} placeholder={'- Always book aisle seats\n- Never email my boss without asking\n- Default budget for gifts: $75'} />
      </section>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={() => save()} disabled={saving} className="rounded-full bg-[var(--gold)] px-5 py-2 text-sm font-medium text-[var(--gold-foreground)] disabled:opacity-60">{saving ? 'Saving…' : saved ? 'Saved' : 'Save'}</button>
      </div>

      <section className="mt-8">
        <h3 className="mb-2 text-sm font-medium">What it remembers</h3>
        {memories.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : (
          <ul className="space-y-1.5">
            {memories.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-2 rounded-xl bg-card px-3 py-2 text-sm">
                <span>{m.content}</span>
                <button onClick={() => forget(m.id)} aria-label="Forget" className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h3 className="mb-1 text-sm font-medium">Invites</h3>
        <p className="mb-2 text-xs text-muted-foreground">Each code lets one person in.</p>
        {invites.length === 0 ? <p className="text-sm text-muted-foreground">All used.</p> : (
          <ul className="space-y-1.5">
            {invites.map((c) => <li key={c} className="flex items-center justify-between rounded-xl bg-card px-3 py-2 font-mono text-sm"><span>{c}</span><CopyButton text={c} /></li>)}
          </ul>
        )}
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-border pt-4 text-sm">
        <Link href="/chat" className="underline hover:text-[var(--gold)]">Classic chat &amp; code</Link>
        <Link href="/pricing" className="underline hover:text-[var(--gold)]">Plans</Link>
        <button onClick={signOut} className="ml-auto flex items-center gap-1 text-muted-foreground hover:text-foreground"><LogOut className="h-4 w-4" /> Sign out</button>
      </div>
    </Panel>
  )
}

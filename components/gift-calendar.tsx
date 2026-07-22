'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { CalendarDays, Download, Gift, Loader2, Mail, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const fetcher = (url: string) => fetch(url).then(async (response) => {
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body
})

type Occasion = { id: string; name: string; give_by: string; plan_by: string | null; budget_cents: number | null; status: string; gift_recipients: { name: string; relationship: string | null } | { name: string; relationship: string | null }[] }

export function GiftCalendar() {
  const { data, error, isLoading, mutate } = useSWR('/api/gifts/calendar', fetcher)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showForm, setShowForm] = useState(false)
  const occasions: Occasion[] = data?.occasions || []
  const grouped = useMemo(() => occasions.reduce<Record<string, Occasion[]>>((groups, item) => {
    const month = new Date(`${item.give_by}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    ;(groups[month] ||= []).push(item)
    return groups
  }, {}), [occasions])

  async function addOccasion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setMessage('')
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/gifts/calendar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipientName: form.get('recipientName'), relationship: form.get('relationship') || undefined, occasionName: form.get('occasionName'), giveBy: form.get('giveBy'), planBy: form.get('planBy') || undefined, budgetUsd: form.get('budgetUsd') ? Number(form.get('budgetUsd')) : undefined, recurring: form.get('recurring') === 'on', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }) })
    const body = await response.json()
    setSaving(false)
    if (!response.ok) return setMessage(body.error || 'Could not save occasion')
    setMessage(`Saved with ${body.reminders.length} email reminders.`)
    event.currentTarget.reset(); setShowForm(false); mutate()
  }

  if (error?.message === 'Unauthorized') return <div className="rounded-xl border border-border bg-card p-8 text-center"><Gift className="mx-auto h-8 w-8 text-primary"/><h2 className="mt-4 font-serif text-2xl font-semibold">Sign in to keep a gift calendar</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Your occasions and reminders are private and tied to your BlueTAO account.</p><Button asChild className="mt-5"><a href="/auth/login">Sign in</a></Button></div>

  return <div className="flex flex-col gap-6">
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="font-mono text-xs font-semibold uppercase tracking-widest text-primary">GiftFinder</p><h1 className="mt-2 text-balance font-serif text-3xl font-semibold text-foreground md:text-4xl">Never scramble for a gift again.</h1><p className="mt-2 max-w-xl text-pretty text-sm leading-6 text-muted-foreground">Plan occasions, set thoughtful budgets, and get reminders 30, 14, and 3 days before each gift is due.</p></div>
        <div className="flex gap-2"><Button variant="outline" asChild><a href="/api/gifts/calendar/export"><Download className="h-4 w-4"/>Export .ics</a></Button><Button onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4"/>Add occasion</Button></div>
      </div>
      <div className="mt-5 flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm text-secondary-foreground"><Mail className="h-4 w-4 text-primary"/>{data?.emailConfigured ? 'Email reminders are active.' : 'Calendar is active; email reminders need Resend configuration.'}</div>
    </section>

    {showForm && <form onSubmit={addOccasion} className="grid gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-2">
      <label className="text-sm font-medium">Recipient<Input name="recipientName" required className="mt-1.5" placeholder="Alex"/></label>
      <label className="text-sm font-medium">Relationship<Input name="relationship" className="mt-1.5" placeholder="Friend"/></label>
      <label className="text-sm font-medium">Occasion<Input name="occasionName" required className="mt-1.5" placeholder="Birthday"/></label>
      <label className="text-sm font-medium">Give by<Input name="giveBy" type="date" required className="mt-1.5"/></label>
      <label className="text-sm font-medium">Plan by<Input name="planBy" type="date" className="mt-1.5"/></label>
      <label className="text-sm font-medium">Budget (USD)<Input name="budgetUsd" type="number" min="0" step="1" className="mt-1.5" placeholder="75"/></label>
      <label className="flex items-center gap-2 text-sm"><input name="recurring" type="checkbox" className="h-4 w-4 accent-primary"/>Repeat yearly</label>
      <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin"/>}Save and schedule</Button>
    </form>}
    {message && <p role="status" className="text-sm text-primary">{message}</p>}

    <section aria-label="Gift agenda" className="flex flex-col gap-5">
      {isLoading ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary"/></div> : occasions.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center"><CalendarDays className="mx-auto h-8 w-8 text-muted-foreground"/><h2 className="mt-3 font-serif text-xl font-semibold">Your gift year starts here</h2><p className="mt-1 text-sm text-muted-foreground">Add an occasion or save calendar candidates from a GiftFinder dossier.</p></div> : Object.entries(grouped).map(([month, items]) => <div key={month}><h2 className="mb-3 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">{month}</h2><div className="flex flex-col gap-3">{items.map(item => { const recipient = Array.isArray(item.gift_recipients) ? item.gift_recipients[0] : item.gift_recipients; return <article key={item.id} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4"><div className="flex h-12 w-12 flex-none flex-col items-center justify-center rounded-lg bg-primary text-primary-foreground"><span className="text-[10px] uppercase">{new Date(`${item.give_by}T12:00:00`).toLocaleDateString(undefined,{month:'short'})}</span><span className="text-lg font-bold leading-none">{new Date(`${item.give_by}T12:00:00`).getDate()}</span></div><div className="min-w-0 flex-1"><h3 className="truncate font-semibold text-foreground">{item.name} for {recipient?.name}</h3><p className="mt-1 text-sm text-muted-foreground">{item.plan_by ? `Plan by ${new Date(`${item.plan_by}T12:00:00`).toLocaleDateString()}` : 'Plan date not set'}{item.budget_cents != null ? ` · $${(item.budget_cents/100).toFixed(0)} budget` : ''}</p></div><span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">{item.status}</span></article>})}</div></div>) }
    </section>
  </div>
}

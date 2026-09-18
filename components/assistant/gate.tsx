'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BlueTaoLogo } from '@/components/animated-background'
import { createClient } from '@/lib/supabase/client'

export default function Gate({ email }: { email: string }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [waitlisted, setWaitlisted] = useState(false)

  async function redeem(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const r = await fetch('/api/assistant/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'redeem', code }) })
    const j = await r.json()
    setBusy(false)
    if (!j.ok) { setError(j.error || 'That code did not work.'); return }
    router.refresh()
  }

  async function waitlist() {
    setBusy(true)
    await fetch('/api/assistant/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'waitlist', email }) })
    setBusy(false); setWaitlisted(true)
  }

  async function signOut() {
    await createClient().auth.signOut()
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-xl">
        <div className="flex items-center gap-2">
          <BlueTaoLogo className="h-7 w-7 text-[var(--gold)]" />
          <span className="font-[family-name:var(--font-playfair)] text-xl">BlueTAO Assistant</span>
        </div>
        <h1 className="mt-6 text-2xl font-medium">Private access</h1>
        <p className="mt-2 text-muted-foreground">Signed in as {email}. The assistant is open to members and their invitees while we scale up compute.</p>
        <form onSubmit={redeem} className="mt-6 flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BT-XXXXXX" className="flex-1 rounded-full border border-border bg-input px-4 py-2.5 font-mono tracking-wider outline-none focus:border-[var(--gold)]" />
          <button disabled={busy || !code} className="rounded-full bg-[var(--gold)] px-5 py-2.5 font-medium text-[var(--gold-foreground)] disabled:opacity-60">Enter</button>
        </form>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          {waitlisted ? <span className="text-muted-foreground">You are on the waitlist.</span> : <button onClick={waitlist} disabled={busy} className="underline hover:text-[var(--gold)]">No code? Join the waitlist</button>}
          <span className="text-border">·</span>
          <Link href="/" className="underline hover:text-[var(--gold)]">Use classic BlueTAO chat</Link>
          <span className="text-border">·</span>
          <button onClick={signOut} className="underline hover:text-[var(--gold)]">Sign out</button>
        </div>
      </div>
    </main>
  )
}

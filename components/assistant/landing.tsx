'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BlueTaoLogo } from '@/components/animated-background'
import { ArrowRight, MessageSquare, Phone, Mail, Check } from 'lucide-react'

const EXAMPLES = [
  { who: 'you', text: 'my internet bill jumped to $95, can you find out why and get it back down' },
  { who: 'blue', text: 'On it. I’ll dig into the account and the current promos and text you when I have something.' },
  { who: 'blue', text: 'Found it. A 12-month promo expired in August. There’s a retention offer at $49 for new 24-month terms. Want me to write to them and ask for it?', later: 'later that afternoon' },
  { who: 'you', text: 'yes' },
  { who: 'blue', text: 'Done. Sent from my address with your account number. I’ll check back Thursday if they haven’t replied.' },
]

export default function Landing() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function join(e: React.FormEvent) {
    e.preventDefault()
    setState('busy')
    try {
      const r = await fetch('/api/assistant/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'waitlist', email }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { setState('error'); setMsg(j.error || 'Something went wrong.'); return }
      setState('done')
      setMsg(j.position ? `You’re on the list (#${j.position}).` : 'You’re on the list.')
    } catch { setState('error'); setMsg('Something went wrong.') }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] bg-[radial-gradient(ellipse_at_top,oklch(0.8_0.13_82/0.16),transparent_60%)]" />
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <BlueTaoLogo className="h-7 w-7 text-[var(--gold)] drop-shadow-[0_0_12px_var(--gold)]" />
          <span className="font-[family-name:var(--font-playfair)] text-xl">BlueTAO</span>
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/chat" className="text-muted-foreground hover:text-foreground">classic chat</Link>
          <Link href="/auth/login" className="rounded-full border border-border px-4 py-1.5 hover:bg-secondary">I have an invite</Link>
        </nav>
      </header>

      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-16 pt-12 md:pt-20">
        <div className="grid items-start gap-12 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <h1 className="font-[family-name:var(--font-playfair)] text-4xl leading-[1.08] md:text-6xl">
              A personal assistant that actually gets things done.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Text it like a person. It handles the errand, the research, the follow-up and the awkward email, keeps working after you put your phone down, and checks back in when it needs you. No new app to learn. One thread, forever.
            </p>
            <form onSubmit={join} className="mt-8 flex max-w-md flex-col gap-2 sm:flex-row">
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="flex-1 rounded-full border border-border bg-input px-5 py-3 text-base outline-none focus:border-[var(--gold)]"
              />
              <button disabled={state === 'busy' || state === 'done'} className="flex items-center justify-center gap-2 rounded-full bg-[var(--gold)] px-6 py-3 font-medium text-[var(--gold-foreground)] hover:opacity-90 disabled:opacity-60">
                {state === 'done' ? <Check className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                {state === 'done' ? 'On the list' : 'Join the waitlist'}
              </button>
            </form>
            {msg && <p className={`mt-3 text-sm ${state === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{msg}</p>}
            <p className="mt-4 text-sm text-muted-foreground">
              BlueTAO Assistant is open to a private group while we scale up compute. Members can invite three people each. Have a code? <Link href="/auth/login" className="underline hover:text-foreground">Sign in</Link>.
            </p>
          </div>

          <div className="rounded-3xl border border-border bg-card/70 p-4 shadow-2xl backdrop-blur">
            <div className="mb-3 flex items-center gap-2 border-b border-border pb-3">
              <BlueTaoLogo className="h-6 w-6 text-[var(--gold)]" />
              <div>
                <p className="text-sm font-medium">Blue</p>
                <p className="text-xs text-muted-foreground">working on 1 thing</p>
              </div>
            </div>
            <div className="space-y-2">
              {EXAMPLES.map((m, i) => (
                <div key={i}>
                  {m.later && <p className="my-2 text-center text-[11px] uppercase tracking-wider text-muted-foreground">{m.later}</p>}
                  <div className={`flex ${m.who === 'you' ? 'justify-end' : 'justify-start'}`}>
                    <p className={`max-w-[85%] rounded-2xl px-4 py-2 text-[15px] leading-snug ${m.who === 'you' ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border bg-secondary'}`}>{m.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative z-10 border-t border-border/60 bg-card/30">
        <div className="mx-auto grid max-w-5xl gap-8 px-6 py-14 md:grid-cols-3">
          {[
            { icon: MessageSquare, title: 'Text it', body: 'One ongoing thread. No projects, no folders, no prompts to engineer. Say what you need the way you’d say it to a person.' },
            { icon: Phone, title: 'Call it', body: 'Tap the call button and talk. It listens, thinks, answers out loud, and the whole conversation lands in the same thread.' },
            { icon: Mail, title: 'Email it', body: 'It has its own address. Forward the confirmation, cc it on the thread, or let it write to the vendor for you.' },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="h-6 w-6 text-[var(--gold)]" />
              <h3 className="mt-3 font-[family-name:var(--font-playfair)] text-xl">{title}</h3>
              <p className="mt-2 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-5xl px-6 py-14">
        <h2 className="font-[family-name:var(--font-playfair)] text-3xl">You employ it. You don’t operate it.</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {[
            ['It keeps working between messages', 'Hand it a job and it runs in the background: searching, reading, comparing, writing to people. Progress shows up in the thread as it happens.'],
            ['It texts you first', 'Follow-ups you would have dropped, a morning note on where things stand, the reminder you asked for at 4pm Thursday.'],
            ['It remembers', 'Your preferences, your people, your rules. Say “always book the aisle seat” once and it becomes a standing instruction.'],
            ['It asks only when it has to', 'One specific question when it is truly stuck, never a wall of options. Then it picks the job back up where it left off.'],
          ].map(([t, b]) => (
            <div key={t} className="rounded-2xl border border-border bg-card/50 p-6">
              <h3 className="text-lg font-medium">{t}</h3>
              <p className="mt-2 text-muted-foreground">{b}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
          What it does today: research, comparisons, drafting, emailing people and businesses on your behalf, monitoring and reminders, memory and standing rules. It does not place phone calls or spend money yet, and it will tell you so rather than pretend.
        </p>
      </section>

      <footer className="relative z-10 border-t border-border/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
          <span>BlueTAO · powered by decentralized compute</span>
          <div className="flex gap-4">
            <Link href="/chat" className="hover:text-foreground">Classic chat</Link>
            <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
            <Link href="/developers" className="hover:text-foreground">Developers</Link>
          </div>
        </div>
      </footer>
    </main>
  )
}

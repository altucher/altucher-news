import Link from 'next/link'
import { ArrowLeft, Clock3, Sparkles } from 'lucide-react'
import { AnimatedOceanBackground } from '@/components/animated-background'

export default function PricingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <AnimatedOceanBackground />

      <header className="relative z-10 flex items-center justify-between p-4 md:p-6">
        <Link
          href="/"
          className="font-serif text-2xl font-medium tracking-wide text-foreground"
        >
          BlueTAO
        </Link>
        <Link
          href="/"
          className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to Chat
        </Link>
      </header>

      <main className="relative z-10 flex min-h-[calc(100vh-80px)] items-center justify-center px-4 pb-20 pt-10">
        <section className="flex w-full max-w-2xl flex-col items-center gap-8 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
            <Sparkles className="size-7" aria-hidden="true" />
          </div>

          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground">
              <Clock3 className="size-4 text-primary" aria-hidden="true" />
              Upgrades are on the way
            </div>
            <h1 className="max-w-xl text-balance font-serif text-5xl font-medium leading-tight text-foreground md:text-7xl">
              Coming soon
            </h1>
            <p className="max-w-lg text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
              We&apos;re preparing new BlueTAO plans with more usage, more creative power, and expanded access. Your current experience remains available while we get everything ready.
            </p>
          </div>

          <Link
            href="/"
            className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            Continue using BlueTAO
          </Link>

          <p className="text-sm text-muted-foreground">
            Questions? <a className="font-medium text-foreground underline decoration-border underline-offset-4 hover:text-primary" href="mailto:support@bluetao.ai">support@bluetao.ai</a>
          </p>
        </section>
      </main>
    </div>
  )
}

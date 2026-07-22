'use client'

import { useDeferredValue, useMemo, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import { ArrowUpRight, Bot, BookmarkPlus, Check, Clock3, ExternalLink, Loader2, Search, ShieldCheck, Sparkles, Telescope, TrendingUp, WandSparkles } from 'lucide-react'

interface Agent {
  id: string
  slug: string
  name: string
  description: string
  category: string
  listedAt: string | null
  openCount: number
  suggestedPrompts: string[]
  tools: string[]
}

interface AgentsResponse { agents: Agent[]; categories: string[] }
const fetcher = (url: string) => fetch(url).then(async (response) => {
  if (!response.ok) throw new Error('Could not load agents')
  return response.json()
})

function AgentCard({ agent, featured = false }: { agent: Agent; featured?: boolean }) {
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState('')
  const [installed, setInstalled] = useState(false)

  const install = async () => {
    setInstalling(true)
    setInstallError('')
    try {
      const response = await fetch(`/api/agents/${agent.slug}/install`, { method: 'POST' })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || 'Could not add this agent')
      setInstalled(true)
      window.open(data.openUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : 'Could not add this agent')
    } finally {
      setInstalling(false)
    }
  }

  return (
    <article className={`group flex h-full flex-col rounded-2xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10 ${featured ? 'border-primary/30' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Bot className="h-5 w-5" aria-hidden="true" />
        </div>
        <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">{agent.category}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 pt-5">
        <h3 className="text-balance font-serif text-xl font-semibold text-card-foreground group-hover:text-primary">{agent.name}</h3>
        <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{agent.description}</p>
        {agent.suggestedPrompts[0] && (
          <div className="mt-auto rounded-xl bg-muted px-3 py-2.5 text-xs leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">Try asking: </span>{agent.suggestedPrompts[0]}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 pt-5">
        <button type="button" onClick={install} disabled={installing || installed} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70">
          {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : installed ? <Check className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
          {installing ? 'Adding…' : installed ? 'Added to your projects' : 'Add to my projects'}
        </button>
        <div className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-pretty text-xs leading-5 text-muted-foreground">
            {installed
              ? <>Opened in a new tab. Find it anytime under <span className="font-semibold text-foreground">My Projects</span>, where your chats stay private to you—and you can delete it whenever you like.</>
              : <>Add it to keep your conversations <span className="font-semibold text-foreground">private to your account</span>. It lives in <span className="font-semibold text-foreground">My Projects</span> and you can delete it anytime.</>}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" />{agent.openCount.toLocaleString()} opens</span>
          <a href={`/api/agents/${agent.slug}/open`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            Try a public preview <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
        {installError && <p className="text-pretty text-xs leading-5 text-destructive" role="alert">{installError}</p>}
      </div>
    </article>
  )
}

export function AgentMarketplace() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [sort, setSort] = useState<'featured' | 'new' | 'popular'>('featured')
  const deferredQuery = useDeferredValue(query)
  const url = `/api/agents?q=${encodeURIComponent(deferredQuery)}&category=${encodeURIComponent(category)}&sort=${sort}`
  const { data, error, isLoading } = useSWR<AgentsResponse>(url, fetcher, { keepPreviousData: true })
  const agents = data?.agents || []
  const featured = useMemo(() => [...agents].sort((a, b) => b.openCount - a.openCount).slice(0, 3), [agents])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 md:px-6">
          <Link href="/" className="font-serif text-2xl font-semibold tracking-tight">BlueTAO</Link>
          <nav className="flex items-center gap-2" aria-label="Marketplace navigation">
            <Link href="/" className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">Build an agent</Link>
            <span className="hidden rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground sm:inline-flex">Agent Marketplace</span>
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-14 md:px-6 md:py-20">
            <div className="flex max-w-3xl flex-col gap-5">
              <span className="flex w-fit items-center gap-2 rounded-full border border-primary/25 bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"><Sparkles className="h-3.5 w-3.5" />Live agents, built by people</span>
              <h1 className="text-balance font-serif text-4xl font-semibold tracking-tight md:text-6xl">Find an agent for the work ahead.</h1>
              <p className="max-w-2xl text-pretty text-base leading-7 text-muted-foreground md:text-lg">Discover AI agents that research, explain, organize, and help you move faster. Every listing opens into a live agent powered by BlueTAO.</p>
            </div>
            <div className="flex max-w-3xl flex-col gap-3 sm:flex-row">
              <label className="relative flex-1">
                <span className="sr-only">Search agents</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents by name or capability" className="h-12 w-full rounded-xl border border-input bg-card pl-11 pr-4 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </label>
              <Link href="/?mode=code" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><WandSparkles className="h-4 w-4" />Build your own</Link>
            </div>
          </div>
        </section>

        <section className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 md:px-6 md:py-14">
          {!query && category === 'All' && featured.length > 0 && (
            <div className="flex flex-col gap-5">
              <div className="flex items-end justify-between gap-4"><div><p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-primary"><Telescope className="h-4 w-4" />Curated now</p><h2 className="font-serif text-2xl font-semibold md:text-3xl">Agents people are opening</h2></div></div>
              <div className="grid gap-4 md:grid-cols-3">{featured.map((agent) => <AgentCard key={`featured-${agent.id}`} agent={agent} featured />)}</div>
            </div>
          )}

          <div className="flex flex-col gap-5">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
              <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Explore the directory</p><h2 className="font-serif text-2xl font-semibold md:text-3xl">All live agents</h2></div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex max-w-full gap-2 overflow-x-auto pb-1" aria-label="Agent categories">
                  {['All', ...(data?.categories || [])].map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${category === item ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground hover:text-foreground'}`}>{item}</button>)}
                </div>
                <div className="flex rounded-lg border border-border bg-card p-1" aria-label="Sort agents">
                  {([['featured', 'Featured'], ['new', 'Newest'], ['popular', 'Popular']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setSort(value)} className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${sort === value ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
                </div>
              </div>
            </div>

            {isLoading && !data ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-label="Loading agents">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-72 animate-pulse rounded-2xl border border-border bg-muted" />)}</div>
            ) : error ? (
              <div className="rounded-2xl border border-border bg-card p-10 text-center"><p className="font-semibold">The marketplace could not load.</p><p className="mt-2 text-sm text-muted-foreground">Please refresh and try again.</p></div>
            ) : agents.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-12 text-center"><Bot className="h-8 w-8 text-primary" /><h3 className="font-serif text-xl font-semibold">No agents found</h3><p className="max-w-md text-sm leading-6 text-muted-foreground">Try another search or category—or build the first agent for this niche.</p></div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{agents.map((agent) => <AgentCard key={agent.id} agent={agent} />)}</div>
            )}
          </div>
        </section>

        <section className="border-t border-border bg-card">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-12 md:flex-row md:items-center md:px-6">
            <div className="max-w-xl"><div className="mb-2 flex items-center gap-2 text-primary"><Clock3 className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-widest">Publish in one click</span></div><h2 className="text-balance font-serif text-3xl font-semibold">Have an idea that deserves its own agent?</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">Describe it in BlueTAO Code, preview it, and publish. Your live agent can appear here automatically.</p></div>
            <Link href="/" className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background hover:bg-primary hover:text-primary-foreground">Create an agent <ExternalLink className="h-4 w-4" /></Link>
          </div>
        </section>
      </main>
    </div>
  )
}

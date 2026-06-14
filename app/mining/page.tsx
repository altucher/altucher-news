import Link from 'next/link'
import { Server, TrendingUp, Spade, Cpu, ArrowRight, CheckCircle2, Bot, Zap, Network, ShieldCheck, Search } from 'lucide-react'

type Subnet = {
  id: number
  name: string
  netuid: string
  tagline: string
  icon: typeof Server
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced'
  hardware: string
  highlights: string[]
}

const SUBNETS: Subnet[] = [
  {
    id: 33,
    name: 'Conversense',
    netuid: 'SN33',
    tagline: 'Route inference requests through an adapter — no GPU required.',
    icon: Server,
    difficulty: 'Beginner',
    hardware: 'Cheap VPS (~$6/mo), no GPU',
    highlights: [
      'Lowest barrier to entry on Bittensor',
      'Run an adapter proxy to an external API',
      'Ideal for learning the miner/validator loop',
    ],
  },
  {
    id: 88,
    name: 'Investing88',
    netuid: 'SN88',
    tagline: 'Compete with portfolio strategies — no ML engineering needed.',
    icon: TrendingUp,
    difficulty: 'Beginner',
    hardware: 'Basic server, market knowledge',
    highlights: [
      'Submit investment strategies via dashboard',
      'Great if you understand markets, not models',
      'No model hosting or GPU required',
    ],
  },
  {
    id: 126,
    name: 'Poker44',
    netuid: 'SN126',
    tagline: 'Well-documented onboarding that rewards model quality over raw compute.',
    icon: Spade,
    difficulty: 'Intermediate',
    hardware: 'Basic Linux server',
    highlights: [
      'Clear, beginner-friendly onboarding docs',
      'Rewards strategy quality, not just hardware',
      'Active community support',
    ],
  },
  {
    id: 22,
    name: 'Desearch',
    netuid: 'SN22',
    tagline: 'Decentralized AI search — scrape and structure real-time web and social data.',
    icon: Search,
    difficulty: 'Intermediate',
    hardware: 'Mid-range server, reliable bandwidth',
    highlights: [
      'Powers real-time X and web data retrieval',
      'Rewards fast, accurate, well-structured results',
      'No high-end GPU required to get started',
    ],
  },
  {
    id: 64,
    name: 'Chutes',
    netuid: 'SN64',
    tagline: 'Serverless GPU compute — host AI models and serve inference at scale.',
    icon: Zap,
    difficulty: 'Advanced',
    hardware: 'High-end GPUs (A100/H100 class)',
    highlights: [
      'Powers the AI models behind BlueTAO',
      'Earn by serving real inference demand',
      'Requires serious GPU capacity and uptime',
    ],
  },
  {
    id: 4,
    name: 'Targon',
    netuid: 'SN4',
    tagline: 'Deterministic verified inference — fast, low-latency LLM serving.',
    icon: Network,
    difficulty: 'Advanced',
    hardware: 'Multiple data-center GPUs',
    highlights: [
      'One of the largest inference subnets',
      'Rewards speed, uptime, and verified outputs',
      'Highly competitive — scale matters',
    ],
  },
  {
    id: 107,
    name: 'Minos',
    netuid: 'SN107',
    tagline: 'Verification and validation of AI outputs across the network.',
    icon: ShieldCheck,
    difficulty: 'Advanced',
    hardware: 'GPU server with strong reliability',
    highlights: [
      'Focuses on verifying model outputs',
      'Rewards accuracy and consistency',
      'Best for experienced operators',
    ],
  },
]

export default function MiningPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-orange-600 flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">B</span>
            </div>
            <span className="text-xl font-semibold text-foreground">BlueTAO</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
              Pricing
            </Link>
            <Link href="/" className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors">
              Open Chat
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-16 max-w-5xl">
        {/* Hero */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 rounded-full text-primary text-sm mb-4">
            <Cpu className="w-4 h-4" />
            Mining-as-a-Service
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold text-foreground text-balance mb-4">
            Start mining Bittensor with BlueTAO by your side
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto text-pretty">
            Pick a subnet below — from beginner-friendly options to advanced GPU compute. BlueTAO will
            walk you through setup, hardware, registration, and getting your miner scoring — step by step.
          </p>
        </div>

        {/* Subnet grid */}
        <div className="grid gap-6 md:grid-cols-3">
          {SUBNETS.map((subnet) => {
            const Icon = subnet.icon
            return (
              <div
                key={subnet.id}
                className="flex flex-col rounded-2xl border border-border bg-card p-6 transition-all hover:border-primary/50 hover:shadow-lg"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <span
                    className={
                      subnet.difficulty === 'Beginner'
                        ? 'text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : subnet.difficulty === 'Intermediate'
                        ? 'text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'text-xs font-medium px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    }
                  >
                    {subnet.difficulty}
                  </span>
                </div>

                <div className="flex items-baseline gap-2 mb-1">
                  <h2 className="text-xl font-semibold text-foreground">{subnet.name}</h2>
                  <span className="text-sm font-mono text-muted-foreground">{subnet.netuid}</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-4 text-pretty">
                  {subnet.tagline}
                </p>

                <div className="text-xs text-muted-foreground mb-4">
                  <span className="font-medium text-foreground">Hardware: </span>
                  {subnet.hardware}
                </div>

                <ul className="flex flex-col gap-2 mb-6">
                  {subnet.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={`/?mine=${subnet.id}`}
                  className="mt-auto flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                >
                  <Bot className="w-4 h-4" />
                  Help me mine {subnet.netuid}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            )
          })}
        </div>

        {/* Footer note */}
        <div className="mt-14 rounded-2xl border border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl mx-auto text-pretty">
            <span className="font-medium text-foreground">Heads up:</span> easy to start does not mean
            guaranteed profit. Registration costs TAO and the top miners earn most emissions. BlueTAO
            will help you understand the economics before you commit.
          </p>
        </div>
      </main>
    </div>
  )
}

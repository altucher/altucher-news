import Link from 'next/link'
import { Server, TrendingUp, Spade, Cpu, ArrowRight, CheckCircle2, Bot, Zap, Network, ShieldCheck, Trophy, Terminal, ExternalLink, AlertTriangle, WalletCards, Code2 } from 'lucide-react'

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
    id: 1,
    name: 'Apex',
    netuid: 'SN1',
    tagline: 'Compete by building the best algorithm or model for open intelligence challenges.',
    icon: Trophy,
    difficulty: 'Intermediate',
    hardware: 'Linux/macOS or Windows via WSL2 — no always-on GPU server',
    highlights: [
      'Submit Python code or trained model files',
      'Start from public competition baselines',
      'Winner-takes-all rewards for the top score',
    ],
  },
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

                {subnet.id === 1 && (
                  <Link
                    href="#apex-guide"
                    className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 px-4 py-2.5 font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    Read the setup guide
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
                <Link
                  href={`/?mine=${subnet.id}`}
                  className="mt-auto flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Bot className="h-4 w-4" />
                  Guide me in Chat
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )
          })}
        </div>

        <section id="apex-guide" className="scroll-mt-24 py-16" aria-labelledby="apex-guide-title">
          <div className="mb-8 flex flex-col gap-4 border-b border-border pb-8 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <div className="mb-3 flex items-center gap-2 font-mono text-sm font-semibold text-primary">
                <span>SN1</span>
                <span aria-hidden="true">/</span>
                <span>Apex solver guide</span>
              </div>
              <h2 id="apex-guide-title" className="font-serif text-3xl font-semibold text-foreground md:text-4xl">
                From a fresh machine to your first submission
              </h2>
              <p className="mt-3 text-pretty text-muted-foreground leading-relaxed">
                Apex is not a conventional always-on miner. You choose a measurable competition, improve its baseline solution, submit your file, and compete for the highest score.
              </p>
            </div>
            <a href="https://github.com/macrocosm-os/apex/blob/main/SOLVERS.md" target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-2 text-sm font-medium text-primary hover:underline">
              Official solver docs <ExternalLink className="h-4 w-4" />
            </a>
          </div>

          <div className="mb-8 grid gap-4 md:grid-cols-3">
            {[
              { icon: Terminal, title: 'Machine', text: 'Linux, macOS, or Windows through WSL2. Python 3.12+ and Git.' },
              { icon: WalletCards, title: 'Wallet', text: 'A Bittensor coldkey and hotkey, plus enough TAO for registration and submission fees.' },
              { icon: Code2, title: 'Work', text: 'Python, model, or structured solution files that match a competition specification.' },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-xl border border-border bg-card p-5">
                <Icon className="mb-3 h-5 w-5 text-primary" />
                <h3 className="font-semibold text-foreground">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>

          <div className="mb-8 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-relaxed text-foreground">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p><strong>Protect your wallet.</strong> Never paste a mnemonic, coldkey file, or password into BlueTAO, Discord, GitHub, or any website. Store recovery words offline. Each competition can charge a submission fee, so confirm the displayed TAO cost before approving.</p>
          </div>

          <div className="flex flex-col gap-5">
            {[
              { n: '01', title: 'Install the Apex CLI', body: 'Clone the official repository and run its installer. The script installs uv, syncs the workspace, and exposes the apex command.', command: 'git clone https://github.com/macrocosm-os/apex.git\ncd apex\n./install_cli.sh\napex --help' },
              { n: '02', title: 'Create or select your wallet', body: 'Create one coldkey and a hotkey that will sign submissions. Replace the example names with your own.', command: 'uv run btcli wallet new_coldkey --wallet.name my-apex-wallet\nuv run btcli wallet new_hotkey --wallet.name my-apex-wallet --wallet.hotkey miner1\nuv run btcli wallet balance --wallet.name my-apex-wallet' },
              { n: '03', title: 'Register on Subnet 1', body: 'Registration is the one-time on-chain entry for your hotkey. The CLI shows the current TAO cost before confirmation.', command: 'uv run btcli subnet register \\\n  --wallet.name my-apex-wallet --wallet.hotkey miner1 \\\n  --netuid 1' },
              { n: '04', title: 'Link the hotkey to Apex', body: 'Choose the wallet and registered hotkey when prompted. Authentication may take a few minutes after a new registration.', command: 'apex link\napex competitions' },
              { n: '05', title: 'Choose a competition', body: 'Inspect active competitions, then read that competition’s README and baseline before writing code. Requirements and fees vary.', command: 'apex competitions\napex competitions -c <COMPETITION_ID>\napex docs -c' },
              { n: '06', title: 'Build and submit a solution', body: 'Start from the supplied baseline, test locally, and submit only when it matches the required interface. Save the returned submission ID.', command: 'apex submit path/to/solution.py -c <COMPETITION_ID>' },
              { n: '07', title: 'Track your score and iterate', body: 'Compare your entry with the leaderboard, inspect result details, and improve deliberately. Apex rewards the top-ranked solution for each competition.', command: 'apex list -c <COMPETITION_ID> -m\napex list -c <COMPETITION_ID> -t\napex result <SUBMISSION_ID>\napex dashboard' },
            ].map((step) => (
              <article key={step.n} className="grid gap-4 rounded-2xl border border-border bg-card p-5 md:grid-cols-[3rem_1fr] md:p-6">
                <span className="font-mono text-sm font-semibold text-primary">{step.n}</span>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  <pre className="mt-4 overflow-x-auto rounded-xl bg-foreground p-4 font-mono text-sm leading-relaxed text-background"><code>{step.command}</code></pre>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              ['apex: command not found', 'Add ~/.local/bin to PATH, restart the shell, then run apex --help.'],
              ['403 or authentication error', 'Confirm the linked hotkey is registered on netuid 1, then wait several minutes and retry.'],
              ['No hotkey file path found', 'Run apex link again from your Apex working directory and select the registered hotkey.'],
            ].map(([problem, fix]) => (
              <div key={problem} className="rounded-xl bg-muted/50 p-5">
                <h3 className="font-mono text-sm font-semibold text-foreground">{problem}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{fix}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-col items-center justify-between gap-4 rounded-2xl bg-primary p-6 text-primary-foreground md:flex-row">
            <div>
              <h3 className="text-xl font-semibold">Want BlueTAO beside you while you set it up?</h3>
              <p className="mt-1 text-sm text-primary-foreground/80">The guided chat starts by checking your operating system, tools, wallet, and experience.</p>
            </div>
            <Link href="/?mine=1" className="flex shrink-0 items-center gap-2 rounded-xl bg-background px-5 py-3 font-medium text-foreground transition-opacity hover:opacity-90">
              <Bot className="h-4 w-4" /> Start guided setup
            </Link>
          </div>
        </section>

        {/* Footer note */}
        <div className="rounded-2xl border border-border bg-muted/30 p-6 text-center">
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

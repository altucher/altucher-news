import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { docs, isHeading } from '@/lib/classifier/docs'
import { TryIt } from '@/components/classifier/try-it'
import { Doc } from '@/components/classifier/doc'

export const metadata: Metadata = {
  title: 'hex',
  description: 'Zero-shot text classification over plain HTTP. No API key, no account.',
}

export const dynamic = 'force-dynamic'

/**
 * The site, for browsers: the same plain-text document `curl /api/hex`
 * prints, rendered as markdown in a terminal, with a form at the top that
 * calls the API from the page. Nothing is duplicated: the text below is
 * generated from the same source at request time.
 */
export default async function ClassifyPage() {
  const h = await headers()
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const origin = `${proto}://${host}`
  const text = docs(origin)
  const lines = text.split('\n')
  const title = lines[0]
  const sections = splitSections(lines.slice(1))

  return (
    <div className="cls">
      <div className="page">
        <div className="doc">
          <header>
            <h1>
              <span className="syn"># </span>
              {title}
            </h1>
            {paragraphs(sections.intro).map((p, i) => (
              <p className="lead" key={i}>
                {p}
              </p>
            ))}
            <nav className="row" aria-label="Pages">
              <a className="b on" href="/hex">
                <span className="br">[</span>docs<span className="br">]</span>
              </a>
              <a className="b" href="/api/hex">
                <span className="br">[</span>plain text<span className="br">]</span>
              </a>
              <a className="b" href="https://github.com/mrmps/classifier-dev" rel="noreferrer">
                <span className="br">[</span>original source<span className="br">]</span>
              </a>
              <a className="b" href="/">
                <span className="br">[</span>BlueTAO<span className="br">]</span>
              </a>
            </nav>
          </header>

          <TryIt />

          <div className="prose">
            {sections.rest.map((s) => (
              <Doc key={s.heading} heading={s.heading} lines={s.lines} />
            ))}
          </div>

          <footer className="foot">
            <p>
              hex is a clone of classifier.dev. The plain-text document at{' '}
              <a className="inline" href="/api/hex">
                {origin}/api/hex
              </a>{' '}
              is the canonical one; this page is rendered from it.
            </p>
          </footer>
        </div>
      </div>
    </div>
  )
}

function paragraphs(lines: string[]) {
  return lines
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function splitSections(lines: string[]) {
  const intro: string[] = []
  const rest: { heading: string; lines: string[] }[] = []
  let current: { heading: string; lines: string[] } | null = null
  for (const line of lines) {
    if (isHeading(line)) {
      current = { heading: line, lines: [] }
      rest.push(current)
    } else if (current) {
      current.lines.push(line)
    } else {
      intro.push(line)
    }
  }
  return { intro, rest }
}

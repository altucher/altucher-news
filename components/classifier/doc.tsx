/**
 * One section of the plain-text document, rendered. The text is indented two
 * spaces under its heading; a block indented further, or one starting with a
 * command or a brace, is code and gets a copy button. Bare URLs become links.
 */
import { CopyButton } from './copy-button'

const isCode = (l: string) => /^ {4,}\S/.test(l)
const isCommand = (l: string) =>
  /^\s*(curl|npm|npx|pip|go get|classify)\b(?!:)/.test(l) || /^\s*[{[]/.test(l) || /^\s*(GET|POST)\s{2}/.test(l)

type Block = { kind: 'p' | 'pre'; lines: string[] }

function blocks(lines: string[]): Block[] {
  const out: Block[] = []
  let cur: Block | null = null
  for (const raw of lines) {
    if (!raw.trim()) {
      cur = null
      continue
    }
    // Is this line code: deeper than the prose indent, or a command at prose indent
    // followed by its output at the same indent?
    const code = isCode(raw) || (cur?.kind === 'pre' && /^ {2,}/.test(raw)) || (isCommand(raw) && !cur)
    if (code) {
      if (!cur || cur.kind !== 'pre') {
        cur = { kind: 'pre', lines: [] }
        out.push(cur)
      }
      cur.lines.push(raw)
    } else {
      if (!cur || cur.kind !== 'p') {
        cur = { kind: 'p', lines: [] }
        out.push(cur)
      }
      cur.lines.push(raw)
    }
  }
  return out
}

/** The common indent of a block, removed so the code sits flush in its box. */
function dedent(lines: string[]) {
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length))
  return lines.map((l) => l.slice(indent))
}

const URL_RE = /https?:\/\/[^\s<>()"']+/g

function linkify(text: string, key: string) {
  const parts: React.ReactNode[] = []
  let at = 0
  let i = 0
  for (const m of text.matchAll(URL_RE)) {
    const trail = m[0].match(/[.,;:]+$/)?.[0] ?? ''
    const href = m[0].slice(0, m[0].length - trail.length)
    parts.push(text.slice(at, m.index))
    parts.push(
      <a key={`${key}-${i++}`} className="inline" href={href} rel="noreferrer">
        {href}
      </a>,
    )
    parts.push(trail)
    at = (m.index ?? 0) + m[0].length
  }
  parts.push(text.slice(at))
  return parts
}

/**
 * A parameter table: lines shaped "  name   description", continued by lines
 * indented to the description column. Rendered as a definition list.
 */
function isParams(lines: string[]) {
  return lines.length > 1 && /^ {2}\S+ {2,}\S/.test(lines[0]) && lines.every((l) => /^ {2}\S+ {2,}\S/.test(l) || /^ {6,}\S/.test(l))
}

function params(lines: string[]) {
  const rows: { term: string; desc: string[] }[] = []
  for (const l of lines) {
    const m = l.match(/^ {2}(\S+(?: \S+)*) {2,}(.*)$/)
    if (m) rows.push({ term: m[1], desc: [m[2]] })
    else if (rows.length) rows[rows.length - 1].desc.push(l.trim())
  }
  return rows
}

export function Doc({ heading, lines }: { heading: string; lines: string[] }) {
  const id = heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  const title = heading.charAt(0) + heading.slice(1).toLowerCase()
  return (
    <section id={id}>
      <h2>
        <span className="syn">## </span>
        {title}
      </h2>
      {blocks(lines).map((b, i) => {
        if (b.kind === 'pre') {
          const code = dedent(b.lines).join('\n')
          return (
            <div className="block" key={i}>
              <pre>
                <code>
                  {code.split('\n').map((l, j) => (
                    <span key={j} className={/^(curl|npm|npx|pip|go get|classify)\b/.test(l) ? 'cmd' : undefined}>
                      {linkify(l, `${id}-${i}-${j}`)}
                      {'\n'}
                    </span>
                  ))}
                </code>
              </pre>
              <div className="row">
                <CopyButton text={code} />
              </div>
            </div>
          )
        }
        if (isParams(b.lines)) {
          return (
            <dl className="params" key={i}>
              {params(b.lines).map((r) => (
                <div key={r.term}>
                  <dt>{r.term}</dt>
                  <dd>{r.desc.join(' ')}</dd>
                </div>
              ))}
            </dl>
          )
        }
        return <p key={i}>{linkify(b.lines.map((l) => l.trim()).join(' '), `${id}-${i}`)}</p>
      })}
    </section>
  )
}

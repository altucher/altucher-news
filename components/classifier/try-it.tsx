'use client'

import { useEffect, useState } from 'react'
import { CopyButton } from './copy-button'

type Single = {
  label: string
  confidence: number | null
  scores: Record<string, number> | null
  unscored?: string
  escalated?: true
  ms: number
  model: string
  tier: string
}
type Multi = { labels: string[]; scores: Record<string, number> | null; unscored?: string; ms: number; model: string; tier: string }
type Answer = Single | Multi
type Failure = { error: string; code: string; try?: string }

const EXAMPLES: { labels: string; text: string }[] = [
  { labels: 'spam, not spam', text: 'Win a free iPhone now' },
  { labels: 'bug, feature, praise', text: 'the checkout button does nothing' },
  { labels: 'entailment, neutral, contradiction', text: 'Only 12 of 40 sites were inspected. Every site was inspected.' },
  { labels: 'joy, sadness, anger, fear, surprise, disgust', text: 'I cannot believe they cancelled the show after one season.' },
]

/**
 * The form at the top of the page: labels, text, a tier, and the same GET
 * request curl would make. The URL it builds is shown so the reader leaves
 * with something to paste.
 */
export function TryIt() {
  const [labels, setLabels] = useState(EXAMPLES[0].labels)
  const [text, setText] = useState(EXAMPLES[0].text)
  const [tier, setTier] = useState<'fast' | 'smart'>('fast')
  const [multi, setMulti] = useState(false)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  // The origin is only known in the browser; rendering it on the server would
  // mismatch on hydration, so the curl line grows its host after mount.
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])

  const list = labels.split(',').map((l) => l.trim()).filter(Boolean)
  const seg = (s: string) => encodeURIComponent(s).replace(/%20/g, '+')
  const path = `/api/hex/${list.map(seg).join(',')}/${seg(text.trim())}`
  const query = [tier === 'smart' ? 'tier=smart' : '', multi ? 'multi=1' : ''].filter(Boolean).join('&')
  const url = `${path}${query ? `?${query}` : ''}`
  const curl = `curl "${origin}${url}"`

  async function run(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setFailure(null)
    setAnswer(null)
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      const body = (await res.json().catch(() => null)) as Answer | Failure | null
      if (!res.ok || !body || 'error' in body) {
        setFailure((body as Failure) ?? { error: `HTTP ${res.status}`, code: `http_${res.status}` })
      } else {
        setAnswer(body)
      }
    } catch (err) {
      setFailure({ error: (err as Error).message, code: 'network' })
    } finally {
      setBusy(false)
    }
  }

  const ranked = answer && 'scores' in answer && answer.scores ? Object.entries(answer.scores).sort((a, b) => b[1] - a[1]) : null

  return (
    <section className="agent" id="try">
      <h2>
        <span className="syn">## </span>Try it
      </h2>
      <form onSubmit={run} className="try">
        <label>
          <span className="k">labels</span>
          <input
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            spellCheck={false}
            placeholder="spam, not spam"
            aria-label="Labels, separated by commas"
          />
        </label>
        <label>
          <span className="k">text</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Win a free iPhone now" aria-label="Text to classify" />
        </label>
        <div className="row opts">
          <span className="k">tier</span>
          {(['fast', 'smart'] as const).map((t) => (
            <button key={t} type="button" className={`b${tier === t ? ' on' : ''}`} onClick={() => setTier(t)} aria-pressed={tier === t}>
              <span className="br">[</span>
              {t}
              <span className="br">]</span>
            </button>
          ))}
          <button type="button" className={`b${multi ? ' on' : ''}`} onClick={() => setMulti(!multi)} aria-pressed={multi}>
            <span className="br">[</span>
            {multi ? 'multi-label: on' : 'multi-label: off'}
            <span className="br">]</span>
          </button>
          <span className="or">·</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.text}
              type="button"
              className="b dim"
              onClick={() => {
                setLabels(ex.labels)
                setText(ex.text)
                setAnswer(null)
                setFailure(null)
              }}
            >
              <span className="br">[</span>
              {ex.labels.split(',')[0].trim()}…
              <span className="br">]</span>
            </button>
          ))}
        </div>
        <div className="prompt block">
          <pre>
            <code>{curl}</code>
          </pre>
          <div className="row">
            <button type="submit" className="b cta" disabled={busy || list.length < 2 || !text.trim()}>
              <span className="br">[</span>
              {busy ? 'classifying…' : 'classify'}
              <span className="br">]</span>
            </button>
            <CopyButton text={curl} label="copy curl" />
            <a className="b" href={url} target="_blank" rel="noreferrer">
              <span className="br">[</span>open<span className="br">]</span>
            </a>
          </div>
        </div>
      </form>

      {failure && (
        <div className="note bad" role="alert">
          <b>error:</b> {failure.error} <span className="dim">({failure.code})</span>
          {failure.try && (
            <>
              <br />
              <b>try:</b> <a className="inline" href={failure.try}>{failure.try}</a>
            </>
          )}
        </div>
      )}

      {answer && 'labels' in answer && (
        <div className="result">
          <div className="big">{answer.labels.length ? answer.labels.join(', ') : <span className="dim">none</span>}</div>
          {ranked && (
            <div className="scroll">
              <table className="scores">
                <tbody>
                  {ranked.map(([l, v]) => (
                    <tr key={l} className={answer.labels.includes(l) ? 'best' : undefined}>
                      <td>{l}</td>
                      <td className="num">{v.toFixed(4)}</td>
                      <td className="bar">
                        <span style={{ width: `${Math.max(1, v * 100)}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="dim">
            {answer.unscored ? `unscored: ${answer.unscored} · ` : ''}
            {answer.tier} · {answer.ms}ms · {answer.model}
          </p>
        </div>
      )}

      {answer && 'label' in answer && (
        <div className="result">
          <div className="big">
            {answer.label}
            {answer.confidence !== null && <span className="conf"> {(answer.confidence * 100).toFixed(1)}%</span>}
          </div>
          {ranked && (
            <div className="scroll">
              <table className="scores">
                <tbody>
                  {ranked.map(([l, v]) => (
                    <tr key={l} className={l === answer.label ? 'best' : undefined}>
                      <td>{l}</td>
                      <td className="num">{v.toFixed(4)}</td>
                      <td className="bar">
                        <span style={{ width: `${Math.max(1, v * 100)}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="dim">
            {answer.unscored ? `unscored: ${answer.unscored} · ` : ''}
            {answer.confidence === null && !answer.unscored ? 'this provider returned no scores · ' : ''}
            {answer.escalated ? 'escalated to the reasoning model · ' : ''}
            {answer.tier} · {answer.ms}ms · {answer.model}
          </p>
        </div>
      )}
    </section>
  )
}

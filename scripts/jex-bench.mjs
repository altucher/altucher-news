#!/usr/bin/env node
/**
 * jex against Jev, on classifier.dev's own benchmark sets.
 *
 *   node scripts/jex-bench.mjs --base https://your-deploy.vercel.app
 *   node scripts/jex-bench.mjs --base http://localhost:3000 --n 100 --tier fast
 *   TYPESAFE_API_KEY=... node scripts/jex-bench.mjs --base ... --jev   # measure Jev live too
 *
 * Single-label: AG News (four-way topic) and dair-ai/emotion (six-way), the
 * first 400 test items of each, exactly the sets and count classifier.dev
 * reports for Jev. Multi-label: the seven hand-labelled cases from
 * classifier.dev's eval/cases.py, scored with its precision/recall/F1.
 *
 * Jev's numbers come from classifier.dev's checked-in measurement
 * (src/vs-jev.json, 2026-09-18, and eval/README.md for multi-label) unless
 * --jev re-measures it live through TypeSafe's API, which also unlocks the
 * per-item comparisons: accuracy on the items Jev was unsure about, and
 * agreement between the two.
 *
 * No dependencies. Datasets are fetched once from the Hugging Face
 * datasets-server and cached under --data-dir; raw per-item results land in
 * --out-dir so a run can be re-summarised without re-spending.
 */
import fs from 'node:fs'
import path from 'node:path'

// ------------------------------------------------------------------ reference

/** What classifier.dev measured for Jev. Sources: src/vs-jev.json (single-label), eval/README.md (multi-label). */
const JEV_REFERENCE = {
  measured: '2026-09-18',
  ag_news: { acc: 0.875, ms_item: 2.16, cost_per_1k: 0.0054, n: 400 },
  emotion: { acc: 0.6175, ms_item: 1.92, cost_per_1k: 0.0043, n: 400 },
  multi: { p: 0.81, r: 0.99, f1: 0.887, ms: 232 },
}

const DATASETS = {
  ag_news: { ds: 'fancyzhx/ag_news', cfg: 'default', split: 'test' },
  emotion: { ds: 'dair-ai/emotion', cfg: 'split', split: 'test' },
}

// ------------------------------------------------------------------ the seven multi-label cases (eval/cases.py)

const TAGS50 = ['machine learning', 'databases', 'distributed systems', 'security', 'privacy', 'startups',
  'venture capital', 'open source', 'developer tools', 'cloud infrastructure', 'serverless', 'kubernetes',
  'programming languages', 'rust', 'python', 'javascript', 'web development', 'frontend', 'backend', 'devops',
  'observability', 'performance optimization', 'caching', 'networking', 'cryptography', 'blockchain',
  'hardware', 'semiconductors', 'climate', 'biotech', 'healthcare', 'education', 'gaming', 'social media',
  'regulation', 'antitrust', 'labor', 'remote work', 'hiring', 'product management', 'design', 'typography',
  'accessibility', 'mobile', 'ios', 'android', 'testing', 'compilers', 'operating systems', 'robotics']
const ARTICLE = `After eighteen months running our own Postgres cluster on rented metal, we moved the
whole thing to a managed serverless platform and cut the on-call rota in half. The migration was not
free. We rewrote the connection pooling layer in Rust because the Python service could not hold
enough idle connections without ballooning memory, and we spent three weeks building out tracing
before we trusted a single query path. What surprised us was the caching story: once we put a
read-through cache in front of the hottest ten queries, p99 latency dropped from 400ms to 38ms and
our compute bill fell by roughly 60 percent. The engineers who had been carrying the pager every
third week got their evenings back, which mattered more for retention than any of the numbers.
We open sourced the pooling library last month.`
const GENRES = ['comedy', 'drama', 'horror', 'science fiction', 'fantasy', 'documentary', 'romance', 'thriller',
  'animation', 'war', 'western', 'musical', 'crime', 'biography', 'sports', 'family', 'mystery', 'noir', 'satire', 'adventure']
const TICKET = ['billing', 'refund', 'login problem', 'bug', 'feature request', 'documentation', 'performance',
  'security', 'integration', 'pricing', 'cancellation', 'data export', 'mobile', 'accessibility', 'onboarding']
const SKILLS = ['python', 'javascript', 'typescript', 'rust', 'go', 'java', 'sql', 'react', 'vue', 'node', 'django',
  'kubernetes', 'docker', 'aws', 'gcp', 'terraform', 'ci/cd', 'machine learning', 'data engineering', 'etl',
  'postgres', 'redis', 'kafka', 'graphql', 'rest api', 'testing', 'security', 'leadership', 'mentoring', 'agile']
const ASPECTS = ['battery life', 'screen quality', 'build quality', 'price', 'customer service', 'shipping',
  'software', 'noise', 'comfort', 'durability', 'design', 'accessories']
const SUBSYS = ['authentication', 'database', 'caching', 'networking', 'ui rendering', 'file upload', 'search',
  'notifications', 'billing', 'permissions', 'logging', 'migration', 'api', 'mobile app', 'email', 'scheduler', 'import', 'export']
const TOPICS = ['politics', 'economy', 'technology', 'health', 'climate', 'education', 'sports', 'entertainment',
  'science', 'business', 'law', 'immigration', 'housing', 'transport', 'energy', 'agriculture', 'labor',
  'international', 'military', 'local government', 'media', 'religion', 'crime', 'infrastructure', 'elections']

const CASES = [
  ['tech article / 50 tags', TAGS50, ARTICLE,
    ['databases', 'distributed systems', 'cloud infrastructure', 'serverless', 'rust', 'python',
      'backend', 'devops', 'observability', 'performance optimization', 'caching', 'open source']],
  ['film synopsis / genres', GENRES,
    'A washed-up detective in a rain-soaked city takes one last case: a missing heiress, a nightclub ' +
    'owner who lies for sport, and a partner who may be on the take. Shot in black and white, the film ' +
    'plays its grim double-crosses for uneasy laughs, and ends with a shrug rather than a shootout.',
    ['crime', 'mystery', 'noir', 'drama', 'comedy']],
  ['support ticket / areas', TICKET,
    'I upgraded to the Pro plan on Tuesday and was charged twice. On top of that the dashboard now takes ' +
    'close to a minute to load on my phone, and the invoice download button returns a 500. I would like ' +
    'one of the charges reversed.',
    ['billing', 'refund', 'bug', 'performance', 'mobile']],
  ['job posting / skills', SKILLS,
    'We are hiring a senior backend engineer to own our data platform. You will write Python and SQL ' +
    'daily, maintain Airflow pipelines feeding a Postgres warehouse, and tune Kafka consumers under load. ' +
    'Experience with Terraform and AWS is expected, and you will mentor two junior engineers.',
    ['python', 'sql', 'postgres', 'kafka', 'terraform', 'aws', 'data engineering', 'etl', 'mentoring']],
  ['product review / aspects', ASPECTS,
    'Three months in. The battery still gets me through a full day, and the aluminium body has survived ' +
    'two drops without a mark. But the fans are audible in a quiet room, and support took nine days to ' +
    'answer a simple question. For the money I expected better on both counts.',
    ['battery life', 'build quality', 'durability', 'noise', 'customer service', 'price']],
  ['bug report / subsystems', SUBSYS,
    'After the 4.2 migration, users with SSO accounts cannot log in — the session token is issued but the ' +
    'permission check rejects it. Attaching a file over 10MB also now fails silently, and nothing shows up ' +
    'in the logs for either case.',
    ['authentication', 'permissions', 'migration', 'file upload', 'logging']],
  ['news story / topics', TOPICS,
    'The council approved a rezoning plan that clears the way for 4,000 new apartments near the rail ' +
    'corridor, over objections from residents worried about school capacity. Construction unions backed the ' +
    'measure, citing three years of steady work. The vote fell along party lines ahead of the spring election.',
    ['housing', 'local government', 'transport', 'education', 'labor', 'politics', 'elections']],
]

// ------------------------------------------------------------------ args

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return dflt
  const v = argv[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const BASE = String(flag('base', '')).replace(/\/$/, '')
const N = Number(flag('n', 400))
const TIERS = flag('tier', 'both') === 'both' ? ['fast', 'smart'] : [String(flag('tier'))]
const SETS = String(flag('sets', 'ag_news,emotion,multi')).split(',')
const RUNS = Number(flag('runs', 2))
const CHUNK = Number(flag('chunk', 50))
const MEASURE_JEV = flag('jev', false) === true
const FRESH = flag('fresh', false) === true
const DATA_DIR = String(flag('data-dir', 'scripts/bench-data'))
const OUT_DIR = String(flag('out-dir', 'scripts/bench-results'))
const UNSURE = 0.7

if (!BASE || flag('help', false) === true) {
  console.error('usage: node scripts/jex-bench.mjs --base <url> [--n 400] [--tier fast|smart|both] [--sets ag_news,emotion,multi] [--runs 2] [--jev] [--fresh]')
  process.exit(2)
}
if (MEASURE_JEV && !process.env.TYPESAFE_API_KEY) {
  console.error('--jev needs TYPESAFE_API_KEY')
  process.exit(2)
}

const log = (s) => process.stderr.write(s + '\n')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (x) => (x == null || Number.isNaN(x) ? '   -  ' : `${(x * 100).toFixed(1).padStart(5)}%`)
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const median = (xs) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

// ------------------------------------------------------------------ data

async function loadSet(name, n) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const file = path.join(DATA_DIR, `${name}.json`)
  let d
  if (fs.existsSync(file)) {
    d = JSON.parse(fs.readFileSync(file, 'utf8'))
  } else {
    const { ds, cfg, split } = DATASETS[name]
    const rows = []
    let features = {}
    for (let off = 0; off < n; off += 100) {
      const u = `https://datasets-server.huggingface.co/rows?dataset=${ds}&config=${cfg}&split=${split}&offset=${off}&length=${Math.min(100, n - off)}`
      const res = await fetch(u, { headers: { 'user-agent': 'jex-bench/1.0' } })
      if (!res.ok) throw new Error(`hugging face ${res.status} for ${name}`)
      const page = await res.json()
      features = Object.fromEntries(page.features.map((f) => [f.name, f.type]))
      rows.push(...page.rows.map((r) => r.row))
    }
    d = { features, rows }
    fs.writeFileSync(file, JSON.stringify(d))
  }
  if (d.rows.length < n) log(`  ${name}: only ${d.rows.length} cached items; run with --fresh-data or delete ${file} for more`)
  const labels = d.features.label.names
  return { labels, rows: d.rows.slice(0, n).map((r) => ({ text: r.text, gold: labels[r.label] })) }
}

// ------------------------------------------------------------------ jex

async function post(url, body, headers = {}) {
  const t = Date.now()
  let res
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'jex-bench/1.0', ...headers }, body: JSON.stringify(body) })
  } catch (e) {
    return { payload: { error: `network: ${e.message}` }, headers: new Headers(), ms: Date.now() - t }
  }
  const payload = await res.json().catch(() => ({ error: `http ${res.status}` }))
  if (!res.ok && !payload.error) payload.error = `http ${res.status}`
  return { payload, headers: res.headers, ms: Date.now() - t }
}

async function jexSingle(rows, labels, tier) {
  const out = new Array(rows.length)
  const usage = { classifications: 0, escalated: 0, escalation_failed: 0 }
  const models = new Set()
  for (let start = 0; start < rows.length; start += CHUNK) {
    const inputs = rows.slice(start, start + CHUNK).map((r) => r.text)
    let p, ms
    for (let attempt = 0; ; attempt++) {
      const r = await post(`${BASE}/api/jex`, { inputs, labels, tier })
      p = r.payload
      ms = r.ms
      if (p.results) break
      if (attempt >= 7) throw new Error(`jex ${tier}: gave up at item ${start}: ${p.error}`)
      const wait = Number(r.headers.get('retry-after')) || 5 * 2 ** attempt
      log(`  jex ${tier}: ${p.error} — waiting ${wait}s`)
      await sleep(wait * 1000)
    }
    if (p.results.length !== inputs.length) throw new Error(`jex ${tier}: ${p.results.length} results for ${inputs.length} inputs`)
    for (const k of Object.keys(usage)) usage[k] += p.usage?.[k] ?? 0
    p.results.forEach((r, k) => {
      models.add(r.model)
      out[start + k] = { label: r.label, confidence: r.confidence, scores: r.scores, escalated: !!r.escalated, model: r.model, ms: ms / inputs.length }
    })
    log(`  jex ${tier}: ${start + inputs.length}/${rows.length}  ${ms}ms/batch  escalated ${usage.escalated}`)
  }
  return { out, usage, models: [...models] }
}

async function jexMulti(labels, text) {
  for (let attempt = 0; ; attempt++) {
    const r = await post(`${BASE}/api/jex`, { input: text, labels, multi: true })
    if (r.payload.results) return { labels: r.payload.results[0].labels ?? [], ms: r.ms, model: r.payload.results[0].model }
    if (attempt >= 5) throw new Error(`jex multi: ${r.payload.error}`)
    const wait = Number(r.headers.get('retry-after')) || 5 * 2 ** attempt
    log(`  jex multi: ${r.payload.error} — waiting ${wait}s`)
    await sleep(wait * 1000)
  }
}

// ------------------------------------------------------------------ jev (TypeSafe), the same call eval/single.py makes

async function jevSingle(rows, labels, pack = 400) {
  const key = process.env.TYPESAFE_API_KEY
  const out = new Array(rows.length)
  let tokens = 0
  for (let start = 0; start < rows.length; start += pack) {
    const chunk = rows.slice(start, start + pack)
    const state = chunk.map((r, k) => ({ id: `i${k}`, text: r.text }))
    const questions = Object.fromEntries(chunk.map((_, k) => [`i${k}`, { type: 'choice', instructions: `Which category does item \`i${k}\` belong to?`, criteria: Object.fromEntries(labels.map((l) => [l, null])) }]))
    const { payload: p, ms } = await post('https://api.typesafe.ai/v1/systemone', { state, model: 'jev-latest', questions }, { authorization: `Bearer ${key}` })
    if (!p.answers) throw new Error(`typesafe: ${JSON.stringify(p).slice(0, 200)}`)
    tokens += p.usage?.input_tokens ?? 0
    chunk.forEach((_, k) => {
      const a = p.answers[`i${k}`]
      out[start + k] = { label: a.choice, confidence: a.confidence, scores: a.probabilities, ms: ms / chunk.length, model: p.model ?? 'jev' }
    })
    log(`  jev: ${start + chunk.length}/${rows.length}  ${ms}ms/batch`)
  }
  return { out, cost: (tokens * 0.042) / 1e6, models: ['jev'] }
}

async function jevMulti(labels, text) {
  const key = process.env.TYPESAFE_API_KEY
  const questions = Object.fromEntries(labels.map((l) => [l, { type: 'boolean', instructions: `Does the category "${l}" apply to the text?` }]))
  const { payload: p, ms } = await post('https://api.typesafe.ai/v1/systemone', { state: text, model: 'jev-latest', questions }, { authorization: `Bearer ${key}` })
  if (!p.answers) throw new Error(`typesafe: ${JSON.stringify(p).slice(0, 200)}`)
  const picked = labels.filter((l) => (p.answers[l]?.probability ?? (p.answers[l]?.answer ? 1 : 0)) >= UNSURE)
  return { labels: picked, ms, model: 'jev' }
}

// ------------------------------------------------------------------ scoring

function calibration(out, rows) {
  const buckets = { '>=0.9': [], '0.7-0.9': [], '<0.7': [], unscored: [] }
  out.forEach((o, i) => {
    const right = o.label === rows[i].gold
    if (o.confidence == null) buckets.unscored.push(right)
    else if (o.confidence >= 0.9) buckets['>=0.9'].push(right)
    else if (o.confidence >= UNSURE) buckets['0.7-0.9'].push(right)
    else buckets['<0.7'].push(right)
  })
  return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, { n: v.length, acc: v.length ? mean(v.map(Number)) : null }]))
}

function summariseSingle(rows, runs) {
  const jev = runs.jev?.out
  const unsure = jev ? new Set(jev.flatMap((o, i) => ((o.confidence ?? 0) < UNSURE ? [i] : []))) : null
  const summary = {}
  for (const [name, run] of Object.entries(runs)) {
    const out = run.out
    const right = out.map((o, i) => o.label === rows[i].gold)
    const row = {
      acc: mean(right.map(Number)),
      ms_item: mean(out.map((o) => o.ms)),
      escalated: out.filter((o) => o.escalated).length,
      models: run.models,
      calibration: calibration(out, rows),
      cost_per_1k: run.cost != null ? (run.cost / rows.length) * 1000 : null,
    }
    if (unsure) {
      row.acc_unsure = unsure.size ? mean([...unsure].map((i) => Number(right[i]))) : null
      row.acc_sure = mean(right.filter((_, i) => !unsure.has(i)).map(Number))
      row.agree_with_jev = mean(out.map((o, i) => Number(o.label === jev[i].label)))
    }
    summary[name] = row
  }
  return { n: rows.length, unsure: unsure ? unsure.size : null, rows: summary }
}

function prf(got, gold) {
  const g = new Set(got)
  const w = new Set(gold)
  const hit = [...g].filter((x) => w.has(x)).length
  const p = g.size ? hit / g.size : 0
  const r = w.size ? hit / w.size : 1
  return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0 }
}

async function runMulti(fn, name) {
  const ps = [], rs = [], fs = [], ms = [], perCase = []
  for (const [caseName, labels, text, gold] of CASES) {
    const caseF = []
    for (let i = 0; i < RUNS; i++) {
      let got = [], elapsed = NaN
      try {
        const r = await fn(labels, text)
        got = r.labels
        elapsed = r.ms
      } catch (e) {
        log(`  ${name} ${caseName}: FAILED ${e.message}`)
      }
      const s = prf(got, gold)
      ps.push(s.p); rs.push(s.r); fs.push(s.f1); caseF.push(s.f1)
      if (!Number.isNaN(elapsed)) ms.push(elapsed)
      log(`  ${name} ${caseName} run ${i + 1}: F1 ${s.f1.toFixed(2)} (${got.length} picked, ${gold.length} gold) ${Number.isNaN(elapsed) ? '' : elapsed + 'ms'}`)
    }
    perCase.push({ name: caseName, f1: mean(caseF) })
  }
  return { p: mean(ps), r: mean(rs), f1: mean(fs), ms: median(ms), cases: perCase }
}

// ------------------------------------------------------------------ main

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  const report = { measured: date, base: BASE, n: N, jev_reference: JEV_REFERENCE, single: {}, multi: null }

  for (const set of SETS.filter((s) => s !== 'multi')) {
    log(`\n${set}: ${N} items`)
    const { labels, rows } = await loadSet(set, N)
    const runs = {}
    const cache = (name) => path.join(OUT_DIR, `${set}-${name}.json`)
    if (MEASURE_JEV) {
      if (!FRESH && fs.existsSync(cache('jev')) && JSON.parse(fs.readFileSync(cache('jev'), 'utf8')).out.length >= rows.length) {
        runs.jev = JSON.parse(fs.readFileSync(cache('jev'), 'utf8'))
        runs.jev.out = runs.jev.out.slice(0, rows.length)
      } else {
        runs.jev = await jevSingle(rows, labels)
        fs.writeFileSync(cache('jev'), JSON.stringify(runs.jev))
      }
    }
    for (const tier of TIERS) {
      runs[`jex ${tier}`] = await jexSingle(rows, labels, tier)
      fs.writeFileSync(cache(`jex-${tier}`), JSON.stringify(runs[`jex ${tier}`]))
    }
    report.single[set] = summariseSingle(rows, runs)
  }

  if (SETS.includes('multi')) {
    log(`\nmulti-label: ${CASES.length} cases x ${RUNS} runs`)
    report.multi = { jex: await runMulti(jexMulti, 'jex') }
    if (MEASURE_JEV) report.multi.jev = await runMulti(jevMulti, 'jev')
  }

  fs.writeFileSync(path.join(OUT_DIR, `jex-vs-jev-${date}.json`), JSON.stringify(report, null, 2))
  print(report)
}

function print(report) {
  const out = []
  out.push(`jex (${report.base}) vs Jev, measured ${report.measured}`)
  out.push('')
  for (const [set, s] of Object.entries(report.single)) {
    out.push(`${set}  (${s.n} items${s.unsure != null ? `, ${s.unsure} Jev-unsure` : ''})`)
    out.push(`  ${'run'.padEnd(26)} ${'acc'.padStart(6)} ${'unsure'.padStart(7)} ${'sure'.padStart(6)} ${'agree'.padStart(6)} ${'ms/item'.padStart(8)} ${'$/1k'.padStart(7)}  models`)
    const ref = JEV_REFERENCE[set]
    if (!s.rows.jev && ref) {
      out.push(`  ${'jev (classifier.dev ref)'.padEnd(26)} ${pct(ref.acc)} ${'-'.padStart(7)} ${'-'.padStart(6)} ${'-'.padStart(6)} ${ref.ms_item.toFixed(1).padStart(8)} ${ref.cost_per_1k.toFixed(4).padStart(7)}  jev, ${JEV_REFERENCE.measured}`)
    }
    for (const [name, r] of Object.entries(s.rows)) {
      out.push(`  ${name.padEnd(26)} ${pct(r.acc)} ${pct(r.acc_unsure)} ${pct(r.acc_sure)} ${pct(r.agree_with_jev)} ${r.ms_item.toFixed(1).padStart(8)} ${(r.cost_per_1k == null ? '-' : r.cost_per_1k.toFixed(4)).padStart(7)}  ${r.models.join(',')}${r.escalated ? ` (${r.escalated} escalated)` : ''}`)
    }
    for (const [name, r] of Object.entries(s.rows)) {
      const c = r.calibration
      out.push(`  ${name} calibration: ` + Object.entries(c).map(([k, v]) => `${k}: ${v.n} items${v.acc == null ? '' : ` ${pct(v.acc).trim()} right`}`).join('  '))
    }
    out.push('')
  }
  if (report.multi) {
    out.push(`multi-label  (${CASES.length} cases, macro P/R/F1, median ms)`)
    out.push(`  ${'run'.padEnd(26)} ${'P'.padStart(5)} ${'R'.padStart(5)} ${'F1'.padStart(6)} ${'ms'.padStart(7)}`)
    const ref = JEV_REFERENCE.multi
    if (!report.multi.jev) out.push(`  ${'jev (classifier.dev ref)'.padEnd(26)} ${ref.p.toFixed(2).padStart(5)} ${ref.r.toFixed(2).padStart(5)} ${ref.f1.toFixed(3).padStart(6)} ${String(ref.ms).padStart(7)}`)
    for (const [name, r] of Object.entries(report.multi)) {
      out.push(`  ${name.padEnd(26)} ${r.p.toFixed(2).padStart(5)} ${r.r.toFixed(2).padStart(5)} ${r.f1.toFixed(3).padStart(6)} ${(Number.isNaN(r.ms) ? '-' : r.ms.toFixed(0)).padStart(7)}`)
      for (const c of r.cases) out.push(`      ${c.name.padEnd(26)} F1=${c.f1.toFixed(2)}`)
    }
    out.push('')
  }
  out.push('Jev reference numbers are classifier.dev\'s own measurement (src/vs-jev.json, eval/README.md).')
  out.push('Differences under ~5 points on 400 items are within noise; see classifier.dev/eval/README.md.')
  console.log(out.join('\n'))
}

main().catch((e) => {
  log(`error: ${e.message}`)
  process.exit(1)
})

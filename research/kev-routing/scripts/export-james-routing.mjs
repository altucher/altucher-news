// Export James's routing decisions from analytics_events to JSONL for kev training.
//
//   node research/kev-routing/scripts/export-james-routing.mjs [out.jsonl]
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or
// .env.local (same convention as scripts/run-sql.mjs). Keeps chat_query events whose model
// starts with "james/": the cell James chose, written by app/api/chat/route.ts from the
// x-james-route header. Only the prompt, the cell and the search flag are exported; no
// user ids or locations. Prompts in this table are the last user message, cut at 500 chars.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const out = process.argv[2] || 'research/kev-routing/data/james_routing.jsonl'
const env = { ...process.env }
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/)
    if (m && !env[m[1]]) env[m[1]] = m[2]
  }
}
const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing'); process.exit(1) }
const db = createClient(url, key)

const rows = []
const page = 1000
for (let from = 0; ; from += page) {
  const { data, error } = await db
    .from('analytics_events')
    .select('id, created_at, prompt, model, used_desearch')
    .eq('event_type', 'chat_query')
    .like('model', 'james/%')
    .order('created_at', { ascending: true })
    .range(from, from + page - 1)
  if (error) { console.error('query failed:', error.message); process.exit(1) }
  rows.push(...data)
  if (data.length < page) break
}

fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })
fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''))

const byCell = {}
for (const r of rows) byCell[r.model] = (byCell[r.model] || 0) + 1
const withPrompt = rows.filter((r) => r.prompt && r.prompt.trim()).length
console.log(`wrote ${rows.length} James-served chat events to ${out} (${withPrompt} with a prompt)`)
if (rows.length) console.log(`range ${rows[0].created_at} .. ${rows[rows.length - 1].created_at}`)
for (const [cell, n] of Object.entries(byCell).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(6)}  ${cell}`)

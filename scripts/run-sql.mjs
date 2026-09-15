// Runs a SQL file against the project's Postgres (Supabase) using .env.local.
// Usage: node scripts/run-sql.mjs scripts/create-assistant-tables.sql
import fs from 'node:fs'
import pg from 'pg'

const file = process.argv[2]
if (!file) { console.error('usage: node scripts/run-sql.mjs <file.sql>'); process.exit(1) }
const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/)
  if (m) env[m[1]] = m[2]
}
const url = (env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL_NON_POOLING || '').replace(/\?.*$/, '')
if (!url) { console.error('POSTGRES_URL_NON_POOLING missing'); process.exit(1) }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(fs.readFileSync(file, 'utf8'))
  console.log('ok:', file)
} finally {
  await client.end()
}

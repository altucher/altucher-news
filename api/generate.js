import Anthropic from "@anthropic-ai/sdk";
import { kv } from "@vercel/kv";

const client = new Anthropic();

const rateLimits = new Map();
const MAX_PER_HOUR = 5;
const WINDOW_MS = 60 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimits.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + WINDOW_MS;
  }
  record.count += 1;
  rateLimits.set(ip, record);
  return record.count <= MAX_PER_HOUR;
}

async function fetchMarketaux(searchTerm) {
  const base = `https://api.marketaux.com/v1/news/all?language=en&filter_entities=true&limit=40&api_token=${process.env.MARKETAUX_API_KEY}`;
  const url = searchTerm ? `${base}&search=${encodeURIComponent(searchTerm)}` : base;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`News API failed: ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

async function logSearch({ filter, country, status }) {
  try {
    const entry = {
      filter: filter || "none",
      country: country || "unknown",
      status,
      timestamp: new Date().toISOString()
    };
    await kv.lpush("searches", JSON.stringify(entry));
    await kv.ltrim("searches", 0, 4999);
  } catch (err) {
    console.error("Failed to log search:", err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  const country = req.headers["x-vercel-ip-country"] || "unknown";

  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Rate limit exceeded. Try again in an hour." });
  }

  const body = req.body || {};
  const filter = (body.filter || "").trim().toLowerCase();
  const isWeirdFilter = filter === "weird";

  try {
    let articles = [];
    let fallbackNote = null;

    if (isWeirdFilter || !filter) {
      articles = await fetchMarketaux(null);
    } else {
      const filtered = await fetchMarketaux(filter);
      if (filtered.length >= 6) {
        articles = filtered;
      } else {
        const general = await fetchMarketaux(null);
        const seenUrls = new Set(filtered.map(a => a.url));
        const padding = general.filter(a => !seenUrls.has(a.url));
        articles = [...filtered, ...padding];
        if (filtered.length === 0) {
          fallbackNote = `No stories matched "${filter}" — showing general market news instead.`;
        } else {
          fallbackNote = `Only ${filtered.length} ${filtered.length === 1 ? "story" : "stories"} matched "${filter}" — padded with general market news.`;
        }
      }
    }

    if (articles.length < 6) {
      throw new Error(`Not enough news available right now (got ${articles.length}). Try again later.`);
    }

    const headlines = articles.slice(0, 40).map((article, i) =>
      `${i + 1}. ${article.title} — ${article.description || ""} (Source: ${article.source}) [URL: ${article.url}]`
    ).join("\n");

    const weirdInstruction = isWeirdFilter
      ? `Special instruction: the user has chosen the "weird" lens. ALL six stories should lean into the unusual, counterintuitive, or quirky angle of the news. Find the surprising read on each. The "weird stats" story is still required as one of the six, but the other five should also feel offbeat.`
      : `EXACTLY ONE of the six must be a "weird stats" story — built around an unusual, counterintuitive, or surprising statistic about the markets, AND it must lean bullish (find the optimistic read on the number). Tag this one as "Weird stats".`;

    const focusInstruction = filter && !isWeirdFilter
      ? `\n\nThe user has filtered for: "${filter}". Prefer stories from the headlines below that relate to this topic.`
      : "";

    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 6000,
      messages: [
        {
          role: "user",
          content: `Below are real financial news headlines from today. You MUST pick exactly 6 (six) stories. Not 5. Not 7. Exactly 6.

Selection criteria:
- Must be IMPORTANT (real market signal, not fluff or PR)
- Must be slightly QUIRKY (an odd angle, a counterintuitive detail)
- Prefer variety across asset classes / sectors

${weirdInstruction}${focusInstruction}

Rewrite each in the voice of James Altucher: punchy, contrarian, conversational, slightly self-deprecating, short sentences, rhetorical questions. 3-4 sentences per body. Don't summarize — interpret.

Include the source URL from the headline list (the value inside [URL: ...]).

Headlines:

${headlines}

Return ONLY valid JSON with exactly 6 entries. No preamble. No markdown fences.
{
  "stories": [
    { "tag": "category", "headline": "rewritten headline", "body": "3-4 sentences", "source_url": "exact URL" }
  ]
}`
        }
      ]
    });

    const text = message.content[0].text;
    const data = JSON.parse(text);

    if (!data.stories || !Array.isArray(data.stories) || data.stories.length !== 6) {
      throw new Error(`Invalid response from Claude (got ${data.stories?.length || 0} stories)`);
    }

    if (fallbackNote) data.note = fallbackNote;

    await logSearch({ filter, country, status: "success" });
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    await logSearch({ filter, country, status: "error" });
    res.status(500).json({ error: err.message });
  }
}

File 3: api/admin.js (NEW file — create it inside the api folder)
javascriptimport { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const password = req.query.password;
  if (password !== process.env.ADMIN_PASSWORD) {
    res.setHeader("Content-Type", "text/html");
    return res.status(401).send(`
      <!DOCTYPE html>
      <html><head><title>Admin</title>
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 400px; margin: 5rem auto; padding: 1rem; }
        input { font-size: 16px; padding: 10px; width: 100%; box-sizing: border-box; border: 1px solid #ccc; border-radius: 6px; }
        button { font-size: 16px; padding: 10px 20px; margin-top: 10px; background: #1a1a1a; color: white; border: none; border-radius: 6px; cursor: pointer; }
      </style></head>
      <body>
        <h2>Admin login</h2>
        <form method="GET" action="/api/admin">
          <input type="password" name="password" placeholder="Password" autofocus />
          <button type="submit">Sign in</button>
        </form>
      </body></html>
    `);
  }

  try {
    const raw = await kv.lrange("searches", 0, -1);
    const entries = raw.map(r => typeof r === "string" ? JSON.parse(r) : r);

    const filterCounts = {};
    const countryCounts = {};
    let successCount = 0;
    let errorCount = 0;

    for (const e of entries) {
      filterCounts[e.filter] = (filterCounts[e.filter] || 0) + 1;
      countryCounts[e.country] = (countryCounts[e.country] || 0) + 1;
      if (e.status === "success") successCount++;
      else errorCount++;
    }

    const sortedFilters = Object.entries(filterCounts).sort((a, b) => b[1] - a[1]);
    const sortedCountries = Object.entries(countryCounts).sort((a, b) => b[1] - a[1]);

    res.setHeader("Content-Type", "text/html");
    res.status(200).send(`
      <!DOCTYPE html>
      <html><head><title>Admin — searches</title>
      <style>
        body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 2rem auto; padding: 1rem; color: #1a1a1a; }
        h1 { font-size: 24px; }
        h2 { font-size: 18px; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        table { border-collapse: collapse; width: 100%; font-size: 14px; }
        td, th { padding: 6px 10px; border-bottom: 1px solid #eee; text-align: left; }
        th { background: #f5f5f0; }
        .stats { display: flex; gap: 2rem; margin-top: 1rem; }
        .stat { background: #f5f5f0; padding: 12px 16px; border-radius: 8px; }
        .stat .num { font-size: 22px; font-weight: 500; }
        .stat .label { font-size: 12px; color: #666; }
      </style></head>
      <body>
        <h1>Search log</h1>
        <div class="stats">
          <div class="stat"><div class="num">${entries.length}</div><div class="label">Total searches</div></div>
          <div class="stat"><div class="num">${successCount}</div><div class="label">Successful</div></div>
          <div class="stat"><div class="num">${errorCount}</div><div class="label">Errors</div></div>
        </div>

        <h2>Top filters</h2>
        <table><tr><th>Filter</th><th>Count</th></tr>
        ${sortedFilters.map(([f, c]) => `<tr><td>${f}</td><td>${c}</td></tr>`).join("")}
        </table>

        <h2>Top countries</h2>
        <table><tr><th>Country</th><th>Count</th></tr>
        ${sortedCountries.map(([c, n]) => `<tr><td>${c}</td><td>${n}</td></tr>`).join("")}
        </table>

        <h2>Recent searches (last 100)</h2>
        <table><tr><th>Time</th><th>Filter</th><th>Country</th><th>Status</th></tr>
        ${entries.slice(0, 100).map(e =>
          `<tr><td>${new Date(e.timestamp).toLocaleString()}</td><td>${e.filter}</td><td>${e.country}</td><td>${e.status}</td></tr>`
        ).join("")}
        </table>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
}

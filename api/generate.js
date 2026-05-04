import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// Simple in-memory rate limiter (resets when serverless function cold-starts)
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Rate limit exceeded. Try again in an hour." });
  }

  try {
    // 1. Fetch real financial news from Marketaux
    const newsUrl = `https://api.marketaux.com/v1/news/all?language=en&filter_entities=true&limit=20&api_token=${process.env.MARKETAUX_API_KEY}`;
    const newsRes = await fetch(newsUrl);
    if (!newsRes.ok) throw new Error(`News API failed: ${newsRes.status}`);
    const newsData = await newsRes.json();

    if (!newsData.data || newsData.data.length === 0) {
      throw new Error("No news returned from Marketaux");
    }

    // Build a compact list of headlines for Claude
    const headlines = newsData.data.map((article, i) =>
      `${i + 1}. ${article.title} — ${article.description || ""} (Source: ${article.source})`
    ).join("\n");

    // 2. Ask Claude to pick three and rewrite them
    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `Below are real financial news headlines from today. Pick the THREE most worth reading.

Selection criteria:
- Must be IMPORTANT (real market signal, not fluff or PR)
- Must be slightly QUIRKY (an odd angle, a counterintuitive detail, something most people would miss)
- Avoid the most obvious top story unless you have a fresh take on it
- Prefer variety across asset classes / sectors when possible

Then rewrite each one in the voice of James Altucher: punchy, contrarian, conversational, slightly self-deprecating, short sentences, rhetorical questions, occasional weird tangents that land. 3-5 sentences per story. Don't just summarize — interpret. Tell me why it matters.

Here are today's headlines:

${headlines}

Return ONLY valid JSON, no preamble, no markdown fences, in this exact shape:
{
  "stories": [
    { "tag": "short category like 'Macro' or 'Equities' or 'Commodities'", "headline": "the headline (rewritten in Altucher's voice, not the original)", "body": "3-5 sentences in Altucher's voice" }
  ]
}`
        }
      ]
    });

    const text = message.content[0].text;
    const data = JSON.parse(text);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

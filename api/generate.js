import Anthropic from "@anthropic-ai/sdk";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Rate limit exceeded. Try again in an hour." });
  }

  try {
    const newsUrl = `https://api.marketaux.com/v1/news/all?language=en&filter_entities=true&limit=40&api_token=${process.env.MARKETAUX_API_KEY}`;
    const newsRes = await fetch(newsUrl);
    if (!newsRes.ok) throw new Error(`News API failed: ${newsRes.status}`);
    const newsData = await newsRes.json();

    if (!newsData.data || newsData.data.length < 6) {
      throw new Error(`Not enough news returned (got ${newsData.data?.length || 0}, need at least 6)`);
    }

    const headlines = newsData.data.map((article, i) =>
      `${i + 1}. ${article.title} — ${article.description || ""} (Source: ${article.source}) [URL: ${article.url}]`
    ).join("\n");

    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 6000,
      messages: [
        {
          role: "user",
          content: `Below are real financial news headlines from today. You MUST pick exactly 6 (six) stories. Not 5. Not 7. Exactly 6. This is a hard requirement — if you return any other number, the response is invalid.

Selection criteria for the six:
- Must be IMPORTANT (real market signal, not fluff or PR)
- Must be slightly QUIRKY (an odd angle, a counterintuitive detail, something most people would miss)
- Prefer variety across asset classes / sectors
- EXACTLY ONE of the six must be a "weird stats" story — built around an unusual, counterintuitive, or surprising statistic about the markets, AND it must lean bullish (find the optimistic read on the number). Tag this one as "Weird stats".

Rewrite each one in the voice of James Altucher: punchy, contrarian, conversational, slightly self-deprecating, short sentences, rhetorical questions, occasional weird tangents that land. Keep each body to 3-4 sentences (not 5) — be tight. Don't just summarize — interpret.

For each story, you MUST include the source URL from the headline list (the value inside [URL: ...]). Copy it exactly.

Here are today's headlines:

${headlines}

Return ONLY valid JSON with exactly 6 entries in the stories array. No preamble. No markdown fences. No trailing text. This exact shape:
{
  "stories": [
    { "tag": "category", "headline": "rewritten headline", "body": "3-4 sentences", "source_url": "exact URL" }
  ]
}

Count your stories before returning. If you have fewer than 6, add more. If you have more than 6, remove some.`
        }
      ]
    });

    const text = message.content[0].text;
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error("JSON parse failed. Raw response:", text);
      throw new Error(`Claude returned invalid JSON: ${parseErr.message}`);
    }

    if (!data.stories || !Array.isArray(data.stories)) {
      throw new Error("Response missing 'stories' array");
    }

    if (data.stories.length !== 6) {
      console.error(`Expected 6 stories, got ${data.stories.length}. Stories:`, data.stories);
      throw new Error(`Claude returned ${data.stories.length} stories instead of 6. Try again.`);
    }

    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

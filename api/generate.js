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

async function fetchMarketaux(searchTerm) {
  const base = `https://api.marketaux.com/v1/news/all?language=en&filter_entities=true&limit=40&api_token=${process.env.MARKETAUX_API_KEY}`;
  const url = searchTerm ? `${base}&search=${encodeURIComponent(searchTerm)}` : base;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`News API failed: ${res.status}`);
  const data = await res.json();
  return data.data || [];
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
    const body = req.body || {};
    const filter = (body.filter || "").trim().toLowerCase();
    const isWeirdFilter = filter === "weird";

    let articles = [];
    let fallbackNote = null;

    if (isWeirdFilter || !filter) {
      // No specific topic — just pull general news
      articles = await fetchMarketaux(null);
    } else {
      // Topic filter — try filtered first
      const filtered = await fetchMarketaux(filter);
      if (filtered.length >= 6) {
        articles = filtered;
      } else {
        // Pad with general news
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
      ? `\n\nThe user has filtered for: "${filter}". Prefer stories from the headlines below that relate to this topic. If the headlines below are a mix of filtered and general news, prioritize the ones that fit the filter.`
      : "";

    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 6000,
      messages: [
        {
          role: "user",
          content: `Below are real financial news headlines from today. You MUST pick exactly 6 (six) stories. Not 5. Not 7. Exactly 6. This is a hard requirement.

Selection criteria for the six:
- Must be IMPORTANT (real market signal, not fluff or PR)
- Must be slightly QUIRKY (an odd angle, a counterintuitive detail, something most people would miss)
- Prefer variety across asset classes / sectors

${weirdInstruction}${focusInstruction}

Rewrite each one in the voice of James Altucher: punchy, contrarian, conversational, slightly self-deprecating, short sentences, rhetorical questions, occasional weird tangents that land. Keep each body to 3-4 sentences — be tight. Don't just summarize — interpret.

For each story, you MUST include the source URL from the headline list (the value inside [URL: ...]). Copy it exactly.

Here are today's headlines:

${headlines}

Return ONLY valid JSON with exactly 6 entries in the stories array. No preamble. No markdown fences. No trailing text. This exact shape:
{
  "stories": [
    { "tag": "category", "headline": "rewritten headline", "body": "3-4 sentences", "source_url": "exact URL" }
  ]
}

Count your stories before returning. Exactly 6.`
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
      throw new Error(`Claude returned ${data.stories.length} stories instead of 6. Try again.`);
    }

    if (fallbackNote) data.note = fallbackNote;

    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

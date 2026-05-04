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
  const base = "https://api.marketaux.com/v1/news/all?language=en&filter_entities=true&limit=40&api_token=" + process.env.MARKETAUX_API_KEY;
  const url = searchTerm ? base + "&search=" + encodeURIComponent(searchTerm) : base;
  const res = await fetch(url);
  if (!res.ok) throw new Error("News API failed: " + res.status);
  const data = await res.json();
  return data.data || [];
}

async function logSearch(entry) {
  try {
    const record = {
      filter: entry.filter || "none",
      country: entry.country || "unknown",
      status: entry.status,
      timestamp: new Date().toISOString()
    };
    await kv.lpush("searches", JSON.stringify(record));
    await kv.ltrim("searches", 0, 4999);
  } catch (err) {
    console.error("Failed to log search:", err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ipHeader = req.headers["x-forwarded-for"] || "";
  const ip = ipHeader.split(",")[0] || "unknown";
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
        const seenUrls = new Set(filtered.map(function (a) { return a.url; }));
        const padding = general.filter(function (a) { return !seenUrls.has(a.url); });
        articles = filtered.concat(padding);
        if (filtered.length === 0) {
          fallbackNote = "No stories matched \"" + filter + "\" - showing general market news instead.";
        } else {
          fallbackNote = "Only " + filtered.length + " " + (filtered.length === 1 ? "story" : "stories") + " matched \"" + filter + "\" - padded with general market news.";
        }
      }
    }

    if (articles.length < 6) {
      throw new Error("Not enough news available right now (got " + articles.length + "). Try again later.");
    }

    const headlines = articles.slice(0, 40).map(function (article, i) {
      return (i + 1) + ". " + article.title + " - " + (article.description || "") + " (Source: " + article.source + ") [URL: " + article.url + "]";
    }).join("\n");

    const weirdInstruction = isWeirdFilter
      ? "Special instruction: the user has chosen the weird lens. ALL six stories should lean into the unusual, counterintuitive, or quirky angle of the news. Find the surprising read on each. The weird stats story is still required as one of the six, but the other five should also feel offbeat."
      : "EXACTLY ONE of the six must be a weird stats story - built around an unusual, counterintuitive, or surprising statistic about the markets, AND it must lean bullish (find the optimistic read on the number). Tag this one as Weird stats.";

    const focusInstruction = filter && !isWeirdFilter
      ? "\n\nThe user has filtered for: \"" + filter + "\". Prefer stories from the headlines below that relate to this topic."
      : "";

    const promptText = "Below are real financial news headlines from today. You MUST pick exactly 6 (six) stories. Not 5. Not 7. Exactly 6.\n\n" +
      "Selection criteria:\n" +
      "- Must be IMPORTANT (real market signal, not fluff or PR)\n" +
      "- Must be slightly QUIRKY (an odd angle, a counterintuitive detail)\n" +
      "- Prefer variety across asset classes / sectors\n\n" +
      weirdInstruction + focusInstruction + "\n\n" +
      "Rewrite each in the voice of James Altucher: punchy, contrarian, conversational, slightly self-deprecating, short sentences, rhetorical questions. 3-4 sentences per body. Don't summarize - interpret.\n\n" +
      "Include the source URL from the headline list (the value inside [URL: ...]).\n\n" +
      "Headlines:\n\n" + headlines + "\n\n" +
      "Return ONLY valid JSON with exactly 6 entries. No preamble. No markdown fences.\n" +
      "{\n" +
      '  "stories": [\n' +
      '    { "tag": "category", "headline": "rewritten headline", "body": "3-4 sentences", "source_url": "exact URL" }\n' +
      "  ]\n" +
      "}";

    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 6000,
      messages: [{ role: "user", content: promptText }]
    });

    const text = message.content[0].text;
    const data = JSON.parse(text);

    if (!data.stories || !Array.isArray(data.stories) || data.stories.length !== 6) {
      throw new Error("Invalid response from Claude (got " + (data.stories ? data.stories.length : 0) + " stories)");
    }

    if (fallbackNote) data.note = fallbackNote;

    await logSearch({ filter: filter, country: country, status: "success" });
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    await logSearch({ filter: filter, country: country, status: "error" });
    res.status(500).json({ error: err.message });
  }
}

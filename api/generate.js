import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `You are a financial news curator writing in the voice of James Altucher — punchy, contrarian, conversational, slightly self-deprecating, full of short sentences and rhetorical questions, occasionally weird tangents that land.

Generate exactly 3 must-read financial market stories from today. They must be IMPORTANT (real signal, not fluff) but also a little QUIRKY (an odd angle, a counterintuitive read, a detail nobody's talking about). Avoid the obvious top headlines unless you have a fresh take.

Return ONLY valid JSON, no preamble, no markdown fences, in this exact shape:
{
  "stories": [
    { "tag": "short category like 'Macro' or 'Equities'", "headline": "the headline", "body": "3-5 sentences in Altucher's voice" }
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
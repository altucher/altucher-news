import assert from 'node:assert/strict'

const sections = ['As of','The Big Idea','Podcast Blueprint','Instagram Reel','X/Twitter Thread','Substack','Why It Could Go Viral','Sources and Guardrails']
function complete(text, finishReason = 'stop') {
  const normalized = text.toLowerCase()
  return finishReason !== 'length' && sections.every((s) => normalized.includes(s.toLowerCase())) && /sources\s*(?:and|&)\s*guardrails[\s\S]{80,}$/i.test(text) && !/(?:^|\s)(?:script|caption|audio|text overlay):\s*["“][^"”\n]{0,220}$/i.test(text.trim())
}
const cutOff = `## As of\nNow\n## The Big Idea\nIdea\n## Podcast Blueprint\nPlan\n## Instagram Reel\nScript:\n"16 Nobel Laureates say AI will displace`
const valid = `## As of\nNow\n## The Big Idea\nIdea\n## Podcast Blueprint\nPlan\n## Instagram Reel\nA complete reel script.\n## X/Twitter Thread\nThread.\n## Substack / Viral Article\nArticle.\n## Why It Could Go Viral\nReasons.\n## Sources and Guardrails\nOfficial sources were checked. Claims remain attributed and time-stamped. Prices, roles, and status are current only as of the stated date. Additional source notes complete this dossier.`
assert.equal(complete(cutOff), false)
assert.equal(complete(valid, 'length'), false)
assert.equal(complete(valid), true)
console.log('Viral dossier completeness regression checks passed.')

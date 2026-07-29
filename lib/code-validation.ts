export type ValidationFinding = {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export type ValidationResult = {
  valid: boolean
  findings: ValidationFinding[]
}

export function extractHtmlDocument(text: string): string | null {
  const fenced = [...text.matchAll(/```(?:html)?\s*([\s\S]*?)```/gi)]
    .map((match) => match[1].trim())
    .filter((candidate) => /<!doctype html|<html[\s>]/i.test(candidate))

  if (fenced.length > 0) return fenced[fenced.length - 1]

  const doctypeMatches = [...text.matchAll(/<!doctype html/gi)]
  const htmlMatches = [...text.matchAll(/<html[\s>]/gi)]
  const lastDoctype = doctypeMatches.at(-1)?.index
  const lastHtml = htmlMatches.at(-1)?.index
  const start = lastDoctype !== undefined && (lastHtml === undefined || lastDoctype <= lastHtml)
    ? lastDoctype
    : lastHtml
  if (start === undefined) return null
  const tail = text.slice(start)
  const close = tail.match(/<\/html\s*>/i)
  return close ? tail.slice(0, (close.index ?? 0) + close[0].length).trim() : tail.trim()
}

function countTag(html: string, tag: string) {
  return [...html.matchAll(new RegExp(`<${tag}\\b`, 'gi'))].length
}

function add(
  findings: ValidationFinding[],
  severity: ValidationFinding['severity'],
  code: string,
  message: string,
) {
  findings.push({ severity, code, message })
}

export function validateHtmlDocument(html: string): ValidationResult {
  const findings: ValidationFinding[] = []
  const lower = html.toLowerCase()

  if (!/^\s*<!doctype html>/i.test(html)) add(findings, 'error', 'missing-doctype', 'Add <!DOCTYPE html> at the start.')
  if (!/<html[\s>]/i.test(html) || !/<\/html\s*>/i.test(html)) add(findings, 'error', 'incomplete-document', 'Return a complete <html> document with a closing </html> tag.')
  if (!/<body[\s>][\s\S]*\S[\s\S]*<\/body\s*>/i.test(html)) add(findings, 'error', 'missing-body', 'Include a non-empty, closed <body>.')
  if (!/<style[\s>]|rel=["']stylesheet["']/i.test(html)) add(findings, 'warning', 'missing-styles', 'Include complete styling for the page.')
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) add(findings, 'warning', 'missing-viewport', 'Add a responsive viewport meta tag.')
  if (/\b(?:todo|fixme|coming soon|placeholder implementation|lorem ipsum|your (?:business|company|address|phone))\b/i.test(html)) add(findings, 'warning', 'placeholder-content', 'Replace placeholders with finished, subject-specific content.')

  // Treat documents with conventional site chrome as full websites. Games and
  // single-purpose tools intentionally do not need this marketing-site contract.
  const isBusinessSite = /<nav\b|<footer\b/i.test(html) || countTag(html, 'section') >= 3
  if (isBusinessSite) {
    if (!/<h1[\s>][\s\S]*?<\/h1>/i.test(html)) add(findings, 'error', 'missing-primary-heading', 'Add one clear, specific H1 in a finished hero section.')
    if (!/<main[\s>][\s\S]*?<\/main>/i.test(html)) add(findings, 'warning', 'missing-main', 'Wrap the primary page content in a semantic <main>.')
    if (!/<nav[\s>][\s\S]*?<\/nav>/i.test(html)) add(findings, 'warning', 'missing-navigation', 'Add usable desktop and mobile navigation.')
    if (!/<footer[\s>][\s\S]*?<\/footer>/i.test(html)) add(findings, 'warning', 'missing-footer', 'Add a complete footer with business contact details.')
    if (countTag(html, 'section') < 4) add(findings, 'warning', 'thin-site', 'Build at least four meaningful sections: hero, offering, trust/proof, and conversion/contact.')
    if (!/\b(?:book|schedule|contact|call|request|start|get a quote|appointment)\b/i.test(html)) add(findings, 'warning', 'missing-conversion-path', 'Add a clear conversion path and repeated primary call to action.')
  }

  const ids = [...html.matchAll(/\sid=["']([^"']+)["']/gi)].map((match) => match[1])
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  if (duplicates.length) add(findings, 'error', 'duplicate-ids', `Make IDs unique: ${duplicates.slice(0, 5).join(', ')}.`)

  const idSet = new Set(ids)
  const anchors = [...html.matchAll(/href=["']#([^"']+)["']/gi)].map((match) => match[1])
  const brokenAnchors = [...new Set(anchors.filter((anchor) => anchor && !idSet.has(anchor)))]
  if (brokenAnchors.length) add(findings, 'warning', 'broken-anchors', `Fix internal links with no target: ${brokenAnchors.slice(0, 5).join(', ')}.`)

  if (/source\.unsplash\.com|images\.unsplash\.com/i.test(html)) add(findings, 'error', 'forbidden-images', 'Replace dead or guessed Unsplash URLs with the approved image sources.')
  if (/\b(?:src|href)=["'](?:javascript:|data:text\/html)/i.test(html)) add(findings, 'error', 'unsafe-url', 'Remove javascript: and data:text/html URLs.')

  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1]
    if (!/\balt=["'][^"']*["']/i.test(attrs)) add(findings, 'warning', 'missing-image-alt', 'Add alt text to every image.')
    if (!(/\bwidth=["']?\d+/i.test(attrs) && /\bheight=["']?\d+/i.test(attrs)) && !/aspect-ratio/i.test(html)) {
      add(findings, 'warning', 'image-layout-shift', 'Set image width/height or an aspect-ratio to prevent layout shift.')
      break
    }
  }

  for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const accessibleText = match[2].replace(/<[^>]+>/g, '').trim()
    if (!accessibleText && !/aria-label=["'][^"']+["']/i.test(match[1])) add(findings, 'warning', 'unnamed-button', 'Give every icon-only button an aria-label.')
  }

  const scriptBodies = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1])
  for (const script of scriptBodies) {
    try {
      // Compile only. The generated JavaScript is never executed by validation.
      new Function(script)
    } catch (error) {
      add(findings, 'error', 'javascript-syntax', `Fix JavaScript syntax: ${error instanceof Error ? error.message : 'invalid script'}.`)
      break
    }
  }

  findings.push(...findBrokenSelectors(html))

  // Keep repair prompts concise and deterministic.
  const unique = findings.filter((finding, index) => findings.findIndex((item) => item.code === finding.code) === index)
  return { valid: !unique.some((finding) => finding.severity === 'error'), findings: unique }
}

// Every HTML element name that can legitimately lead a selector. Anything else
// in that position is either a custom element or a typo.
const KNOWN_TAGS = new Set([
  'a','abbr','address','area','article','aside','audio','b','base','bdi','bdo','blockquote','body','br',
  'button','canvas','caption','cite','code','col','colgroup','data','datalist','dd','del','details','dfn',
  'dialog','div','dl','dt','em','embed','fieldset','figcaption','figure','footer','form','h1','h2','h3',
  'h4','h5','h6','head','header','hgroup','hr','html','i','iframe','img','input','ins','kbd','label',
  'legend','li','link','main','map','mark','menu','meta','meter','nav','noscript','object','ol','optgroup',
  'option','output','p','param','picture','pre','progress','q','rp','rt','ruby','s','samp','script',
  'search','section','select','slot','small','source','span','strong','style','sub','summary','sup','svg',
  'table','tbody','td','template','textarea','tfoot','th','thead','time','title','tr','track','u','ul',
  'var','video','wbr','circle','path','rect','g','line','polygon','polyline','text','use','defs',
])

/**
 * Catch selector strings whose leading token looks like a tag name but is really
 * a CSS class that lost its dot - e.g. `card-list[data-status="todo"]` instead of
 * `.card-list[...]`. This fails SILENTLY at runtime: querySelector returns null,
 * an `if (!el) return` swallows it, and the page renders with empty containers
 * while any count derived from the data still looks correct. A real generated
 * kanban board shipped exactly this bug and looked fine until the DOM was
 * inspected, so syntax-only validation cannot catch it.
 *
 * Only flags a name that is NOT a known HTML tag, contains no dot/hash, and does
 * appear as a class value in the document - that combination is unambiguous
 * enough to report as an error rather than a warning.
 */
export function findBrokenSelectors(html: string): ValidationFinding[] {
  const classAttrValues = new Set<string>()
  for (const match of html.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gi)) {
    for (const name of match[1].trim().split(/\s+/)) classAttrValues.add(name)
  }

  // Scan selector-shaped string literals anywhere in <script>, NOT just the ones
  // written inline inside querySelector(...). The real kanban stored them in a
  // lookup object (`colMap = { todo: 'card-list[data-status="todo"]' }`) and
  // passed the variable in, so a querySelector-anchored regex found nothing and
  // my first version of this check reported a clean bill of health on a file
  // whose columns were provably empty.
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n')

  // Match each string literal by ITS OWN delimiter, then inspect the contents.
  // A single character class cannot do this: the real selector is
  // 'card-list[data-status="todo"]' - a single-quoted string containing double
  // quotes - so any pattern that excludes quotes inside the brackets misses it.
  const literals: string[] = []
  for (const re of [/'((?:[^'\\\n]|\\.)*)'/g, /"((?:[^"\\\n]|\\.)*)"/g, /`((?:[^`\\]|\\.)*)`/g]) {
    for (const match of scripts.matchAll(re)) literals.push(match[1])
  }

  const broken = new Set<string>()
  for (const literal of literals) {
    const selector = literal.trim()
    // Must look like a selector: a tag-like leading token plus an attribute filter.
    if (!/^[A-Za-z][\w-]*\[[^\]]*\]/.test(selector)) continue
    // Leading token, up to the first attribute/descendant/pseudo boundary.
    const lead = selector.split(/[[\s>+~:,]/)[0]
    if (!lead) continue
    if (lead.includes('.') || lead.includes('#') || lead.includes('*')) continue
    if (KNOWN_TAGS.has(lead.toLowerCase())) continue
    if (lead.includes('-') && !classAttrValues.has(lead)) continue // likely a real custom element
    if (!classAttrValues.has(lead)) continue
    broken.add(selector)
  }

  if (broken.size === 0) return []
  const list = [...broken].slice(0, 4).map((s) => `"${s}"`).join(', ')
  return [{
    severity: 'error',
    code: 'selector-missing-class-dot',
    message:
      `These querySelector calls target a tag name that does not exist, but matches a class in the markup: ${list}. ` +
      `Add the missing "." prefix (e.g. ".card-list[data-status=\\"todo\\"]") so the elements are actually found.`,
  }]
}

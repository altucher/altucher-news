export const PROJECT_MARKER = 'BLUETAO_PROJECT_V1'
export const PROJECT_PATHS = ['index.html', 'styles.css', 'app.js'] as const
export type ProjectPath = (typeof PROJECT_PATHS)[number]

export interface AgentManifest {
  name: string
  instructions: string
  welcomeMessage: string
  suggestedPrompts: string[]
  tools: ['web_search']
}

export interface ProjectDocument {
  version: 1
  entry: 'index.html'
  type?: 'site' | 'agent'
  agent?: AgentManifest
  files: Record<ProjectPath, string>
}

export interface ProjectPatch {
  file: ProjectPath
  find: string
  replace: string
  expectedOccurrences: number
}

const MAX_FILE_LENGTH = 1_000_000

function decodeAccidentallyEscapedSource(value: string): string {
  const escapedNewlines = (value.match(/\\n/g) || []).length
  const escapedQuotes = (value.match(/\\["']/g) || []).length
  const realNewlines = (value.match(/\n/g) || []).length
  if (escapedNewlines < 3 || realNewlines > 2) return value

  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\(["'])/g, '$1')
}

function deduplicateLocalAssets(html: string): string {
  let stylesheetSeen = false
  let scriptSeen = false
  return html
    .replace(/<link\b[^>]*href=["']styles\.css["'][^>]*>/gi, (tag) => {
      if (stylesheetSeen) return ''
      stylesheetSeen = true
      return tag
    })
    .replace(/<script\b[^>]*src=["']app\.js["'][^>]*><\/script>/gi, (tag) => {
      if (scriptSeen) return ''
      scriptSeen = true
      return tag
    })
}

function hasBalancedDelimiters(value: string, open: string, close: string): boolean {
  return value.split(open).length - 1 === value.split(close).length - 1
}

export function normalizeGeneratedProject(project: ProjectDocument): ProjectDocument {
  const files = Object.fromEntries(PROJECT_PATHS.map((path) => [path, decodeAccidentallyEscapedSource(project.files?.[path] || '')])) as Record<ProjectPath, string>
  files['index.html'] = deduplicateLocalAssets(files['index.html'])
  return {
    ...project,
    files,
    agent: project.agent ? { ...project.agent, suggestedPrompts: [...project.agent.suggestedPrompts], tools: [...project.agent.tools] } : undefined,
  }
}

export function createProject(files: Partial<Record<ProjectPath, string>>): ProjectDocument {
  return {
    version: 1,
    entry: 'index.html',
    files: {
      'index.html': files['index.html'] || '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"></head><body><script src="app.js"></script></body></html>',
      'styles.css': files['styles.css'] || '',
      'app.js': files['app.js'] || '',
    },
  }
}

export function validateProject(project: ProjectDocument): string[] {
  const errors: string[] = []
  if (project.version !== 1 || project.entry !== 'index.html') errors.push('Unsupported project format.')
  if (project.type === 'agent') {
    if (!project.agent || typeof project.agent.name !== 'string' || !project.agent.name.trim()) errors.push('Agent name is required.')
    if (!project.agent || typeof project.agent.instructions !== 'string' || project.agent.instructions.trim().length < 20) errors.push('Agent instructions are required.')
    if (!project.agent || typeof project.agent.welcomeMessage !== 'string') errors.push('Agent welcome message is required.')
    if (!project.agent || !Array.isArray(project.agent.suggestedPrompts) || project.agent.suggestedPrompts.length > 6) errors.push('Invalid suggested prompts.')
    if (!project.agent || !Array.isArray(project.agent.tools) || project.agent.tools.some((tool) => tool !== 'web_search')) errors.push('Unsupported agent tool.')
  }
  for (const path of PROJECT_PATHS) {
    if (typeof project.files?.[path] !== 'string') errors.push(`Missing ${path}.`)
    else if (project.files[path].length > MAX_FILE_LENGTH) errors.push(`${path} is too large.`)
  }
  const html = project.files?.['index.html'] || ''
  const css = project.files?.['styles.css'] || ''
  const js = project.files?.['app.js'] || ''
  if (!/<!doctype html/i.test(html) || !/<html[\s>]/i.test(html) || !/<\/html\s*>/i.test(html) || !/<body[\s>]/i.test(html) || !/<\/body\s*>/i.test(html)) {
    errors.push('index.html must contain a complete HTML document.')
  }
  if ((html.match(/href=["']styles\.css["']/gi) || []).length !== 1) errors.push('index.html must reference styles.css exactly once.')
  if ((html.match(/src=["']app\.js["']/gi) || []).length !== 1) errors.push('index.html must reference app.js exactly once.')
  if ((html.match(/\\n/g) || []).length >= 3) errors.push('index.html contains escaped source instead of executable markup.')
  if (/\b(?:TODO|FIXME|lorem ipsum|your (?:business|company|address|phone)|placeholder)\b/i.test(`${html}\n${css}\n${js}`)) errors.push('Project contains unfinished placeholder content.')
  if (!hasBalancedDelimiters(css.replace(/\/\*[\s\S]*?\*\//g, ''), '{', '}')) errors.push('styles.css appears truncated or malformed.')
  if (!hasBalancedDelimiters(js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), '{', '}')) errors.push('app.js appears truncated or malformed.')
  return errors
}

export function validateInteractiveBuild(project: ProjectDocument, instruction: string): string[] {
  if (!/\b(game|space\s*invaders?|shooter|arcade|pong|snake|tetris|platformer)\b/i.test(instruction)) return []

  const html = project.files['index.html']
  const css = project.files['styles.css']
  const js = project.files['app.js']
  const source = `${html}\n${css}\n${js}`
  const errors: string[] = []
  const isSpaceInvaders = /space\s*invaders?/i.test(instruction)

  if (js.length < (isSpaceInvaders ? 3000 : 1400)) errors.push('The game implementation is too thin to be complete.')
  if (!/<canvas\b|\b(?:game|stage|board)[-_ ]?(?:area|screen|container)?\b/i.test(html)) errors.push('The project needs a visible playable game stage.')
  if (!/requestAnimationFrame|setInterval|setTimeout/i.test(js)) errors.push('The game needs a running update loop.')
  if (!/keydown|keyup|pointerdown|touchstart|click/i.test(source)) errors.push('The game needs working keyboard, pointer, or touch controls.')
  if (!/\b(?:collision|collides?|intersect|overlap|hitTest|hit\w*|distance)\b/i.test(js)) errors.push('The game needs collision or hit detection.')
  if (!/\b(?:score|points)\b/i.test(source)) errors.push('The game needs visible score state.')
  if (!/\b(?:gameOver|game over|lives|health|lose|lost)\b/i.test(source)) errors.push('The game needs a clear loss or game-over state.')
  if (!/\b(?:restart|reset|play again|new game|startGame)\b/i.test(source)) errors.push('The game needs a restart flow.')

  if (isSpaceInvaders) {
    if (!/\b(?:player|ship|cannon)\b/i.test(js)) errors.push('Space Invaders needs player state.')
    if (!/\b(?:invader|enemy|alien)\b/i.test(js)) errors.push('Space Invaders needs enemy formations and state.')
    if (!/\b(?:bullet|projectile|laser|shot)\b/i.test(js)) errors.push('Space Invaders needs player projectiles.')
    if (!/(?:enemy|invader|alien)[\s\S]{0,80}(?:bullet|projectile|laser|shot|shoot|fire)|(?:bullet|projectile|laser|shot|shoot|fire)[\s\S]{0,80}(?:enemy|invader|alien)/i.test(js)) errors.push('Space Invaders needs enemy fire.')
    if (!/\b(?:direction|speed|velocity|moveDown|drop)\b/i.test(js)) errors.push('Space Invaders needs moving enemies that advance toward the player.')
    if (!/\b(?:wave|level|victory|you win|nextLevel)\b/i.test(source)) errors.push('Space Invaders needs wave or victory progression.')
  }

  return errors
}

export function serializeProject(project: ProjectDocument): string {
  const errors = validateProject(project)
  if (errors.length) throw new Error(errors.join(' '))
  return `${PROJECT_MARKER}\n${JSON.stringify(project)}`
}

export function parseProject(value: string): ProjectDocument | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith(PROJECT_MARKER)) return null
  try {
    const parsed = normalizeGeneratedProject(JSON.parse(trimmed.slice(PROJECT_MARKER.length).trim()) as ProjectDocument)
    return validateProject(parsed).length ? null : parsed
  } catch {
    return null
  }
}

export function legacyHtmlToProject(html: string): ProjectDocument {
  let document = html.trim()
  if (!/<html[\s>]/i.test(document)) {
    document = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${document}</body></html>`
  }
  const styles: string[] = []
  document = document.replace(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi, (_match, css: string) => {
    styles.push(css.trim())
    return ''
  })
  const scripts: string[] = []
  document = document.replace(/<script(?![^>]*\bsrc=)(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi, (_match, js: string) => {
    scripts.push(js.trim())
    return ''
  })
  if (!/href=["']styles\.css["']/i.test(document)) {
    document = document.replace(/<\/head>/i, '  <link rel="stylesheet" href="styles.css">\n</head>')
  }
  if (!/src=["']app\.js["']/i.test(document)) {
    document = document.replace(/<\/body>/i, '  <script src="app.js"></script>\n</body>')
  }
  return createProject({ 'index.html': document, 'styles.css': styles.join('\n\n'), 'app.js': scripts.join('\n\n') })
}

export function normalizeProject(value: string): ProjectDocument {
  return parseProject(value) || legacyHtmlToProject(value)
}

export function bundleProject(project: ProjectDocument): string {
  let html = project.files['index.html']
  const css = project.files['styles.css']
  const js = project.files['app.js']
  html = html.replace(/<link\b[^>]*href=["']styles\.css["'][^>]*>/gi, css ? `<style data-bluetao-file="styles.css">\n${css}\n</style>` : '')
  html = html.replace(/<script\b[^>]*src=["']app\.js["'][^>]*><\/script>/gi, js ? `<script data-bluetao-file="app.js">\n${js}\n</script>` : '')
  if (css && !html.includes('data-bluetao-file="styles.css"')) html = html.replace(/<\/head>/i, `<style data-bluetao-file="styles.css">\n${css}\n</style>\n</head>`)
  if (js && !html.includes('data-bluetao-file="app.js"')) html = html.replace(/<\/body>/i, `<script data-bluetao-file="app.js">\n${js}\n</script>\n</body>`)
  return html
}

export function projectFromBundledHtml(html: string): ProjectDocument {
  return legacyHtmlToProject(html.replace(/ data-bluetao-file=["'][^"']+["']/gi, ''))
}

export function extractProjectArtifact(text: string): ProjectDocument | null {
  const markerIndex = text.indexOf(PROJECT_MARKER)
  if (markerIndex >= 0) {
    const candidate = text.slice(markerIndex)
    const fencedEnd = candidate.indexOf('\n```')
    const parsed = parseProject(fencedEnd >= 0 ? candidate.slice(0, fencedEnd) : candidate)
    if (parsed) return parsed
  }
  const htmlStart = text.search(/<!doctype html|<html[\s>]/i)
  if (htmlStart >= 0) {
    const endMatch = text.slice(htmlStart).match(/<\/html\s*>/i)
    if (endMatch) return legacyHtmlToProject(text.slice(htmlStart, htmlStart + (endMatch.index || 0) + endMatch[0].length))
  }
  return null
}

export function applyProjectPatches(project: ProjectDocument, patches: ProjectPatch[]): ProjectDocument {
  if (!Array.isArray(patches) || patches.length === 0) throw new Error('No patches supplied.')
  const next: ProjectDocument = {
    ...createProject({ ...project.files }),
    type: project.type,
    agent: project.agent ? { ...project.agent, suggestedPrompts: [...project.agent.suggestedPrompts], tools: [...project.agent.tools] } : undefined,
  }
  for (const patch of patches) {
    if (!PROJECT_PATHS.includes(patch.file) || !patch.find || patch.expectedOccurrences < 1) throw new Error('Invalid patch.')
    const count = next.files[patch.file].split(patch.find).length - 1
    if (count !== patch.expectedOccurrences) throw new Error(`Patch for ${patch.file} expected ${patch.expectedOccurrences} matches but found ${count}.`)
    const updated = next.files[patch.file].split(patch.find).join(patch.replace)
    if (updated === next.files[patch.file]) throw new Error('Patch made no change.')
    next.files[patch.file] = updated
  }
  const errors = validateProject(next)
  if (errors.length) throw new Error(errors.join(' '))
  return next
}

export function extractPatchArtifact(text: string): ProjectPatch[] | null {
  const marker = 'BLUETAO_PATCH_V1'
  const index = text.indexOf(marker)
  if (index < 0) return null
  const candidate = text.slice(index + marker.length).replace(/^\s*/, '')
  const end = candidate.indexOf('\n```')
  try {
    const value = JSON.parse(end >= 0 ? candidate.slice(0, end) : candidate) as { patches?: ProjectPatch[] }
    return Array.isArray(value.patches) ? value.patches : null
  } catch {
    return null
  }
}

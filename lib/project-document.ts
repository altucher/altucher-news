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

function extractJsonObject(value: string): string | null {
  const start = value.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return value.slice(start, index + 1)
    }
  }
  return null
}

function parseRawFileProject(value: string): ProjectDocument | null {
  const labels = PROJECT_PATHS.map((path) => `=== ${path} ===`)
  const positions = labels.map((label) => value.indexOf(label))
  if (positions.some((position) => position < 0) || positions[0] >= positions[1] || positions[1] >= positions[2]) return null

  const files = {} as Record<ProjectPath, string>
  for (let index = 0; index < PROJECT_PATHS.length; index += 1) {
    const start = positions[index] + labels[index].length
    const end = index + 1 < positions.length ? positions[index + 1] : value.length
    files[PROJECT_PATHS[index]] = value.slice(start, end).replace(/^\s*\n/, '').replace(/\n?```[\s\S]*$/, '').trimEnd()
  }
  const project = normalizeGeneratedProject(createProject(files))
  return validateProject(project).length ? null : project
}

export function parseProject(value: string): ProjectDocument | null {
  const markerIndex = value.indexOf(PROJECT_MARKER)
  if (markerIndex < 0) return null
  const artifact = value.slice(markerIndex + PROJECT_MARKER.length)
  const rawProject = parseRawFileProject(artifact)
  if (rawProject) return rawProject

  const json = extractJsonObject(artifact)
  if (!json) return null
  try {
    const parsed = normalizeGeneratedProject(JSON.parse(json) as ProjectDocument)
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
  const css = project.files['styles.css'].replace(/<\/style/gi, '<\\/style')
  const js = project.files['app.js'].replace(/<\/script/gi, '<\\/script')
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
  const parsedProject = parseProject(text)
  if (parsedProject) return parsedProject

  // Legacy single-file HTML remains supported, but only when no multi-file
  // marker is present. A truncated project may contain complete HTML inside its
  // JSON string; treating that fragment as the whole build creates blank or
  // broken previews instead of allowing the repair path to run.
  if (text.includes(PROJECT_MARKER)) return null
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

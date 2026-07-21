export const PROJECT_MARKER = 'BLUETAO_PROJECT_V1'
export const PROJECT_PATHS = ['index.html', 'styles.css', 'app.js'] as const
export type ProjectPath = (typeof PROJECT_PATHS)[number]

export interface ProjectDocument {
  version: 1
  entry: 'index.html'
  files: Record<ProjectPath, string>
}

export interface ProjectPatch {
  file: ProjectPath
  find: string
  replace: string
  expectedOccurrences: number
}

const MAX_FILE_LENGTH = 1_000_000

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
  for (const path of PROJECT_PATHS) {
    if (typeof project.files?.[path] !== 'string') errors.push(`Missing ${path}.`)
    else if (project.files[path].length > MAX_FILE_LENGTH) errors.push(`${path} is too large.`)
  }
  if (!/<html[\s>]/i.test(project.files?.['index.html'] || '')) errors.push('index.html must contain a complete HTML document.')
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
    const parsed = JSON.parse(trimmed.slice(PROJECT_MARKER.length).trim()) as ProjectDocument
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
  const next = createProject({ ...project.files })
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

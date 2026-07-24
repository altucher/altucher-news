import { put } from '@vercel/blob'
import mammoth from 'mammoth'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_FILE_SIZE = 25 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
])

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'manuscript'
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to upload a manuscript.' }, { status: 401 })

  const form = await request.formData()
  const file = form.get('file')
  const projectId = form.get('projectId')
  if (!(file instanceof File) || typeof projectId !== 'string') {
    return NextResponse.json({ error: 'A manuscript and BookLaunch project are required.' }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Manuscripts must be 25 MB or smaller.' }, { status: 413 })
  if (!ALLOWED_TYPES.has(file.type) && !/\.(docx|txt|md)$/i.test(file.name)) {
    return NextResponse.json({ error: 'Upload a DOCX, TXT, or Markdown manuscript.' }, { status: 415 })
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, agent_manifest')
    .eq('id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()
  const manifest = project?.agent_manifest as { name?: string } | null
  if (!project || manifest?.name !== 'BookLaunch') return NextResponse.json({ error: 'BookLaunch project not found.' }, { status: 404 })

  const bytes = Buffer.from(await file.arrayBuffer())
  let text = ''
  if (/\.docx$/i.test(file.name) || file.type.includes('wordprocessingml')) {
    text = (await mammoth.extractRawText({ buffer: bytes })).value
  } else {
    text = bytes.toString('utf8')
  }
  text = text.replace(/\u0000/g, '').trim()
  if (text.length < 100) return NextResponse.json({ error: 'The manuscript did not contain enough readable text.' }, { status: 422 })

  const prefix = `booklaunch/${user.id}/${projectId}/${crypto.randomUUID()}`
  const original = await put(`${prefix}/${safeName(file.name)}`, bytes, { access: 'private', contentType: file.type || 'application/octet-stream' })
  const extracted = await put(`${prefix}/manuscript.txt`, text, { access: 'private', contentType: 'text/plain; charset=utf-8' })
  const words = text.split(/\s+/).filter(Boolean).length

  return NextResponse.json({
    manuscriptPath: extracted.pathname,
    originalPath: original.pathname,
    filename: file.name,
    words,
    characters: text.length,
  })
}

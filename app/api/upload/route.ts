import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const fileName = file.name.toLowerCase()
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    let extractedText = ''

    // Handle different file types
    if (fileName.endsWith('.pdf')) {
      // Dynamic import to avoid issues with pdf-parse
      const pdfParse = (await import('pdf-parse')).default
      const pdfData = await pdfParse(fileBuffer)
      extractedText = pdfData.text
    } else if (fileName.endsWith('.docx')) {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer: fileBuffer })
      extractedText = result.value
    } else if (fileName.endsWith('.txt') || fileName.endsWith('.md')) {
      extractedText = fileBuffer.toString('utf-8')
    } else {
      return NextResponse.json(
        { error: 'Unsupported file type. Please upload PDF, DOCX, TXT, or MD files.' },
        { status: 400 }
      )
    }

    // Trim and limit text to avoid token limits (roughly 100k chars ~ 25k tokens)
    extractedText = extractedText.trim()
    if (extractedText.length > 100000) {
      extractedText = extractedText.substring(0, 100000) + '\n\n[Document truncated due to length...]'
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileSize: file.size,
      textLength: extractedText.length,
      extractedText,
    })
  } catch (error) {
    console.error('[Upload] Error processing file:', error)
    return NextResponse.json(
      { error: 'Failed to process file. Please try a different file.' },
      { status: 500 }
    )
  }
}

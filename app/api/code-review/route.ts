import chromium from '@sparticuz/chromium'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { gateway } from '@ai-sdk/gateway'
import { generateText, Output } from 'ai'
import puppeteer from 'puppeteer-core'
import { z } from 'zod'
import { extractHtmlDocument, validateHtmlDocument } from '@/lib/code-validation'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_HTML_BYTES = 1_500_000

function countMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].length
}

function preservesBuildStructure(original: string, repaired: string) {
  const checks = [
    [/<section\b/gi, 0.75],
    [/<img\b/gi, 0.75],
    [/<button\b/gi, 0.75],
    [/<script\b/gi, 1],
  ] as const
  return checks.every(([pattern, ratio]) => {
    const before = countMatches(original, pattern)
    if (before === 0) return true
    return countMatches(repaired, pattern) >= Math.ceil(before * ratio)
  }) && repaired.length >= original.length * 0.65
}

const reviewSchema = z.object({
  passed: z.boolean(),
  summary: z.string().max(300),
  issues: z.array(z.object({
    severity: z.enum(['error', 'warning']),
    message: z.string().max(300),
  })).max(12),
})

async function captureScreenshots(html: string) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: null,
    executablePath: await chromium.executablePath(),
    headless: true,
  })

  try {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    const allowedAssetHosts = new Set([
      'loremflickr.com',
      'picsum.photos',
      'fastly.picsum.photos',
      'i.pravatar.cc',
      'unpkg.com',
      'fonts.googleapis.com',
      'fonts.gstatic.com',
    ])
    page.on('request', (request) => {
      const url = request.url()
      if (url === 'about:blank' || url.startsWith('data:image/')) return request.continue()
      if (request.isNavigationRequest()) return request.abort()
      try {
        const parsed = new URL(url)
        if (parsed.protocol === 'https:' && allowedAssetHosts.has(parsed.hostname)) return request.continue()
      } catch {
        // Invalid URLs are blocked below.
      }
      request.abort()
    })

    const render = async (width: number, height: number) => {
      await page.setViewport({ width, height, deviceScaleFactor: 1 })
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await page.evaluate(async () => {
        await document.fonts?.ready
        await Promise.all(Array.from(document.images).map((image) => {
          if (image.complete) return Promise.resolve()
          return new Promise<void>((resolve) => {
            image.addEventListener('load', () => resolve(), { once: true })
            image.addEventListener('error', () => resolve(), { once: true })
            setTimeout(resolve, 3_000)
          })
        }))
      })
      return Buffer.from(await page.screenshot({ type: 'jpeg', quality: 72, fullPage: true }))
    }

    const desktop = await render(1440, 900)
    const mobile = await render(390, 844)
    return { desktop, mobile }
  } finally {
    await browser.close()
  }
}

async function reviewVisually(html: string, deterministicSummary: string) {
  const screenshots = await captureScreenshots(html)
  const { output } = await generateText({
    model: gateway('openai/gpt-4o-mini'),
    output: Output.object({ schema: reviewSchema }),
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Review these desktop and mobile screenshots of a generated web page. Be practical and strict. Flag meaningful problems: broken rendering/images, overlap, clipping, horizontal overflow, unreadable contrast, weak hierarchy, generic or visibly unfinished content, excessive empty space, inconsistent spacing, unusable mobile controls, a missing conversion path, or a business site that looks like a thin template rather than a finished launch-ready page. A complete business website needs a clear hero, meaningful offering, trust/proof, contact details, and an obvious call to action.\n\nDeterministic checks:\n${deterministicSummary || 'No deterministic findings.'}\n\nReturn passed=true only when the page is complete, credible, responsive, and no meaningful repair is needed.`,
        },
        { type: 'image', image: screenshots.desktop },
        { type: 'image', image: screenshots.mobile },
      ],
    }],
  })
  return output
}

async function repairHtml(html: string, instructions: string) {
  const apiKey = process.env.CHUTES_API_KEY
  const model = apiKey
    ? createOpenAICompatible({ name: 'chutes-review', apiKey, baseURL: 'https://llm.chutes.ai/v1' })('moonshotai/Kimi-K2.6-TEE')
    : gateway('openai/gpt-4o-mini')

  const { text } = await generateText({
    model,
    maxOutputTokens: 32_000,
    temperature: 0.2,
    prompt: `You are repairing one self-contained HTML build after automated quality review.\n\nFix every issue below without removing working features or changing the product's intent. The result must be a complete, launch-ready responsive page—not a fragment, wireframe, or thin template. For a business website, preserve or add a strong hero, meaningful services or offering, trust/proof, real-looking contact details, repeated conversion CTA, complete footer, mobile navigation, accessible controls, and subject-appropriate reliable imagery. Preserve the existing visual direction unless the critique identifies a visual problem. Do not leave TODOs, placeholders, dead controls, or false capability claims. Return ONLY one complete <!DOCTYPE html> document, with all CSS and JavaScript inline. No markdown fence and no explanation.\n\nISSUES TO FIX:\n${instructions}\n\nCURRENT HTML:\n${html}`,
  })
  return extractHtmlDocument(text)
}

export async function POST(request: Request) {
  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > MAX_HTML_BYTES) return Response.json({ error: 'Build is too large to review.' }, { status: 413 })

    const body = JSON.parse(raw) as { html?: unknown }
    if (typeof body.html !== 'string' || body.html.length < 100) return Response.json({ error: 'A complete HTML build is required.' }, { status: 400 })

    const originalHtml = body.html
    const initialValidation = validateHtmlDocument(originalHtml)
    const deterministicSummary = initialValidation.findings
      .map((finding) => `- ${finding.severity.toUpperCase()}: ${finding.message}`)
      .join('\n')

    let visualReview: z.infer<typeof reviewSchema> | null = null
    try {
      visualReview = await reviewVisually(originalHtml, deterministicSummary)
    } catch (error) {
      console.error('[v0] Visual review unavailable:', error instanceof Error ? error.message : error)
    }

    const visualIssues = visualReview?.issues ?? []
    const needsRepair = initialValidation.findings.length > 0 || visualIssues.some((issue) => issue.severity === 'error' || issue.severity === 'warning')
    if (!needsRepair) {
      return Response.json({ html: originalHtml, status: 'passed', summary: visualReview?.summary || 'Review passed.', findings: [] })
    }

    const instructions = [
      ...initialValidation.findings.map((finding) => `${finding.severity.toUpperCase()}: ${finding.message}`),
      ...visualIssues.map((issue) => `${issue.severity.toUpperCase()}: ${issue.message}`),
    ].join('\n')

    const repaired = await repairHtml(originalHtml, instructions)
    if (!repaired) {
      return Response.json({ html: originalHtml, status: 'fallback', summary: 'Review found issues, but the repair was incomplete. Showing the original build.', findings: initialValidation.findings })
    }

    const finalValidation = validateHtmlDocument(repaired)
    if (!finalValidation.valid || !preservesBuildStructure(originalHtml, repaired)) {
      return Response.json({ html: originalHtml, status: 'fallback', summary: 'Review found issues, but the repair did not safely preserve the build. Showing the original build.', findings: finalValidation.findings })
    }

    return Response.json({ html: repaired, status: 'improved', summary: visualReview?.summary || 'Reviewed and improved.', findings: finalValidation.findings })
  } catch (error) {
    console.error('[v0] Code review failed:', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Review unavailable; showing the original build.' }, { status: 500 })
  }
}

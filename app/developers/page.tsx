'use client'

import { useState } from 'react'
import { Copy, Check, Code, ExternalLink, Building2, FileText, MessageSquare } from 'lucide-react'
import Link from 'next/link'

export default function DevelopersPage() {
  const [copied, setCopied] = useState<string | null>(null)
  
  const basicEmbed = `<script src="https://bluetao.ai/widget.js" async></script>`
  
  const customEmbed = `<script 
  src="https://bluetao.ai/widget.js"
  data-company="Dr. Smith's Dental Office"
  data-context="We specialize in pain-free dentistry using the latest sedation techniques. Our root canal procedures use rotary endodontics with local anesthesia and optional nitrous oxide. Average procedure time is 45-60 minutes. We offer same-day emergency appointments. Our office is located at 123 Main St. Hours: Mon-Fri 8am-6pm."
  data-welcome="Hi! I'm the virtual assistant for Dr. Smith's Dental Office. How can I help you today?"
  async>
</script>`

  const contextUrlEmbed = `<script 
  src="https://bluetao.ai/widget.js"
  data-company="Your Business Name"
  data-context-url="https://yourdomain.com/ai-context.txt"
  async>
</script>`
  
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-orange-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">B</span>
            </div>
            <span className="text-xl font-semibold text-foreground">BlueTAO</span>
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
              Pricing
            </Link>
            <Link href="/auth/login" className="px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors">
              Sign In
            </Link>
          </nav>
        </div>
      </header>

      <main className="container mx-auto px-4 py-16 max-w-4xl">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 rounded-full text-primary text-sm mb-4">
            <Code className="w-4 h-4" />
            Developers
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            Embed BlueTAO on Your Site
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Add AI-powered chat to any website with a single line of code. Customize it with your business information for personalized responses.
          </p>
        </div>

        {/* Quick Start Section */}
        <div className="bg-card border border-border rounded-2xl p-8 mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">Quick Start</h2>
          <p className="text-muted-foreground mb-6">
            Add this script tag to your website, just before the closing <code className="bg-muted px-2 py-0.5 rounded text-sm">&lt;/body&gt;</code> tag:
          </p>
          
          <div className="relative">
            <pre className="bg-[#1a1612] border border-border rounded-xl p-4 overflow-x-auto">
              <code className="text-amber-500 text-sm">{basicEmbed}</code>
            </pre>
            <button
              onClick={() => copyToClipboard(basicEmbed, 'basic')}
              className="absolute top-3 right-3 p-2 bg-background/80 hover:bg-background rounded-lg border border-border transition-colors"
            >
              {copied === 'basic' ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </div>
          
          <p className="text-sm text-muted-foreground mt-4">
            That&apos;s it! A chat button will appear in the bottom-right corner of your site.
          </p>
        </div>

        {/* Business Customization Section */}
        <div className="bg-gradient-to-br from-primary/5 to-orange-500/5 border border-primary/20 rounded-2xl p-8 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold text-foreground">Customize for Your Business</h2>
          </div>
          
          <p className="text-muted-foreground mb-6">
            Make BlueTAO your own AI assistant by adding your business information. When visitors ask questions, the AI will respond with context about your specific services, products, and policies.
          </p>

          <div className="bg-card border border-border rounded-xl p-6 mb-6">
            <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-primary" />
              Example: Dental Office
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex gap-3">
                <span className="text-muted-foreground min-w-[80px]">Visitor:</span>
                <span className="text-foreground">&quot;Is a root canal painful?&quot;</span>
              </div>
              <div className="flex gap-3">
                <span className="text-muted-foreground min-w-[80px]">AI:</span>
                <span className="text-foreground">&quot;At Dr. Smith&apos;s Dental Office, we specialize in pain-free dentistry. Our root canal procedures use rotary endodontics with local anesthesia and optional nitrous oxide sedation. Most patients report feeling comfortable throughout the 45-60 minute procedure...&quot;</span>
              </div>
            </div>
          </div>
          
          <div className="relative">
            <pre className="bg-[#1a1612] border border-border rounded-xl p-4 overflow-x-auto text-sm">
              <code className="text-amber-500 whitespace-pre">{customEmbed}</code>
            </pre>
            <button
              onClick={() => copyToClipboard(customEmbed, 'custom')}
              className="absolute top-3 right-3 p-2 bg-background/80 hover:bg-background rounded-lg border border-border transition-colors"
            >
              {copied === 'custom' ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* Configuration Options */}
        <div className="bg-card border border-border rounded-2xl p-8 mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-6">Configuration Options</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-foreground font-medium">Attribute</th>
                  <th className="text-left py-3 px-4 text-foreground font-medium">Description</th>
                  <th className="text-left py-3 px-4 text-foreground font-medium">Example</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4"><code className="text-amber-500">data-company</code></td>
                  <td className="py-3 px-4">Your business name (shown in chat header)</td>
                  <td className="py-3 px-4"><code>&quot;Dr. Smith&apos;s Dental&quot;</code></td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4"><code className="text-amber-500">data-context</code></td>
                  <td className="py-3 px-4">Business information, services, FAQs, policies</td>
                  <td className="py-3 px-4"><code>&quot;We offer...&quot;</code></td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4"><code className="text-amber-500">data-context-url</code></td>
                  <td className="py-3 px-4">URL to a text file with your business info (for longer content)</td>
                  <td className="py-3 px-4"><code>&quot;https://...&quot;</code></td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4"><code className="text-amber-500">data-welcome</code></td>
                  <td className="py-3 px-4">Custom welcome message</td>
                  <td className="py-3 px-4"><code>&quot;Hi! How can I help?&quot;</code></td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-3 px-4"><code className="text-amber-500">data-position</code></td>
                  <td className="py-3 px-4">Button position: &quot;right&quot; or &quot;left&quot;</td>
                  <td className="py-3 px-4"><code>&quot;left&quot;</code></td>
                </tr>
                <tr>
                  <td className="py-3 px-4"><code className="text-amber-500">data-color</code></td>
                  <td className="py-3 px-4">Primary button color (hex)</td>
                  <td className="py-3 px-4"><code>&quot;#3b82f6&quot;</code></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* External Context File */}
        <div className="bg-card border border-border rounded-2xl p-8 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold text-foreground">Using an External Context File</h2>
          </div>
          
          <p className="text-muted-foreground mb-6">
            For longer business information (services, FAQs, policies), host a text file on your server and reference it with <code className="bg-muted px-2 py-0.5 rounded text-sm">data-context-url</code>:
          </p>
          
          <div className="relative mb-6">
            <pre className="bg-[#1a1612] border border-border rounded-xl p-4 overflow-x-auto text-sm">
              <code className="text-amber-500 whitespace-pre">{contextUrlEmbed}</code>
            </pre>
            <button
              onClick={() => copyToClipboard(contextUrlEmbed, 'contextUrl')}
              className="absolute top-3 right-3 p-2 bg-background/80 hover:bg-background rounded-lg border border-border transition-colors"
            >
              {copied === 'contextUrl' ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
          </div>

          <div className="bg-muted/50 rounded-xl p-4">
            <p className="text-sm font-medium text-foreground mb-2">Example ai-context.txt:</p>
            <pre className="text-sm text-muted-foreground whitespace-pre-wrap">
{`About Us:
Dr. Smith's Dental Office has been serving the community since 1995.

Services:
- General dentistry (cleanings, fillings, exams)
- Cosmetic dentistry (whitening, veneers)
- Root canals (pain-free with sedation options)
- Emergency same-day appointments available

Location & Hours:
123 Main Street, Suite 100
Monday-Friday: 8am-6pm
Saturday: 9am-2pm

Insurance:
We accept most major dental insurance plans.`}
            </pre>
          </div>
        </div>

        {/* JavaScript API */}
        <div className="bg-card border border-border rounded-2xl p-8 mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">JavaScript API</h2>
          <p className="text-muted-foreground mb-6">
            Control the widget programmatically:
          </p>
          
          <div className="space-y-4">
            <div className="bg-[#1a1612] border border-border rounded-xl p-4">
              <code className="text-sm">
                <span className="text-amber-500">BlueTAO</span>
                <span className="text-white">.open()</span>
                <span className="text-muted-foreground ml-4">// Open the chat widget</span>
              </code>
            </div>
            <div className="bg-[#1a1612] border border-border rounded-xl p-4">
              <code className="text-sm">
                <span className="text-amber-500">BlueTAO</span>
                <span className="text-white">.close()</span>
                <span className="text-muted-foreground ml-4">// Close the chat widget</span>
              </code>
            </div>
            <div className="bg-[#1a1612] border border-border rounded-xl p-4">
              <code className="text-sm">
                <span className="text-amber-500">BlueTAO</span>
                <span className="text-white">.toggle()</span>
                <span className="text-muted-foreground ml-4">// Toggle open/close</span>
              </code>
            </div>
            <div className="bg-[#1a1612] border border-border rounded-xl p-4">
              <code className="text-sm">
                <span className="text-amber-500">BlueTAO</span>
                <span className="text-white">.setContext(text)</span>
                <span className="text-muted-foreground ml-4">// Update context dynamically</span>
              </code>
            </div>
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Lightning Fast</h3>
            <p className="text-muted-foreground text-sm">
              Lightweight script loads asynchronously without blocking your page.
            </p>
          </div>
          
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Mobile Friendly</h3>
            <p className="text-muted-foreground text-sm">
              Responsive design that works beautifully on all screen sizes.
            </p>
          </div>
          
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">Secure</h3>
            <p className="text-muted-foreground text-sm">
              Sandboxed iframe keeps your site secure and isolated.
            </p>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-card border border-border rounded-2xl p-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">Live Preview</h2>
          <p className="text-muted-foreground mb-6">
            See how the widget looks on your site:
          </p>
          
          <div className="relative bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl h-[400px] overflow-hidden">
            <div className="absolute inset-0 flex items-center justify-center text-slate-400">
              <p>Your website content here</p>
            </div>
            <iframe 
              src="/embed" 
              className="absolute bottom-0 right-0 w-[400px] h-[400px] border-0"
              title="BlueTAO Chat Widget Preview"
            />
          </div>
          
          <div className="mt-6 flex items-center justify-center gap-4">
            <Link 
              href="/embed" 
              target="_blank"
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
            >
              Open Full Preview
              <ExternalLink className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-card/30 py-8 mt-16">
        <div className="container mx-auto px-4 text-center text-muted-foreground text-sm">
          <p>BlueTAO - Decentralized AI powered by Bittensor</p>
        </div>
      </footer>
    </div>
  )
}

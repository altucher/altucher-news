'use client'

import { useState } from 'react'
import { Copy, Check, Code, ExternalLink } from 'lucide-react'
import Link from 'next/link'

export default function DevelopersPage() {
  const [copied, setCopied] = useState(false)
  
  const embedCode = `<script src="https://bluetao.ai/widget.js" async></script>`
  
  const copyToClipboard = () => {
    navigator.clipboard.writeText(embedCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
            Add AI-powered chat to any website with a single line of code. Powered by Bittensor&apos;s decentralized AI network.
          </p>
        </div>

        {/* Embed Code Section */}
        <div className="bg-card border border-border rounded-2xl p-8 mb-12">
          <h2 className="text-2xl font-semibold text-foreground mb-4">Quick Start</h2>
          <p className="text-muted-foreground mb-6">
            Add this script tag to your website, just before the closing <code className="bg-muted px-2 py-0.5 rounded text-sm">&lt;/body&gt;</code> tag:
          </p>
          
          <div className="relative">
            <pre className="bg-[#1a1612] border border-border rounded-xl p-4 overflow-x-auto">
              <code className="text-amber-500 text-sm">{embedCode}</code>
            </pre>
            <button
              onClick={copyToClipboard}
              className="absolute top-3 right-3 p-2 bg-background/80 hover:bg-background rounded-lg border border-border transition-colors"
            >
              {copied ? (
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

        {/* JavaScript API */}
        <div className="bg-card border border-border rounded-2xl p-8 mb-12">
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

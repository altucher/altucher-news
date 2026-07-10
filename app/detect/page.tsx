'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, Link as LinkIcon, Image as ImageIcon, FileText, Loader2, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import Link from 'next/link'

type Sentence = { text: string; score: number }

type DetectionResult = {
  isAI: boolean
  confidence: number
  similarity?: number
  aiProbability?: number
  sentences?: Sentence[]
} | null

export default function DetectPage() {
  const [mode, setMode] = useState<'image' | 'text' | 'video'>('image')
  const [text, setText] = useState('')
  const [deepScan, setDeepScan] = useState(true)
  const [imageUrl, setImageUrl] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<DetectionResult>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }
    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
    setImageUrl('')
    setResult(null)
    setError(null)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleUrlChange = (url: string) => {
    setImageUrl(url)
    setSelectedFile(null)
    setPreviewUrl(null)
    setResult(null)
    setError(null)
  }

  const handleModeChange = (nextMode: 'image' | 'text') => {
    setMode(nextMode)
    setResult(null)
    setError(null)
  }

  const handleAnalyze = async () => {
    setIsAnalyzing(true)
    setError(null)
    setResult(null)

    try {
      let response: Response

      if (mode === 'text') {
        response = await fetch('/api/detect-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, deepScan }),
        })
      } else {
        const formData = new FormData()
        if (selectedFile) {
          formData.append('file', selectedFile)
        } else if (imageUrl) {
          formData.append('url', imageUrl)
        }
        response = await fetch('/api/detect', {
          method: 'POST',
          body: formData,
        })
      }

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to analyze')
      }

      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const canAnalyze =
    (mode === 'text' ? text.trim().length > 0 : selectedFile || imageUrl.trim()) &&
    !isAnalyzing

  const getResultColor = () => {
    if (!result) return ''
    if (result.isAI) return 'text-red-400'
    return 'text-green-400'
  }

  const getConfidenceLabel = () => {
    if (!result) return ''
    const pct = Math.round(result.confidence * 100)
    if (result.isAI) {
      return `${pct}% likely AI-generated`
    }
    return mode === 'text' ? `${pct}% likely human-written` : `${pct}% likely authentic`
  }

  const heatmapColor = (score: number) => {
    // green (human) -> red (AI)
    if (score >= 0.75) return 'bg-red-500/30 text-red-100'
    if (score >= 0.5) return 'bg-orange-500/25 text-orange-100'
    if (score >= 0.25) return 'bg-yellow-500/20 text-yellow-100'
    return 'bg-green-500/15 text-green-100'
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-blue-500" style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
            BlueTAO
          </Link>
          <span className="text-sm text-gray-400">Powered by Bittensor</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 py-16">
        {/* Title */}
        <div className="text-center mb-12">
          <p className="text-cyan-400 text-sm tracking-widest mb-4">POWERED BY BITTENSOR</p>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">AI Content Detector</h1>
          <p className="text-gray-400 text-lg">
            {mode === 'text'
              ? 'Paste text to check if it was written by AI.'
              : 'Upload an image to instantly check if it was generated by AI.'}
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="flex justify-center mb-8">
          <div className="bg-white/5 rounded-full p-1 inline-flex">
            <button
              onClick={() => handleModeChange('image')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-2 ${
                mode === 'image' ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:text-white'
              }`}
            >
              <ImageIcon className="w-4 h-4" />
              Image
            </button>
            <button
              onClick={() => handleModeChange('text')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-2 ${
                mode === 'text' ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:text-white'
              }`}
            >
              <FileText className="w-4 h-4" />
              Text
            </button>
            <button
              onClick={() => setMode('video')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-2 ${
                mode === 'video' ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-400 hover:text-white'
              }`}
              disabled
              title="Coming soon"
            >
              <span className="opacity-50">Video (Coming Soon)</span>
            </button>
          </div>
        </div>

        {/* Upload / Input Area */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
          {mode === 'text' ? (
            <div>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setResult(null)
                  setError(null)
                }}
                placeholder="Paste or type the text you want to check..."
                rows={10}
                maxLength={500000}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400/50 resize-y leading-relaxed"
              />
              <div className="flex items-center justify-between mt-3">
                <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deepScan}
                    onChange={(e) => setDeepScan(e.target.checked)}
                    className="accent-cyan-500 w-4 h-4"
                  />
                  Deep scan (per-sentence heatmap)
                </label>
                <span className="text-xs text-gray-500">{text.length.toLocaleString()} chars</span>
              </div>
            </div>
          ) : (
          <>
          {/* Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${
              isDragging ? 'border-cyan-400 bg-cyan-400/10' : 'border-white/20 hover:border-white/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              className="hidden"
            />
            
            {previewUrl ? (
              <div className="space-y-4">
                <img src={previewUrl} alt="Preview" className="max-h-64 mx-auto rounded-lg" />
                <p className="text-gray-400 text-sm">{selectedFile?.name}</p>
              </div>
            ) : (
              <div className="space-y-4">
                <Upload className="w-12 h-12 mx-auto text-gray-500" />
                <div>
                  <p className="text-gray-300">Drop your image here or <span className="text-cyan-400">browse</span></p>
                  <p className="text-gray-500 text-sm mt-2">JPG, PNG, WebP</p>
                </div>
              </div>
            )}
          </div>

          {/* URL Input */}
          <div className="mt-6">
            <p className="text-gray-500 text-xs text-center mb-3">OR PASTE A URL</p>
            <div className="relative">
              <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="Enter image URL"
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-12 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400/50"
              />
            </div>
            <p className="text-gray-500 text-xs mt-2 text-center">
              Direct image URLs only (right click → Copy image address)
            </p>
          </div>
          </>
          )}

          {/* Analyze Button */}
          <button
            onClick={handleAnalyze}
            disabled={!canAnalyze}
            className={`w-full mt-6 py-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
              canAnalyze
                ? 'bg-cyan-500 hover:bg-cyan-600 text-white'
                : 'bg-white/10 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Analyzing...
              </>
            ) : (
              mode === 'text' ? 'Analyze Text' : 'Analyze Image'
            )}
          </button>

          {/* Error */}
          {error && (
            <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className={`mt-6 p-6 rounded-lg border ${
              result.isAI ? 'bg-red-500/10 border-red-500/20' : 'bg-green-500/10 border-green-500/20'
            }`}>
              <div className="flex items-center gap-3 mb-4">
                {result.isAI ? (
                  <XCircle className="w-8 h-8 text-red-400" />
                ) : (
                  <CheckCircle className="w-8 h-8 text-green-400" />
                )}
                <div>
                  <h3 className={`text-xl font-semibold ${getResultColor()}`}>
                    {result.isAI ? 'AI Generated' : mode === 'text' ? 'Likely Human' : 'Likely Authentic'}
                  </h3>
                  <p className="text-gray-400 text-sm">{getConfidenceLabel()}</p>
                </div>
              </div>
              
              {/* Confidence Bar */}
              <div className="mt-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-400">Confidence</span>
                  <span className={getResultColor()}>{Math.round(result.confidence * 100)}%</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-500 ${result.isAI ? 'bg-red-500' : 'bg-green-500'}`}
                    style={{ width: `${result.confidence * 100}%` }}
                  />
                </div>
              </div>

              {/* Sentence-level heatmap */}
              {mode === 'text' && result.sentences && result.sentences.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-gray-300 text-sm font-medium">Sentence breakdown</span>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>Human</span>
                      <span className="inline-block h-2 w-20 rounded-full bg-gradient-to-r from-green-500/60 via-yellow-500/60 to-red-500/60" />
                      <span>AI</span>
                    </div>
                  </div>
                  <p className="leading-relaxed text-sm">
                    {result.sentences.map((s, i) => (
                      <span
                        key={i}
                        className={`rounded px-1 py-0.5 mr-0.5 ${heatmapColor(s.score)}`}
                        title={`${Math.round(s.score * 100)}% AI`}
                      >
                        {s.text}
                      </span>
                    ))}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Note */}
        <p className="text-center text-gray-500 text-sm mt-8">
          {mode === 'text' ? (
            <>
              Text detection powered by{' '}
              <a href="https://its-ai.org" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">It&apos;s AI</a>{' '}
              (Bittensor Subnet 32).
            </>
          ) : (
            <>
              Image detection powered by{' '}
              <a href="https://bitmind.ai" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">BitMind</a>{' '}
              on the Bittensor network.
            </>
          )}
        </p>
      </main>
    </div>
  )
}

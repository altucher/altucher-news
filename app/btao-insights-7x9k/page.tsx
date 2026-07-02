'use client'

import { useState, useEffect } from 'react'
import { Loader2, MessageSquare, Image as ImageIcon, DollarSign, Users, Calendar, TrendingUp, RefreshCw, Globe, Eye, Search, Music } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface AnalyticsData {
  summary: {
    totalQueries: number
    totalImageGenerations: number
    totalChatQueries: number
    totalAIDetections?: number
    totalMusicGenerations?: number
    uniqueUsers: number
    activeDays: number
    estimatedChatCost: string
    estimatedImageCost: string
    estimatedMusicCost?: string
    totalEstimatedCost: string
  }
  topCountries?: Array<{ country: string; count: number }>
  dailyStats: Array<{
    date: string
    queries: number
    images: number
    cost: string
  }>
  recentEvents: Array<{
    id: string
    type: string
    prompt: string
    model: string
    tokensUsed: number
    costEstimate: string
    createdAt: string
    usedDesearch?: boolean
  }>
  allQueries: Array<{
    id: string
    type: string
    prompt: string
    model: string
    tokensUsed: number
    costEstimate: string
    createdAt: string
    usedDesearch?: boolean
  }>
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalytics = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/analytics')
      if (!response.ok) throw new Error('Failed to fetch analytics')
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>Loading analytics...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <Button onClick={fetchAnalytics}>Retry</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/30 bg-background/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-[family-name:var(--font-playfair)] text-2xl font-medium text-foreground">
              BlueTAO
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-lg font-medium text-foreground">The Analytics Page</h1>
          </div>
          <Button variant="outline" size="sm" onClick={fetchAnalytics} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <span className="text-sm text-muted-foreground">Total Queries (All Time)</span>
            </div>
            <p className="text-3xl font-semibold text-foreground">
              {data?.summary.totalQueries.toLocaleString() || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {data?.summary.totalChatQueries?.toLocaleString() || 0} chat + {data?.summary.totalImageGenerations?.toLocaleString() || 0} images + {data?.summary.totalAIDetections?.toLocaleString() || 0} detections + {data?.summary.totalMusicGenerations?.toLocaleString() || 0} songs
            </p>
          </div>

          <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-violet-500/10 rounded-lg">
                <ImageIcon className="w-5 h-5 text-violet-600" />
              </div>
              <span className="text-sm text-muted-foreground">Images Generated</span>
            </div>
            <p className="text-3xl font-semibold text-foreground">
              {data?.summary.totalImageGenerations.toLocaleString() || 0}
            </p>
          </div>

          <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-cyan-500/10 rounded-lg">
                <Eye className="w-5 h-5 text-cyan-500" />
              </div>
              <span className="text-sm text-muted-foreground">AI Detections</span>
            </div>
            <p className="text-3xl font-semibold text-foreground">
              {data?.summary.totalAIDetections?.toLocaleString() || 0}
            </p>
          </div>

          <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-emerald-500/10 rounded-lg">
                <Music className="w-5 h-5 text-emerald-600" />
              </div>
              <span className="text-sm text-muted-foreground">Songs Generated</span>
            </div>
            <p className="text-3xl font-semibold text-foreground">
              {data?.summary.totalMusicGenerations?.toLocaleString() || 0}
            </p>
          </div>

          <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <span className="text-sm text-muted-foreground">Est. Total Cost</span>
            </div>
            <p className="text-3xl font-semibold text-foreground">
              ${data?.summary.totalEstimatedCost || '0.0000'}
            </p>
          </div>

          <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Users className="w-5 h-5 text-amber-600" />
              </div>
              <span className="text-sm text-muted-foreground">Unique Users</span>
            </div>
            <p className="text-3xl font-semibold text-foreground">
              {data?.summary.uniqueUsers.toLocaleString() || 0}
            </p>
          </div>
        </div>

        {/* Top Countries */}
        {data?.topCountries && data.topCountries.length > 0 && (
          <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" />
              Top Countries
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {data.topCountries.map((item: { country: string; count: number }) => (
                <div key={item.country} className="flex items-center justify-between p-3 bg-background/50 rounded-lg">
                  <span className="text-foreground font-medium">{item.country}</span>
                  <span className="text-muted-foreground">{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cost Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6">
            <h2 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Cost Breakdown
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Chat Queries</span>
                <span className="font-medium text-foreground">${data?.summary.estimatedChatCost || '0.0000'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Image Generation</span>
                <span className="font-medium text-foreground">${data?.summary.estimatedImageCost || '0.0000'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Music Generation</span>
                <span className="font-medium text-foreground">${data?.summary.estimatedMusicCost || '0.0000'}</span>
              </div>
              <div className="border-t border-border/50 pt-4 flex items-center justify-between">
                <span className="font-medium text-foreground">Total Estimated</span>
                <span className="font-semibold text-primary">${data?.summary.totalEstimatedCost || '0.0000'}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              * Estimates based on Chutes API pricing (~$0.001/1k tokens for chat, ~$0.02/image)
            </p>
          </div>

          <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6">
            <h2 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              Activity Summary
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Active Days</span>
                <span className="font-medium text-foreground">{data?.summary.activeDays || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Avg Queries/Day</span>
                <span className="font-medium text-foreground">
                  {data?.summary.activeDays 
                    ? Math.round(data.summary.totalQueries / data.summary.activeDays).toLocaleString()
                    : 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Avg Queries/User</span>
                <span className="font-medium text-foreground">
                  {data?.summary.uniqueUsers 
                    ? Math.round(data.summary.totalQueries / data.summary.uniqueUsers).toLocaleString()
                    : 0}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Daily Stats Table */}
        <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-medium text-foreground mb-4">Daily Statistics</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Date</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Queries</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Images</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {data?.dailyStats.map((day) => (
                  <tr key={day.date} className="border-b border-border/30 hover:bg-accent/50">
                    <td className="py-3 px-4 text-sm text-foreground">{day.date}</td>
                    <td className="py-3 px-4 text-sm text-foreground text-right">{day.queries.toLocaleString()}</td>
                    <td className="py-3 px-4 text-sm text-foreground text-right">{day.images.toLocaleString()}</td>
                    <td className="py-3 px-4 text-sm text-foreground text-right">${day.cost}</td>
                  </tr>
                ))}
                {(!data?.dailyStats || data.dailyStats.length === 0) && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-muted-foreground">
                      No daily data available yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Events */}
        <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6 mb-8">
          <h2 className="text-lg font-medium text-foreground mb-4">Recent Events (Last 50)</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Time</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Type</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Prompt</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Location</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data?.recentEvents.map((event) => (
                  <tr key={event.id} className="border-b border-border/30 hover:bg-accent/50">
                    <td className="py-3 px-4 text-sm text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                          event.type === 'image_generation' 
                            ? 'bg-violet-500/10 text-violet-600' 
                            : event.type === 'music_generation'
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : event.type === 'ai_detection'
                            ? 'bg-cyan-500/10 text-cyan-600'
                            : 'bg-primary/10 text-primary'
                        }`}>
                          {event.type === 'image_generation' ? (
                            <><ImageIcon className="w-3 h-3" /> Image</>
                          ) : event.type === 'music_generation' ? (
                            <><Music className="w-3 h-3" /> Music</>
                          ) : event.type === 'ai_detection' ? (
                            <><Eye className="w-3 h-3" /> Detect</>
                          ) : (
                            <><MessageSquare className="w-3 h-3" /> Chat</>
                          )}
                        </span>
                        {event.usedDesearch && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-600">
                            <Search className="w-3 h-3" /> Desearch
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground max-w-xs truncate">
                      {event.prompt || '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground">
                      {event.city && event.country ? `${event.city}, ${event.country}` : event.country || '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground text-right">
                      ${event.costEstimate || '-'}
                    </td>
                  </tr>
                ))}
                {(!data?.recentEvents || data.recentEvents.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No events tracked yet. Events will appear here once the analytics_events table is created.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* All Queries Ever */}
        <div className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-6">
          <h2 className="text-lg font-medium text-foreground mb-4">All Queries Ever ({data?.allQueries?.length || 0} total)</h2>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border/50">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Time</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Type</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Full Prompt</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">Model</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data?.allQueries?.map((query) => (
                  <tr key={query.id} className="border-b border-border/30 hover:bg-accent/50">
                    <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">
                      {new Date(query.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
                          query.type === 'image_generation' 
                            ? 'bg-violet-500/10 text-violet-600' 
                            : query.type === 'music_generation'
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : query.type === 'ai_detection'
                            ? 'bg-cyan-500/10 text-cyan-600'
                            : 'bg-primary/10 text-primary'
                        }`}>
                          {query.type === 'image_generation' ? (
                            <><ImageIcon className="w-3 h-3" /> Image</>
                          ) : query.type === 'music_generation' ? (
                            <><Music className="w-3 h-3" /> Music</>
                          ) : query.type === 'ai_detection' ? (
                            <><Eye className="w-3 h-3" /> Detect</>
                          ) : (
                            <><MessageSquare className="w-3 h-3" /> Chat</>
                          )}
                        </span>
                        {query.usedDesearch && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-600">
                            <Search className="w-3 h-3" /> Desearch
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground">
                      <div className="max-w-md whitespace-pre-wrap break-words">
                        {query.prompt || '-'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">
                      {query.model || '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-foreground text-right whitespace-nowrap">
                      ${query.costEstimate || '-'}
                    </td>
                  </tr>
                ))}
                {(!data?.allQueries || data.allQueries.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No queries recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>This page is only accessible via direct URL.</p>
          <p className="mt-1">URL: /btao-insights-7x9k</p>
        </div>
      </main>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'
import { X, FolderCode, Trash2, Loader2, History, ArrowLeft, RotateCcw, Pencil, Globe, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Project {
  id: string
  title: string
  language: string
  project_type: 'site' | 'agent'
  published_url: string | null
  marketplace_listed: boolean
  created_at: string
  updated_at: string
}

interface Version {
  id: string
  label: string | null
  version_number: number
  created_at: string
}

interface ProjectsPanelProps {
  isOpen: boolean
  onClose: () => void
  // Open a project in the chat to keep editing it.
  onOpenProject: (projectId: string) => void
  // Restore a specific version's code as the newest version, then open it.
  onRestoreVersion: (projectId: string, versionId: string) => void
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export function ProjectsPanel({ isOpen, onClose, onOpenProject, onRestoreVersion }: ProjectsPanelProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [updatingListing, setUpdatingListing] = useState<string | null>(null)
  // When set, we're viewing the version history of a single project.
  const [historyFor, setHistoryFor] = useState<Project | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setHistoryFor(null)
      fetchProjects()
    }
  }, [isOpen])

  const fetchProjects = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/projects')
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects || [])
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err)
    } finally {
      setLoading(false)
    }
  }

  const deleteProject = async (id: string) => {
    if (!confirm('Delete this project and all its versions? This cannot be undone.')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setProjects(projects.filter(p => p.id !== id))
      }
    } catch (err) {
      console.error('Failed to delete project:', err)
    } finally {
      setDeleting(null)
    }
  }

  const toggleMarketplaceListing = async (project: Project) => {
    setUpdatingListing(project.id)
    try {
      const res = await fetch(`/api/projects/${project.id}/marketplace`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listed: !project.marketplace_listed }),
      })
      if (res.ok) {
        const data = await res.json()
        setProjects((current) => current.map((item) => item.id === project.id ? { ...item, marketplace_listed: data.listed } : item))
      }
    } catch (err) {
      console.error('Failed to update marketplace listing:', err)
    } finally {
      setUpdatingListing(null)
    }
  }

  const openHistory = async (project: Project) => {
    setHistoryFor(project)
    setLoadingVersions(true)
    try {
      const res = await fetch(`/api/projects/${project.id}`)
      if (res.ok) {
        const data = await res.json()
        setVersions(data.versions || [])
      }
    } catch (err) {
      console.error('Failed to fetch versions:', err)
    } finally {
      setLoadingVersions(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            {historyFor ? (
              <>
                <Button variant="ghost" size="icon" onClick={() => setHistoryFor(null)} className="h-8 w-8">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <History className="w-5 h-5 text-sky-500" />
                <h2 className="text-lg font-semibold text-foreground truncate max-w-[260px]">
                  {historyFor.title}
                </h2>
              </>
            ) : (
              <>
                <FolderCode className="w-5 h-5 text-sky-500" />
                <h2 className="text-lg font-semibold text-foreground">My Projects</h2>
              </>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Version history view */}
          {historyFor ? (
            loadingVersions ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <History className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No versions yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center justify-between gap-2 p-3 bg-background/50 rounded-lg border border-border/50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {v.label || `Version ${v.version_number}`}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDate(v.created_at)}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRestoreVersion(historyFor.id, v.id)}
                      className="flex-shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            )
          ) : loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FolderCode className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p>No saved projects yet</p>
              <p className="text-sm mt-1">
                Build something in BlueTAO Code, then press &quot;Save&quot; to keep it here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between gap-2 p-3 bg-background/50 rounded-lg border border-border/50 group"
                >
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenProject(project.id)}
                      className="w-full text-left"
                    >
                      <p className="text-sm font-medium text-foreground truncate">{project.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Updated {formatDate(project.updated_at)}
                      </p>
                    </button>
                    {project.published_url && (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <a
                          href={project.published_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-sky-500 hover:text-sky-400 hover:underline max-w-full"
                        >
                          <Globe className="w-3 h-3 shrink-0" />
                          <span className="truncate">{project.published_url.replace(/^https?:\/\//, '')}</span>
                        </a>
                        {project.project_type === 'agent' && (
                          <button
                            type="button"
                            onClick={() => toggleMarketplaceListing(project)}
                            disabled={updatingListing === project.id}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-60 ${project.marketplace_listed ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
                          >
                            {updatingListing === project.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Store className="h-3 w-3" />}
                            {project.marketplace_listed ? 'Listed' : 'List agent'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-sky-500"
                      onClick={() => onOpenProject(project.id)}
                      aria-label="Open and continue editing"
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openHistory(project)}
                      aria-label="Version history"
                    >
                      <History className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteProject(project.id)}
                      disabled={deleting === project.id}
                      aria-label="Delete project"
                    >
                      {deleting === project.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {!historyFor && (
          <div className="p-4 border-t border-border text-center">
            <p className="text-xs text-muted-foreground">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'} saved
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

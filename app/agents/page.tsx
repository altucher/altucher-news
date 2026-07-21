import type { Metadata } from 'next'
import { AgentMarketplace } from '@/components/agent-marketplace'

export const metadata: Metadata = {
  title: 'Agent Marketplace | BlueTAO',
  description: 'Discover live AI agents built with BlueTAO for research, productivity, support, education, finance, and creative work.',
}

export default function AgentsPage() {
  return <AgentMarketplace />
}

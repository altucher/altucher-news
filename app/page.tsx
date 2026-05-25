import ChatInterface from '@/components/chat-interface'

// Prevent static generation - this page needs client auth state
export const dynamic = 'force-dynamic'

export default function Home() {
  return <ChatInterface />
}

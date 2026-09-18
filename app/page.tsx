import ChatInterface from '@/components/chat-interface'

// Home is the classic BlueTAO chat (text chat served by James, code mode,
// projects, agents). The personal assistant lives at /assistant.
export const dynamic = 'force-dynamic'

export default function Home() {
  return <ChatInterface />
}

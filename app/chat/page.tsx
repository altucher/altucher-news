import { redirect } from 'next/navigation'

// The classic chat moved back to the home page; keep old links working.
export default function ChatPage() {
  redirect('/')
}

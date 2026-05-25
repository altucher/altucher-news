import type { Metadata } from 'next'
import '../globals.css'

export const metadata: Metadata = {
  title: 'BlueTAO Chat Widget',
  description: 'Embeddable AI chat powered by Bittensor',
}

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="bg-transparent">
      <body className="bg-transparent min-h-screen">
        {children}
      </body>
    </html>
  )
}

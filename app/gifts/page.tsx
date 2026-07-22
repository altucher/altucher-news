import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { GiftCalendar } from '@/components/gift-calendar'

export const metadata: Metadata = {
  title: 'Gift Calendar | BlueTAO GiftFinder',
  description: 'Plan gifts and receive timely reminders for every important occasion.',
}

export default function GiftsPage() {
  return <main className="min-h-screen bg-background px-4 py-6 text-foreground md:px-6 md:py-10">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <Link href="/" className="flex w-fit items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="h-4 w-4"/>Back to BlueTAO</Link>
      <GiftCalendar />
    </div>
  </main>
}

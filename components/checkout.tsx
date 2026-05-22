'use client'

import { useCallback, useState } from 'react'
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

import { startSubscriptionCheckout } from '@/app/actions/stripe'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export default function SubscriptionCheckout({ planId }: { planId: string }) {
  const [error, setError] = useState<string | null>(null)

  const fetchClientSecret = useCallback(async () => {
    try {
      setError(null)
      const secret = await startSubscriptionCheckout(planId)
      return secret
    } catch (err) {
      console.error('[Checkout] Error:', err)
      const message = err instanceof Error ? err.message : 'Failed to start checkout'
      setError(message)
      throw err
    }
  }, [planId])

  if (error) {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
        <p className="text-red-500 font-medium">Something went wrong</p>
        <p className="text-sm text-red-400 mt-1">{error}</p>
        <p className="text-xs text-muted-foreground mt-2">
          Please make sure you are logged in and try again.
        </p>
      </div>
    )
  }

  return (
    <div id="checkout" className="w-full">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ fetchClientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  )
}

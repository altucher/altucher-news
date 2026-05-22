'use client'

import { useCallback, useState, useEffect } from 'react'
import {
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
} from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

import { startSubscriptionCheckout } from '@/app/actions/stripe'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

// Inner component that handles the actual checkout - unmounts/remounts when clientSecret changes
function CheckoutForm({ clientSecret }: { clientSecret: string }) {
  const fetchClientSecret = useCallback(() => {
    return Promise.resolve(clientSecret)
  }, [clientSecret])

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

export default function SubscriptionCheckout({ planId }: { planId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    
    async function fetchSecret() {
      try {
        setError(null)
        setLoading(true)
        const secret = await startSubscriptionCheckout(planId)
        if (!cancelled) {
          setClientSecret(secret)
        }
      } catch (err) {
        console.error('[Checkout] Error:', err)
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to start checkout'
          setError(message)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchSecret()
    
    return () => {
      cancelled = true
    }
  }, [planId])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div>
      </div>
    )
  }

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

  if (!clientSecret) {
    return (
      <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
        <p className="text-yellow-500 font-medium">Unable to load checkout</p>
        <p className="text-sm text-muted-foreground mt-1">Please try again.</p>
      </div>
    )
  }

  // Key forces full remount when clientSecret changes
  return <CheckoutForm key={clientSecret} clientSecret={clientSecret} />
}

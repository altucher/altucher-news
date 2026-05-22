'use server'

import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { SUBSCRIPTION_PLANS, getPlanById } from '@/lib/products'
import { createClient } from '@/lib/supabase/server'

export async function startSubscriptionCheckout(planId: string) {
  try {
    // Get the plan
    const plan = getPlanById(planId)
    if (!plan || plan.id === 'free') {
      throw new Error(`Invalid plan: "${planId}"`)
    }

    // Get current user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError) {
      console.error('[Stripe] Auth error:', authError)
      throw new Error('Authentication error')
    }
    
    if (!user) {
      throw new Error('You must be logged in to subscribe')
    }

    console.log('[Stripe] Creating checkout for user:', user.id, 'plan:', planId)

    // Check if user already has a Stripe customer ID
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()

    if (subError && subError.code !== 'PGRST116') {
      console.error('[Stripe] Subscription lookup error:', subError)
    }

    let customerId = subscription?.stripe_customer_id

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      console.log('[Stripe] Creating new Stripe customer for:', user.email)
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      })
      customerId = customer.id
      console.log('[Stripe] Created customer:', customerId)
    }

    // Get the origin for redirect URLs
    const headersList = await headers()
    const origin = headersList.get('origin') || 'http://localhost:3000'

    console.log('[Stripe] Creating checkout session with price:', plan.priceInCents)

    // Create Checkout Session for subscription
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      customer: customerId,
      redirect_on_completion: 'never',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `BlueTAO ${plan.name}`,
              description: plan.description,
            },
            unit_amount: plan.priceInCents,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan_id: plan.id,
        },
      },
    })

    console.log('[Stripe] Checkout session created:', session.id)
    return session.client_secret
  } catch (error) {
    console.error('[Stripe] Checkout error:', error)
    throw error
  }
}

export async function createBillingPortalSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    throw new Error('You must be logged in')
  }

  // Get user's Stripe customer ID
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .single()

  if (!subscription?.stripe_customer_id) {
    throw new Error('No subscription found')
  }

  const headersList = await headers()
  const origin = headersList.get('origin') || 'http://localhost:3000'

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: `${origin}/pricing`,
  })

  return session.url
}

export async function getUserSubscription() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { tier: 'free', status: 'active' }
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!subscription) {
    return { tier: 'free', status: 'active' }
  }

  return subscription
}

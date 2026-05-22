export interface SubscriptionPlan {
  id: string
  name: string
  description: string
  priceInCents: number
  messagesPerDay: number
  features: string[]
  stripePriceId?: string
}

// Subscription tiers - prices include 10% margin over Chutes costs
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Try BlueTAO with limited daily messages',
    priceInCents: 0,
    messagesPerDay: 50,
    features: [
      '50 messages per day',
      'Access to all AI models',
      'Basic chat history',
    ],
  },
  {
    id: 'base',
    name: 'Base',
    description: 'Perfect for casual users',
    priceInCents: 399, // $3.99/month
    messagesPerDay: 300,
    stripePriceId: 'price_1TZvC1RT7TYD7CahxOqTcgxn',
    features: [
      '300 messages per day',
      'Access to all AI models',
      'Full chat history',
      'Priority support',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    description: 'For power users who need more',
    priceInCents: 1099, // $10.99/month
    messagesPerDay: 2000,
    stripePriceId: 'price_1TZvC1RT7TYD7Cah53z1ted1',
    features: [
      '2,000 messages per day',
      'Access to all AI models',
      'Full chat history',
      'Priority support',
      'Early access to new features',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Unlimited potential for professionals',
    priceInCents: 2199, // $21.99/month
    messagesPerDay: 5000,
    stripePriceId: 'price_1TZvC1RT7TYD7CahQmW8GuhI',
    features: [
      '5,000 messages per day',
      'Access to all AI models',
      'Full chat history',
      'Priority support',
      'Early access to new features',
      'API access (coming soon)',
    ],
  },
]

// Helper to get plan by ID
export function getPlanById(planId: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find(plan => plan.id === planId)
}

// Helper to get message limit for a tier
export function getMessageLimit(tier: string): number {
  const plan = getPlanById(tier)
  return plan?.messagesPerDay ?? 50 // Default to free tier limit
}

// Format price for display
export function formatPrice(priceInCents: number): string {
  if (priceInCents === 0) return 'Free'
  return `$${(priceInCents / 100).toFixed(2)}`
}

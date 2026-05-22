'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SUBSCRIPTION_PLANS, formatPrice } from '@/lib/products'
import SubscriptionCheckout from '@/components/checkout'
import { AnimatedOceanBackground } from '@/components/animated-background'
import Link from 'next/link'

export default function PricingPage() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)

  return (
    <div className="min-h-screen relative">
      <AnimatedOceanBackground />
      
      <div className="relative z-10">
        {/* Header */}
        <header className="p-4 flex items-center justify-between">
          <Link 
            href="/"
            className="font-[family-name:var(--font-playfair)] text-2xl font-medium text-foreground tracking-wide"
          >
            BlueTAO
          </Link>
          <Link href="/">
            <Button variant="outline" className="rounded-full border-border/50">
              Back to Chat
            </Button>
          </Link>
        </header>

        {/* Main Content */}
        <main className="max-w-6xl mx-auto px-4 py-12">
          <div className="text-center mb-12">
            <h1 className="font-[family-name:var(--font-playfair)] text-4xl md:text-5xl font-normal text-foreground mb-4">
              Choose Your Plan
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Unlock the full potential of BlueTAO with our flexible subscription plans.
              Start free and upgrade as you grow.
            </p>
          </div>

          {/* Pricing Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {SUBSCRIPTION_PLANS.map((plan) => (
              <div
                key={plan.id}
                className={cn(
                  'relative rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm p-6 flex flex-col',
                  plan.id === 'plus' && 'border-primary shadow-sm',
                  plan.id === selectedPlan && 'ring-2 ring-primary'
                )}
              >
                {plan.id === 'plus' && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-primary-foreground text-xs font-medium rounded-full">
                    Most Popular
                  </div>
                )}

                <h3 className="text-xl font-semibold text-foreground mb-2">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>

                <div className="mb-6">
                  <span className="text-4xl font-semibold text-foreground">
                    {formatPrice(plan.priceInCents)}
                  </span>
                  {plan.priceInCents > 0 && (
                    <span className="text-muted-foreground">/month</span>
                  )}
                </div>

                <ul className="space-y-3 mb-6 flex-1">
                  {plan.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>

                {plan.id === 'free' ? (
                  <Link href="/">
                    <Button variant="outline" className="w-full border-border/50">
                      Get Started
                    </Button>
                  </Link>
                ) : (
                  <Button
                    onClick={() => setSelectedPlan(plan.id)}
                    className={cn(
                      'w-full',
                      plan.id === 'plus'
                        ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                        : 'bg-foreground/10 hover:bg-foreground/20 text-foreground'
                    )}
                  >
                    {selectedPlan === plan.id ? 'Selected' : 'Subscribe'}
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Checkout Section */}
          {selectedPlan && selectedPlan !== 'free' && (
            <div className="max-w-xl mx-auto">
              <div className="bg-card/80 backdrop-blur-sm rounded-xl border border-border/50 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-foreground">
                    Complete Your Subscription
                  </h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedPlan(null)}
                  >
                    Cancel
                  </Button>
                </div>
                <SubscriptionCheckout planId={selectedPlan} />
              </div>
            </div>
          )}

          {/* FAQ or Additional Info */}
          <div className="mt-16 text-center">
            <p className="text-muted-foreground">
              All plans include access to all AI models. Cancel anytime.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Questions? Contact us at support@bluetao.ai
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}

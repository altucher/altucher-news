'use client'

export function AnimatedOceanBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      {/* Elegant cream gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-secondary/30 to-accent/20" />
      
      {/* Subtle geometric pattern overlay */}
      <div className="absolute inset-0 opacity-[0.02]">
        <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="elegant-grid" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M 60 0 L 0 0 0 60" fill="none" stroke="currentColor" strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#elegant-grid)" />
        </svg>
      </div>
      
      {/* Floating elegant shapes */}
      <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-primary/[0.02] blur-3xl animate-float-gentle" />
      <div className="absolute bottom-1/3 left-1/3 w-80 h-80 rounded-full bg-muted-foreground/[0.02] blur-3xl animate-float-gentle" style={{ animationDelay: '4s' }} />
    </div>
  )
}

export function BlueTaoLogo({ className = "w-16 h-16" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 80 80"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Elegant outer ring */}
      <circle 
        cx="40" 
        cy="40" 
        r="36" 
        stroke="currentColor" 
        strokeWidth="1" 
        opacity="0.15" 
      />
      
      {/* Inner refined circle */}
      <circle 
        cx="40" 
        cy="40" 
        r="28" 
        stroke="currentColor" 
        strokeWidth="0.75" 
        opacity="0.1" 
      />
      
      {/* Elegant Tao-inspired symbol - flowing curves */}
      <path
        d="M40 12 C55 12 65 25 65 40 C65 55 55 68 40 68 C25 68 15 55 15 40 C15 25 25 12 40 12"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        opacity="0.2"
      />
      
      {/* Sophisticated S-curve divider */}
      <path
        d="M40 15 C52 22 52 35 40 40 C28 45 28 58 40 65"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
      
      {/* Upper dot - yin */}
      <circle 
        cx="48" 
        cy="28" 
        r="5" 
        fill="currentColor" 
        opacity="0.7" 
      />
      <circle 
        cx="48" 
        cy="28" 
        r="2" 
        fill="currentColor" 
        opacity="0.1" 
      />
      
      {/* Lower dot - yang */}
      <circle 
        cx="32" 
        cy="52" 
        r="5" 
        fill="none"
        stroke="currentColor" 
        strokeWidth="1.5"
        opacity="0.5" 
      />
      <circle 
        cx="32" 
        cy="52" 
        r="2" 
        fill="currentColor" 
        opacity="0.6" 
      />
    </svg>
  )
}

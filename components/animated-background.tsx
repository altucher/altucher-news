'use client'

export function AnimatedOceanBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-sky-50 via-sky-100/50 to-sky-200/30" />
      
      {/* Animated waves */}
      <svg
        className="absolute bottom-0 w-full h-[60vh] opacity-40"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="waveGradient1" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id="waveGradient2" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#0284c7" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        
        {/* Wave 1 - slowest, back */}
        <path
          fill="url(#waveGradient1)"
          className="animate-wave-slow"
          d="M0,160L48,176C96,192,192,224,288,213.3C384,203,480,149,576,138.7C672,128,768,160,864,181.3C960,203,1056,213,1152,197.3C1248,181,1344,139,1392,117.3L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
        />
        
        {/* Wave 2 - medium speed */}
        <path
          fill="url(#waveGradient2)"
          className="animate-wave-medium"
          d="M0,224L48,213.3C96,203,192,181,288,181.3C384,181,480,203,576,218.7C672,235,768,245,864,234.7C960,224,1056,192,1152,181.3C1248,171,1344,181,1392,186.7L1440,192L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
        />
        
        {/* Wave 3 - fastest, front */}
        <path
          fill="#bae6fd"
          fillOpacity="0.3"
          className="animate-wave-fast"
          d="M0,288L48,272C96,256,192,224,288,218.7C384,213,480,235,576,245.3C672,256,768,256,864,240C960,224,1056,192,1152,186.7C1248,181,1344,203,1392,213.3L1440,224L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
        />
      </svg>
      
      {/* Floating particles/bubbles */}
      <div className="absolute inset-0">
        {[...Array(15)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-sky-300/20 animate-float"
            style={{
              width: `${Math.random() * 8 + 4}px`,
              height: `${Math.random() * 8 + 4}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 5}s`,
              animationDuration: `${Math.random() * 10 + 10}s`,
            }}
          />
        ))}
      </div>
      
      {/* Light rays from top */}
      <div className="absolute top-0 left-1/4 w-1/2 h-full opacity-20">
        <div className="absolute top-0 left-0 w-32 h-full bg-gradient-to-b from-white/40 to-transparent transform -skew-x-12 animate-shimmer" />
        <div className="absolute top-0 left-1/3 w-24 h-full bg-gradient-to-b from-white/30 to-transparent transform skew-x-6 animate-shimmer-delayed" />
        <div className="absolute top-0 right-1/4 w-20 h-full bg-gradient-to-b from-white/20 to-transparent transform -skew-x-3 animate-shimmer-slow" />
      </div>
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
      {/* Outer circle - Tao symbol base */}
      <circle cx="40" cy="40" r="35" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      
      {/* Yin-Yang inspired water symbol */}
      <path
        d="M40 5C20.67 5 5 20.67 5 40s15.67 35 35 35 35-15.67 35-35S59.33 5 40 5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.2"
      />
      
      {/* Wave forms - representing water/ocean */}
      <path
        d="M15 45 Q22 38 30 45 T45 45 T60 45 T70 45"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
        className="animate-wave-path"
      />
      <path
        d="M12 52 Q20 45 28 52 T44 52 T60 52 T72 52"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
        className="animate-wave-path-delayed"
      />
      <path
        d="M18 38 Q24 32 32 38 T48 38 T62 38"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.4"
      />
      
      {/* Tao dot - top */}
      <circle cx="40" cy="25" r="4" fill="currentColor" opacity="0.8" />
      
      {/* Small accent dots - like water droplets */}
      <circle cx="25" cy="32" r="2" fill="currentColor" opacity="0.4" />
      <circle cx="55" cy="30" r="1.5" fill="currentColor" opacity="0.3" />
      <circle cx="62" cy="42" r="1" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

import { withWorkflow } from 'workflow/next'

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    nodeMiddleware: true,
  },
  // hex, the classifier, first shipped at /classify; the old paths still work.
  async redirects() {
    return [
      { source: '/classify', destination: '/hex', permanent: true },
      { source: '/api/classify/:path*', destination: '/api/hex/:path*', permanent: true },
    ]
  },
}

export default withWorkflow(nextConfig)

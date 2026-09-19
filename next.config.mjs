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
  // jex, the classifier, first shipped at /classify and then /hex; the old
  // paths still work.
  async redirects() {
    return [
      { source: '/classify', destination: '/jex', permanent: true },
      { source: '/hex', destination: '/jex', permanent: true },
      { source: '/api/classify/:path*', destination: '/api/jex/:path*', permanent: true },
      { source: '/api/hex/:path*', destination: '/api/jex/:path*', permanent: true },
    ]
  },
}

export default withWorkflow(nextConfig)

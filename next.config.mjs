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
  // BlockCraft (public/blockcraft) is a static WebGL game; its pages use
  // relative module paths, so always land on the real index.html URL.
  async redirects() {
    return [
      { source: '/blockcraft', destination: '/blockcraft/index.html', permanent: false },
      { source: '/minecraft', destination: '/blockcraft/index.html', permanent: false },
    ]
  },
}

export default withWorkflow(nextConfig)

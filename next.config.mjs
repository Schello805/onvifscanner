/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  // Use separate build dirs to avoid dev/build cache corruption.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracing: false,
  async headers() {
    return [
      // Keep long-term caching for build artifacts.
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable"
          }
        ]
      },
      // Avoid stale HTML referencing old chunk hashes after updates & apply security headers.
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
          },
          {
            key: "Pragma",
            value: "no-cache"
          },
          {
            key: "Expires",
            value: "0"
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff"
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN"
          },
          {
            key: "Referrer-Policy",
            value: "same-origin"
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()"
          }
        ]
      },
      // Video streaming endpoint: allow byte range requests and browser caching
      {
        source: "/api/nvr/recordings/stream",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=86400"
          },
          {
            key: "Accept-Ranges",
            value: "bytes"
          }
        ]
      }
    ];
  }
};

export default nextConfig;

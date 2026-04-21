/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Use separate build dirs to avoid dev/build cache corruption.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
      // Avoid stale HTML referencing old chunk hashes after updates.
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store"
          }
        ]
      }
    ];
  }
};

export default nextConfig;

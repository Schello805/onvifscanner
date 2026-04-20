/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Use separate build dirs to avoid dev/build cache corruption.
  distDir: process.env.NEXT_DIST_DIR || ".next"
};

export default nextConfig;

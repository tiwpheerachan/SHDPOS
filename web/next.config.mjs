/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

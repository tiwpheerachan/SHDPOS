/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_BUILD_DIR || ".next",
  eslint: { ignoreDuringBuilds: true },
  // instrumentation.ts: วงรอบส่งบิลขาย → OneWarehouse ในโปรเซสเว็บ (Render free ไม่มี background worker)
  experimental: { instrumentationHook: true },
};

export default nextConfig;

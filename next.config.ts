import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Lets a verification build run alongside `next dev` without clobbering its .next folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // undici is used server-side for SSRF-pinned outbound requests; keep it out of the bundle.
  serverExternalPackages: ["undici"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

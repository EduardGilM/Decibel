import type { NextConfig } from "next";

// Static export: the same `out/` build runs as PWA, inside Tauri (desktop/mobile)
// or behind any static file server. No server routes, middleware or image optimizer.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;

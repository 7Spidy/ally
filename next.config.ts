import type { NextConfig } from "next";

// Portraits, avatars, videos, logos and first-run art rarely change, so let the browser and CDN keep them for a
// day and serve a stale copy for a week while revalidating, instead of re-checking on every visit. A replaced
// image shows up within a day, or on the visit after.
const LONG_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/assets/:path*", headers: [{ key: "Cache-Control", value: LONG_CACHE }] }];
  },
};

export default nextConfig;
